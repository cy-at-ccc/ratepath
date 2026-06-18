/**
 * Default tolerances for the dominance check, per spec section 9.1 (term mode)
 * and 9.2 (payment mode). The two modes share some keys; payment mode
 * uses `worstCaseEndingBalance` and `payoffTime` instead of
 * `worstCaseInterest` and `expectedAffordabilityBreaches`.
 * @type {Record<string, number>}
 */
export const DEFAULT_TOLERANCES_TERM = {
  // Tightened from $50 -> $20: on a $500k loan over 5 years, $50 is ~0.001% of
  // principal — looser than the typical $500-$5,000 cost gap between strategies.
  // The tighter tolerance widens the Pareto set so 3+ split strategies that
  // tie the 90/10 reference on cost (within $20) but beat it on
  // `expectedMaxConcurrentRefixPercentage` are no longer hidden.
  expectedInterest: 20,
  worstCaseInterest: 50,
  worstCasePayment: 10,
  // 0.01 -> 0.02: refix concentration differences of <2% between two strategies
  // are within noise of the spread product catalogue. Loosening by 2x keeps the
  // Pareto set meaningful without collapsing all strategies into a tie.
  expectedMaxConcurrentRefixPercentage: 0.02,
  // 0.5 -> 1: the user perceives "0 vs 1 budget breach" as equivalent (an off-by-one
  // on the boundary month), but 1 vs 2 as materially worse.
  expectedAffordabilityBreaches: 1,
  // 0.01 -> 0.02: aligns with the refix concentration tolerance since both
  // axes are read off the strategy.allocations share (same denominator).
  flexibilityPenalty: 0.02,
  // NZD/period stddev of monthly scheduled payments. Typical values 5-30 NZD.
  // 0.05 ≈ 0.2-1% of typical payment size — discriminates without collapsing.
  expectedPaymentVolatility: 0.05,
  // NZD; ending balance on a $500k loan is in tens of thousands. 200 NZD
  // tolerance ≈ 0.04% of principal — meaningful but doesn't drown real splits.
  expectedEndingBalance: 200,
  // 1: same boundary semantics as `expectedAffordabilityBreaches`.
  worstCaseAffordabilityBreaches: 1
};

/** @type {Record<string, number>} */
export const DEFAULT_TOLERANCES_PAYMENT = {
  // Same tightening as term mode — see DEFAULT_TOLERANCES_TERM comment.
  expectedInterest: 20,
  worstCaseEndingBalance: 50,
  // 1 -> 3: a 30-year loan's `payoffTime` is fuzzy at the single-month level.
  // ±3 months reflects "拖尾 vs 提前偿清"的实际可感知差异.
  payoffTime: 3,
  expectedMaxConcurrentRefixPercentage: 0.02,
  flexibilityPenalty: 0.02,
  expectedPaymentVolatility: 0.05
};

/**
 * Tolerance-aware dominance check per spec section 9.3.
 * A strategy A dominates B iff:
 *  - For every selected objective, A.objective <= B.objective + tolerance, AND
 *  - For at least one objective, A.objective < B.objective - tolerance.
 *
 * All objectives are minimise.
 *
 * @param {any} a
 * @param {any} b
 * @param {string[]} objectives - Objective keys, all in the minimise direction.
 * @param {Record<string, number>} tolerances
 * @returns {boolean} True if A dominates B within the given tolerances.
 */
export function dominates(a, b, objectives, tolerances) {
  let allWithin = true;
  let anyStrict = false;
  for (const o of objectives) {
    const tol = tolerances[o] !== undefined ? tolerances[o] : 0;
    const diff = a[o] - b[o];
    if (diff > tol) {
      allWithin = false;
    }
    if (diff < -tol) {
      anyStrict = true;
    }
  }
  return allWithin && anyStrict;
}

/**
 * Returns the bound object {min, max, diff} for a metric, with diff fallback to 1
 * for divide-by-zero protection (matches the existing semantics at optimiser.js:157-162).
 * @param {any[]} strategies
 * @param {string} key
 * @returns {{min: number, max: number, diff: number}}
 */
function getBoundsFor(strategies, key) {
  const values = strategies.map((/** @type {any} */ s) => s[key]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max, diff: (max - min) || 1 };
}

