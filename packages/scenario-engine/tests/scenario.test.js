import { describe, it, expect } from "vitest";
import { generateScenarios, validateScenario } from "../src/index.js";

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
});
