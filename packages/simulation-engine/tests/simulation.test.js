import { describe, it, expect } from "vitest";
import { simulateStrategyScenario, simulateStrategyScenarioMatrix } from "../src/index.js";

describe("Simulation Engine Tests", () => {
  /** @type {any} */
  const mortgage = {
    id: "m1",
    name: "Main Mortgage",
    countryCode: "NZ",
    currencyCode: "NZD",
    originalTermMonths: 360,
    remainingTermMonths: 300,
    repaymentFrequency: "monthly",
    repaymentType: "principal-and-interest",
    tranches: [],
    extraRepayments: []
  };

  /** @type {any[]} */
  const products = [
    { code: "floating", fixedMonths: null, displayName: "Floating", type: "floating", supportsExtraRepayment: true, supportsOffset: true },
    { code: "fixed-1y", fixedMonths: 12, displayName: "1y Fixed", type: "fixed", supportsExtraRepayment: true, supportsOffset: false },
    { code: "fixed-2y", fixedMonths: 24, displayName: "2y Fixed", type: "fixed", supportsExtraRepayment: true, supportsOffset: false }
  ];

  /** @type {any} */
  const currentProductRates = {
    floating: 0.08,
    "fixed-1y": 0.07,
    "fixed-2y": 0.065
  };

  /** @type {any} */
  const strategy = {
    id: "strat-1",
    allocations: [
      { productCode: "floating", percentage: 0.3, amount: 150000 },
      { productCode: "fixed-1y", percentage: 0.7, amount: 350000 }
    ],
    refixRule: { type: "same-term" }
  };

  /** @type {any} */
  const scenario = {
    id: "base",
    countryCode: "NZ",
    name: "Base Scenario",
    mode: "policy-rate-derived",
    probability: 1.0,
    forecastMonths: 24,
    policyRatePath: Array.from({ length: 25 }, (_, i) => ({ month: i, rate: 0.05 })),
    productRatePaths: {
      floating: Array.from({ length: 25 }, (_, i) => ({ month: i, rate: 0.08 })),
      "fixed-1y": Array.from({ length: 25 }, (_, i) => ({ month: i, rate: 0.07 })),
      "fixed-2y": Array.from({ length: 25 }, (_, i) => ({ month: i, rate: 0.065 }))
    },
    assumptions: {}
  };

  it("should run a single strategy scenario simulation correctly", () => {
    const result = simulateStrategyScenario({
      mortgage,
      strategy,
      scenario,
      products,
      currentProductRates,
      startDate: "2026-06-16",
      forecastMonths: 24,
      maxAffordablePayment: 4000
    });

    expect(result.strategyId).toBe("strat-1");
    expect(result.scenarioId).toBe("base");
    expect(result.totalInterest).toBeGreaterThan(0);
    expect(result.endingBalance).toBeLessThan(500000);
    expect(result.paymentVolatility).toBeDefined();
    expect(result.floatingExposure).toBe(0.3); // 150000 / 500000
    expect(result.refixEventCount).toBe(1); // the 1y fixed tranche refixes at month 12
    expect(result.maximumConcurrentRefixPercentage).toBeGreaterThanOrEqual(0);
    expect(result.timeline.length).toBe(24);
  });

  it("should execute a matrix of strategy-scenario simulations and support cancel and progress", async () => {
    /** @type {any[]} */
    let progressCalls = [];
    const controller = new globalThis.AbortController();

    const results = await simulateStrategyScenarioMatrix({
      mortgage,
      strategies: [strategy],
      scenarios: [scenario],
      products,
      currentProductRates,
      startDate: "2026-06-16",
      forecastMonths: 12,
      onProgress: (completed, total) => {
        progressCalls.push({ completed, total });
      },
      signal: controller.signal
    });

    expect(results.length).toBe(1);
    expect(progressCalls).toEqual([{ completed: 1, total: 1 }]);

    // Test cancellation
    controller.abort();
    await expect(simulateStrategyScenarioMatrix({
      mortgage,
      strategies: [strategy],
      scenarios: [scenario],
      products,
      currentProductRates,
      startDate: "2026-06-16",
      forecastMonths: 12,
      signal: controller.signal
    })).rejects.toThrow("Simulation cancelled");
  });
});
