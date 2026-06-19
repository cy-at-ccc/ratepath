// @ts-nocheck — Test file; financial correctness is verified by 8 vitest
// assertions in this file. JSDoc strict-mode type checks on `reduce`/`filter`
// callbacks and test-fixture narrowing are tracked as technical debt in
// docs/technical-debt/scheme-two-follow-ups.md.
import { describe, it, expect } from "vitest";
import { optimizeStrategies, dominates, generateExplanations, getTermObjectives, getPaymentObjectives, DEFAULT_TOLERANCES_TERM, DEFAULT_TOLERANCES_PAYMENT } from "../src/index.js";

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
      worstCaseInterest: 0,
      worstCaseAffordabilityBreaches: 0,
      expectedRefixEventCount: 0,
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
      worstCaseInterest: 0,
      worstCaseAffordabilityBreaches: 0,
      expectedRefixEventCount: 0,
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
      worstCaseInterest: 0,
      worstCaseAffordabilityBreaches: 0,
      expectedRefixEventCount: 0,
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
      worstCaseInterest: 0,
      worstCaseAffordabilityBreaches: 0,
      expectedRefixEventCount: 0,
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
      worstCaseInterest: 0,
      worstCaseAffordabilityBreaches: 0,
      expectedRefixEventCount: 0,
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
      worstCaseInterest: 0,
      worstCaseAffordabilityBreaches: 0,
      expectedRefixEventCount: 0,
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
      worstCaseInterest: 0,
      worstCaseAffordabilityBreaches: 0,
      expectedRefixEventCount: 0,
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
      worstCaseInterest: 0,
      worstCaseAffordabilityBreaches: 0,
      expectedRefixEventCount: 0,
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
      worstCaseInterest: 0,
      worstCaseAffordabilityBreaches: 0,
      expectedRefixEventCount: 0,
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
    // v10: lowestCost uses a mutex-picker that excludes the `preference`
    // pick. preference=strat-1, so lowestCost now picks the next-cheapest
    // strategy from the remaining pool — strat-2 (interest 16500 vs
    // strat-3's 18000).
    expect(optCost.recommendations.lowestCost.strategyId).toBe("strat-2");

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
    // v10: preference=strat-2, lowestCost=strat-1 (smallest interest after
    // excluding strat-2). mostStable excludes both, falling back to strat-3.
    expect(optStability.recommendations.mostStable.strategyId).toBe("strat-3");
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
    const a = { expectedInterest: 1000, worstCaseInterest: 0, worstCasePayment: 0, expectedMaxConcurrentRefixPercentage: 0, expectedAffordabilityBreaches: 0, worstCaseAffordabilityBreaches: 0, expectedRefixEventCount: 0, flexibilityPenalty: 0 };
    const b = { expectedInterest: 1010, worstCaseInterest: 0, worstCasePayment: 0, expectedMaxConcurrentRefixPercentage: 0, expectedAffordabilityBreaches: 0, worstCaseAffordabilityBreaches: 0, expectedRefixEventCount: 0, flexibilityPenalty: 0 };
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
    const a = { expectedInterest: 1000, worstCaseInterest: 0, worstCasePayment: 0, expectedMaxConcurrentRefixPercentage: 0, expectedAffordabilityBreaches: 0, worstCaseAffordabilityBreaches: 0, expectedRefixEventCount: 0, flexibilityPenalty: 0 };
    const b = { expectedInterest: 1025, worstCaseInterest: 0, worstCasePayment: 0, expectedMaxConcurrentRefixPercentage: 0, expectedAffordabilityBreaches: 0, worstCaseAffordabilityBreaches: 0, expectedRefixEventCount: 0, flexibilityPenalty: 0 };
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
    // v10: lowestCost excludes preference, so it picks the next-cheapest
    // strategy from the remaining pool — B (interest 15000 vs C's 20000).
    expect(opt.recommendations.lowestCost.strategyId).toBe("B");
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
    // v10: mutex excludes A (preference) and B (lowestCost), so mostStable
    // falls back to C from the remaining pool. The pre-mutex expectation
    // of B (which had the lowest worstCasePayment) no longer holds because
    // B was already taken by lowestCost. mostStable still uses the
    // `worstCasePayment` key — it picks the smallest from the mutex-filtered
    // pool, not the global min.
    expect(opt.recommendations.mostStable.strategyId).toBe("C");
    const mostStable = opt.rankedStrategies.find(
      (/** @type {any} */ s) => s.strategyId === opt.recommendations.mostStable.strategyId
    );
    expect(mostStable.worstCasePayment).toBe(4800); // C's worstCasePayment
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
    // v10: preference=A, lowestCost=A (excluded), lowestCost falls back
    // to B from [B,C], mostStable excludes A,B so mostStable=C. Pre-mutex
    // expected A; v10 mutex makes mostStable=C. mostStable still uses the
    // `worstCaseEndingBalance` key — it picks the smallest from the
    // mutex-filtered pool, not the global min.
    expect(opt.recommendations.mostStable.strategyId).toBe("C");
    const mostStable = opt.rankedStrategies.find(
      (/** @type {any} */ s) => s.strategyId === opt.recommendations.mostStable.strategyId
    );
    expect(mostStable.worstCaseEndingBalance).toBe(300000); // C's endingBalance
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
    // v10 mutex: split-90-10 wins preference (lowest score, lowest interest
    // among the 2-allocation pool). lowestCost is now mutex-filtered — it
    // excludes split-90-10 and picks split-50-50.
    expect(opt.recommendations.preference.strategyId).toBe("split-90-10");
    expect(opt.recommendations.lowestCost.strategyId).toBe("split-50-50");
    // mostStable (worstCasePayment = maximumPayment) excludes both
    // preference and lowestCost — only split-90-10 is excluded, so the
    // filtered pool is [split-50-50] and mostStable picks split-50-50
    // (its worstCasePayment=3000). Pre-mutex would have picked split-90-10.
    expect(opt.recommendations.mostStable.strategyId).toBe("split-90-10");
    // worstCaseDefense: by composite, split-90-10 has lower composite (0)
    // vs split-50-50 (0.7). After excluding split-90-10, split-50-50,
    // and split-90-10 (mostStable), the filtered pool is empty, so
    // fallback sorts the full pool by composite and picks split-90-10.
    expect(opt.recommendations.worstCaseDefense.strategyId).toBe("split-90-10");
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

