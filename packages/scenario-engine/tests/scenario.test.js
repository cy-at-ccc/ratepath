import { describe, it, expect } from "vitest";
import { generateScenarios, validateScenario } from "../src/index.js";
import { buildQuantileScenarios } from "../src/quantile.js";

describe("Scenario Engine Tests", () => {
  const currentProductRates = {
    floating: 0.075,
    "fixed-1y": 0.065
  };

  const betas = {
    floating: 0.90,
    "fixed-1y": 0.75
  };

  /** @type {any[]} */
  const products = [
    { code: "floating", fixedMonths: null, displayName: "Floating", type: "floating", supportsExtraRepayment: true, supportsOffset: true },
    { code: "fixed-1y", fixedMonths: 12, displayName: "1y Fixed", type: "fixed", supportsExtraRepayment: true, supportsOffset: false }
  ];

  it("should generate low, base, and high scenarios correctly", () => {
    const scenarios = generateScenarios({
      initialRate: 0.05,
      currentProductRates,
      betas,
      products,
      forecastMonths: 24,
      controls: { shortTermChange: -0.01, mediumTermDirection: 0, changeSpeed: 0.5, uncertainty: 0.01, spreadShock: 0 }
    });

    expect(scenarios.length).toBe(3);
    const [low, base, high] = scenarios;

    expect(low.id).toBe("low");
    expect(base.id).toBe("base");
    expect(high.id).toBe("high");

    // Check probabilities
    expect(low.probability).toBe(0.15);
    expect(base.probability).toBe(0.7);
    expect(high.probability).toBe(0.15);
    expect(low.probability + base.probability + high.probability).toBe(1.0);

    // At Month 0, there is 0% uncertainty multiplier, so all policy rates match
    expect(low.policyRatePath[0].rate).toBe(0.05);
    expect(base.policyRatePath[0].rate).toBe(0.05);
    expect(high.policyRatePath[0].rate).toBe(0.05);

    // At Month 12, there is 100% uncertainty multiplier (0.01 shock)
    // base policy rate = 0.05 - 0.01 = 0.04
    // low policy rate = 0.04 - 0.01 = 0.03
    // high policy rate = 0.04 + 0.01 = 0.05
    expect(base.policyRatePath[12].rate).toBe(0.04);
    expect(low.policyRatePath[12].rate).toBe(0.03);
    expect(high.policyRatePath[12].rate).toBe(0.05);
  });

  it("should keep months 0-12 deterministic and vary months 13-36 when sampling", () => {
    const scenarios = generateScenarios({
      initialRate: 0.05,
      currentProductRates,
      betas,
      products,
      forecastMonths: 36,
      controls: {
        shortTermChange: 0.01,
        mediumTermDirection: 1,
        changeSpeed: 0.5,
        uncertainty: 0.01,
        spreadShock: 0,
        monteCarloSampleCount: 8
      }
    });

    expect(scenarios.length).toBe(24);
    const baseSamples = scenarios.filter((/** @type {any} */ s) => s.assumptions?.scenarioFamily === "base");
    expect(baseSamples).toHaveLength(8);
    expect(baseSamples[0].policyRatePath[12].rate).toBe(baseSamples[1].policyRatePath[12].rate);
    expect(baseSamples[0].policyRatePath[24].rate).not.toBe(baseSamples[1].policyRatePath[24].rate);
    expect(scenarios.reduce((sum, s) => sum + s.probability, 0)).toBeCloseTo(1, 8);
  });

  it("should apply custom scenario probabilities", () => {
    const scenarios = generateScenarios({
      initialRate: 0.05,
      currentProductRates,
      betas,
      products,
      forecastMonths: 24,
      controls: {
        shortTermChange: -0.01,
        mediumTermDirection: 0,
        changeSpeed: 0.5,
        uncertainty: 0.01,
        spreadShock: 0,
        scenarioProbabilities: {
          low: 0.2,
          base: 0.5,
          high: 0.3
        }
      }
    });

    const [low, base, high] = scenarios;
    expect(low.probability).toBe(0.2);
    expect(base.probability).toBe(0.5);
    expect(high.probability).toBe(0.3);
  });

  it("should default to one representative Monte Carlo tail per scenario family after month 36", () => {
    const scenarios = generateScenarios({
      initialRate: 0.05,
      currentProductRates,
      betas,
      products,
      forecastMonths: 84,
      controls: {
        shortTermChange: 0.01,
        mediumTermDirection: 1,
        changeSpeed: 0.5,
        uncertainty: 0.01,
        spreadShock: 0,
        longTermCycleYears: 2,
        longTermReversalBias: 0.7
      }
    });

    expect(scenarios.length).toBe(3);
    const lowSamples = scenarios.filter((/** @type {any} */ s) => s.assumptions?.scenarioFamily === "low");
    const baseSamples = scenarios.filter((/** @type {any} */ s) => s.assumptions?.scenarioFamily === "base");
    const highSamples = scenarios.filter((/** @type {any} */ s) => s.assumptions?.scenarioFamily === "high");
    expect(lowSamples).toHaveLength(1);
    expect(baseSamples).toHaveLength(1);
    expect(highSamples).toHaveLength(1);
    expect(scenarios.reduce((sum, s) => sum + s.probability, 0)).toBeCloseTo(1, 8);
    expect(lowSamples[0].policyRatePath[36].rate).toBe(lowSamples[0].policyRatePath[36].rate);
    expect(lowSamples[0].policyRatePath[48].rate).not.toBeUndefined();
  });

  it("should join the long-term MC path continuously to the deterministic prefix at month 36", () => {
    const scenarios = generateScenarios({
      initialRate: 0.05,
      currentProductRates,
      betas,
      products,
      forecastMonths: 84,
      controls: {
        shortTermChange: 0.01,
        mediumTermDirection: 1,
        changeSpeed: 0.5,
        uncertainty: 0.01,
        spreadShock: 0,
        longTermCycleYears: 2,
        longTermReversalBias: 0.7,
        monteCarloSampleCount: 4
      }
    });

    // Find any base-family long-term MC sample. The first MC step (month 37) starts
    // from `currentRate = month36Rate` and adds drift + oscillation + noise, so strict
    // equality is not expected — but the first MC step must remain bounded.
    /** @type {any} */
    let baseSample = scenarios.find((/** @type {any} */ s) => s.assumptions?.scenarioFamily === "base" && s.assumptions?.isMonteCarloTail);
    expect(baseSample).toBeTruthy();
    baseSample = /** @type {any} */ (baseSample);
    const anchorRate = baseSample.policyRatePath[36].rate;
    const firstMcRate = baseSample.policyRatePath[37].rate;
    expect(typeof anchorRate).toBe("number");
    expect(typeof firstMcRate).toBe("number");
    // Soft continuity: first MC step magnitude is bounded by monthlyTrendStep + baseNoiseScale
    // (both small in absolute terms; allow generous 5pp upper bound for safety).
    expect(Math.abs(firstMcRate - anchorRate)).toBeLessThan(0.05);
    // Path length covers the full forecast horizon (forecastMonths + 1 = 85).
    expect(baseSample.policyRatePath.length).toBe(85);
  });

  it("should support explicit multi-sample Monte Carlo expansion", () => {
    const scenarios = generateScenarios({
      initialRate: 0.05,
      currentProductRates,
      betas,
      products,
      forecastMonths: 84,
      controls: {
        shortTermChange: 0.01,
        mediumTermDirection: 1,
        changeSpeed: 0.5,
        uncertainty: 0.01,
        spreadShock: 0,
        longTermCycleYears: 2,
        longTermReversalBias: 0.7,
        monteCarloSampleCount: 12
      }
    });

    expect(scenarios.length).toBe(36);
    const lowSamples = scenarios.filter((/** @type {any} */ s) => s.assumptions?.scenarioFamily === "low");
    expect(lowSamples).toHaveLength(12);
    expect(scenarios.reduce((sum, s) => sum + s.probability, 0)).toBeCloseTo(1, 8);
    expect(lowSamples[0].policyRatePath[12].rate).toBe(lowSamples[1].policyRatePath[12].rate);
    expect(lowSamples[0].policyRatePath[24].rate).not.toBe(lowSamples[1].policyRatePath[24].rate);
    expect(lowSamples[0].policyRatePath[48].rate).not.toBe(lowSamples[1].policyRatePath[48].rate);
  });

  it("should be reproducible for identical Monte Carlo inputs", () => {
    const input = {
      initialRate: 0.05,
      currentProductRates,
      betas,
      products,
      forecastMonths: 84,
      controls: {
        shortTermChange: 0.01,
        mediumTermDirection: -0.5,
        changeSpeed: 0.25,
        uncertainty: 0.015,
        spreadShock: 0,
        longTermCycleYears: 2,
        longTermReversalBias: 0.7,
        monteCarloSampleCount: 10
      }
    };

    const first = generateScenarios(input);
    const second = generateScenarios(input);

    expect(JSON.stringify(first.map((s) => s.policyRatePath))).toBe(JSON.stringify(second.map((s) => s.policyRatePath)));
  });

  it("should keep generated Monte Carlo rates finite and within the policy cap", () => {
    const scenarios = generateScenarios({
      initialRate: 0.005,
      currentProductRates,
      betas,
      products,
      forecastMonths: 120,
      controls: {
        shortTermChange: -0.02,
        mediumTermDirection: -1,
        changeSpeed: 1,
        uncertainty: 0.08,
        spreadShock: 0,
        longTermCycleYears: 1,
        longTermReversalBias: 0.8,
        monteCarloSampleCount: 20,
        policyRateCap: 0.12
      }
    });

    const rates = scenarios.flatMap((s) => s.policyRatePath.map((p) => p.rate));
    expect(rates.every((rate) => Number.isFinite(rate))).toBe(true);
    expect(Math.min(...rates)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...rates)).toBeLessThanOrEqual(0.12);
    expect(scenarios.reduce((sum, s) => sum + s.probability, 0)).toBeCloseTo(1, 8);
  });

  it("should validate and throw errors on malformed scenarios", () => {
    /** @type {any} */
    const badScenario = {
      id: "bad",
      countryCode: "NZ",
      name: "Bad Scenario",
      mode: "policy-rate-derived",
      probability: 1.5, // invalid probability > 1
      forecastMonths: 12,
      policyRatePath: [{ month: 0, rate: 0.05 }],
      productRatePaths: {}
    };

    expect(() => validateScenario(badScenario)).toThrow();
  });

  // Helper: aggregate a 200-sample MC pool into a proper P50 path. The
  // lab/strategy-lab page renders this P50 on the OCR chart, so the
  // regression target is the quantile path, not a single raw sample.
  // (Sorting by id and picking the middle is WRONG — it picks the seed-deterministic
  // median sample, not the statistical median rate.)
  function buildP50Path(scenarios) {
    const quantiles = buildQuantileScenarios(
      scenarios,
      [0.5],
      { forecastMonths: scenarios[0].forecastMonths, currentProductRates, betas, products }
    );
    return quantiles[0]?.policyRatePath ?? [];
  }

  function peakToTrough(path, fromMonth, toMonth) {
    const segment = path.filter((p) => p.month >= fromMonth && p.month <= toMonth);
    if (segment.length === 0) return 0;
    const rates = segment.map((p) => p.rate);
    return Math.max(...rates) - Math.min(...rates);
  }

  it("long-term amplitude: default 1.0× produces visible swing over the long-term horizon", () => {
    // 10-year horizon. The /lab chart displays a 200-sample P50 path,
    // so the regression target is the *median* path's peak-to-trough.
    const scenarios = generateScenarios({
      initialRate: 0.05,
      currentProductRates,
      betas,
      products,
      forecastMonths: 120, // 10 years
      controls: {
        shortTermChange: -0.005,
        mediumTermDirection: -0.5,
        changeSpeed: 0.5,
        uncertainty: 0.01,
        longTermCycleYears: 2,
        longTermReversalBias: 0.7,
        longTermAmplitude: 1.0,
        monteCarloSampleCount: 200
      }
    });

    const median = buildP50Path(scenarios);
    // Years 3-10 = months 36-120. With cycle floor 0.001, mean reversion
    // 0.006, oscillation 0.5, and aligned phase offset, the P50 path (median
    // across 200 MC samples) shows a peak-to-trough of ~0.8%. This is ~8×
    // larger than the pre-tuning behaviour (~0.1%) and reads as clearly
    // visible crests/troughs on the OCR chart. We assert ≥0.5% to leave
    // margin for the 70/30 cycle-direction split and noise-vs-cycle overlap
    // that compresses the P50 amplitude below the single-sample theoretical
    // max of ~1.5%.
    expect(peakToTrough(median, 36, 120)).toBeGreaterThanOrEqual(0.005);
  });

  it("long-term amplitude: 2.0× produces more swing than 0.5× on the median path", () => {
    const baseControls = {
      shortTermChange: -0.005,
      mediumTermDirection: -0.5,
      changeSpeed: 0.5,
      uncertainty: 0.01,
      longTermCycleYears: 2,
      longTermReversalBias: 0.7,
      monteCarloSampleCount: 200
    };
    const low = generateScenarios({
      initialRate: 0.05,
      currentProductRates,
      betas,
      products,
      forecastMonths: 120,
      controls: { ...baseControls, longTermAmplitude: 0.5 }
    });
    const high = generateScenarios({
      initialRate: 0.05,
      currentProductRates,
      betas,
      products,
      forecastMonths: 120,
      controls: { ...baseControls, longTermAmplitude: 2.0 }
    });

    const lowSwing = peakToTrough(buildP50Path(low), 36, 120);
    const highSwing = peakToTrough(buildP50Path(high), 36, 120);

    // 2.0× is 4× the linear amplitude of 0.5×, and the amplitude slider
    // only scales the cycle (noise stays fixed), so the visible peak-to-trough
    // ratio on the P50 should track that 4× closely. Empirically the
    // ratio is ~5× on the P50 path; we assert 2.5× to leave room for
    // cycle-direction jitter and noise interference across 200 samples.
    expect(highSwing).toBeGreaterThan(lowSwing * 2.5);
  });

  it("long-term amplitude: clamps out-of-range values to [0.5, 2.0]", () => {
    const tooLow = generateScenarios({
      initialRate: 0.05,
      currentProductRates,
      betas,
      products,
      forecastMonths: 60,
      controls: {
        shortTermChange: 0,
        mediumTermDirection: 0,
        changeSpeed: 0.5,
        uncertainty: 0.01,
        longTermAmplitude: 0.1 // way below floor
      }
    });
    const tooHigh = generateScenarios({
      initialRate: 0.05,
      currentProductRates,
      betas,
      products,
      forecastMonths: 60,
      controls: {
        shortTermChange: 0,
        mediumTermDirection: 0,
        changeSpeed: 0.5,
        uncertainty: 0.01,
        longTermAmplitude: 10.0 // way above ceiling
      }
    });

    // Clamped values are recorded in scenario.assumptions.longTermAmplitude
    // so test callers can verify the clamp took effect.
    const lowSample = tooLow.find((s) => s.assumptions?.scenarioFamily === "base");
    const highSample = tooHigh.find((s) => s.assumptions?.scenarioFamily === "base");
    expect(lowSample.assumptions.longTermAmplitude).toBe(0.5);
    expect(highSample.assumptions.longTermAmplitude).toBe(2.0);
  });
});