/**
 * Returns the term-mode Pareto objective set per spec 9.1:
 *   1. expectedInterest ($20)
 *   2. worstCaseInterest ($50)
 *   3. worstCasePayment ($10)
 *   4. expectedMaxConcurrentRefixPercentage (0.02)
 *   5. expectedAffordabilityBreaches (1)
 *   6. flexibilityPenalty = 1 - expectedFloatingExposure (0.02)
 *   7. expectedPaymentVolatility (0.05) — schedule-flow stability
 *   8. expectedEndingBalance (200) — principal paydown speed (term-mode only)
 *   9. worstCaseAffordabilityBreaches (1) — tail budget-breach count
 * @param {Record<string, number>} [tolerances]
 * @returns {{objectives: string[], tolerances: Record<string, number>}}
 */
export function getTermObjectives(tolerances = {}) {
  return {
    objectives: [
      "expectedInterest",
      "worstCaseInterest",
      "worstCasePayment",
      "expectedMaxConcurrentRefixPercentage",
      "expectedAffordabilityBreaches",
      "flexibilityPenalty",
      "expectedPaymentVolatility",
      "expectedEndingBalance",
      "worstCaseAffordabilityBreaches"
    ],
    tolerances: { ...DEFAULT_TOLERANCES_TERM, ...tolerances }
  };
}

/**
 * Returns the payment-mode Pareto objective set per spec 9.2:
 *   1. expectedInterest ($20)
 *   2. worstCaseEndingBalance ($50)
 *   3. payoffTime (3)
 *   4. expectedMaxConcurrentRefixPercentage (0.02)
 *   5. flexibilityPenalty (0.02)
 *   6. expectedPaymentVolatility (0.05) — schedule-flow stability
 *
 * Note: `expectedEndingBalance` is intentionally NOT a payment-mode objective
 * since `payoffTime` already captures the same signal (loan paid off -> balance
 * = 0; not paid off -> payoffTime > forecastMonths).
 * @param {Record<string, number>} [tolerances]
 * @returns {{objectives: string[], tolerances: Record<string, number>}}
 */
export function getPaymentObjectives(tolerances = {}) {
  return {
    objectives: [
      "expectedInterest",
      "worstCaseEndingBalance",
      "payoffTime",
      "expectedMaxConcurrentRefixPercentage",
      "flexibilityPenalty",
      "expectedPaymentVolatility"
    ],
    tolerances: { ...DEFAULT_TOLERANCES_PAYMENT, ...tolerances }
  };
}

/**
 * Generates Chinese-language pros/cons for a strategy, given the rank-wide
 * bounds and the operation mode. Exported so the page can use it as the
 * single source of truth (spec 10.4).
 *
 * @param {any} s - Aggregated strategy record (must include the metrics below)
 * @param {Record<string, {min: number, max: number, diff: number}>} bounds
 *   - Map of metric name → {min, max, diff}. Keys include: cost, stability,
 *     endingBalance, refix, flexibility, flex, budget, principal, payoff.
 * @param {"term"|"payment"} mode
 * @param {Object} [opts]
 * @param {boolean} [opts.diversification=false] - When true, the user has
 *   opted into a richer candidate set via the Diversification preset. The
 *   pros/cons emit diversification-flavoured copy: refix-spread and flexible
 *   overpayment are emphasised as pros; multi-tranche management overhead
 *   and slightly higher expected cost are flagged as cons.
 * @returns {{pros: string[], cons: string[]}}
 */