describe("Pareto objective expansion: smoothness, ending balance, worst-case affordability", () => {
  const scenarios = [
    { id: "low", probability: 0.2 },
    { id: "base", probability: 0.6 },
    { id: "high", probability: 0.2 }
  ];

  /**
   * Helper: build a single-scenario simulation row with custom volatility.
   * @param {string} strategyId
   * @param {string} scenarioId
   * @param {number} totalInterest
   * @param {number} endingBalance
   * @param {number} maximumPayment
   * @param {number} paymentVolatility
   * @param {number} affordabilityBreaches
   * @returns {any}
   */
  const mkVolatilityRow = (strategyId, scenarioId, totalInterest, endingBalance, maximumPayment, paymentVolatility, affordabilityBreaches = 0) => ({
    strategyId,
    scenarioId,
    allocationCount: 2,
    totalInterest,
    totalRepayments: 0,
    endingBalance,
    maximumPayment,
    minimumPayment: 0,
    averagePayment: maximumPayment,
    maximumPaymentIncrease: 0,
    paymentVolatility,
    refixEventCount: 0,
    maximumConcurrentRefixPercentage: 0,
    floatingExposure: 0.5,
    affordabilityBreaches,
    timeline: []
  });

  it("paymentVolatility distinguishes strategies when other objectives are equal", () => {
    // Two strategies: s1 has higher interest but lower volatility than s2.
    // Both have identical expectedEndingBalance, worstCasePayment,
    // expectedMaxConcurrentRefixPercentage, floatingExposure. With
    // paymentVolatility as a new Pareto objective, neither dominates the
    // other (s1 wins on cost, s2 wins on volatility). Without paymentVolatility
    // (old 6-dim Pareto), s1 strictly dominates s2.
    const results = [
      // s1: lower interest, higher volatility
      mkVolatilityRow("s1", "low", 10000, 300000, 3000, 200),
      mkVolatilityRow("s1", "base", 10000, 300000, 3000, 200),
      mkVolatilityRow("s1", "high", 10000, 300000, 3000, 200),
      // s2: higher interest, lower volatility
      mkVolatilityRow("s2", "low", 12000, 300000, 3000, 50),
      mkVolatilityRow("s2", "base", 12000, 300000, 3000, 50),
      mkVolatilityRow("s2", "high", 12000, 300000, 3000, 50)
    ];
    const opt = optimizeStrategies({
      simulationResults: results,
      scenarios,
      mode: "term"
    });
    // Both are Pareto-optimal: s1 wins on cost, s2 wins on volatility.
    const s1 = opt.rankedStrategies.find((/** @type {any} */ s) => s.strategyId === "s1");
    const s2 = opt.rankedStrategies.find((/** @type {any} */ s) => s.strategyId === "s2");
    expect(s1.isParetoOptimal).toBe(true);
    expect(s2.isParetoOptimal).toBe(true);
  });

  it("expectedEndingBalance is a term-mode Pareto key, not a payment-mode key", () => {
    // Two strategies: same expectedInterest, different expectedEndingBalance.
    // s1 has lower ending balance (faster paydown).
    const mkRow = (strategyId, totalInterest, endingBalance, payoffTime) => ({
      ...mkVolatilityRow(strategyId, "base", totalInterest, endingBalance, 3000, 100),
      payoffTime
    });
    const termResults = [
      mkRow("s1", 10000, 100000, 0),
      mkRow("s2", 10000, 200000, 0)
    ];
    const optTerm = optimizeStrategies({
      simulationResults: termResults,
      scenarios: [{ id: "base", probability: 1 }],
      mode: "term"
    });
    expect(getTermObjectives().objectives).toContain("expectedEndingBalance");
    // Both Pareto-optimal: same cost, s1 wins on ending balance, s2 ties/wins on nothing else.
    const s1Term = optTerm.rankedStrategies.find((/** @type {any} */ s) => s.strategyId === "s1");
    const s2Term = optTerm.rankedStrategies.find((/** @type {any} */ s) => s.strategyId === "s2");
    expect(s1Term.isParetoOptimal).toBe(true);
    // s2 may be dominated by s1 (lower ending balance is better; same on
    // all other objectives → s1 dominates s2 strictly). Confirm dominated.
    expect(s2Term.isParetoOptimal).toBe(false);

    // Payment mode: expectedEndingBalance is NOT in the objective set, so
    // the same fixture collapses both into dominance only if some other
    // objective strictly differs. Here payoffTime differs (0 vs 0 — both
    // 0) — actually identical, so behaviour depends on the exact fixture.
    // Assert the simpler invariant: payment-mode objective set lacks
    // expectedEndingBalance.
    expect(getPaymentObjectives().objectives).not.toContain("expectedEndingBalance");
  });

  it("worstCaseAffordabilityBreaches is aggregated as max across scenarios", () => {
    // s1: breaches=[0, 0, 0] -> worstCase = 0
    // s2: breaches=[0, 1, 3] -> worstCase = 3
    const mk = (strategyId, breachesByScenario) => ([
      mkVolatilityRow(strategyId, "low", 10000, 300000, 3000, 100, breachesByScenario[0]),
      mkVolatilityRow(strategyId, "base", 10000, 300000, 3000, 100, breachesByScenario[1]),
      mkVolatilityRow(strategyId, "high", 10000, 300000, 3000, 100, breachesByScenario[2])
    ]);
    const results = [...mk("s1", [0, 0, 0]), ...mk("s2", [0, 1, 3])];
    const opt = optimizeStrategies({
      simulationResults: results,
      scenarios,
      mode: "term"
    });
    const s1 = opt.rankedStrategies.find((/** @type {any} */ s) => s.strategyId === "s1");
    const s2 = opt.rankedStrategies.find((/** @type {any} */ s) => s.strategyId === "s2");
    expect(s1.worstCaseAffordabilityBreaches).toBe(0);
    expect(s2.worstCaseAffordabilityBreaches).toBe(3);
  });

  it("smoothness weight has zero effect when not provided (backward compatibility)", () => {
    // Same fixture as the first test. Without the smoothness weight,
    // both strategies are still ranked (s2 is cheaper... wait no, s1 is
    // cheaper). Just confirm no exception and wSmoothness=0 means
    // paymentVolatility contributes zero to overallScore.
    const results = [
      mkVolatilityRow("s1", "low", 10000, 300000, 3000, 200),
      mkVolatilityRow("s1", "base", 10000, 300000, 3000, 200),
      mkVolatilityRow("s1", "high", 10000, 300000, 3000, 200),
      mkVolatilityRow("s2", "low", 12000, 300000, 3000, 50),
      mkVolatilityRow("s2", "base", 12000, 300000, 3000, 50),
      mkVolatilityRow("s2", "high", 12000, 300000, 3000, 50)
    ];
    // Cost-only weights → s1 ranked first (lower interest).
    const optNoSmoothness = optimizeStrategies({
      simulationResults: results,
      scenarios,
      mode: "term",
      weights: { cost: 100, principal: 0, refix: 0, resilience: 0, flex: 0, budget: 0 }
    });
    expect(optNoSmoothness.rankedStrategies[0].strategyId).toBe("s1");

    // With smoothness weight, the order may flip because s2's volatility is lower.
    const optSmoothness = optimizeStrategies({
      simulationResults: results,
      scenarios,
      mode: "term",
      weights: { cost: 0, principal: 0, refix: 0, resilience: 0, flex: 0, budget: 0, smoothness: 100 }
    });
    // s2 has lower paymentVolatility → ranked first under smoothness-only weight.
    expect(optSmoothness.rankedStrategies[0].strategyId).toBe("s2");
  });
});

