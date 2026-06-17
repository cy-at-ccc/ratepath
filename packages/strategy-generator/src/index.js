/** @typedef {import("@mortgage/schemas").SplitStrategy} SplitStrategy */
/** @typedef {import("@mortgage/schemas").SplitAllocation} SplitAllocation */

/**
 * Generates all candidate split strategies satisfying constraints.
 * @param {Object} input
 * @param {number} input.totalAmount - Total loan amount (e.g. 500000)
 * @param {Array<{code: string, type: string}>} input.allowedProducts - Allowed product codes and types
 * @param {Object} [input.constraints] - Split constraints
 * @param {number} [input.constraints.maxSplits=3] - Maximum number of active tranches
 * @param {number} [input.constraints.minPercentage=0.1] - Minimum split allocation percentage (0 to 1)
 * @param {number} [input.constraints.percentageStep=0.1] - Grid percentage allocation step (0 to 1)
 * @param {number} [input.constraints.maxFloatingPercentage=0.3] - Maximum overall floating percentage (0 to 1)
 * @param {number} [input.constraints.minFixedPercentage=0.7] - Minimum overall fixed percentage (0 to 1)
 * @param {number} [input.constraints.minTrancheAmount=10000] - Minimum tranche amount in dollars
 * @param {boolean} [input.constraints.mustKeepFloating=false] - If true, floating percentage must be > 0
 * @param {import("@mortgage/schemas").RefixRule} [input.refixRule] - Refix rule configuration to append
 * @returns {SplitStrategy[]} List of valid SplitStrategy objects
 */
export function generateSplitStrategies({
  totalAmount,
  allowedProducts,
  constraints = {},
  refixRule = { type: "same-term" }
}) {
  const maxSplits = constraints.maxSplits ?? 3;
  const minPercentage = constraints.minPercentage ?? 0.1;
  const percentageStep = constraints.percentageStep ?? 0.1;
  const maxFloatingPercentage = constraints.maxFloatingPercentage ?? 0.3;
  const minFixedPercentage = constraints.minFixedPercentage ?? 0.7;
  const minTrancheAmount = constraints.minTrancheAmount ?? 10000;
  const mustKeepFloating = constraints.mustKeepFloating ?? false;

  const stepCount = Math.round(1 / percentageStep);
  const products = allowedProducts;

  /** @type {SplitStrategy[]} */
  const validStrategies = [];
  const strategyKeys = new Set();

  /**
   * Recursive allocation solver.
   * @param {number} currentIndex - Current product index
   * @param {Array<{productCode: string, percentage: number}>} currentAllocation - Accumulated percentage splits
   * @param {number} remainingPercentage - Unallocated percentage remaining
   */
  function allocate(currentIndex, currentAllocation, remainingPercentage) {
    const remaining = Math.round(remainingPercentage * 1e4) / 1e4;

    if (remaining === 0) {
      // 1. Filter out empty allocations
      const activeAllocations = currentAllocation.filter(a => a.percentage > 0);
      if (activeAllocations.length === 0) {
        return;
      }

      // 2. Validate max splits
      if (activeAllocations.length > maxSplits) {
        return;
      }

      // 3. Validate minimum percentage on all non-zero allocations
      const hasUnderMinPercentage = activeAllocations.some(a => a.percentage < minPercentage);
      if (hasUnderMinPercentage) {
        return;
      }

      // 4. Validate minimum tranche amount
      const hasUnderMinAmount = activeAllocations.some(a => a.percentage * totalAmount < minTrancheAmount);
      if (hasUnderMinAmount) {
        return;
      }

      // 5. Enforce floating and fixed limits
      let floatingPct = 0;
      let fixedPct = 0;
      activeAllocations.forEach(a => {
        const prod = products.find(p => p.code === a.productCode);
        const isFloating = prod && ["floating", "offset", "revolving"].includes(prod.type);
        if (isFloating) {
          floatingPct += a.percentage;
        } else {
          fixedPct += a.percentage;
        }
      });

      floatingPct = Math.round(floatingPct * 1e4) / 1e4;
      fixedPct = Math.round(fixedPct * 1e4) / 1e4;

      if (floatingPct > maxFloatingPercentage) {
        return;
      }
      if (fixedPct < minFixedPercentage) {
        return;
      }
      if (mustKeepFloating && floatingPct <= 0) {
        return;
      }

      // 6. Deduplicate combinations by sorting by productCode
      const sortedAllocations = [...activeAllocations].sort((a, b) => a.productCode.localeCompare(b.productCode));

      const key = sortedAllocations.map(a => `${a.productCode}:${a.percentage}`).join("|");
      if (strategyKeys.has(key)) {
        return;
      }

      strategyKeys.add(key);

      // Construct output SplitAllocation values
      const allocations = sortedAllocations.map(a => ({
        productCode: a.productCode,
        percentage: a.percentage,
        amount: Math.round(a.percentage * totalAmount * 100) / 100
      }));

      validStrategies.push({
        id: `strat-${strategyKeys.size}`,
        allocations,
        refixRule
      });

      return;
    }

    if (currentIndex >= products.length) {
      return;
    }

    const product = products[currentIndex];

    // Recurse allocating grid steps
    for (let steps = 0; steps <= stepCount; steps++) {
      const pct = steps * percentageStep;
      if (pct > remaining + 1e-9) {
        break;
      }

      allocate(
        currentIndex + 1,
        [...currentAllocation, { productCode: product.code, percentage: pct }],
        remaining - pct
      );
    }
  }

  allocate(0, [], 1.0);

  return validStrategies;
}
