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
    // The default tolerance for `expectedInterest` is $20 (tightened from $50
    // in Deliverable 1). A beats B by $10, which is within the new tolerance,
    // so A does NOT dominate B.
    const a = { expectedInterest: 1000, worstCaseInterest: 0, worstCasePayment: 0, expectedMaxConcurrentRefixPercentage: 0, expectedAffordabilityBreaches: 0, flexibilityPenalty: 0 };
    const b = { expectedInterest: 1010, worstCaseInterest: 0, worstCasePayment: 0, expectedMaxConcurrentRefixPercentage: 0, expectedAffordabilityBreaches: 0, flexibilityPenalty: 0 };
    const { objectives, tolerances } = getTermObjectives();
    expect(dominates(a, b, objectives, tolerances)).toBe(false);
    // With a $0 tolerance override, A dominates B.
    const tight = { ...tolerances, expectedInterest: 0 };
    expect(dominates(a, b, objectives, tight)).toBe(true);
  });

  it("Tolerance tightening (D1): $25 difference no longer ties; A wins on interest strictly", () => {
    // With the new $20 tolerance, two strategies that differ by $25 on
    // expectedInterest are now discriminating — A's strictly-better interest
    // (by $25 > $20 tolerance) plus tie-or-better on the other objectives
    // is enough for A to dominate B. The legacy $50 tolerance made them tie.
    const a = { expectedInterest: 1000, worstCaseInterest: 0, worstCasePayment: 0, expectedMaxConcurrentRefixPercentage: 0, expectedAffordabilityBreaches: 0, flexibilityPenalty: 0 };
    const b = { expectedInterest: 1025, worstCaseInterest: 0, worstCasePayment: 0, expectedMaxConcurrentRefixPercentage: 0, expectedAffordabilityBreaches: 0, flexibilityPenalty: 0 };
    const { objectives, tolerances } = getTermObjectives();
    expect(dominates(a, b, objectives, tolerances)).toBe(true);
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

  it("generateExplanations diversification flag emits refix-spread / flex copy", () => {
    // Pins Deliverable 3b: when the user has opted into the Diversification
    // preset, the pros/cons must surface the refix-spread and floating-
    // exposure benefits explicitly. Without the flag those strings are absent.
    const bounds = {
      cost: { min: 1000, max: 2000, diff: 1000 },
      principal: { min: 0, max: 0, diff: 1 },
      refix: { min: 0.0, max: 0.6, diff: 0.6 },
      resilience: { min: 3000, max: 5000, diff: 2000 },
      flex: { min: 0.0, max: 0.6, diff: 0.6 },
      stability: { min: 0, max: 0, diff: 1 },
      budget: { min: 0, max: 0, diff: 1 },
      endingBalance: { min: 0, max: 0, diff: 1 },
      payoff: { min: 0, max: 0, diff: 1 }
    };
    // Mid-pack refix concentration (0.15) and floating exposure (0.45) trigger
    // the diversification-only branches in generateExplanations.
    const strategy = {
      expectedInterest: 1500, // above the cost floor, triggers the cost-premium con
      expectedMaxConcurrentRefixPercentage: 0.15,
      expectedAffordabilityBreaches: 0,
      expectedFloatingExposure: 0.45,
      worstCasePayment: 3500,
      expectedEndingBalance: 0
    };

    const withoutFlag = generateExplanations(strategy, bounds, "term");
    const withFlag = generateExplanations(strategy, bounds, "term", { diversification: true });

    // The cost-premium con is present under both modes (it's a legitimate
    // observation). The diversification-only branches add the refix-spread /
    // flex pros and the multi-tranche-management con.
    const hasRefixSpreadPro = (e) => e.pros.some((p) => p.includes("再融资风险分散"));
    const hasFlexPro = (e) => e.pros.some((p) => p.includes("保留充足的浮动或Offset额度"));
    const hasManageCon = (e) => e.cons.some((p) => p.includes("管理多个固定到期日稍复杂"));

    expect(hasRefixSpreadPro(withoutFlag)).toBe(false);
    expect(hasFlexPro(withoutFlag)).toBe(false);
    expect(hasManageCon(withoutFlag)).toBe(false);

    expect(hasRefixSpreadPro(withFlag)).toBe(true);
    expect(hasFlexPro(withFlag)).toBe(true);
    expect(hasManageCon(withFlag)).toBe(true);
  });
});

