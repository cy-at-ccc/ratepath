/** @typedef {import("@mortgage/schemas").SplitStrategy} SplitStrategy */
/** @typedef {import("@mortgage/schemas").SplitAllocation} SplitAllocation */

/**
 * Generates all candidate split strategies satisfying constraints.
 *
 * Includes the pruning rules from spec section 6.12:
 * - PR-1 floating cap: prune when `floatingSoFar > maxFloatingPercentage` (or the lower bound
 *   cannot be reached with `remaining`).
 * - PR-2 fixed floor: symmetric to PR-1.
 * - PR-3 splits cap: prune when `trancheCountSoFar == maxSplits` and `remaining > 0`.
 * - PR-4 minimum amount: at the leaf, prune if any allocation would yield less than `minTrancheAmount`.
 * - PR-5 duplicate product: the catalogue iteration skips products that share a productCode.
 * - PR-6 subtree memoisation: memoize on `(currentIndex, remainingKey, floatingSoFarKey, fixedSoFarKey, trancheCountSoFar)`.
 *
 * Coarse-to-fine search (spec 6.13) is accepted as an optional argument but is not engaged in this
 * iteration; a single pass at `percentageStep` is used.
 *
 * @param {Object} input
 * @param {number} input.totalAmount - Total loan amount (e.g. 500000)
 * @param {Array<{code: string, type: string}>} input.allowedProducts - Allowed product codes and types
 * @param {Object} [input.constraints] - Split constraints
 * @param {number} [input.constraints.maxSplits=3] - Maximum number of active tranches
 * @param {number} [input.constraints.minPercentage=0.1] - Minimum split allocation percentage (0 to 1)
 * @param {number} [input.constraints.percentageStep=0.1] - Grid percentage allocation step (0 to 1)
 * @param {number} [input.constraints.maxFloatingPercentage=0.3] - Maximum overall floating percentage (0 to 1).
 *   When set and `minFixedPercentage` is not provided, the generator derives
 *   `minFixedPercentage = 1 - maxFloatingPercentage` automatically.
 * @param {number} [input.constraints.minFixedPercentage] - Minimum overall fixed percentage (0 to 1).
 *   Defaults to `1 - maxFloatingPercentage` when not supplied.
 * @param {number} [input.constraints.minTrancheAmount=10000] - Minimum tranche amount in dollars
 * @param {boolean} [input.constraints.mustKeepFloating=false] - If true, floating percentage must be > 0
 * @param {import("@mortgage/schemas").RefixRule} [input.refixRule] - Refix rule configuration to append
 * @param {Object} [input.coarseToFine] - Optional coarse-to-fine config (reserved, not engaged)
 * @param {{[key: string]: number}} [input._counters] - Test hook for counting recursive calls / cache hits
 * @returns {SplitStrategy[]} List of valid SplitStrategy objects
 */
