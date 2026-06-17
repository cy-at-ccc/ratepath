import { simulateStrategyScenarioMatrix } from "@mortgage/simulation-engine";

/**
 * LRU cache (size 1) for simulation results, keyed by a stable string
 * serialisation of the input. Single-entry is sufficient for the Web app's
 * single-user interaction model: a weights-only change should not retrigger
 * a full simulation.
 * @type {{key: string|null, results: any[]|null}}
 */
const cache = { key: null, results: null };

/**
 * Stable JSON serialisation with sorted keys (no whitespace).
 * @param {any} value
 * @returns {string}
 */
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

/**
 * Computes a SHA-1 digest and returns the first 8 hex characters.
 * @param {string} text
 * @returns {Promise<string>}
 */
async function shortHash(text) {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-1", enc);
    const bytes = new Uint8Array(buf);
    return Array.from(bytes.slice(0, 4))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Fallback (should not normally trigger in a browser worker): a non-cryptographic
  // 32-bit hash so tests can still exercise the cache code path.
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
      self.postMessage({ type: "cached", results: cache.results, key });
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

    self.postMessage({ type: "success", results, key });
  } catch (error) {
    const err = /** @type {any} */ (error);
    self.postMessage({ type: "error", error: err.message || String(err) });
  }
};
