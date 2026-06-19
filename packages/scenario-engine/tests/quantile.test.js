import { describe, it, expect } from "vitest";
import { generateScenarios, buildQuantileScenarios } from "../src/index.js";

const currentProductRates = { floating: 0.075, "fixed-1y": 0.065 };
const betas = { floating: 0.90, "fixed-1y": 0.75 };

/** @type {any[]} */
const products = [
  { code: "floating", fixedMonths: null, displayName: "Floating", type: "floating", supportsExtraRepayment: true, supportsOffset: true },
  { code: "fixed-1y", fixedMonths: 12, displayName: "1y Fixed", type: "fixed", supportsExtraRepayment: true, supportsOffset: false }
];

const baseControls = {
  shortTermChange: 0.005,
  mediumTermDirection: 0.3,
  changeSpeed: 0.5,
  uncertainty: 0.02,
  spreadShock: 0,
  longTermCycleYears: 2,
  longTermReversalBias: 0.7
};

/** @type {any} */
const derivedParams = { currentProductRates, betas, products };

describe("buildQuantileScenarios", () => {
  it("returns 3 quantile scenarios with correct family ids and path lengths (N=30)", () => {
    const forecastMonths = 60;
    const mc = generateScenarios({
      initialRate: 0.05,
      currentProductRates,
      betas,
      products,
      forecastMonths,
      controls: { ...baseControls, monteCarloSampleCount: 30 }
    });
    const qs = buildQuantileScenarios(mc, [0.1, 0.5, 0.9], { ...derivedParams, forecastMonths });
    expect(qs).toHaveLength(3);
    expect(qs.map((/** @type {any} */ s) => s.assumptions.scenarioFamily)).toEqual(["p10", "p50", "p90"]);
    qs.forEach((/** @type {any} */ s) => {
      expect(s.policyRatePath.length).toBe(forecastMonths + 1);
      expect(s.assumptions.isQuantileScenario).toBe(true);
      expect(s.assumptions.sourceMonteCarloSampleCount).toBe(mc.length);
    });
  });

  it("P50 of single-family sample (N=1) equals the base scenario path", () => {
    const forecastMonths = 24;
    const mc = generateScenarios({
      initialRate: 0.05,
      currentProductRates,
      betas,
      products,
      forecastMonths,
      controls: { ...baseControls, monteCarloSampleCount: 1 }
    });
    const qs = buildQuantileScenarios(mc, [0.5], { ...derivedParams, forecastMonths });
    expect(qs).toHaveLength(1);
    /** @type {any} */
    const baseScenario = mc.find((s) => s.id === "base");
    expect(baseScenario).toBeTruthy();
    qs[0].policyRatePath.forEach((/** @type {any} */ point, /** @type {number} */ idx) => {
      expect(point.rate).toBeCloseTo(baseScenario.policyRatePath[idx].rate, 6);
    });
  });

  it("preserves ordering P10 <= P50 <= P90 at every month (N=50)", () => {
    const forecastMonths = 60;
    const mc = generateScenarios({
      initialRate: 0.05,
      currentProductRates,
      betas,
      products,
      forecastMonths,
      controls: { ...baseControls, monteCarloSampleCount: 50 }
    });
    const qs = buildQuantileScenarios(mc, [0.1, 0.5, 0.9], { ...derivedParams, forecastMonths });
    const [p10, p50, p90] = qs;
    for (let i = 0; i < p10.policyRatePath.length; i++) {
      expect(p10.policyRatePath[i].rate).toBeLessThanOrEqual(p50.policyRatePath[i].rate);
      expect(p50.policyRatePath[i].rate).toBeLessThanOrEqual(p90.policyRatePath[i].rate);
    }
  });

  it("returns empty array for empty input or empty quantiles", () => {
    expect(
      buildQuantileScenarios([], [0.5], { ...derivedParams, forecastMonths: 12 })
    ).toEqual([]);
    const mc = generateScenarios({
      initialRate: 0.05,
      currentProductRates,
      betas,
      products,
      forecastMonths: 12,
      controls: { ...baseControls, monteCarloSampleCount: 1 }
    });
    expect(
      buildQuantileScenarios(mc, [], { ...derivedParams, forecastMonths: 12 })
    ).toEqual([]);
  });

  it("derives productRatePaths covering the full forecast horizon", () => {
    const forecastMonths = 36;
    const mc = generateScenarios({
      initialRate: 0.05,
      currentProductRates,
      betas,
      products,
      forecastMonths,
      controls: { ...baseControls, monteCarloSampleCount: 10 }
    });
    const [p50] = buildQuantileScenarios(mc, [0.5], { ...derivedParams, forecastMonths });
    expect(p50.productRatePaths.floating).toHaveLength(forecastMonths + 1);
    expect(p50.productRatePaths["fixed-1y"]).toHaveLength(forecastMonths + 1);
  });

  it("probabilities split: P10=0.1, P50=0.5, P90=0.1", () => {
    const forecastMonths = 60;
    const mc = generateScenarios({
      initialRate: 0.05,
      currentProductRates,
      betas,
      products,
      forecastMonths,
      controls: { ...baseControls, monteCarloSampleCount: 20 }
    });
    const qs = buildQuantileScenarios(mc, [0.1, 0.5, 0.9], { ...derivedParams, forecastMonths });
    expect(qs[0].probability).toBeCloseTo(0.1, 6);
    expect(qs[1].probability).toBeCloseTo(0.5, 6);
    expect(qs[2].probability).toBeCloseTo(0.1, 6);
  });

  it("band is non-degenerate at month 60 with N=200: P90[60] - P10[60] > 0", () => {
    const forecastMonths = 60;
    const mc = generateScenarios({
      initialRate: 0.05,
      currentProductRates,
      betas,
      products,
      forecastMonths,
      controls: { ...baseControls, monteCarloSampleCount: 200 }
    });
    const [p10, , p90] = buildQuantileScenarios(mc, [0.1, 0.5, 0.9], { ...derivedParams, forecastMonths });
    const spread = p90.policyRatePath[forecastMonths].rate - p10.policyRatePath[forecastMonths].rate;
    expect(spread).toBeGreaterThan(0);
  });

  it("is deterministic: identical inputs produce identical outputs", () => {
    const forecastMonths = 36;
    const input = {
      initialRate: 0.05,
      currentProductRates,
      betas,
      products,
      forecastMonths,
      controls: { ...baseControls, monteCarloSampleCount: 25 }
    };
    const mcA = generateScenarios(input);
    const mcB = generateScenarios(input);
    const qA = buildQuantileScenarios(mcA, [0.1, 0.5, 0.9], { ...derivedParams, forecastMonths });
    const qB = buildQuantileScenarios(mcB, [0.1, 0.5, 0.9], { ...derivedParams, forecastMonths });
    expect(JSON.stringify(qA.map((s) => s.policyRatePath))).toBe(
      JSON.stringify(qB.map((s) => s.policyRatePath))
    );
  });

  it("rejects invalid forecastMonths", () => {
    const mc = generateScenarios({
      initialRate: 0.05,
      currentProductRates,
      betas,
      products,
      forecastMonths: 12,
      controls: { ...baseControls, monteCarloSampleCount: 1 }
    });
    expect(() => buildQuantileScenarios(mc, [0.5], { ...derivedParams, forecastMonths: -1 })).toThrow();
    expect(() => buildQuantileScenarios(mc, [0.5], { ...derivedParams })).toThrow();
  });
});
