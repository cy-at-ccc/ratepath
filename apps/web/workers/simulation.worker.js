import { simulateStrategyScenarioMatrix } from "@mortgage/simulation-engine";

self.onmessage = async (e) => {
  const {
    mortgage,
    strategies,
    scenarios,
    products,
    currentProductRates,
    startDate,
    forecastMonths,
    maxAffordablePayment
  } = e.data;

  try {
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
    self.postMessage({ type: "success", results });
  } catch (error) {
    const err = /** @type {any} */ (error);
    self.postMessage({ type: "error", error: err.message || String(err) });
  }
};
