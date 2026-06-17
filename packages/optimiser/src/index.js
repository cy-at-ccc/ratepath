/**
 * Default tolerances for the dominance check, per spec section 9.1 (term mode)
 * and 9.2 (payment mode). The two modes share some keys; payment mode
 * uses `worstCaseEndingBalance` and `payoffTime` instead of
 * `worstCaseInterest` and `expectedAffordabilityBreaches`.
 * @type {Record<string, number>}
 */
export const DEFAULT_TOLERANCES_TERM = {
  expectedInterest: 50,
  worstCaseInterest: 50,
  worstCasePayment: 10,
  expectedMaxConcurrentRefixPercentage: 0.01,
  expectedAffordabilityBreaches: 0.5,
  flexibilityPenalty: 0.01
};

/** @type {Record<string, number>} */
export const DEFAULT_TOLERANCES_PAYMENT = {
  expectedInterest: 50,
  worstCaseEndingBalance: 50,
  payoffTime: 1,
  expectedMaxConcurrentRefixPercentage: 0.01,
  flexibilityPenalty: 0.01
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
 *   1. expectedInterest ($50)
 *   2. worstCaseInterest ($50)
 *   3. worstCasePayment ($10)
 *   4. expectedMaxConcurrentRefixPercentage (0.01)
 *   5. expectedAffordabilityBreaches (0.5)
 *   6. flexibilityPenalty = 1 - expectedFloatingExposure (0.01)
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
      "flexibilityPenalty"
    ],
    tolerances: { ...DEFAULT_TOLERANCES_TERM, ...tolerances }
  };
}

/**
 * Returns the payment-mode Pareto objective set per spec 9.2:
 *   1. expectedInterest ($50)
 *   2. worstCaseEndingBalance ($50)
 *   3. payoffTime (1)
 *   4. expectedMaxConcurrentRefixPercentage (0.01)
 *   5. flexibilityPenalty (0.01)
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
      "flexibilityPenalty"
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
 * @returns {{pros: string[], cons: string[]}}
 */
export function generateExplanations(s, bounds, mode = "term") {
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

  // Flexibility
  if (bounds.flex && s.expectedFloatingExposure >= bounds.flex.max - bounds.flex.diff * 0.15) {
    pros.push("保留较高浮动或Offset额度，资金注入与提前还款极具灵活性。");
  } else if (bounds.flex && s.expectedFloatingExposure <= bounds.flex.min + bounds.flex.diff * 0.20) {
    cons.push("高比例固定锁死了贷款，限制了随时对冲或大额提前还款。");
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
 * @param {Object} input
 * @param {any[]} input.simulationResults - All strategy x scenario simulation results
 * @param {any[]} input.scenarios - List of scenarios with probabilities
 * @param {number} [input.sliderCostStability=0.5] - 0 = cost-priority, 1 = stability-priority
 * @param {number} [input.sliderFlexibility=0.0] - 0 = no flex, 1 = high flex
 * @param {{cost?: number, principal?: number, refix?: number, resilience?: number, flex?: number, budget?: number, stability?: number, endingBalance?: number, payoff?: number}} [input.weights]
 *   - Optional explicit weights. Keys: cost, principal, refix, resilience, flex, budget
 *     (term mode) plus stability, endingBalance, payoff (payment mode). Missing keys
 *     default to 0. Sum of present keys must be > 0 or all weights are ignored.
 * @param {"term"|"payment"} [input.mode] - Mode selector for the objective set (defaults to "term")
 * @param {Record<string, number>} [input.tolerances] - Per-objective tolerance override
 * @returns {any} Ranks, recommendations, and Pareto frontier details
 */
export function optimizeStrategies({
  simulationResults,
  scenarios,
  sliderCostStability = 0.5,
  sliderFlexibility = 0.0,
  weights = undefined,
  mode = "term",
  tolerances = undefined
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
    payoff: getBoundsFor(aggregatedStrategies, "expectedPayoffTime")
  };

  // 5. Weight calculation (mode-aware per spec 10.2)
  let wCost, wPrincipal, wRefix, wResilience, wFlex, wStability, wBudget, wEndingBalance, wPayoff;
  if (weights) {
    const totalRaw = (weights.cost || 0) +
      (weights.principal || 0) +
      (weights.refix || 0) +
      (weights.resilience || 0) +
      (weights.flex || 0) +
      (weights.budget || 0) || 1;
    wCost = (weights.cost || 0) / totalRaw;
    wPrincipal = (weights.principal || 0) / totalRaw;
    wRefix = (weights.refix || 0) / totalRaw;
    wResilience = (weights.resilience || 0) / totalRaw;
    wFlex = (weights.flex || 0) / totalRaw;
    wBudget = (weights.budget || 0) / totalRaw;
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

    const overallScore = wCost * costScore +
      wPrincipal * principalScore +
      wRefix * refixScore +
      wResilience * resilienceScore +
      wFlex * flexibilityScore +
      wStability * stabilityScore +
      wBudget * budgetScore +
      wEndingBalance * endingBalanceScore +
      wPayoff * payoffScore;

    return {
      ...s,
      isParetoOptimal: paretoStatus[s.strategyId],
      score: Math.round(overallScore * 1000) / 1000
    };
  });

  scoredStrategies.sort((a, b) => a.score - b.score);

  // 7. Recommendations: preference, lowest cost, most stable (mode-aware).
  const preference = scoredStrategies[0];
  const lowestCost = [...scoredStrategies].sort((a, b) => a.expectedInterest - b.expectedInterest)[0];
  const mostStable = mode === "payment"
    ? [...scoredStrategies].sort((a, b) => a.worstCaseEndingBalance - b.worstCaseEndingBalance)[0]
    : [...scoredStrategies].sort((a, b) => a.expectedMaxPayment - b.expectedMaxPayment)[0];

  const buildRecObject = (/** @type {any} */ s) => {
    if (!s) return null;
    const { pros, cons } = generateExplanations(s, bounds, mode);
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
      mostStable: buildRecObject(mostStable)
    }
  };
}
