
/** @typedef {import("@mortgage/schemas").RefixRule} RefixRule */

/**
 * Determines the next product code for a tranche that has reached maturity.
 * Behaviour is identical regardless of whether the refix is scheduled (term
 * matured) or early (user broke the term). Break-fee economics are handled
 * separately by `calculateBreakFee`.
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
 * Calculates the break-fee in dollars for a user-initiated early exit from a
 * fixed-term product, per spec section 6.7. The fee is added to the period's
 * interest (NZ market convention).
 *
 * The function is a stub in this iteration: callers may pass `userInitiatedBreak`
 * to `simulateMortgageTimeline` (always `false` for now) and the amortiser will
 * invoke this when a break is requested. The fee is read from
 * `breakFeeSchedule[productCode]`, an entry of `{ monthsToMaturity, feeBps }`
 * points. The closest entry to `monthsToMaturity` is used.
 *
 * @param {Object} input
 * @param {string} input.productCode - Product being broken (e.g. "fixed-1y")
 * @param {number} input.balance - Current outstanding principal
 * @param {number} input.monthsToMaturity - Months remaining until scheduled maturity
 * @param {Record<string, Array<{monthsToMaturity: number, feeBps: number}>>} [input.breakFeeSchedule] - Country-adapter break-fee schedule
 * @returns {number} Fee amount in dollars (0 if schedule is empty or unknown)
 */
export function calculateBreakFee({ productCode, balance, monthsToMaturity, breakFeeSchedule = {} }) {
  const entries = breakFeeSchedule[productCode];
  if (!entries || entries.length === 0) {
    return 0;
  }
  // Find the entry with the closest monthsToMaturity.
  let best = entries[0];
  let bestDiff = Math.abs(best.monthsToMaturity - monthsToMaturity);
  for (let i = 1; i < entries.length; i++) {
    const diff = Math.abs(entries[i].monthsToMaturity - monthsToMaturity);
    if (diff < bestDiff) {
      best = entries[i];
      bestDiff = diff;
    }
  }
  return Math.round(balance * best.feeBps / 10000 * 100) / 100;
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