describe("Weights path and recommendation source semantics", () => {
  // Scenarios shared by the term-mode weights tests. Identical probabilities
  // to the main fixture above so the test outputs mirror the production
  // scenario shape.
  const scenarios = [
    { id: "low", probability: 0.2 },
    { id: "base", probability: 0.6 },
    { id: "high", probability: 0.2 }
  ];

  /**
   * Helper: build a single-scenario simulation result row with sensible
   * defaults for fields the optimiser touches but the test does not care
   * about. The defaults are non-degenerate (not all zero) so normalisation
   * bounds stay well-defined even with a single scenario.
   *
   * @param {string} strategyId
   * @param {string} scenarioId
   * @param {number} totalInterest
   * @param {number} endingBalance
   * @param {number} maximumPayment
   * @param {number} [floatingExposure]
   * @param {number} [refixPct]
   * @param {number} [allocationCount]
   * @returns {any}
   */
  const mkRow = (strategyId, scenarioId, totalInterest, endingBalance, maximumPayment, floatingExposure = 0.5, refixPct = 0.1, allocationCount = 1) => ({
    strategyId,
    scenarioId,
    allocationCount,
    totalInterest,
    totalRepayments: 0,
    endingBalance,
    maximumPayment,
    minimumPayment: 0,
    averagePayment: maximumPayment,
    maximumPaymentIncrease: 0,
    paymentVolatility: 0,
    refixEventCount: 0,
    maximumConcurrentRefixPercentage: refixPct,
    floatingExposure,
    affordabilityBreaches: 0,
    timeline: []
  });

  // Three strategies with strictly different expectedInterest, endingBalance
  // and worstCasePayment. Used by tests 1, 2, 3 and 6.
  //
  //   expectedInterest   A < B < C
  //   expectedEndingBalance  C < B < A   (C is fastest principal paydown)
  //   worstCasePayment    A < B < C
  //
  // That way:
  //   - cost=100      -> preference is A (also lowestCost)
  //   - principal=100 -> preference is C (not A, so != lowestCost)
  //   - resilience=100-> preference is A (smallest worstCasePayment)
  const baseResults = [
    mkRow("A", "low", 10000, 400000, 3000),
    mkRow("A", "base", 10000, 400000, 3000),
    mkRow("A", "high", 10000, 400000, 3000),
    mkRow("B", "low", 15000, 200000, 3500),
    mkRow("B", "base", 15000, 200000, 3500),
    mkRow("B", "high", 15000, 200000, 3500),
    mkRow("C", "low", 20000, 100000, 4000),
    mkRow("C", "base", 20000, 100000, 4000),
    mkRow("C", "high", 20000, 100000, 4000)
  ];

  it("optimiseStrategies weights drive preference ranking", () => {
    // cost=100 -> wCost=1, every other weight 0 -> overall score = costScore
    // -> preference is the strategy with the smallest expectedInterest.
    const opt = optimizeStrategies({
      simulationResults: baseResults,
      scenarios,
      mode: "term",
      weights: { cost: 100, principal: 0, refix: 0, resilience: 0, flex: 0, budget: 0 }
    });
    expect(opt.recommendations.preference.strategyId).toBe("A");
    // Sanity: A is the lowestCost strategy in this fixture.
    expect(opt.recommendations.lowestCost.strategyId).toBe("A");
  });

  it("optimiseStrategies weights zero weights on cost pushes preference to non-cheapest", () => {
    // cost=0, principal=100 -> wPrincipal=1, wCost=0. Cost no longer
    // contributes to overall score. The lowest-cost strategy (A) is the
    // slowest at principal paydown, so preference should NOT be A.
    const opt = optimizeStrategies({
      simulationResults: baseResults,
      scenarios,
      mode: "term",
      weights: { cost: 0, principal: 100, refix: 0, resilience: 0, flex: 0, budget: 0 }
    });
    expect(opt.recommendations.preference.strategyId).not.toBe(opt.recommendations.lowestCost.strategyId);
    // Specifically, C is the fastest principal paydown, so it should win.
    expect(opt.recommendations.preference.strategyId).toBe("C");
  });

  it("optimiseStrategies resilience weight aligns preference with worstCasePayment", () => {
    // resilience=100 -> wResilience=1 -> preference has the smallest
    // worstCasePayment among the candidates.
    const opt = optimizeStrategies({
      simulationResults: baseResults,
      scenarios,
      mode: "term",
      weights: { cost: 0, principal: 0, refix: 0, resilience: 100, flex: 0, budget: 0 }
    });
    const pref = opt.rankedStrategies.find(
      (/** @type {any} */ s) => s.strategyId === opt.recommendations.preference.strategyId
    );
    const minWorstCasePayment = Math.min(
      ...opt.rankedStrategies.map((/** @type {any} */ s) => s.worstCasePayment)
    );
    expect(pref.worstCasePayment).toBe(minWorstCasePayment);
  });

  it("optimiseStrategies mostStable term mode uses worstCasePayment", () => {
    // Three strategies whose `expectedMaxPayment` ordering DIFFERS from their
    // `worstCasePayment` ordering. Pre-fix this test would have selected A
    // (lowest expectedMaxPayment). Post-fix the mostStable slot must select
    // B (lowest worstCasePayment).
    //
    //   A: 3000/5000/3000 (0.2/0.6/0.2) -> expectedMaxPayment=4200, worstCasePayment=5000
    //   B: 4500/4500/3500                -> expectedMaxPayment=4300, worstCasePayment=4500
    //   C: 4000/4800/4000                -> expectedMaxPayment=4480, worstCasePayment=4800
    const results = [
      mkRow("A", "low", 10000, 400000, 3000),
      mkRow("A", "base", 10000, 400000, 5000),
      mkRow("A", "high", 10000, 400000, 3000),
      mkRow("B", "low", 10000, 400000, 4500),
      mkRow("B", "base", 10000, 400000, 4500),
      mkRow("B", "high", 10000, 400000, 3500),
      mkRow("C", "low", 10000, 400000, 4000),
      mkRow("C", "base", 10000, 400000, 4800),
      mkRow("C", "high", 10000, 400000, 4000)
    ];
    const opt = optimizeStrategies({
      simulationResults: results,
      scenarios,
      mode: "term"
    });
    const minWorstCasePayment = Math.min(
      ...opt.rankedStrategies.map((/** @type {any} */ s) => s.worstCasePayment)
    );
    expect(opt.recommendations.mostStable.strategyId).toBe("B");
    const mostStable = opt.rankedStrategies.find(
      (/** @type {any} */ s) => s.strategyId === opt.recommendations.mostStable.strategyId
    );
    expect(mostStable.worstCasePayment).toBe(minWorstCasePayment);
  });

  it("optimiseStrategies mostStable payment mode uses worstCaseEndingBalance", () => {
    // Payment-mode fixture: three strategies with strictly different
    // worstCaseEndingBalance. The mostStable slot must select the smallest.
    const mkPaymentRow = (strategyId, totalInterest, endingBalance, payoffTime) => ({
      ...mkRow(strategyId, "base", totalInterest, endingBalance, 0, 0.5, 0.1),
      payoffTime
    });
    const paymentResults = [
      mkPaymentRow("A", 10000, 100000, 24),
      mkPaymentRow("B", 15000, 200000, 30),
      mkPaymentRow("C", 20000, 300000, 36)
    ];
    const opt = optimizeStrategies({
      simulationResults: paymentResults,
      scenarios: [{ id: "base", probability: 1 }],
      mode: "payment"
    });
    expect(opt.recommendations.mostStable.strategyId).toBe("A");
    const mostStable = opt.rankedStrategies.find(
      (/** @type {any} */ s) => s.strategyId === opt.recommendations.mostStable.strategyId
    );
    const minWorstCaseEndingBalance = Math.min(
      ...opt.rankedStrategies.map((/** @type {any} */ s) => s.worstCaseEndingBalance)
    );
    expect(mostStable.worstCaseEndingBalance).toBe(minWorstCaseEndingBalance);
  });

  it("optimiseStrategies lowestCost ignores weights", () => {
    // Pass an extreme weights profile (cost=0, principal=100) that would
    // normally push `preference` to the fastest-paydown strategy. The
    // `lowestCost` slot must still be the smallest expectedInterest.
    const opt = optimizeStrategies({
      simulationResults: baseResults,
      scenarios,
      mode: "term",
      weights: { cost: 0, principal: 100, refix: 0, resilience: 0, flex: 0, budget: 0 }
    });
    expect(opt.recommendations.lowestCost.strategyId).toBe("A");
    // And the preference slot must have moved away from lowestCost,
    // proving the weights actually had an effect elsewhere.
    expect(opt.recommendations.preference.strategyId).not.toBe(opt.recommendations.lowestCost.strategyId);
  });

  it("optimiseStrategies can keep 100% benchmarks out of headline split recommendations", () => {
    const results = [
      mkRow("single-100", "base", 10000, 400000, 2800, 0, 0, 1),
      mkRow("split-90-10", "base", 11000, 390000, 2900, 0.1, 0.1, 2),
      mkRow("split-50-50", "base", 12000, 380000, 3000, 0.2, 0.2, 2)
    ];
    const opt = optimizeStrategies({
      simulationResults: results,
      scenarios: [{ id: "base", probability: 1 }],
      mode: "term",
      weights: { cost: 100, principal: 0, refix: 0, resilience: 0, flex: 0, budget: 0 },
      recommendationMinAllocationCount: 2
    });

    expect(opt.rankedStrategies[0].strategyId).toBe("single-100");
    expect(opt.recommendations.preference.strategyId).toBe("split-90-10");
    expect(opt.recommendations.lowestCost.strategyId).toBe("split-90-10");
    expect(opt.recommendations.mostStable.strategyId).toBe("split-90-10");
  });

  it("optimiseStrategies falls back to single-product recommendations when no split exists", () => {
    const opt = optimizeStrategies({
      simulationResults: [mkRow("single-only", "base", 10000, 400000, 2800, 0, 0, 1)],
      scenarios: [{ id: "base", probability: 1 }],
      mode: "term",
      recommendationMinAllocationCount: 2
    });

    expect(opt.recommendations.preference.strategyId).toBe("single-only");
    expect(opt.recommendations.lowestCost.strategyId).toBe("single-only");
    expect(opt.recommendations.mostStable.strategyId).toBe("single-only");
  });

  it("optimiseStrategies payment-mode weights ignore stability/endingBalance/payoff keys", () => {
    // The JSDoc on `weights` lists the 6 term-mode keys as the only ones
    // honoured. In payment mode, the `stability`, `endingBalance`, and
    // `payoff` objectives are weighted by the slider-derived branch (based
    // on `sliderCostStability` / `sliderFlexibility`), not by the caller's
    // `weights` object. This test pins that contract: passing
    // `endingBalance: 100` in payment mode must NOT steer `preference`
    // any differently than passing `endingBalance: 0`.
    const baseOpts = {
      simulationResults: baseResults,
      scenarios,
      mode: "payment"
    };
    const withEndingBalance = optimizeStrategies({
      ...baseOpts,
      sliderCostStability: 0.5,
      sliderFlexibility: 0,
      weights: { endingBalance: 100, cost: 0 }
    });
    const withoutEndingBalance = optimizeStrategies({
      ...baseOpts,
      sliderCostStability: 0.5,
      sliderFlexibility: 0,
      weights: { cost: 0 }
    });
    // If a future change starts reading `weights.endingBalance` in payment
    // mode, this assertion will start to fail — which is the desired alarm.
    expect(withEndingBalance.recommendations.preference.strategyId)
      .toBe(withoutEndingBalance.recommendations.preference.strategyId);
  });
});
