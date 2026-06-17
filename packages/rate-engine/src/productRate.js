import { getRateFromPath } from "./interpolation.js";

/**
 * Derives future rate paths for all mortgage products based on a policy rate path and current market rates.
 * ForecastProductRate(k,t) = CurrentProductRate(k) + Beta(k) * ExpectedPolicyRateChange(k,t) + spreadShock
 * where ExpectedPolicyRateChange(k,t) = (Average Policy Rate from t to t+term-1) - (Average Policy Rate from 0 to term-1)
 * @param {Object} input
 * @param {Array<{month: number, rate: number}>} input.policyRatePath - Central bank policy rate path
 * @param {Record<string, number>} input.currentProductRates - Current rate for each product at Month 0
 * @param {Record<string, number>} input.betas - Beta sensitivity coefficients for each product code
 * @param {Array<{code: string, fixedMonths: number|null}>} input.products - Product term configurations from adapter
 * @param {number} input.forecastMonths - Simulation forecasting horizon in months (e.g., 36)
 * @param {number} [input.spreadShock] - Optional interest spread shock applied to all rates (default 0)
 * @returns {Record<string, Array<{month: number, rate: number}>>} Dictionary of product codes mapping to their rate paths
 */
export function deriveProductRatePaths({
  policyRatePath,
  currentProductRates,
  betas,
  products,
  forecastMonths,
  spreadShock = 0
}) {
  /** @type {Record<string, Array<{month: number, rate: number}>>} */
  const result = {};

  products.forEach(product => {
    const code = product.code;
    const currentRate = currentProductRates[code];
    if (currentRate === undefined) {
      return; // Skip products with no starting rate
    }

    const beta = betas[code] ?? 1.0;
    const term = product.fixedMonths ?? 1; // Floating has a term of 1 month

    // 1. Calculate base average policy rate starting at Month 0 (Current average)
    let currentAverageSum = 0;
    for (let offset = 0; offset < term; offset++) {
      currentAverageSum += getRateFromPath(policyRatePath, offset, "linear");
    }
    const currentAverage = currentAverageSum / term;

    // 2. Derive rate at each month step in the forecast horizon
    const productPath = [];
    for (let t = 0; t <= forecastMonths; t++) {
      let forecastSum = 0;
      for (let offset = 0; offset < term; offset++) {
        forecastSum += getRateFromPath(policyRatePath, t + offset, "linear");
      }
      const forecastAverage = forecastSum / term;

      const expectedPolicyChange = forecastAverage - currentAverage;
      const derivedRate = currentRate + beta * expectedPolicyChange + spreadShock;

      productPath.push({
        month: t,
        rate: Math.max(0, Math.round(derivedRate * 1e8) / 1e8)
      });
    }

    result[code] = productPath;
  });

  return result;
}
