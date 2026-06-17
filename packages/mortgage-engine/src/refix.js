
/** @typedef {import("@mortgage/schemas").RefixRule} RefixRule */

/**
 * Determines the next product code for a tranche that has reached maturity.
 * @param {string} currentProductCode - Current product code (e.g., "fixed-1y")
 * @param {RefixRule} [refixRule] - Refix rule configuration
 * @param {number} [refixCount] - Number of times this tranche has been refixed
 * @returns {string} The new product code
 */
export function determineRefixProduct(currentProductCode, refixRule = undefined, refixCount = 0) {
  const type = refixRule?.type || "move-to-floating";

  if (type === "move-to-floating") {
    return "floating";
  }

  if (type === "same-term") {
    return currentProductCode;
  }

  if (type === "specified-sequence") {
    const sequence = refixRule?.sequence || [];
    if (sequence.length > 0) {
      return sequence[refixCount % sequence.length];
    }
  }

  return "floating";
}

/**
 * Gets the fixed term in months from a product code.
 * @param {string} productCode - Product code
 * @param {Array<{code: string, fixedMonths: number|null}>} products - List of products supported by country adapter
 * @returns {number|null} The number of fixed months, or null if floating
 */
export function getProductFixedMonths(productCode, products = []) {
  const product = products.find(p => p.code === productCode);
  if (product) {
    return product.fixedMonths;
  }

  // Fallback map based on common naming convention
  if (productCode.startsWith("fixed-")) {
    const parts = productCode.split("-");
    if (parts.length === 2) {
      const term = parts[1];
      if (term.endsWith("m")) {
        return parseInt(term, 10);
      }
      if (term.endsWith("y")) {
        return parseInt(term, 10) * 12;
      }
    }
  }
  return null;
}

/**
 * Interpolates or finds the rate for a specific month in a RatePoint path.
 * Supports step-flat extrapolation and linear interpolation.
 * @param {Array<{month: number, rate: number}>} ratePath - Rate path points
 * @param {number} month - Month index to evaluate
 * @returns {number} The annual rate
 */
export function getRateForMonth(ratePath, month) {
  if (!ratePath || ratePath.length === 0) {
    return 0;
  }

  const sortedPath = [...ratePath].sort((a, b) => a.month - b.month);

  // Exact match
  const exact = sortedPath.find(p => p.month === month);
  if (exact) {
    return exact.rate;
  }

  // Extrapolate below range
  if (month <= sortedPath[0].month) {
    return sortedPath[0].rate;
  }

  // Extrapolate above range
  if (month >= sortedPath[sortedPath.length - 1].month) {
    return sortedPath[sortedPath.length - 1].rate;
  }

  // Interpolate inside range
  let lower = sortedPath[0];
  let upper = sortedPath[sortedPath.length - 1];

  for (let i = 0; i < sortedPath.length - 1; i++) {
    if (sortedPath[i].month <= month && sortedPath[i + 1].month > month) {
      lower = sortedPath[i];
      upper = sortedPath[i + 1];
      break;
    }
  }

  const fraction = (month - lower.month) / (upper.month - lower.month);
  const rate = lower.rate + fraction * (upper.rate - lower.rate);
  return Math.round(rate * 1e8) / 1e8;
}