export function generateExplanations(s, bounds, mode = "term", opts = {}) {
  const { diversification = false } = opts;
  /** @type {string[]} */
  const pros = [];
  /** @type {string[]} */
  const cons = [];

  // Interest cost
  if (bounds.cost && s.expectedInterest <= bounds.cost.min + bounds.cost.diff * 0.15) {
    pros.push("预期利息成本极低，利息支出控制最佳。");
  } else if (bounds.cost && s.expectedInterest >= bounds.cost.max - bounds.cost.diff * 0.20) {
    cons.push("预期整体利息成本支出较高。");
  }

  // Diversification preset: a small expected-interest premium is acceptable
  // because the user explicitly opted into richer candidate sets. Frame it as
  // a known trade-off rather than a pure negative.
  if (diversification && bounds.cost && s.expectedInterest > bounds.cost.min + bounds.cost.diff * 0.15) {
    cons.push("分散化预设下：总成本略高于最优方案，但换来更低的再融资集中度和更高的灵活度。");
  }

  // Worst-case payment (term mode) or worst-case ending balance (payment mode)
  if (mode === "term") {
    if (bounds.stability && s.worstCasePayment <= bounds.stability.min + bounds.stability.diff * 0.15) {
      pros.push("还款波动小，还款额平稳，供款保障度高。");
    } else if (bounds.stability && s.worstCasePayment >= bounds.stability.max - bounds.stability.diff * 0.20) {
      cons.push("高利率情景下面临较高的月供/周供/双周供峰值风险。");
    }
  } else {
    if (bounds.endingBalance && s.worstCaseEndingBalance <= bounds.endingBalance.min + bounds.endingBalance.diff * 0.15) {
      pros.push("极端情景下剩余本金较少，债务压缩速度稳定。");
    } else if (bounds.endingBalance && s.worstCaseEndingBalance >= bounds.endingBalance.max - bounds.endingBalance.diff * 0.20) {
      cons.push("极端情景下剩余本金较多，本金压缩存在不确定性。");
    }
  }

  // Refix concentration
  if (bounds.refix && s.expectedMaxConcurrentRefixPercentage <= bounds.refix.min + bounds.refix.diff * 0.15) {
    pros.push("贷款到期日期分散，避免集中重定价利率飙升的风险。");
  } else if (bounds.refix && s.expectedMaxConcurrentRefixPercentage >= bounds.refix.max - bounds.refix.diff * 0.20) {
    cons.push("多笔贷款面临同时到期，重定价利率集中暴露风险高。");
  }

  // Diversification preset: when the user opted into richer candidate sets,
  // refix-spread is the headline benefit. Surface it explicitly even when it
  // is only "above average" rather than top-of-the-front.
  if (diversification && bounds.refix &&
      s.expectedMaxConcurrentRefixPercentage <= bounds.refix.min + bounds.refix.diff * 0.50) {
    if (!pros.some((p) => p.includes("贷款到期日期分散"))) {
      pros.push("分散化预设下：再融资风险分散到不同月份，单次冲击的影响更可控。");
    }
    cons.push("分散化预设下：管理多个固定到期日稍复杂，需要关注每个子贷款的再融资时点。");
  }

  // Term-mode only: affordability breaches + principal paydown
  if (mode === "term") {
    if (bounds.budget && s.expectedAffordabilityBreaches <= bounds.budget.min + bounds.budget.diff * 0.15) {
      pros.push("模拟期内预算超限次数较少，供款压力更可控。");
    } else if (bounds.budget && s.expectedAffordabilityBreaches >= bounds.budget.max - bounds.budget.diff * 0.20) {
      cons.push("模拟期内更容易超过设定供款预算。");
    }
    if (bounds.principal && s.expectedEndingBalance <= bounds.principal.min + bounds.principal.diff * 0.15) {
      pros.push("本金还款额度大，有利于快速消减贷款余额。");
    } else if (bounds.principal && s.expectedEndingBalance >= bounds.principal.max - bounds.principal.diff * 0.20) {
      cons.push("本金还款进度较慢，到期剩余余额较多。");
    }
  } else {
    // Payment-mode: payoff time
    if (bounds.payoff && s.payoffTime <= bounds.payoff.min + bounds.payoff.diff * 0.15) {
      pros.push("贷款在合理期限内偿清，无长期挂账风险。");
    } else if (bounds.payoff && s.payoffTime >= bounds.payoff.max - bounds.payoff.diff * 0.20) {
      cons.push("贷款在模拟期内未能完全偿清，存在挂账风险。");
    }
  }

  // Payment smoothness (term + payment modes; same axis, same copy)
  // Captures month-to-month stability of the scheduled payment stream, distinct
  // from worstCasePayment (single peak) which is covered above.
  if (bounds.smoothness && s.expectedPaymentVolatility <= bounds.smoothness.min + bounds.smoothness.diff * 0.15) {
    pros.push("供款波动小，家庭现金流可预期性高。");
  } else if (bounds.smoothness && s.expectedPaymentVolatility >= bounds.smoothness.max - bounds.smoothness.diff * 0.20) {
    cons.push("供款波动较大，临近 refix 时跳升明显，需预备缓冲。");
  }

  // Flexibility
  if (bounds.flex && s.expectedFloatingExposure >= bounds.flex.max - bounds.flex.diff * 0.15) {
    pros.push("保留较高浮动或Offset额度，资金注入与提前还款极具灵活性。");
  } else if (bounds.flex && s.expectedFloatingExposure <= bounds.flex.min + bounds.flex.diff * 0.20) {
    cons.push("高比例固定锁死了贷款，限制了随时对冲或大额提前还款。");
  }

  // Diversification preset: when the user opted into richer candidate sets
  // and the strategy preserves meaningful floating exposure, surface the
  // flexibility benefit explicitly.
  if (diversification && bounds.flex &&
      s.expectedFloatingExposure >= bounds.flex.max - bounds.flex.diff * 0.50 &&
      !pros.some((p) => p.includes("保留较高浮动"))) {
    pros.push("分散化预设下：保留充足的浮动或Offset额度，便于在机会出现时灵活还款或对冲。");
  }

  if (pros.length === 0) {
    pros.push("各项财务与风险指标表现较为均衡。");
  }
  if (cons.length === 0) {
    cons.push("在极端高息走势下缺乏更深度的防御缓冲。");
  }

  return { pros, cons };
}