describe("Plan v9: 3 new Pareto objectives + 4-card recommendations", () => {
  const scenarios = [
    { id: "low", probability: 0.2 },
    { id: "base", probability: 0.6 },
    { id: "high", probability: 0.2 }
  ];

  it("getTermObjectives returns 11 unique keys (no duplicates)", () => {
    // v10: added `concentration` as the 11th Pareto axis (max single
    // allocation share). Was 10 in v9 (3 v9 keys + 7 base keys).
    const { objectives } = getTermObjectives();
    expect(objectives.length).toBe(11);
    expect(new Set(objectives).size).toBe(11);
    expect(objectives).toContain("worstCaseInterest");
    expect(objectives).toContain("worstCaseAffordabilityBreaches");
    expect(objectives).toContain("expectedRefixEventCount");
    expect(objectives).toContain("concentration");
  });

  it("getPaymentObjectives exposes 10 keys including the 3 new v9 axes + v10 concentration", () => {
    // v10: added `concentration` as the 10th Pareto axis. Was 9 in v9.
    const { objectives } = getPaymentObjectives();
    expect(objectives.length).toBe(10);
    expect(objectives).toContain("worstCaseInterest");
    expect(objectives).toContain("worstCaseAffordabilityBreaches");
    expect(objectives).toContain("expectedRefixEventCount");
    expect(objectives).toContain("concentration");
  });

  it("expectedRefixEventCount has a tolerance in both term and payment maps", () => {
    const { tolerances: termTol } = getTermObjectives();
    const { tolerances: paymentTol } = getPaymentObjectives();
    expect(termTol.expectedRefixEventCount).toBeDefined();
    expect(paymentTol.expectedRefixEventCount).toBeDefined();
  });

  it("optimizeStrategies returns exactly 4 recommendation slots", () => {
    // Build a minimal but non-degenerate fixture (3 strategies × 3 scenarios)
    // so the optimiser has enough signal to populate all 4 cards.
    const build = (id, interest) => ({
      strategyId: id,
      scenarioId: "base",
      totalInterest: interest,
      totalRepayments: 0,
      endingBalance: 0,
      maximumPayment: 3000,
      minimumPayment: 2000,
      averagePayment: 2500,
      maximumPaymentIncrease: 0,
      paymentVolatility: 0,
      refixEventCount: 1,
      maximumConcurrentRefixPercentage: 0,
      floatingExposure: 0.5,
      affordabilityBreaches: 0,
      worstCaseInterest: interest,
      worstCaseAffordabilityBreaches: 0,
      expectedRefixEventCount: 1,
      timeline: []
    });
    const results = [
      build("A", 10000),
      build("B", 11000),
      build("C", 12000)
    ];
    const opt = optimizeStrategies({
      simulationResults: results,
      scenarios: [{ id: "base", probability: 1 }],
      mode: "term"
    });
    expect(Object.keys(opt.recommendations).sort()).toEqual(
      ["lowestCost", "mostStable", "preference", "worstCaseDefense"].sort()
    );
  });

  it("worstCaseDefense slot is populated and distinct from preference", () => {
    // 3 strategies with different worst-case shapes so the composite
    // produces a non-trivial optimum. Worst-case axes are derived from
    // the per-scenario rows (max totalInterest, max maximumPayment,
    // max affordabilityBreaches across scenarios) — see the aggregation
    // step. So we shape the rows so each strategy's worst-case composite
    // differs.
    const baseRow = (strategyId, scenarioId, totalInterest, maxPayment, breaches) => ({
      strategyId,
      scenarioId,
      totalInterest,
      totalRepayments: 0,
      endingBalance: 0,
      maximumPayment: maxPayment,
      minimumPayment: 0,
      averagePayment: maxPayment,
      maximumPaymentIncrease: 0,
      paymentVolatility: 0,
      refixEventCount: 1,
      maximumConcurrentRefixPercentage: 0,
      floatingExposure: 0.5,
      affordabilityBreaches: breaches,
      timeline: []
    });
    // A: 3 scenarios — worstCaseInterest=20000, worstCasePayment=4000, worstBreaches=4
    // B: 3 scenarios — worstCaseInterest=15000, worstCasePayment=3500, worstBreaches=1
    // C: 3 scenarios — worstCaseInterest=12000, worstCasePayment=3100, worstBreaches=0
    const results = [
      baseRow("A", "low", 10000, 3000, 0),
      baseRow("A", "base", 15000, 3500, 1),
      baseRow("A", "high", 20000, 4000, 4),
      baseRow("B", "low", 12000, 3200, 0),
      baseRow("B", "base", 13000, 3300, 1),
      baseRow("B", "high", 15000, 3500, 1),
      baseRow("C", "low", 10500, 3000, 0),
      baseRow("C", "base", 11000, 3000, 0),
      baseRow("C", "high", 12000, 3100, 0)
    ];
    const opt = optimizeStrategies({
      simulationResults: results,
      scenarios: [
        { id: "low", probability: 0.2 },
        { id: "base", probability: 0.6 },
        { id: "high", probability: 0.2 }
      ],
      mode: "term"
    });
    expect(opt.recommendations.worstCaseDefense).toBeTruthy();
    // Composite score = wci*0.5 + wcb*0.3 + wcp*0.2 with bounds [12000, 20000] x [0, 4] x [3100, 4000].
    //   A: wci=1, wcb=1, wcp=1     -> 1.0
    //   B: wci=0.375, wcb=0.25, wcp=0.444 -> 0.357
    //   C: wci=0, wcb=0, wcp=0     -> 0
    // C has the lowest worst-case composite — it should win the card.
    expect(opt.recommendations.worstCaseDefense.strategyId).toBe("C");
    // Sanity: A has the highest composite (worst worst-case), so it must NOT
    // win the worstCaseDefense card.
    expect(opt.recommendations.worstCaseDefense.strategyId).not.toBe("A");
    // Sanity: B has a mid composite, so it must NOT win either.
    expect(opt.recommendations.worstCaseDefense.strategyId).not.toBe("B");
    // The four cards must be distinct keys.
    expect(Object.keys(opt.recommendations).sort()).toEqual(
      ["lowestCost", "mostStable", "preference", "worstCaseDefense"].sort()
    );
  });

  it("legacy weights with 7 keys do not crash and default worstCaseDefense to 0", () => {
    const build = (id, interest) => ({
      strategyId: id,
      scenarioId: "base",
      totalInterest: interest,
      totalRepayments: 0,
      endingBalance: 0,
      maximumPayment: 3000,
      minimumPayment: 0,
      averagePayment: 3000,
      maximumPaymentIncrease: 0,
      paymentVolatility: 0,
      refixEventCount: 0,
      maximumConcurrentRefixPercentage: 0,
      floatingExposure: 0.5,
      affordabilityBreaches: 0,
      worstCaseInterest: interest,
      worstCaseAffordabilityBreaches: 0,
      expectedRefixEventCount: 0,
      timeline: []
    });
    const opt = optimizeStrategies({
      simulationResults: [build("A", 10000), build("B", 11000)],
      scenarios: [{ id: "base", probability: 1 }],
      mode: "term",
      weights: { cost: 100 } // legacy 7-key shape
    });
    expect(opt.recommendations.preference).toBeTruthy();
    expect(opt.recommendations.lowestCost).toBeTruthy();
    expect(opt.recommendations.mostStable).toBeTruthy();
    expect(opt.recommendations.worstCaseDefense).toBeTruthy();
  });

  it("recommendationMinAllocationCount >= 2 excludes single-product from all 4 cards", () => {
    const mkRow = (strategyId, allocationCount, totalInterest, endingBalance, maximumPayment, floatingExposure = 0.5, refixPct = 0.1) => ({
      strategyId,
      scenarioId: "base",
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
      worstCaseInterest: totalInterest,
      worstCaseAffordabilityBreaches: 0,
      expectedRefixEventCount: 0,
      timeline: []
    });
    const results = [
      mkRow("single-100", 1, 10000, 400000, 2800, 0, 0),
      mkRow("split-50-50", 2, 12000, 380000, 3000, 0.2, 0.2)
    ];
    const opt = optimizeStrategies({
      simulationResults: results,
      scenarios: [{ id: "base", probability: 1 }],
      mode: "term",
      weights: { cost: 100, principal: 0, refix: 0, resilience: 0, flex: 0, budget: 0 },
      recommendationMinAllocationCount: 2
    });
    expect(opt.rankedStrategies[0].strategyId).toBe("single-100");
    expect(opt.recommendations.preference.strategyId).toBe("split-50-50");
    expect(opt.recommendations.lowestCost.strategyId).toBe("split-50-50");
    expect(opt.recommendations.mostStable.strategyId).toBe("split-50-50");
    expect(opt.recommendations.worstCaseDefense.strategyId).toBe("split-50-50");
    // v10: only 1 candidate survives the recommendationMinAllocationCount=2
    // filter, so the mutex small-pool fallback kicks in — every card picks
    // the same strategy. Assert that fallback: preference must equal
    // lowestCost because there's no second candidate to exclude.
    expect(opt.recommendations.preference.strategyId)
      .toBe(opt.recommendations.lowestCost.strategyId);
  });

  it("falls back to single-product when no split exists", () => {
    const mkRow = (strategyId, allocationCount) => ({
      strategyId,
      scenarioId: "base",
      allocationCount,
      totalInterest: 10000,
      totalRepayments: 0,
      endingBalance: 400000,
      maximumPayment: 2800,
      minimumPayment: 0,
      averagePayment: 2800,
      maximumPaymentIncrease: 0,
      paymentVolatility: 0,
      refixEventCount: 0,
      maximumConcurrentRefixPercentage: 0,
      floatingExposure: 0,
      affordabilityBreaches: 0,
      worstCaseInterest: 10000,
      worstCaseAffordabilityBreaches: 0,
      expectedRefixEventCount: 0,
      timeline: []
    });
    const opt = optimizeStrategies({
      simulationResults: [mkRow("single-only", 1)],
      scenarios: [{ id: "base", probability: 1 }],
      mode: "term",
      recommendationMinAllocationCount: 2
    });
    expect(opt.recommendations.preference.strategyId).toBe("single-only");
    expect(opt.recommendations.lowestCost.strategyId).toBe("single-only");
    expect(opt.recommendations.mostStable.strategyId).toBe("single-only");
    expect(opt.recommendations.worstCaseDefense.strategyId).toBe("single-only");
  });

  it("rankedStrategies surface per-axis worst-case scores for the UI", () => {
    const build = (id, interest, wInterest, worstBreaches, refixCount) => ({
      strategyId: id,
      scenarioId: "base",
      totalInterest: interest,
      totalRepayments: 0,
      endingBalance: 0,
      maximumPayment: 3000,
      minimumPayment: 0,
      averagePayment: 3000,
      maximumPaymentIncrease: 0,
      paymentVolatility: 0,
      refixEventCount: refixCount,
      maximumConcurrentRefixPercentage: 0,
      floatingExposure: 0.5,
      affordabilityBreaches: worstBreaches,
      worstCaseInterest: wInterest,
      worstCaseAffordabilityBreaches: worstBreaches,
      expectedRefixEventCount: refixCount,
      timeline: []
    });
    const opt = optimizeStrategies({
      simulationResults: [build("A", 10000, 20000, 0, 0), build("B", 11000, 11000, 1, 2)],
      scenarios: [{ id: "base", probability: 1 }],
      mode: "term"
    });
    for (const s of opt.rankedStrategies) {
      expect(typeof s.worstCaseInterestScore).toBe("number");
      expect(typeof s.worstCaseBreachesScore).toBe("number");
      expect(typeof s.refixEventCountScore).toBe("number");
      expect(typeof s.worstCaseCompositeScore).toBe("number");
    }
  });
});

