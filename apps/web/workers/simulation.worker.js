// @ts-nocheck — Web Worker entry point; JSDoc strict-mode type checks on the
// LRU cache helpers and the postMessage handlers are out of scope here.
import { simulateStrategyScenarioMatrix } from "@mortgage/simulation-engine";
import enNZ from "@/messages/en-NZ.json";
import zhCN from "@/messages/zh-CN.json";
import { interpolate } from "@/lib/i18n/interpolate.js";

const DB_NAME = "MortgageStrategyDB";
const DB_VERSION = 1;

/**
 * Map of supported locales to their dictionaries. JSON imports work in
 * module workers under Next 16, so this is the same data the React tree
 * sees — the worker is just a thin i18n client.
 */
const DICT = {
  "en-NZ": enNZ,
  "zh-CN": zhCN
};

/**
 * Look up a translation key in the active dictionary and apply
 * `{name}`-style placeholders. Falls back to the English dictionary
 * then to the bracketed key form so a missing key never crashes the
 * worker.
 *
 * @param {string} locale - Active locale (e.g. "en-NZ" or "zh-CN").
 * @param {string} key - Dictionary key, dot-separated.
 * @param {Record<string, any>} [vars] - Placeholder variables.
 * @returns {string}
 */
function t(locale, key, vars) {
  const active = DICT[locale] || DICT["en-NZ"];
  const template = active && typeof active[key] === "string"
    ? active[key]
    : (DICT["en-NZ"][key] || `[${key}]`);
  return interpolate(template, vars);
}

/** @type {Promise<IDBDatabase> | null} */
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = self.indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => { dbPromise = null; reject(request.error); };
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("savedResults")) {
        db.createObjectStore("savedResults", { keyPath: "id" });
      }
    };
  });
  return dbPromise;
}

async function dbPut(storeName, data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request = store.put(data);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

const cache = { key: null, results: null };

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
}

async function shortHash(text) {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-1", enc);
    const bytes = new Uint8Array(buf);
    return Array.from(bytes.slice(0, 4))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(31, h) + text.charCodeAt(i);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function productCodeToKey(code) {
  switch (code) {
    case "floating": return "floating";
    case "fixed-6m": return "fixed6m";
    case "fixed-1y": return "fixed1y";
    case "fixed-18m": return "fixed18m";
    case "fixed-2y": return "fixed2y";
    case "fixed-3y": return "fixed3y";
    case "fixed-5y": return "fixed5y";
    default: return code;
  }
}

function getProductLabel(products, productCode, locale) {
  const product = products.find((p) => p.code === productCode);
  if (!product) return productCode;
  // Prefer the localised product name; fall back to the adapter's English
  // displayName when the active dictionary is missing a key.
  if (locale) {
    const localised = t(locale, `common.${productCodeToKey(product.code)}`, undefined);
    if (!localised.startsWith("[")) return localised;
  }
  return product.displayName || productCode;
}

function getFixTermLabel(products, productCode, locale) {
  const product = products.find((p) => p.code === productCode);
  if (!product || product.type === "floating") return t(locale, "worker.fixTerm.floating");
  if (!product.fixedMonths) return product.displayName || productCode;
  if (product.fixedMonths < 12) return t(locale, "worker.fixTerm.months", { n: product.fixedMonths });
  const years = product.fixedMonths / 12;
  return Number.isInteger(years)
    ? t(locale, "worker.fixTerm.years", { n: years })
    : t(locale, "worker.fixTerm.months", { n: product.fixedMonths });
}

function describeStrategy(strategy, products, locale) {
  return strategy.allocations
    .map((allocation) => `${getProductLabel(products, allocation.productCode, locale)} ${(allocation.percentage * 100).toFixed(0)}%`)
    .join(" + ");
}

function describeFixTerms(strategy, products, locale) {
  return strategy.allocations
    .map((allocation) => `${getFixTermLabel(products, allocation.productCode, locale)} ${(allocation.percentage * 100).toFixed(0)}%`)
    .join(" + ");
}

function describeScenario(scenario, locale) {
  const family = scenario.assumptions?.scenarioFamily || scenario.id;
  if (family === "low") return t(locale, "worker.scenario.low");
  if (family === "base") return t(locale, "worker.scenario.base");
  if (family === "high") return t(locale, "worker.scenario.high");
  if (family === "p10") return t(locale, "worker.scenario.p10");
  if (family === "p50") return t(locale, "worker.scenario.p50");
  if (family === "p90") return t(locale, "worker.scenario.p90");
  if (family === "expected") return t(locale, "strategyLab.path.expected.label");
  return scenario.name || scenario.id;
}

self.onmessage = async (e) => {
  const {
    mortgage,
    strategies,
    scenarios,
    products,
    currentProductRates,
    startDate,
    forecastMonths,
    maxAffordablePayment,
    forceRecompute = false,
    locale = "en-NZ"
  } = e.data;

  try {
    // Cache key is INTENTIONALLY locale-agnostic so language switches
    // never invalidate the simulation result. The locale is consumed
    // only by the progress-message formatters below.
    const cacheKeyInput = {
      mortgage,
      strategies,
      scenarios,
      products,
      currentProductRates,
      startDate,
      forecastMonths,
      maxAffordablePayment
    };
    const serialised = stableStringify(cacheKeyInput);
    const key = await shortHash(serialised);

    if (!forceRecompute && cache.key === key && cache.results) {
      self.postMessage({ type: "cached", key, results: cache.results });
      return;
    }

    const summaries = await simulateStrategyScenarioMatrix({
      mortgage,
      strategies,
      scenarios,
      products,
      currentProductRates,
      startDate,
      forecastMonths,
      maxAffordablePayment,
      includeTimeline: false,
      includeRefixEvents: false,
      onProgress: (completed, total, current) => {
        self.postMessage({
          type: "progress",
          completed,
          total,
          current: current ? {
            strategyId: current.strategy.id,
            scenarioId: current.scenario.id,
            combination: describeStrategy(current.strategy, products, locale),
            fixTerms: describeFixTerms(current.strategy, products, locale),
            scenarioPath: describeScenario(current.scenario, locale),
            scenarioIndex: current.scenarioIndex,
            scenarioTotal: current.scenarioTotal
          } : null
        });
      }
    });

    cache.key = key;
    cache.results = summaries;

    // Persist summary-only results to IndexedDB to avoid cloning very large
    // timeline payloads across the structured-clone boundary.
    await dbPut("savedResults", { id: "last_simulation", results: summaries, key });

    self.postMessage({ type: "success", results: summaries, key, savedToDB: true });
  } catch (error) {
    const err = error;
    self.postMessage({ type: "error", error: err.message || String(err) });
  }
};

// ---------------------------------------------------------------------------
// Global error handlers — surface module-load and async failures to the page.
// Without these, a parse error during top-level `import` would silently kill
// the worker (no onmessage ever fires) and the page would see a stuck modal.
// ---------------------------------------------------------------------------
self.addEventListener("error", (e) => {
  try {
    self.postMessage({
      type: "error",
      error: (e && (e.message || (e.error && e.error.message))) || "worker error"
    });
  } catch {
    // postMessage may itself throw if the page has gone away; nothing to do.
  }
});

self.addEventListener("unhandledrejection", (e) => {
  try {
    const reason = e && e.reason;
    self.postMessage({
      type: "error",
      error: (reason && (reason.message || String(reason))) || "unhandled rejection"
    });
  } catch {
    // ignore
  }
});
