import { getRateFromPath } from "./interpolation.js";

/**
 * Derives future rate paths for all mortgage products based on a policy rate path and current market rates.
 * Floating products continue to use a beta-scaled OCR transmission model:
 *   ForecastFloatingRate(k,t) = CurrentProductRate(k) + Beta(k) * (PolicyRate(t) - PolicyRate(0)) + spreadShock
 *
 * Fixed products are repriced off the OCR level at the refix month:
 *   ForecastFixedRate(k,t) = CurrentProductRate(k) + (PolicyRate(t) - PolicyRate(0)) + spreadShock
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
  const currentPolicyRate = getRateFromPath(policyRatePath, 0, "linear");

  products.forEach(product => {
    const code = product.code;
    const currentRate = currentProductRates[code];
    if (currentRate === undefined) {
      return; // Skip products with no starting rate
    }

    const beta = betas[code] ?? 1.0;
    const isFixedProduct = product.fixedMonths !== null && product.fixedMonths !== undefined;

    // Derive the offer rate available at each month in the forecast horizon.
    const productPath = [];
    for (let t = 0; t <= forecastMonths; t++) {
      const policyRateAtMonth = getRateFromPath(policyRatePath, t, "linear");
      const expectedPolicyChange = policyRateAtMonth - currentPolicyRate;
      const derivedRate = isFixedProduct
        ? currentRate + expectedPolicyChange + spreadShock
        : currentRate + beta * expectedPolicyChange + spreadShock;

      productPath.push({
        month: t,
        rate: Math.max(0, Math.round(derivedRate * 1e8) / 1e8)
      });
    }

    result[code] = productPath;
  });

  return result;
}