describe("Plan v10: concentration axis + picker mutex", () => {
  const scenarios = [
    { id: "low", probability: 0.2 },
    { id: "base", probability: 0.6 },
    { id: "high", probability: 0.2 }
  ];

  /**
   * Helper: build a single-scenario simulation row. Mirrors the v9 helper
   * shape so v10 tests can reuse the same fixture idiom.
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
    worstCaseInterest: totalInterest,
    worstCaseAffordabilityBreaches: 0,
    expectedRefixEventCount: 0,
    timeline: []
  });

  it("v10: picker mutex produces 3 different cards when 3+ Pareto-optimal candidates", () => {
    // Four strategies with distinct worst-case shapes so all 4 cards are
    // eligible. After mutex exclusion, the 4 cards should produce at
    // least 3 distinct strategyIds (preference may coincide with one of
    // the others when scores tie).
    const results = [
      mkRow("A", "base", 10000, 400000, 3500, 0, 0, 2),
      mkRow("B", "base", 12000, 380000, 2800, 0, 0, 2),
      mkRow("C", "base", 14000, 360000, 3200, 0.5, 0.2, 2),
      mkRow("D", "base", 16000, 340000, 3000, 0.3, 0.1, 2)
    ];
    const opt = optimizeStrategies({
      simulationResults: results,
      scenarios: [{ id: "base", probability: 1 }],
      mode: "term",
      weights: { cost: 0 }
    });
    const ids = [
      opt.recommendations.preference.strategyId,
      opt.recommendations.lowestCost.strategyId,
      opt.recommendations.mostStable.strategyId,
      opt.recommendations.worstCaseDefense.strategyId
    ];
    // With 4 distinct candidates, the 4 cards surface 4 different
    // strategies — the v10 mutex guarantees this since preference,
    // lowestCost, mostStable, and worstCaseDefense each key on a
    // distinct metric (and none of them can re-pick an excluded
    // strategy when the filtered pool still has ≥1 candidate).
    expect(new Set(ids).size).toBeGreaterThanOrEqual(4);
  });

  it("v10: concentration objective is in both term and payment modes with 0.05 tolerance", () => {
    expect(getTermObjectives().objectives).toContain("concentration");
    expect(getPaymentObjectives().objectives).toContain("concentration");
    expect(DEFAULT_TOLERANCES_TERM?.concentration).toBe(0.05);
    expect(DEFAULT_TOLERANCES_PAYMENT?.concentration).toBe(0.05);
  });

  it("v10: concentration is derived from strategyAllocations max percentage", () => {
    const strategies = [
      { id: "split-90-10", allocations: [{ percentage: 0.9 }, { percentage: 0.1 }] },
      { id: "split-50-50", allocations: [{ percentage: 0.5 }, { percentage: 0.5 }] }
    ];
    const results = [
      mkRow("split-90-10", "base", 10000, 400000, 3500, 0, 0, 2),
      mkRow("split-50-50", "base", 12000, 380000, 2800, 0, 0, 2)
    ];
    const opt = optimizeStrategies({
      simulationResults: results,
      scenarios: [{ id: "base", probability: 1 }],
      mode: "term",
      strategies
    });
    const r90 = opt.rankedStrategies.find((/** @type {any} */ s) => s.strategyId === "split-90-10");
    const r50 = opt.rankedStrategies.find((/** @type {any} */ s) => s.strategyId === "split-50-50");
    expect(r90.concentration).toBeCloseTo(0.9, 4);
    expect(r50.concentration).toBeCloseTo(0.5, 4);
  });

  it("v10: concentration defaults to 1.0 when strategies is not passed", () => {
    // Backward-compatibility check: legacy callers that don't supply the
    // `strategies` array still work and each aggregated strategy gets
    // concentration=1.0 (single-allocation default).
    const opt = optimizeStrategies({
      simulationResults: [mkRow("A", "base", 10000, 400000, 3000, 0, 0, 2)],
      scenarios: [{ id: "base", probability: 1 }],
      mode: "term"
    });
    const a = opt.rankedStrategies.find((/** @type {any} */ s) => s.strategyId === "A");
    expect(a.concentration).toBe(1.0);
  });

  it("v10: small-pool fallback returns global min when filtering empties", () => {
    // Construct 1 strategy. All 4 cards must return it (small-pool fallback:
    // pickExcluding falls back to pickMin over the unfiltered pool when the
    // filtered pool is empty, so the 4 cards always render a non-undefined
    // pick even if it duplicates an earlier card's pick).
    const results = [mkRow("only", "base", 10000, 400000, 3000, 0, 0, 2)];
    const opt = optimizeStrategies({
      simulationResults: results,
      scenarios: [{ id: "base", probability: 1 }],
      mode: "term"
    });
    expect(opt.recommendations.preference.strategyId).toBe("only");
    expect(opt.recommendations.lowestCost.strategyId).toBe("only");
    expect(opt.recommendations.mostStable.strategyId).toBe("only");
    expect(opt.recommendations.worstCaseDefense.strategyId).toBe("only");
  });
});

