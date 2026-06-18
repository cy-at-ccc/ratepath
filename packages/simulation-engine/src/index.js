import { simulateMortgageTimeline, addMonths } from "@mortgage/mortgage-engine";

/**
 * Simulates a single strategy under a single rate scenario.
 * @param {Object} input
 * @param {import("@mortgage/schemas").Mortgage} input.mortgage - Base mortgage details
 * @param {import("@mortgage/schemas").SplitStrategy} input.strategy - The Split Strategy containing allocations
 * @param {import("@mortgage/schemas").RateScenario} input.scenario - Rate Scenario with product rate paths
 * @param {import("@mortgage/schemas").MortgageProductDefinition[]} input.products - Product definitions (to look up term lengths)
 * @param {Record<string, number>} input.currentProductRates - Current product rates (for initial rates)
 * @param {string} [input.startDate] - Start date of the simulation
 * @param {number} [input.forecastMonths=36] - Horizon length in months
 * @param {number} [input.maxAffordablePayment] - User budget threshold (optional)
 * @param {boolean} [input.includeTimeline=true] - Include per-month detail rows in the result
 * @param {boolean} [input.includeRefixEvents=true] - Include refix event detail in the result
 * @returns {any} Detailed result for this simulation
 */
export function simulateStrategyScenario({
  mortgage,
  strategy,
  scenario,
  products,
  currentProductRates,
  startDate,
  forecastMonths = 36,
  maxAffordablePayment,
  includeTimeline = true,
  includeRefixEvents = true
}) {
  const start = startDate || new Date().toISOString().split("T")[0];
  const frequency = mortgage.repaymentFrequency;

  // Map strategy allocations to MortgageTranche objects
  /** @type {import("@mortgage/schemas").MortgageTranche[]} */
  const tranches = strategy.allocations.map((alloc, idx) => {
    const prodDef = products.find(p => p.code === alloc.productCode);
    const fixedMonths = prodDef ? prodDef.fixedMonths : null;

    // Calculate fixedUntil date if applicable
    const fixedUntil = fixedMonths ? addMonths(start, fixedMonths) : null;

    const initialRate = currentProductRates[alloc.productCode] ?? 0;

    return {
      id: `tranche-${idx}-${alloc.productCode}`,
      productCode: alloc.productCode,
      balance: alloc.amount,
      annualRate: initialRate,
      fixedUntil,
      remainingTermMonths: mortgage.remainingTermMonths,
      repaymentType: mortgage.repaymentType,
      linkedOffsetBalance: 0
    };
  });

  // Construct temporary mortgage object. Forward the new payment-policy, offset
  // event, and target fields per spec section 4 and 7.
  /** @type {import("@mortgage/schemas").Mortgage} */
  const tempMortgage = {
    ...mortgage,
    tranches,
    paymentPolicy: mortgage.paymentPolicy,
    offsetEvents: mortgage.offsetEvents
  };

  // Run the timeline simulation
  const rawResult = simulateMortgageTimeline({
    mortgage: tempMortgage,
    scenario,
    startDate: start,
    forecastMonths,
    refixRule: strategy.refixRule,
    products
  });

  // Calculate additional metrics:
  // 1. maximumPaymentIncrease: max month-to-month scheduled payment increase
  let maxPaymentIncrease = 0;
  /** @type {any[]} */
  const timeline = rawResult.timeline;
  for (let i = 1; i < timeline.length; i++) {
    const prevPayment = timeline[i - 1].scheduledPayment;
    const currPayment = timeline[i].scheduledPayment;
    const diff = currPayment - prevPayment;
    if (diff > maxPaymentIncrease) {
      maxPaymentIncrease = diff;
    }
  }
  maxPaymentIncrease = Math.round(maxPaymentIncrease * 100) / 100;

  // 2. paymentVolatility: Standard deviation of monthly scheduled payments
  const payments = timeline.map(t => t.scheduledPayment);
  let averagePayment = 0;
  if (payments.length > 0) {
    averagePayment = payments.reduce((sum, p) => sum + p, 0) / payments.length;
  }
  let varianceSum = 0;
  payments.forEach(p => {
    varianceSum += Math.pow(p - averagePayment, 2);
  });
  const variance = payments.length > 0 ? varianceSum / payments.length : 0;
  const paymentVolatility = Math.round(Math.sqrt(variance) * 100) / 100;

  // 3. maximumConcurrentRefixPercentage: Max percentage of balance refixing in any single period/month
  let maxConcurrentRefixPercentage = 0;

  // Group refixEvents by monthIndex
  /** @type {Record<number, number>} */
  const refixByMonth = {};
  rawResult.refixEvents.forEach((/** @type {any} */ evt) => {
    const m = (frequency === "monthly") ? evt.periodIndex :
              (frequency === "fortnightly") ? Math.floor(evt.periodIndex * 12 / 26) :
              Math.floor(evt.periodIndex * 12 / 52);
    refixByMonth[m] = (refixByMonth[m] || 0) + evt.balance;
  });

  Object.keys(refixByMonth).forEach(mStr => {
    const m = parseInt(mStr, 10);
    const refixedBalance = refixByMonth[m];
    // Find the opening balance of that month in timeline
    const monthRecord = timeline.find(t => t.monthIndex === m);
    const totalBalance = monthRecord ? monthRecord.openingBalance : 0;
    if (totalBalance > 0) {
      const pct = refixedBalance / totalBalance;
      if (pct > maxConcurrentRefixPercentage) {
        maxConcurrentRefixPercentage = pct;
      }
    }
  });
  maxConcurrentRefixPercentage = Math.round(maxConcurrentRefixPercentage * 1e4) / 1e4;

  // 4. floatingExposure: Initial floating/offset/revolving balance / total balance
  const floatingBalance = strategy.allocations
    .filter(alloc => {
      const prodDef = products.find(p => p.code === alloc.productCode);
      return prodDef && ["floating", "offset", "revolving"].includes(prodDef.type);
    })
    .reduce((sum, alloc) => sum + alloc.amount, 0);
  const totalAllocated = strategy.allocations.reduce((sum, alloc) => sum + alloc.amount, 0);
  const floatingExposure = totalAllocated > 0 ? Math.round((floatingBalance / totalAllocated) * 1e4) / 1e4 : 0;

  // 5. affordabilityBreaches: Number of repayment periods where payment exceeds maxAffordablePayment
  let affordabilityBreaches = 0;
  if (maxAffordablePayment !== undefined && maxAffordablePayment > 0) {
    const affordabilityTimeline = rawResult.rawPeriodsTimeline || timeline;
    affordabilityTimeline.forEach((/** @type {any} */ t) => {
      if (t.scheduledPayment > maxAffordablePayment) {
        affordabilityBreaches++;
      }
    });
  }

  return {
    strategyId: strategy.id,
    scenarioId: scenario.id,
    allocationCount: strategy.allocations.length,
    totalInterest: rawResult.totalInterest,
    totalRepayments: rawResult.totalRepayments,
    endingBalance: rawResult.endingBalance,
    maximumPayment: rawResult.maximumPayment,
    minimumPayment: rawResult.minimumPayment,
    averagePayment: rawResult.averagePayment,
    maximumPaymentIncrease: maxPaymentIncrease,
    paymentVolatility,
    refixEventCount: rawResult.refixEventCount,
    maximumConcurrentRefixPercentage: maxConcurrentRefixPercentage,
    floatingExposure,
    affordabilityBreaches,
    payoffTime: rawResult.payoffTime,
    offsetUtilisation: rawResult.offsetUtilisation,
    isInfeasible: rawResult.isInfeasible,
    infeasibilityReason: rawResult.infeasibilityReason,
    refixEvents: includeRefixEvents ? rawResult.refixEvents : [],
    timeline: includeTimeline ? timeline : undefined
  };
}