/**
 * Optimises and ranks split strategies based on simulation results and user
 * preferences. The objective set and tolerances are selected by `mode` (spec 9.1
 * vs 9.2). Infeasible strategies (any scenario flagged isInfeasible) are dropped
 * from the Pareto set.
 *
 * Returned recommendations carry three sources with distinct semantics:
 *
 *   - `preference`  — the strategy with the lowest overall score under the
 *                     supplied `weights` (or the slider-derived defaults when
 *                     `weights` is omitted). This is the personalised pick
 *                     that responds to the user's preference sliders.
 *
 *   - `lowestCost`  — always the strategy with the smallest `expectedInterest`,
 *                     independent of `weights`. This is the mathematical
 *                     expected-cost optimum and acts as an objective benchmark
 *                     that the user can compare their `preference` pick
 *                     against. Intentional by design — `weights` do not
 *                     influence this slot.
 *
 *   - `mostStable`  — term mode  -> smallest `worstCasePayment` (the
 *                     worst-scenario peak across all scenarios);
 *                     payment mode -> smallest `worstCaseEndingBalance`.
 *                     Also `weights`-independent by design, and bound to
 *                     `worstCasePayment` in term mode so the recommendation
 *                     aligns with the `resilience` weight's intent of
 *                     suppressing worst-case peaks rather than the
 *                     probability-weighted average.
 *
 * The `weights` parameter only changes which strategy lands in `preference`;
 * `lowestCost` and `mostStable` are deliberately weights-agnostic objective
 * baselines. This is product behaviour, not a bug.
 *
 * @param {Object} input
 * @param {any[]} input.simulationResults - All strategy x scenario simulation results
 * @param {any[]} input.scenarios - List of scenarios with probabilities
 * @param {number} [input.sliderCostStability=0.5] - 0 = cost-priority, 1 = stability-priority
 * @param {number} [input.sliderFlexibility=0.0] - 0 = no flex, 1 = high flex
 * @param {{cost?: number, principal?: number, refix?: number, resilience?: number, flex?: number, budget?: number, smoothness?: number}} [input.weights]
 *   - Optional explicit weights. Honoured keys: `cost`, `principal`, `refix`,
 *     `resilience`, `flex`, `budget`, `smoothness` (the 7 preference sliders).
 *     Missing keys default to 0. Sum of present keys must be > 0 or all weights
 *     are ignored. `stability`, `endingBalance`, and `payoff` are NOT read from
 *     this object — in payment mode those keys are derived from
 *     `sliderCostStability` / `sliderFlexibility` via the slider-derived branch
 *     below. These weights only steer the `preference` recommendation;
 *     `lowestCost` and `mostStable` remain weights-agnostic (see function
 *     description).
 * @param {"term"|"payment"} [input.mode] - Mode selector for the objective set (defaults to "term")
 * @param {Record<string, number>} [input.tolerances] - Per-objective tolerance override
 * @param {number} [input.recommendationMinAllocationCount] - Minimum number of
 *   allocations required for the three headline recommendations. This does not
 *   filter `rankedStrategies`, so single-product benchmarks can still appear in
 *   the detailed table.
 * @param {boolean} [input.diversification=false] - When true, the user has
 *   opted into the Diversification preset (richer candidate sets + refix-heavy
 *   weights). Pros/cons emission adapts accordingly; ranking and Pareto
 *   classification are unaffected.
 * @returns {any} Ranks, recommendations, and Pareto frontier details
 */