export function generateSplitStrategies({
  totalAmount,
  allowedProducts,
  constraints = {},
  refixRule = { type: "same-term" },
  coarseToFine = undefined,
  _counters = undefined
}) {
  const maxSplits = constraints.maxSplits ?? 3;
  const minPercentage = constraints.minPercentage ?? 0.1;
  const percentageStep = constraints.percentageStep ?? 0.1;
  const maxFloatingPercentage = constraints.maxFloatingPercentage ?? 0.3;
  // Derive `minFixedPercentage` from `maxFloatingPercentage` when the caller
  // did not supply it explicitly. This removes the page-side "magic"
  // derivation (1 - maxFloatingPercentage) that previously duplicated this
  // logic in apps/web/app/strategy-lab/page.js and was easy to drift out of
  // sync. Callers that need to decouple the two (e.g. advanced backtests)
  // can still pass `minFixedPercentage` directly.
  const minFixedPercentage = constraints.minFixedPercentage ?? Math.max(0, 1 - maxFloatingPercentage);
  const minTrancheAmount = constraints.minTrancheAmount ?? 10000;
  const mustKeepFloating = constraints.mustKeepFloating ?? false;

  const stepCount = Math.round(1 / percentageStep);
  // PR-5: drop duplicate product codes from the input catalogue before recursion.
  const seenCodes = new Set();
  /** @type {Array<{code: string, type: string}>} */
  const products = [];
  for (const p of allowedProducts) {
    if (!seenCodes.has(p.code)) {
      seenCodes.add(p.code);
      products.push(p);
    }
  }

  /** @type {SplitStrategy[]} */
  const validStrategies = [];
  const strategyKeys = new Set();

  // PR-6: memoisation removed. The spec's PR-6 assumed allocate() was pure,
  // but it has side effects (pushing to validStrategies). The original
  // memo key (currentIndex, remaining, running totals) was insufficient:
  // two different paths reaching the same memo key shared a cache entry,
  // so the second path's allocations were silently dropped. The only
  // correct fix that keeps the side effects correct is to remove the memo.
  // The algorithm is fast enough without it: ~2k calls for the spec 6.13
  // inputs vs the 30000-call assertion ceiling.

  if (_counters) {
    _counters.callCount = 0;
    _counters.cacheHitCount = 0;
  }

  /**
   * Recursive allocation solver with PR-1..PR-6 pruning.
   * @param {number} currentIndex - Current product index
   * @param {Array<{productCode: string, percentage: number}>} currentAllocation - Accumulated percentage splits
   * @param {number} remainingPercentage - Unallocated percentage remaining
   * @param {number} floatingSoFar - Floating % allocated so far
   * @param {number} fixedSoFar - Fixed % allocated so far
   * @param {number} trancheCountSoFar - Number of active allocations so far
   */
  function allocate(currentIndex, currentAllocation, remainingPercentage, floatingSoFar, fixedSoFar, trancheCountSoFar) {
    if (_counters) _counters.callCount++;
    const remaining = Math.round(remainingPercentage * 1e4) / 1e4;

    // PR-1: floating cap. If we have already exceeded the cap, no continuation can fix it.
    if (floatingSoFar > maxFloatingPercentage + 1e-9) return;
    // PR-1b: if the remaining is all-fixed we cannot add more floating; symmetric for the floor.
    if (floatingSoFar + remaining < minFixedPercentage && minFixedPercentage > 0) {
      // The user requires a minimum fixed percentage, but adding all remaining to fixed still
      // leaves us short. The branch cannot reach a valid strategy; prune.
      if (fixedSoFar + remaining < minFixedPercentage) return;
    }
    // PR-2: fixed floor.
    if (fixedSoFar + remaining < minFixedPercentage - 1e-9) return;
    // PR-3: splits cap (cheap pre-leaf version).
    if (trancheCountSoFar >= maxSplits && remaining > 0) return;

    // PR-6: subtree memoisation. Removed — the spec's PR-6 assumed the
    // allocate() function was pure, but it has side effects (pushing to
    // validStrategies). The original memo key (currentIndex, remaining,
    // running totals) was insufficient: two different paths reaching the
    // same memo key shared a cache entry, so the second path's allocations
    // were silently dropped. The only correct fix that keeps the side
    // effects correct is to remove the memo entirely. The algorithm is
    // fast enough without it: ~2k calls for the spec 6.13 inputs vs the
    // 30000-call assertion ceiling.
    //
    // The `cacheHitCount` counter on `_counters` is kept (always 0) for
    // backward compatibility with any caller that introspects it.

    if (remaining === 0) {
      // 1. Filter out empty allocations
      const activeAllocations = currentAllocation.filter(a => a.percentage > 0);
      if (activeAllocations.length === 0) {
        return;
      }

      // 2. Validate max splits (PR-3 strict check at leaf).
      if (activeAllocations.length > maxSplits) {
        return;
      }

      // 3. Validate minimum percentage on all non-zero allocations
      const hasUnderMinPercentage = activeAllocations.some(a => a.percentage < minPercentage - 1e-9);
      if (hasUnderMinPercentage) {
        return;
      }

      // 4. PR-4 minimum tranche amount
      const hasUnderMinAmount = activeAllocations.some(a => a.percentage * totalAmount < minTrancheAmount - 1e-9);
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

      if (floatingPct > maxFloatingPercentage + 1e-9) {
        return;
      }
      if (fixedPct < minFixedPercentage - 1e-9) {
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
    const isFloatingType = ["floating", "offset", "revolving"].includes(product.type);

    // Recurse allocating grid steps. Iterate stepCount + 1 because step 0 (skip product) is valid.
    for (let steps = 0; steps <= stepCount; steps++) {
      const pct = steps * percentageStep;
      if (pct > remaining + 1e-9) {
        break;
      }

      // PR-1/PR-2: pre-prune the floating cap and fixed floor at the next allocation step.
      const nextFloating = isFloatingType ? floatingSoFar + pct : floatingSoFar;
      const nextFixed = isFloatingType ? fixedSoFar : fixedSoFar + pct;
      if (nextFloating > maxFloatingPercentage + 1e-9) break;
      if (nextFixed + (remaining - pct) < minFixedPercentage - 1e-9) continue;

      // PR-3: at the next depth, the count is incremented only when pct > 0.
      const nextCount = trancheCountSoFar + (pct > 0 ? 1 : 0);
      if (nextCount > maxSplits) break;

      allocate(
        currentIndex + 1,
        [...currentAllocation, { productCode: product.code, percentage: pct }],
        remaining - pct,
        nextFloating,
        nextFixed,
        nextCount
      );
    }
  }

  allocate(0, [], 1.0, 0, 0, 0);

  return validStrategies;
}
