/**
 * Optimises and ranks split strategies based on simulation results and user preferences.
 * Calculates expected values, checks Pareto dominance, scores, and provides pros/cons.
 *
 * @param {Object} input
 * @param {any[]} input.simulationResults - All strategy x scenario simulation results
 * @param {any[]} input.scenarios - List of scenarios with probabilities
 * @param {number} [input.sliderCostStability=0.5] - Slider 1 (0 = Lowest Cost, 1 = Most Stable)
 * @param {number} [input.sliderFlexibility=0.0] - Slider 2 (0 = No Flexibility, 1 = High Flexibility)
 * @param {{cost?: number, principal?: number, refix?: number, resilience?: number, flex?: number, budget?: number}} [input.weights] - Optional explicit scoring weights
 * @returns {any} Ranks, recommendations, and Pareto frontier details
 */
export function optimizeStrategies({
  simulationResults,
  scenarios,
  sliderCostStability = 0.5,
  sliderFlexibility = 0.0,
  weights = undefined
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

  // 2. Compute aggregated expected metrics for each strategy
  const aggregatedStrategies = Object.keys(strategyGroups).map(strategyId => {
    const runs = strategyGroups[strategyId];

    let expectedInterest = 0;
    let expectedRepayments = 0;
    let expectedEndingBalance = 0;
    let expectedMaxPayment = 0;
    let expectedPaymentVolatility = 0;
    let expectedRefixEventCount = 0;
    let expectedMaxConcurrentRefixPercentage = 0;
    let expectedFloatingExposure = 0;
    let expectedAffordabilityBreaches = 0;

    let worstCasePayment = 0;
    let worstCaseInterest = 0;
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

      if (run.maximumPayment > worstCasePayment) {
        worstCasePayment = run.maximumPayment;
      }
      if (run.totalInterest < bestCaseInterest) {
        bestCaseInterest = run.totalInterest;
      }
      if (run.totalInterest > worstCaseInterest) {
        worstCaseInterest = run.totalInterest;
      }
      if (run.scenarioId === "base") {
        baseCaseInterest = run.totalInterest;
      }
    });

    // Clean up rounding
    expectedInterest = Math.round(expectedInterest * 100) / 100;
    expectedRepayments = Math.round(expectedRepayments * 100) / 100;
    expectedEndingBalance = Math.round(expectedEndingBalance * 100) / 100;
    expectedMaxPayment = Math.round(expectedMaxPayment * 100) / 100;
    expectedPaymentVolatility = Math.round(expectedPaymentVolatility * 100) / 100;
    expectedRefixEventCount = Math.round(expectedRefixEventCount * 100) / 100;
    expectedMaxConcurrentRefixPercentage = Math.round(expectedMaxConcurrentRefixPercentage * 1e4) / 1e4;
    expectedFloatingExposure = Math.round(expectedFloatingExposure * 1e4) / 1e4;
    expectedAffordabilityBreaches = Math.round(expectedAffordabilityBreaches * 10) / 10;
    worstCaseInterest = Math.round(worstCaseInterest * 100) / 100;

    return {
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
      worstCasePayment,
      worstCaseInterest,
      bestCaseInterest,
      baseCaseInterest
    };
  });

  if (aggregatedStrategies.length === 0) {
    return {
      rankedStrategies: [],
      recommendations: {}
    };
  }

  // 3. Pareto frontier classification
  // S1 dominates S2 if:
  // - S1 is better than or equal to S2 in all 6 objectives
  // - S1 is strictly better than S2 in at least one objective
  // Objectives and Directions:
  // 1. Expected interest (预计利息): lower is better
  // 2. Worst-case interest (最坏利息): lower is better
  // 3. Worst-case payment (最高还款): lower is better
  // 4. Expected max concurrent refix percentage (同时到期比例): lower is better
  // 5. Expected affordability breaches (预算超限次数): lower is better
  // 6. Flexibility penalty (灵活性惩罚 = 1 - expectedFloatingExposure): lower is better
  const isDominated = (/** @type {any} */ s1, /** @type {any} */ s2) => {
    const s1FlexPenalty = 1 - s1.expectedFloatingExposure;
    const s2FlexPenalty = 1 - s2.expectedFloatingExposure;

    const condCost = s1.expectedInterest <= s2.expectedInterest;
    const condWorstCost = s1.worstCaseInterest <= s2.worstCaseInterest;
    const condWorst = s1.worstCasePayment <= s2.worstCasePayment;
    const condRefix = s1.expectedMaxConcurrentRefixPercentage <= s2.expectedMaxConcurrentRefixPercentage;
    const condBreaches = s1.expectedAffordabilityBreaches <= s2.expectedAffordabilityBreaches;
    const condFlexPenalty = s1FlexPenalty <= s2FlexPenalty;

    const strictCost = s1.expectedInterest < s2.expectedInterest;
    const strictWorstCost = s1.worstCaseInterest < s2.worstCaseInterest;
    const strictWorst = s1.worstCasePayment < s2.worstCasePayment;
    const strictRefix = s1.expectedMaxConcurrentRefixPercentage < s2.expectedMaxConcurrentRefixPercentage;
    const strictBreaches = s1.expectedAffordabilityBreaches < s2.expectedAffordabilityBreaches;
    const strictFlexPenalty = s1FlexPenalty < s2FlexPenalty;

    return condCost && condWorstCost && condWorst && condRefix && condBreaches && condFlexPenalty &&
           (strictCost || strictWorstCost || strictWorst || strictRefix || strictBreaches || strictFlexPenalty);
  };

  /** @type {Record<string, boolean>} */
  const paretoStatus = {};
  aggregatedStrategies.forEach((/** @type {any} */ s) => {
    const dominated = aggregatedStrategies.some(other => isDominated(other, s));
    paretoStatus[s.strategyId] = !dominated;
  });

  // 4. Normalisation bounds
  const getBounds = (/** @type {string} */ key) => {
    const values = aggregatedStrategies.map((/** @type {any} */ s) => s[key]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    return { min, max, diff: max - min || 1 };
  };

  const costBounds = getBounds("expectedInterest");
  const principalBounds = getBounds("expectedEndingBalance");
  const refixBounds = getBounds("expectedMaxConcurrentRefixPercentage");
  const resilienceBounds = getBounds("worstCasePayment");
  const flexBounds = getBounds("expectedFloatingExposure");
  const stabilityBounds = getBounds("expectedMaxPayment");
  const budgetBounds = getBounds("expectedAffordabilityBreaches");

  // 5. Weight calculation
  let wCost, wPrincipal, wRefix, wResilience, wFlex, wStability, wBudget;
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
  }

  // 6. Score and Rank strategies
  const scoredStrategies = aggregatedStrategies.map((/** @type {any} */ s) => {
    const costScore = (s.expectedInterest - costBounds.min) / costBounds.diff;
    const principalScore = (s.expectedEndingBalance - principalBounds.min) / principalBounds.diff;
    const refixScore = (s.expectedMaxConcurrentRefixPercentage - refixBounds.min) / refixBounds.diff;
    const resilienceScore = (s.worstCasePayment - resilienceBounds.min) / resilienceBounds.diff;
    const flexibilityScore = (flexBounds.max - s.expectedFloatingExposure) / flexBounds.diff;
    const stabilityScore = (s.expectedMaxPayment - stabilityBounds.min) / stabilityBounds.diff;
    const budgetScore = (s.expectedAffordabilityBreaches - budgetBounds.min) / budgetBounds.diff;

    const overallScore = wCost * costScore +
                         wPrincipal * principalScore +
                         wRefix * refixScore +
                         wResilience * resilienceScore +
                         wFlex * flexibilityScore +
                         wStability * stabilityScore +
                         wBudget * budgetScore;

    return {
      ...s,
      isParetoOptimal: paretoStatus[s.strategyId],
      score: Math.round(overallScore * 1000) / 1000
    };
  });

  // Sort by overallScore ascending (lower score is better)
  scoredStrategies.sort((a, b) => a.score - b.score);

  // 7. Explanations generator helper
  const generateExplanations = (/** @type {any} */ s) => {
    const pros = [];
    const cons = [];

    // Interest cost explanations
    if (s.expectedInterest <= costBounds.min + costBounds.diff * 0.15) {
      pros.push("预期利息成本极低，利息支出控制最佳。");
    } else if (s.expectedInterest >= costBounds.max - costBounds.diff * 0.20) {
      cons.push("预期整体利息成本支出较高。");
    }

    // Principal repayment explanations
    if (s.expectedEndingBalance <= principalBounds.min + principalBounds.diff * 0.15) {
      pros.push("本金还款额度大，有利于快速消减贷款余额。");
    } else if (s.expectedEndingBalance >= principalBounds.max - principalBounds.diff * 0.20) {
      cons.push("本金还款进度较慢，到期剩余余额较多。");
    }

    // Refix Concentration risk explanations
    if (s.expectedMaxConcurrentRefixPercentage <= refixBounds.min + refixBounds.diff * 0.15) {
      pros.push("贷款到期日期分散，避免集中重定价利率飙升的风险。");
    } else if (s.expectedMaxConcurrentRefixPercentage >= refixBounds.max - refixBounds.diff * 0.20) {
      cons.push("多笔贷款面临同时到期，重定价利率集中暴露风险高。");
    }

    if (s.expectedAffordabilityBreaches <= budgetBounds.min + budgetBounds.diff * 0.15) {
      pros.push("模拟期内预算超限次数较少，供款压力更可控。");
    } else if (s.expectedAffordabilityBreaches >= budgetBounds.max - budgetBounds.diff * 0.20) {
      cons.push("模拟期内更容易超过设定供款预算。");
    }

    // Flexibility explanations
    if (s.expectedFloatingExposure >= flexBounds.max - flexBounds.diff * 0.15) {
      pros.push("保留较高浮动或Offset额度，资金注入与提前还款极具灵活性。");
    } else if (s.expectedFloatingExposure <= flexBounds.min + flexBounds.diff * 0.20) {
      cons.push("高比例固定锁死了贷款，限制了随时对冲或大额提前还款。");
    }

    // Fallbacks if lists are empty
    if (pros.length === 0) {
      pros.push("各项财务与风险指标表现较为均衡。");
    }
    if (cons.length === 0) {
      cons.push("在极端高息走势下缺乏更深度的防御缓冲。");
    }

    return { pros, cons };
  };

  // 8. Determine key recommendations
  const preference = scoredStrategies[0];

  // Lowest Expected Cost
  const lowestCost = [...scoredStrategies].sort((a, b) => a.expectedInterest - b.expectedInterest)[0];

  // Most Stable (lowest peak repayment)
  const mostStable = [...scoredStrategies].sort((a, b) => a.expectedMaxPayment - b.expectedMaxPayment)[0];

  const buildRecObject = (/** @type {any} */ s) => {
    const { pros, cons } = generateExplanations(s);
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
