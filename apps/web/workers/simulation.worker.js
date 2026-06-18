// @ts-nocheck — Web Worker entry point; JSDoc strict-mode type checks on the
// LRU cache helpers and the postMessage handlers are out of scope here.
import { simulateStrategyScenarioMatrix } from "@mortgage/simulation-engine";

const DB_NAME = "MortgageStrategyDB";
const DB_VERSION = 1;

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

function getProductLabel(products, productCode) {
  const product = products.find((p) => p.code === productCode);
  return product?.displayName || productCode;
}

function getFixTermLabel(products, productCode) {
  const product = products.find((p) => p.code === productCode);
  if (!product || product.type === "floating") return "浮动";
  if (!product.fixedMonths) return product.displayName || productCode;
  if (product.fixedMonths < 12) return `${product.fixedMonths}个月固定`;
  const years = product.fixedMonths / 12;
  return Number.isInteger(years) ? `${years}年固定` : `${product.fixedMonths}个月固定`;
}

function describeStrategy(strategy, products) {
  return strategy.allocations
    .map((allocation) => `${getProductLabel(products, allocation.productCode)} ${(allocation.percentage * 100).toFixed(0)}%`)
    .join(" + ");
}

function describeFixTerms(strategy, products) {
  return strategy.allocations
    .map((allocation) => `${getFixTermLabel(products, allocation.productCode)} ${(allocation.percentage * 100).toFixed(0)}%`)
    .join(" + ");
}

function describeScenario(scenario) {
  const family = scenario.assumptions?.scenarioFamily || scenario.id;
  if (family === "low") return "低利率路径";
  if (family === "base") return "基准路径";
  if (family === "high") return "高利率路径";
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
    forceRecompute = false
  } = e.data;

  try {
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
            combination: describeStrategy(current.strategy, products),
            fixTerms: describeFixTerms(current.strategy, products),
            scenarioPath: describeScenario(current.scenario),
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