export function optimizeStrategies({
  simulationResults,
  scenarios,
  sliderCostStability = 0.5,
  sliderFlexibility = 0.0,
  weights = undefined,
  mode = "term",
  tolerances = undefined,
  recommendationMinAllocationCount = 1,
  diversification = false
}) {
  // 1. Group simulation results by strategyId
  /** @type {Record<string, any[]>} */
  const strategyGroups = {};
  simulationResults.forEach((/** @type {any} */ res) => {
    if (!strategyGroups[res.strategyId]) {
      strategyGroups[res.strategyId] = [];
    }
    strategyGroups[res.strategyId].push(res);
  });

  const scenarioMap = new Map(scenarios.map(s => [s.id, s]));

  // 2. Aggregate metrics. Strategies with any infeasible scenario are dropped.
  /** @type {any[]} */
  const aggregatedStrategies = [];
  for (const strategyId of Object.keys(strategyGroups)) {
    const runs = strategyGroups[strategyId];
    if (runs.some((/** @type {any} */ r) => r.isInfeasible)) {
      continue;
    }
    const allocationCount = runs[0]?.allocationCount || 1;
    let expectedInterest = 0;
    let expectedRepayments = 0;
    let expectedEndingBalance = 0;
    let expectedMaxPayment = 0;
    let expectedPaymentVolatility = 0;
    let expectedRefixEventCount = 0;
    let expectedMaxConcurrentRefixPercentage = 0;
    let expectedFloatingExposure = 0;
    let expectedAffordabilityBreaches = 0;
    let expectedPayoffTime = 0;

    let worstCasePayment = 0;
    let worstCaseInterest = 0;
    let worstCaseEndingBalance = 0;
    let worstCaseAffordabilityBreaches = 0;
    let bestCaseInterest = Infinity;
    let baseCaseInterest = 0;

    runs.forEach((/** @type {any} */ run) => {
      const scenario = scenarioMap.get(run.scenarioId);
      const prob = scenario ? scenario.probability : 0;

      expectedInterest += run.totalInterest * prob;
      expectedRepayments += run.totalRepayments * prob;
      expectedEndingBalance += run.endingBalance * prob;
      expectedMaxPayment += run.maximumPayment * prob;
      expectedPaymentVolatility += run.paymentVolatility * prob;
      expectedRefixEventCount += run.refixEventCount * prob;
      expectedMaxConcurrentRefixPercentage += run.maximumConcurrentRefixPercentage * prob;
      expectedFloatingExposure += run.floatingExposure * prob;
      expectedAffordabilityBreaches += run.affordabilityBreaches * prob;
      expectedPayoffTime += (run.payoffTime || 0) * prob;

      if (run.maximumPayment > worstCasePayment) worstCasePayment = run.maximumPayment;
      if (run.endingBalance > worstCaseEndingBalance) worstCaseEndingBalance = run.endingBalance;
      if (run.totalInterest < bestCaseInterest) bestCaseInterest = run.totalInterest;
      if (run.totalInterest > worstCaseInterest) worstCaseInterest = run.totalInterest;
      if (run.affordabilityBreaches > worstCaseAffordabilityBreaches) worstCaseAffordabilityBreaches = run.affordabilityBreaches;
      if (run.scenarioId === "base") {
        baseCaseInterest = run.totalInterest;
      }
    });

    expectedInterest = Math.round(expectedInterest * 100) / 100;
    expectedRepayments = Math.round(expectedRepayments * 100) / 100;
    expectedEndingBalance = Math.round(expectedEndingBalance * 100) / 100;
    expectedMaxPayment = Math.round(expectedMaxPayment * 100) / 100;
    expectedPaymentVolatility = Math.round(expectedPaymentVolatility * 100) / 100;
    expectedRefixEventCount = Math.round(expectedRefixEventCount * 100) / 100;
    expectedMaxConcurrentRefixPercentage = Math.round(expectedMaxConcurrentRefixPercentage * 1e4) / 1e4;
    expectedFloatingExposure = Math.round(expectedFloatingExposure * 1e4) / 1e4;
    expectedAffordabilityBreaches = Math.round(expectedAffordabilityBreaches * 10) / 10;
    expectedPayoffTime = Math.round(expectedPayoffTime);
    worstCaseInterest = Math.round(worstCaseInterest * 100) / 100;
    worstCaseEndingBalance = Math.round(worstCaseEndingBalance * 100) / 100;

    aggregatedStrategies.push({
      strategyId,
      allocationCount,
      expectedInterest,
      expectedRepayments,
      expectedEndingBalance,
      expectedMaxPayment,
      expectedPaymentVolatility,
      expectedRefixEventCount,
      expectedMaxConcurrentRefixPercentage,
      expectedFloatingExposure,
      expectedAffordabilityBreaches,
      expectedPayoffTime,
      worstCasePayment,
      worstCaseInterest,
      worstCaseEndingBalance,
      worstCaseAffordabilityBreaches,
      bestCaseInterest,
      baseCaseInterest,
      // Derived Pareto key (spec 9.1: 1 - expectedFloatingExposure).
      flexibilityPenalty: Math.round((1 - expectedFloatingExposure) * 1e4) / 1e4
    });
  }

  if (aggregatedStrategies.length === 0) {
    return { rankedStrategies: [], recommendations: {} };
  }

  // 3. Pareto frontier classification (tolerance-aware, per spec 9.3).
  const { objectives, tolerances: tolSet } = mode === "payment"
    ? getPaymentObjectives(tolerances)
    : getTermObjectives(tolerances);

  /** @type {Record<string, boolean>} */
  const paretoStatus = {};
  aggregatedStrategies.forEach((/** @type {any} */ s) => {
    const dominated = aggregatedStrategies.some((/** @type {any} */ other) => other !== s && dominates(other, s, objectives, tolSet));
    paretoStatus[s.strategyId] = !dominated;
  });

  // 4. Normalisation bounds
  const bounds = {
    cost: getBoundsFor(aggregatedStrategies, "expectedInterest"),
    principal: getBoundsFor(aggregatedStrategies, "expectedEndingBalance"),
    refix: getBoundsFor(aggregatedStrategies, "expectedMaxConcurrentRefixPercentage"),
    resilience: getBoundsFor(aggregatedStrategies, "worstCasePayment"),
    flex: getBoundsFor(aggregatedStrategies, "expectedFloatingExposure"),
    stability: getBoundsFor(aggregatedStrategies, "expectedMaxPayment"),
    budget: getBoundsFor(aggregatedStrategies, "expectedAffordabilityBreaches"),
    endingBalance: getBoundsFor(aggregatedStrategies, "worstCaseEndingBalance"),
    payoff: getBoundsFor(aggregatedStrategies, "expectedPayoffTime"),
    smoothness: getBoundsFor(aggregatedStrategies, "expectedPaymentVolatility")
  };

  // 5. Weight calculation (mode-aware per spec 10.2)
  let wCost, wPrincipal, wRefix, wResilience, wFlex, wStability, wBudget, wEndingBalance, wPayoff, wSmoothness;
  if (weights) {
    const totalRaw = (weights.cost || 0) +
      (weights.principal || 0) +
      (weights.refix || 0) +
      (weights.resilience || 0) +
      (weights.flex || 0) +
      (weights.budget || 0) +
      (weights.smoothness || 0) || 1;
    wCost = (weights.cost || 0) / totalRaw;
    wPrincipal = (weights.principal || 0) / totalRaw;
    wRefix = (weights.refix || 0) / totalRaw;
    wResilience = (weights.resilience || 0) / totalRaw;
    wFlex = (weights.flex || 0) / totalRaw;
    wBudget = (weights.budget || 0) / totalRaw;
    wSmoothness = (weights.smoothness || 0) / totalRaw;
    wStability = 0;
    wEndingBalance = 0;
    wPayoff = 0;
  } else if (mode === "payment") {
    const rawCostWeight = 0.50 - sliderCostStability * 0.30;
    const rawEndingBalance = 0.20 + sliderCostStability * 0.20;
    const rawPayoffWeight = 0.10;
    const rawRefixWeight = 0.10;
    const rawFlexibilityWeight = sliderFlexibility * 0.20;
    const totalRaw = rawCostWeight + rawEndingBalance + rawPayoffWeight + rawRefixWeight + rawFlexibilityWeight;
    wCost = rawCostWeight / totalRaw;
    wEndingBalance = rawEndingBalance / totalRaw;
    wPayoff = rawPayoffWeight / totalRaw;
    wRefix = rawRefixWeight / totalRaw;
    wFlex = rawFlexibilityWeight / totalRaw;
    wPrincipal = 0;
    wStability = 0;
    wResilience = 0;
    wBudget = 0;
    wSmoothness = 0;
  } else {
    const rawCostWeight = 0.65 - sliderCostStability * 0.40;
    const rawStabilityWeight = 0.15 + sliderCostStability * 0.30;
    const rawRefixWeight = 0.15 + sliderCostStability * 0.10;
    const rawResilienceWeight = 0.05 + sliderCostStability * 0.05;
    const rawFlexibilityWeight = sliderFlexibility * 0.20;
    const totalRaw = rawCostWeight + rawStabilityWeight + rawRefixWeight + rawResilienceWeight + rawFlexibilityWeight;
    wCost = rawCostWeight / totalRaw;
    wStability = rawStabilityWeight / totalRaw;
    wRefix = rawRefixWeight / totalRaw;
    wResilience = rawResilienceWeight / totalRaw;
    wFlex = rawFlexibilityWeight / totalRaw;
    wPrincipal = 0;
    wBudget = 0;
    wEndingBalance = 0;
    wPayoff = 0;
    wSmoothness = 0;
  }

  // 6. Score and rank strategies
  const scoredStrategies = aggregatedStrategies.map((/** @type {any} */ s) => {
    const costScore = (s.expectedInterest - bounds.cost.min) / bounds.cost.diff;
    const principalScore = (s.expectedEndingBalance - bounds.principal.min) / bounds.principal.diff;
    const refixScore = (s.expectedMaxConcurrentRefixPercentage - bounds.refix.min) / bounds.refix.diff;
    const resilienceScore = (s.worstCasePayment - bounds.resilience.min) / bounds.resilience.diff;
    const flexibilityScore = (bounds.flex.max - s.expectedFloatingExposure) / bounds.flex.diff;
    const stabilityScore = (s.expectedMaxPayment - bounds.stability.min) / bounds.stability.diff;
    const budgetScore = (s.expectedAffordabilityBreaches - bounds.budget.min) / bounds.budget.diff;
    const endingBalanceScore = (s.worstCaseEndingBalance - bounds.endingBalance.min) / bounds.endingBalance.diff;
    const payoffScore = (s.expectedPayoffTime - bounds.payoff.min) / bounds.payoff.diff;
    const smoothnessScore = (s.expectedPaymentVolatility - bounds.smoothness.min) / bounds.smoothness.diff;

    const overallScore = wCost * costScore +
      wPrincipal * principalScore +
      wRefix * refixScore +
      wResilience * resilienceScore +
      wFlex * flexibilityScore +
      wStability * stabilityScore +
      wBudget * budgetScore +
      wEndingBalance * endingBalanceScore +
      wPayoff * payoffScore +
      wSmoothness * smoothnessScore;

    return {
      ...s,
      isParetoOptimal: paretoStatus[s.strategyId],
      score: Math.round(overallScore * 1000) / 1000
    };
  });

  scoredStrategies.sort((a, b) => a.score - b.score);

  // 7. Recommendations: preference, lowest cost, most stable (mode-aware).
  //
  // `preference` is driven by the supplied `weights` (or the slider-derived
  // default weights): it is the strategy with the lowest overall score after
  // weighting + normalisation, i.e. the personalised pick.
  //
  // `lowestCost` and `mostStable` are deliberately *weights-independent*
  // objective benchmarks (by design, not a bug): they always pick the
  // mathematical best of the relevant dimension, regardless of the user's
  // slider/weights, so the user can compare their personalised pick against
  // the objective optimum. Concretely:
  //   - `lowestCost`             : smallest `expectedInterest` (term & payment).
  //   - `lowestWorstCaseCost`    : smallest `worstCaseInterest` (term only).
  //   - `lowestWorstCasePayment` : smallest `worstCasePayment` (term only).
  //   - `lowestRefixConcentration`: smallest `expectedMaxConcurrentRefixPercentage`.
  //   - `lowestBudgetBreaches`   : smallest `expectedAffordabilityBreaches` (term).
  //   - `lowestVolatility`       : smallest `expectedPaymentVolatility`.
  //   - `lowestEndingBalance`    : smallest `expectedEndingBalance` (term only).
  //   - `mostFloating`           : smallest `flexibilityPenalty` (i.e. largest
  //                                `expectedFloatingExposure`).
  //   - `mostStable`             : term -> smallest `worstCasePayment`,
  //                                payment -> smallest `worstCaseEndingBalance`.
  //   - `preference`             : weighted-sum preference (responds to `weights`).
  // Each `lowest*` / `mostFloating` benchmark is weights-independent by design
  // so users can compare their personalised pick against each objective's
  // mathematical optimum. See spec 10.4.
  const recommendationPool = scoredStrategies.filter(
    (/** @type {any} */ s) => (s.allocationCount || 1) >= recommendationMinAllocationCount
  );
  const recommendationCandidates = recommendationPool.length > 0 ? recommendationPool : scoredStrategies;
  const preference = recommendationCandidates[0];

  /**
   * @param {any[]} pool
   * @param {string} key
   * @param {(a: any, b: any) => number} [cmp]
   * @returns {any}
   */
  const pickMin = (pool, key, cmp) => [...pool].sort((a, b) =>
    cmp ? cmp(a[key], b[key]) : (a[key] ?? Infinity) - (b[key] ?? Infinity)
  )[0];

  const lowestCost = pickMin(recommendationCandidates, "expectedInterest");
  const lowestWorstCaseCost = pickMin(recommendationCandidates, "worstCaseInterest");
  const lowestWorstCasePayment = pickMin(recommendationCandidates, "worstCasePayment");
  const lowestRefixConcentration = pickMin(recommendationCandidates, "expectedMaxConcurrentRefixPercentage");
  const lowestBudgetBreaches = pickMin(recommendationCandidates, "expectedAffordabilityBreaches");
  const lowestVolatility = pickMin(recommendationCandidates, "expectedPaymentVolatility");
  const lowestEndingBalance = pickMin(recommendationCandidates, "expectedEndingBalance");
  // `flexibilityPenalty = 1 - expectedFloatingExposure` (minimise). So min
  // flexibilityPenalty corresponds to the strategy with the LARGEST floating
  // exposure — i.e. `mostFloating` semantically.
  const mostFloating = pickMin(recommendationCandidates, "flexibilityPenalty");
  const mostStable = mode === "payment"
    ? pickMin(recommendationCandidates, "worstCaseEndingBalance")
    : pickMin(recommendationCandidates, "worstCasePayment");

  const buildRecObject = (/** @type {any} */ s) => {
    if (!s) return null;
    const { pros, cons } = generateExplanations(s, bounds, mode, { diversification });
    return {
      strategyId: s.strategyId,
      score: s.score,
      isParetoOptimal: s.isParetoOptimal,
      pros,
      cons
    };
  };

  return {
    rankedStrategies: scoredStrategies,
    recommendations: {
      preference: buildRecObject(preference),
      lowestCost: buildRecObject(lowestCost),
      lowestWorstCaseCost: buildRecObject(lowestWorstCaseCost),
      lowestWorstCasePayment: buildRecObject(lowestWorstCasePayment),
      lowestRefixConcentration: buildRecObject(lowestRefixConcentration),
      lowestBudgetBreaches: buildRecObject(lowestBudgetBreaches),
      lowestVolatility: buildRecObject(lowestVolatility),
      lowestEndingBalance: buildRecObject(lowestEndingBalance),
      mostFloating: buildRecObject(mostFloating),
      mostStable: buildRecObject(mostStable)
    }
  };
}
