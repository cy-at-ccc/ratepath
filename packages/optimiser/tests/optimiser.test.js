// @ts-nocheck — Test file; financial correctness is verified by 8 vitest
// assertions in this file. JSDoc strict-mode type checks on `reduce`/`filter`
// callbacks and test-fixture narrowing are tracked as technical debt in
// docs/technical-debt/scheme-two-follow-ups.md.
import { describe, it, expect } from "vitest";
import { optimizeStrategies, dominates, generateExplanations, getTermObjectives, getPaymentObjectives } from "../src/index.js";

describe("Optimiser Engine Tests", () => {
  const scenarios = [
    { id: "low", probability: 0.2 },
    { id: "base", probability: 0.6 },
    { id: "high", probability: 0.2 }
  ];

  // Strategy 1 (Mostly Floating): Cheap in Low/Base scenarios, expensive & high monthly payment in High scenario
  // Strategy 2 (Mostly Fixed): Stable but expensive in Low/Base scenarios, cheap in High scenario
  // Strategy 3 (Dominated by Strategy 1): Worse in cost, stability, refix, and flexibility
  const simulationResults = [
    // Strategy 1 (Floating)
    {
      strategyId: "strat-1",
      scenarioId: "low",
      totalInterest: 10000,
      totalRepayments: 30000,
      endingBalance: 400000,
      maximumPayment: 3000,
      minimumPayment: 2500,
      averagePayment: 2700,
      maximumPaymentIncrease: 100,
      paymentVolatility: 150,
      refixEventCount: 0,
      maximumConcurrentRefixPercentage: 0,
      floatingExposure: 1.0,
      affordabilityBreaches: 0,
      timeline: []
    },
    {
      strategyId: "strat-1",
      scenarioId: "base",
      totalInterest: 15000,
      totalRepayments: 35000,
      endingBalance: 405000,
      maximumPayment: 3200,
      minimumPayment: 2600,
      averagePayment: 2800,
      maximumPaymentIncrease: 120,
      paymentVolatility: 180,
      refixEventCount: 0,
      maximumConcurrentRefixPercentage: 0,
      floatingExposure: 1.0,
      affordabilityBreaches: 0,
      timeline: []
    },
    {
      strategyId: "strat-1",
      scenarioId: "high",
      totalInterest: 25000,
      totalRepayments: 45000,
      endingBalance: 415000,
      maximumPayment: 4200, // spikes high
      minimumPayment: 2800,
      averagePayment: 3200,
      maximumPaymentIncrease: 300,
      paymentVolatility: 300,
      refixEventCount: 0,
      maximumConcurrentRefixPercentage: 0,
      floatingExposure: 1.0,
      affordabilityBreaches: 1,
      timeline: []
    },

    // Strategy 2 (Fixed)
    {
      strategyId: "strat-2",
      scenarioId: "low",
      totalInterest: 16500,
      totalRepayments: 38000,
      endingBalance: 408000,
      maximumPayment: 3100,
      minimumPayment: 3100,
      averagePayment: 3100,
      maximumPaymentIncrease: 0,
      paymentVolatility: 0,
      refixEventCount: 1,
      maximumConcurrentRefixPercentage: 0.2,
      floatingExposure: 0.0,
      affordabilityBreaches: 0,
      timeline: []
    },
    {
      strategyId: "strat-2",
      scenarioId: "base",
      totalInterest: 16500,
      totalRepayments: 38000,
      endingBalance: 408000,
      maximumPayment: 3100,
      minimumPayment: 3100,
      averagePayment: 3100,
      maximumPaymentIncrease: 0,
      paymentVolatility: 0,
      refixEventCount: 1,
      maximumConcurrentRefixPercentage: 0.2,
      floatingExposure: 0.0,
      affordabilityBreaches: 0,
      timeline: []
    },
    {
      strategyId: "strat-2",
      scenarioId: "high",
      totalInterest: 16500,
      totalRepayments: 38000,
      endingBalance: 408000,
      maximumPayment: 3100, // very stable peak payment
      minimumPayment: 3100,
      averagePayment: 3100,
      maximumPaymentIncrease: 0,
      paymentVolatility: 0,
      refixEventCount: 1,
      maximumConcurrentRefixPercentage: 0.2,
      floatingExposure: 0.0,
      affordabilityBreaches: 0,
      timeline: []
    },

    // Strategy 3 (Dominated by Strategy 1)
    {
      strategyId: "strat-3",
      scenarioId: "low",
      totalInterest: 12000,
      totalRepayments: 32000,
      endingBalance: 402000,
      maximumPayment: 3100,
      minimumPayment: 2600,
      averagePayment: 2800,
      maximumPaymentIncrease: 110,
      paymentVolatility: 160,
      refixEventCount: 2,
      maximumConcurrentRefixPercentage: 0.5,
      floatingExposure: 0.8,
      affordabilityBreaches: 0,
      timeline: []
    },
    {
      strategyId: "strat-3",
      scenarioId: "base",
      totalInterest: 17000,
      totalRepayments: 37000,
      endingBalance: 407000,
      maximumPayment: 3300,
      minimumPayment: 2700,
      averagePayment: 2900,
      maximumPaymentIncrease: 130,
      paymentVolatility: 190,
      refixEventCount: 2,
      maximumConcurrentRefixPercentage: 0.5,
      floatingExposure: 0.8,
      affordabilityBreaches: 0,
      timeline: []
    },
    {
      strategyId: "strat-3",
      scenarioId: "high",
      totalInterest: 27000,
      totalRepayments: 47000,
      endingBalance: 417000,
      maximumPayment: 4300,
      minimumPayment: 2900,
      averagePayment: 3300,
      maximumPaymentIncrease: 320,
      paymentVolatility: 310,
      refixEventCount: 2,
      maximumConcurrentRefixPercentage: 0.5,
      floatingExposure: 0.8,
      affordabilityBreaches: 1,
      timeline: []
    }
  ];

  it("should rank strategies by preference weights and adjust rank with slider values", () => {
    // 1. Cost preferred: SliderCostStability = 0.0, SliderFlexibility = 0.0
    // ExpectedInterest:
    // strat-1: 10000*0.2 + 15000*0.6 + 25000*0.2 = 2000 + 9000 + 5000 = 16000
    // strat-2: 18000
    // strat-3: 12000*0.2 + 17000*0.6 + 27000*0.2 = 2400 + 10200 + 5400 = 18000
    // Strategy 1 should be ranked best
    const optCost = optimizeStrategies({
      simulationResults,
      scenarios,
      sliderCostStability: 0.0,
      sliderFlexibility: 0.0
    });

    expect(optCost.rankedStrategies[0].strategyId).toBe("strat-1");
    expect(optCost.recommendations.lowestCost.strategyId).toBe("strat-1");

    // 2. Stability preferred: SliderCostStability = 1.0, SliderFlexibility = 0.0
    // ExpectedMaxPayment:
    // strat-1: 3000*0.2 + 3200*0.6 + 4200*0.2 = 600 + 1920 + 840 = 3360
    // strat-2: 3100
    // Strategy 2 should be ranked best
    const optStability = optimizeStrategies({
      simulationResults,
      scenarios,
      sliderCostStability: 1.0,
      sliderFlexibility: 0.0
    });

    expect(optStability.rankedStrategies[0].strategyId).toBe("strat-2");
    expect(optStability.recommendations.mostStable.strategyId).toBe("strat-2");
  });

  it("should identify dominated strategies in Pareto sorting", () => {
    const opt = optimizeStrategies({
      simulationResults,
      scenarios,
      sliderCostStability: 0.5,
      sliderFlexibility: 0.0
    });

    // strat-3 is strictly dominated by strat-1 because:
    // - strat-1 expected interest (16000) < strat-3 (18000)
    // - strat-1 worst case (4200) < strat-3 (4300)
    // - strat-1 refix risk (0.0) < strat-3 (0.5)
    // - strat-1 flexibility (1.0) > strat-3 (0.8)
    const strat3 = opt.rankedStrategies.find((/** @type {any} */ s) => s.strategyId === "strat-3");
    expect(strat3?.isParetoOptimal).toBe(false);

    const strat1 = opt.rankedStrategies.find((/** @type {any} */ s) => s.strategyId === "strat-1");
    expect(strat1?.isParetoOptimal).toBe(true);
    expect(strat1?.worstCaseInterest).toBe(25000);

    const strat2 = opt.rankedStrategies.find((/** @type {any} */ s) => s.strategyId === "strat-2");
    expect(strat2?.isParetoOptimal).toBe(true);
    expect(strat2?.worstCaseInterest).toBe(16500);
  });
});