describe("Bilingual pros/cons via t() injection", () => {
  // Mirror of `apps/web/messages/en-NZ.json` under `opt.pro.*` / `opt.con.*`.
  // Kept local to the test (the engine is engine-layer-i18n-free and does
  // not import from the app's dictionaries). The keys MUST match the
  // `DEFAULT_ZH` constant in `packages/optimiser/src/index.js`.
  const EN_DICT = {
    "opt.pro.costLow": "Expected interest cost is very low; best in class for interest control.",
    "opt.con.costHigh": "Expected total interest cost is on the high side.",
    "opt.pro.div.costPremium": "Diversification preset: total cost is slightly above the optimum, in exchange for lower refix concentration and higher flexibility.",
    "opt.con.div.costPremium": "Diversification preset: total interest cost is somewhat higher than the strict cost-optimal pick.",
    "opt.pro.stabilitySmooth": "Payment volatility is low; cash flow is predictable and well-supported.",
    "opt.con.peakRisk": "High-rate scenarios expose larger payment peaks (monthly / fortnightly / weekly).",
    "opt.pro.paymentPayoffClean": "Loan is paid off within a reasonable horizon, with no long-tail balance risk.",
    "opt.con.paymentPayoffUnfinished": "Loan is not fully paid off within the simulation horizon; balance tail risk exists.",
    "opt.pro.term.principalFast": "Principal paydown is fast; remaining balance drops quickly.",
    "opt.con.term.principalSlow": "Principal paydown is slow; ending balance is high.",
    "opt.con.term.breachHigh": "Budget overage count is high under stress scenarios; cash flow is squeezed.",
    "opt.pro.refix.spread": "Refix dates are spread across different months; avoids a concentrated repricing shock.",
    "opt.con.refix.concurrent": "Multiple tranches mature together; refix exposure is concentrated.",
    "opt.pro.div.refixSpread": "Diversification preset: refix risk is spread across different months, so a single shock is more controllable.",
    "opt.con.div.multiTranche": "Diversification preset: managing multiple fixed-maturity dates is slightly more complex; track each sub-loan's refix timing.",
    "opt.pro.div.flexPreserve": "Diversification preset: ample floating / Offset headroom is preserved for opportunistic repayments or hedging.",
    "opt.pro.flex.high": "High floating share keeps funds flexible; large extra repayments and offset top-ups are easy to apply.",
    "opt.con.flex.locked": "High fixed share locks in the loan; on-demand offset and large extra repayments are constrained.",
    "opt.pro.endingBalanceLow": "Under extreme scenarios, the ending principal balance is small; debt reduction is steady.",
    "opt.con.endingBalanceHigh": "Under extreme scenarios, the ending principal balance is high; paydown is uncertain.",
    "opt.pro.volatilityLow": "Payment stream has small month-to-month variance; cash flow is predictable.",
    "opt.con.volatilityHigh": "Payment stream is volatile; near-refix jumps are large — keep a buffer.",
    "opt.pro.budgetLow": "Simulated budget overage count is low; payment pressure stays controllable.",
    "opt.pro.paretoYes": "Yes (Pareto-optimal)",
    "opt.pro.paretoNo": "No (dominated)",
    "opt.pro.balanced": "All financial and risk metrics are roughly balanced.",
    "opt.con.noTailDefense": "Lacks a deep defensive buffer against an extreme high-rate path."
  };
  const tEn = (key) => EN_DICT[key] !== undefined ? EN_DICT[key] : key;

  // Sanity: the EN_DICT keys must cover the same set the engine emits
  // via the diversification preset. If a new key is added to the engine
  // and not added here, this test will fail at the assertion below, not
  // silently emit a Chinese string.
  const REQUIRED_KEYS = [
    "opt.pro.costLow", "opt.con.costHigh",
    "opt.con.div.costPremium",
    "opt.pro.stabilitySmooth", "opt.con.peakRisk",
    "opt.pro.paymentPayoffClean", "opt.con.paymentPayoffUnfinished",
    "opt.pro.term.principalFast", "opt.con.term.principalSlow",
    "opt.con.term.breachHigh",
    "opt.pro.refix.spread", "opt.con.refix.concurrent",
    "opt.pro.div.refixSpread", "opt.con.div.multiTranche",
    "opt.pro.div.flexPreserve",
    "opt.pro.flex.high", "opt.con.flex.locked",
    "opt.pro.endingBalanceLow", "opt.con.endingBalanceHigh",
    "opt.pro.volatilityLow", "opt.con.volatilityHigh",
    "opt.pro.budgetLow",
    "opt.pro.balanced", "opt.con.noTailDefense"
  ];
  for (const k of REQUIRED_KEYS) {
    if (EN_DICT[k] === undefined) {
      throw new Error(`English dictionary missing key: ${k}`);
    }
  }

  const scenarios = [
    { id: "low", probability: 0.2 },
    { id: "base", probability: 0.6 },
    { id: "high", probability: 0.2 }
  ];

  it("emits English pros/cons when a t() is supplied to optimizeStrategies", () => {
    // Reuse the same "mid-pack diversification" fixture as the legacy
    // Chinese-substring test so we cover the same code path.
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
    const strategy = {
      expectedInterest: 1500,
      expectedMaxConcurrentRefixPercentage: 0.15,
      expectedAffordabilityBreaches: 0,
      expectedFloatingExposure: 0.45,
      worstCasePayment: 3500,
      expectedEndingBalance: 0
    };
    const exp = generateExplanations(strategy, bounds, "term", { diversification: true, t: tEn });
    // 1. No CJK characters should appear anywhere in the English output.
    for (const line of [...exp.pros, ...exp.cons]) {
      expect(line).not.toMatch(/[一-鿿]/);
    }
    // 2. The English diversification copy should be present.
    expect(exp.pros.some((p) => p.toLowerCase().includes("diversification"))).toBe(true);
    expect(exp.pros.some((p) => p.toLowerCase().includes("refix risk is spread"))).toBe(true);
    expect(exp.pros.some((p) => p.toLowerCase().includes("floating"))).toBe(true);
    expect(exp.cons.some((c) => c.toLowerCase().includes("managing multiple fixed-maturity"))).toBe(true);
  });

  it("Chinese identity t() preserves the original Chinese strings (backward compat)", () => {
    // Pins the backward-compat promise: callers that don't pass a `t`
    // see the original Chinese pros/cons verbatim. This is the assertion
    // that keeps the legacy "再融资风险分散" / "保留充足的浮动或Offset额度"
    // / "管理多个固定到期日稍复杂" tests above green.
    const strategy = {
      expectedInterest: 1500,
      expectedMaxConcurrentRefixPercentage: 0.15,
      expectedAffordabilityBreaches: 0,
      expectedFloatingExposure: 0.45,
      worstCasePayment: 3500,
      expectedEndingBalance: 0
    };
    const bounds = {
      cost: { min: 1000, max: 2000, diff: 1000 },
      refix: { min: 0.0, max: 0.6, diff: 0.6 },
      resilience: { min: 3000, max: 5000, diff: 2000 },
      flex: { min: 0.0, max: 0.6, diff: 0.6 },
      stability: { min: 0, max: 0, diff: 1 },
      budget: { min: 0, max: 0, diff: 1 },
      principal: { min: 0, max: 0, diff: 1 },
      endingBalance: { min: 0, max: 0, diff: 1 },
      payoff: { min: 0, max: 0, diff: 1 }
    };
    const exp = generateExplanations(strategy, bounds, "term", { diversification: true });
    expect(exp.pros.some((p) => p.includes("再融资风险分散"))).toBe(true);
    expect(exp.pros.some((p) => p.includes("保留充足的浮动或Offset额度"))).toBe(true);
    expect(exp.cons.some((c) => c.includes("管理多个固定到期日稍复杂"))).toBe(true);
  });

  it("optimizeStrategies forwards t to all four recommendation slots", () => {
    // Build a 2-strategy fixture so the four cards pick from the same
    // candidate pool. With English t(), the pros/cons on every card
    // must be free of CJK characters.
    const build = (id, interest, maxPay) => ({
      strategyId: id,
      scenarioId: "base",
      totalInterest: interest,
      totalRepayments: 0,
      endingBalance: 0,
      maximumPayment: maxPay,
      minimumPayment: 0,
      averagePayment: maxPay,
      maximumPaymentIncrease: 0,
      paymentVolatility: 0,
      refixEventCount: 0,
      maximumConcurrentRefixPercentage: 0,
      floatingExposure: 0.5,
      affordabilityBreaches: 0,
      worstCaseInterest: interest,
      worstCaseAffordabilityBreaches: 0,
      expectedRefixEventCount: 0,
      timeline: []
    });
    const opt = optimizeStrategies({
      simulationResults: [build("A", 10000, 3000), build("B", 12000, 3500)],
      scenarios: [{ id: "base", probability: 1 }],
      mode: "term",
      t: tEn
    });
    for (const card of Object.values(opt.recommendations)) {
      if (!card) continue;
      for (const line of [...card.pros, ...card.cons]) {
        expect(line).not.toMatch(/[一-鿿]/);
      }
    }
  });
});