/**
 * Runs simulation for a matrix of strategies and scenarios, with progress and cancellation.
 * @param {Object} input
 * @param {import("@mortgage/schemas").Mortgage} input.mortgage
 * @param {import("@mortgage/schemas").SplitStrategy[]} input.strategies
 * @param {import("@mortgage/schemas").RateScenario[]} input.scenarios
 * @param {import("@mortgage/schemas").MortgageProductDefinition[]} input.products
 * @param {Record<string, number>} input.currentProductRates
 * @param {string} [input.startDate]
 * @param {number} [input.forecastMonths=36]
 * @param {number} [input.maxAffordablePayment]
 * @param {boolean} [input.includeTimeline=true]
 * @param {boolean} [input.includeRefixEvents=true]
 * @param {function(number, number, {strategy: import("@mortgage/schemas").SplitStrategy, scenario: import("@mortgage/schemas").RateScenario}): void} [input.onProgress]
 * @param {AbortSignal} [input.signal]
 * @returns {Promise<any[]>} Flat list of all strategy x scenario simulation results
 */
export async function simulateStrategyScenarioMatrix({
  mortgage,
  strategies,
  scenarios,
  products,
  currentProductRates,
  startDate,
  forecastMonths = 36,
  maxAffordablePayment,
  includeTimeline = true,
  includeRefixEvents = true,
  onProgress,
  signal
}) {
  const results = [];
  const totalSimulations = strategies.length * scenarios.length;
  let completed = 0;

  for (const strategy of strategies) {
    for (const scenario of scenarios) {
      if (signal?.aborted) {
        throw new Error("Simulation cancelled");
      }

      const res = simulateStrategyScenario({
        mortgage,
        strategy,
        scenario,
        products,
        currentProductRates,
        startDate,
        forecastMonths,
        maxAffordablePayment,
        includeTimeline,
        includeRefixEvents
      });

      results.push(res);
      completed++;

      if (onProgress) {
        onProgress(completed, totalSimulations, { strategy, scenario });
      }

      // Allow event loop to breathe
      if (completed % 10 === 0) {
        await new Promise(resolve => globalThis.setTimeout(resolve, 0));
      }
    }
  }

  return results;
}