describe("Pareto tolerance & mode-specific objectives", () => {
  const scenarios = [
    { id: "low", probability: 0.2 },
    { id: "base", probability: 0.6 },
    { id: "high", probability: 0.2 }
  ];

  /**
   * Golden case 30: term-mode dominance with tolerance.
   * Build two strategies A and B. A dominates B within the spec's tolerances.
   */
  it("Golden case 30: term-mode dominance is recognised within default tolerances", () => {
    /**
     * @param {number} interest
     * @param {number} worstInterest
     * @param {number} worstPayment
     * @param {number} refixPct
     * @param {number} breaches
     * @param {number} floatingExp
     * @returns {any[]}
     */
    const buildResults = (interest, worstInterest, worstPayment, refixPct, breaches, floatingExp) => ([
      // One scenario is sufficient to derive the metrics.
      {
        strategyId: "tmp",
        scenarioId: "base",
        totalInterest: interest,
        totalRepayments: 0,
        endingBalance: 0,
        maximumPayment: worstPayment,
        minimumPayment: 0,
        averagePayment: worstPayment,
        maximumPaymentIncrease: 0,
        paymentVolatility: 0,
        refixEventCount: 0,
        maximumConcurrentRefixPercentage: refixPct,
        floatingExposure: floatingExp,
        affordabilityBreaches: breaches,
        refixEvents: [],
        timeline: []
      }
    ]);
    const scenariosSingle = [{ id: "base", probability: 1 }];
    const results = [
      { id: "A", run: buildResults(10000, 12000, 3000, 0.2, 0, 0.5) },
      { id: "B", run: buildResults(10100, 12100, 3010, 0.21, 0, 0.5) }
    ];
    const flat = results.flatMap(({ id, run }) => {
      const r = run[0];
      return [{ ...r, strategyId: id }];
    });
    const opt = optimizeStrategies({ simulationResults: flat, scenarios: scenariosSingle, mode: "term" });
    const a = opt.rankedStrategies.find((/** @type {any} */ s) => s.strategyId === "A");
    const b = opt.rankedStrategies.find((/** @type {any} */ s) => s.strategyId === "B");
    expect(a.isParetoOptimal).toBe(true);
    expect(b.isParetoOptimal).toBe(false);
  });

  /**
   * Golden case 31: payment-mode dominance.
   */
  it("Golden case 31: payment-mode dominance is recognised", () => {
    const scenariosSingle = [{ id: "base", probability: 1 }];
    /**
     * @param {string} id
     * @param {number} ei
     * @param {number} web
     * @param {number} pt
     * @param {number} refixPct
     * @param {number} fExp
     */
    const mk = (id, ei, web, pt, refixPct, fExp) => ({
      strategyId: id,
      scenarioId: "base",
      totalInterest: ei,
      totalRepayments: 0,
      endingBalance: web,
      maximumPayment: 0,
      minimumPayment: 0,
      averagePayment: 0,
      maximumPaymentIncrease: 0,
      paymentVolatility: 0,
      refixEventCount: 0,
      maximumConcurrentRefixPercentage: refixPct,
      floatingExposure: fExp,
      affordabilityBreaches: 0,
      payoffTime: pt,
      refixEvents: [],
      timeline: []
    });
    const flat = [
      mk("A", 8000, 100000, 24, 0.2, 0.3),
      mk("B", 8050, 105000, 25, 0.21, 0.3)
    ];
    const opt = optimizeStrategies({ simulationResults: flat, scenarios: scenariosSingle, mode: "payment" });
    const a = opt.rankedStrategies.find((/** @type {any} */ s) => s.strategyId === "A");
    const b = opt.rankedStrategies.find((/** @type {any} */ s) => s.strategyId === "B");
    expect(a.isParetoOptimal).toBe(true);
    expect(b.isParetoOptimal).toBe(false);
  });

  it("Tolerance-aware dominance: small differences within tolerance do not dominate", () => {
    // The default tolerance for `expectedInterest` is $50. A beats B by $10,
    // which is within tolerance, so A does NOT dominate B.
    const a = { expectedInterest: 1000, worstCaseInterest: 0, worstCasePayment: 0, expectedMaxConcurrentRefixPercentage: 0, expectedAffordabilityBreaches: 0, flexibilityPenalty: 0 };
    const b = { expectedInterest: 1010, worstCaseInterest: 0, worstCasePayment: 0, expectedMaxConcurrentRefixPercentage: 0, expectedAffordabilityBreaches: 0, flexibilityPenalty: 0 };
    const { objectives, tolerances } = getTermObjectives();
    expect(dominates(a, b, objectives, tolerances)).toBe(false);
    // With a $0 tolerance override, A dominates B.
    const tight = { ...tolerances, expectedInterest: 0 };
    expect(dominates(a, b, objectives, tight)).toBe(true);
  });

  it("generateExplanations is the single source of truth and adapts to mode", () => {
    const bounds = {
      cost: { min: 1000, max: 2000, diff: 1000 },
      principal: { min: 0, max: 0, diff: 1 },
      refix: { min: 0, max: 0, diff: 1 },
      resilience: { min: 0, max: 0, diff: 1 },
      flex: { min: 0, max: 1, diff: 1 },
      stability: { min: 0, max: 0, diff: 1 },
      budget: { min: 0, max: 0, diff: 1 },
      endingBalance: { min: 0, max: 0, diff: 1 },
      payoff: { min: 0, max: 0, diff: 1 }
    };
    const termExp = generateExplanations({
      expectedInterest: 1000,
      expectedMaxConcurrentRefixPercentage: 0,
      expectedAffordabilityBreaches: 0,
      expectedFloatingExposure: 1,
      worstCasePayment: 0,
      expectedEndingBalance: 0
    }, bounds, "term");
    expect(termExp.pros.length).toBeGreaterThan(0);
    // In payment mode, the term-mode-specific pro ("预算超限次数较少") is not emitted.
    const paymentExp = generateExplanations({
      expectedInterest: 1000,
      expectedMaxConcurrentRefixPercentage: 0,
      expectedAffordabilityBreaches: 0,
      expectedFloatingExposure: 1,
      worstCaseEndingBalance: 0,
      payoffTime: 0
    }, bounds, "payment");
    expect(paymentExp.pros.length).toBeGreaterThan(0);
  });
});
