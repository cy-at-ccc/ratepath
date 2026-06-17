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
      self.postMessage({ type: "cached", key });
      return;
    }

    const results = await simulateStrategyScenarioMatrix({
      mortgage,
      strategies,
      scenarios,
      products,
      currentProductRates,
      startDate,
      forecastMonths,
      maxAffordablePayment,
      onProgress: (completed, total) => {
        self.postMessage({ type: "progress", completed, total });
      }
    });

    cache.key = key;
    cache.results = results;

    // Save full results to IndexedDB, then notify main thread
    await dbPut("savedResults", { id: "last_simulation", results, key });

    const summaries = results.map(r => ({
      strategyId: r.strategyId,
      scenarioId: r.scenarioId,
      totalInterest: r.totalInterest,
      totalRepayments: r.totalRepayments,
      endingBalance: r.endingBalance,
      maximumPayment: r.maximumPayment,
      minimumPayment: r.minimumPayment,
      averagePayment: r.averagePayment,
      maximumPaymentIncrease: r.maximumPaymentIncrease,
      paymentVolatility: r.paymentVolatility,
      refixEventCount: r.refixEventCount,
      maximumConcurrentRefixPercentage: r.maximumConcurrentRefixPercentage,
      floatingExposure: r.floatingExposure,
      affordabilityBreaches: r.affordabilityBreaches,
      payoffTime: r.payoffTime,
      offsetUtilisation: r.offsetUtilisation,
      isInfeasible: r.isInfeasible,
      infeasibilityReason: r.infeasibilityReason
    }));

    self.postMessage({ type: "success", results: summaries, key, savedToDB: true });
  } catch (error) {
    const err = error;
    self.postMessage({ type: "error", error: err.message || String(err) });
  }
};
