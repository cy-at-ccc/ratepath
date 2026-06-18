import { describe, it, expect } from "vitest";
import { getRateFromPath, buildPolicyRatePath, deriveProductRatePaths } from "../src/index.js";

describe("Rate Engine: Interpolation", () => {
  const path = [
    { month: 0, rate: 0.06 },
    { month: 12, rate: 0.04 },
    { month: 24, rate: 0.03 }
  ];

  it("should support linear interpolation", () => {
    expect(getRateFromPath(path, 0, "linear")).toBe(0.06);
    expect(getRateFromPath(path, 6, "linear")).toBe(0.05); // half-way between 0.06 and 0.04
    expect(getRateFromPath(path, 12, "linear")).toBe(0.04);
    expect(getRateFromPath(path, 18, "linear")).toBe(0.035); // half-way between 0.04 and 0.03
    expect(getRateFromPath(path, 24, "linear")).toBe(0.03);
  });

  it("should support step interpolation", () => {
    expect(getRateFromPath(path, 0, "step")).toBe(0.06);
    expect(getRateFromPath(path, 5, "step")).toBe(0.06);
    expect(getRateFromPath(path, 6, "step")).toBe(0.06);
    expect(getRateFromPath(path, 12, "step")).toBe(0.04);
    expect(getRateFromPath(path, 23, "step")).toBe(0.04);
    expect(getRateFromPath(path, 24, "step")).toBe(0.03);
  });

  it("should support flat interpolation (entire path is the starting value)", () => {
    expect(getRateFromPath(path, 0, "flat")).toBe(0.06);
    expect(getRateFromPath(path, 12, "flat")).toBe(0.06);
    expect(getRateFromPath(path, 24, "flat")).toBe(0.06);
  });

  it("should extrapolate flatly beyond boundaries", () => {
    expect(getRateFromPath(path, -5, "linear")).toBe(0.06);
    expect(getRateFromPath(path, 36, "linear")).toBe(0.03);
  });
});

describe("Rate Engine: Policy Rate Path Generation", () => {
  it("should build path using linear transition when speed is 0.5", () => {
    const path = buildPolicyRatePath({
      initialRate: 0.05,
      controls: { shortTermChange: -0.02, mediumTermDirection: 0, changeSpeed: 0.5 },
      nodes: [0, 6, 12, 24]
    });

    expect(path[0].rate).toBe(0.05);
    expect(path[1].rate).toBe(0.04); // linear midpoint
    expect(path[2].rate).toBe(0.03); // full change
    expect(path[3].rate).toBe(0.03); // slope is 0 after 12 months
  });

  it("should apply direction trend after month 12", () => {
    const path = buildPolicyRatePath({
      initialRate: 0.05,
      controls: { shortTermChange: -0.02, mediumTermDirection: 1, changeSpeed: 0.5 },
      nodes: [0, 12, 24]
    });

    expect(path[0].rate).toBe(0.05);
    expect(path[1].rate).toBe(0.03);
    // after 12m, trend is +0.005/year * 1 year = +0.005
    expect(path[2].rate).toBe(0.035);
  });

  it("should flatten the policy path after month 36 by default", () => {
    const path = buildPolicyRatePath({
      initialRate: 0.05,
      controls: { shortTermChange: 0.01, mediumTermDirection: 1, changeSpeed: 0.5 },
      nodes: [12, 24, 36, 48, 60]
    });

    expect(path[0].rate).toBe(0.06);
    expect(path[1].rate).toBe(0.065);
    expect(path[2].rate).toBe(0.07);
    expect(path[3].rate).toBe(0.07);
    expect(path[4].rate).toBe(0.07);
  });

  it("should follow the short-term OCR example from 2.25% to 0.25% over 12 months", () => {
    const path = buildPolicyRatePath({
      initialRate: 0.0225,
      controls: { shortTermChange: -0.02, mediumTermDirection: 0, changeSpeed: 0.5 },
      nodes: [0, 6, 12, 24]
    });

    expect(path[0].rate).toBe(0.0225);
    expect(path[1].rate).toBe(0.0125);
    expect(path[2].rate).toBe(0.0025);
    expect(path[3].rate).toBe(0.0025);
  });

  it("should apply the medium-term decline only from month 13 to 36, then stay flat", () => {
    const path = buildPolicyRatePath({
      initialRate: 0.0225,
      controls: { shortTermChange: 0, mediumTermDirection: -1, changeSpeed: 0.5 },
      nodes: [12, 24, 36, 48, 60]
    });

    expect(path[0].rate).toBe(0.0225);
    expect(path[1].rate).toBe(0.0175);
    expect(path[2].rate).toBe(0.0125);
    expect(path[3].rate).toBe(0.0125);
    expect(path[4].rate).toBe(0.0125);
  });

  it("should stay flat from month 13 onward when medium-term direction is 0", () => {
    const path = buildPolicyRatePath({
      initialRate: 0.0225,
      controls: { shortTermChange: 0.01, mediumTermDirection: 0, changeSpeed: 0.5 },
      nodes: [12, 18, 24, 36, 48]
    });

    expect(path[0].rate).toBe(0.0325);
    expect(path[1].rate).toBe(0.0325);
    expect(path[2].rate).toBe(0.0325);
    expect(path[3].rate).toBe(0.0325);
    expect(path[4].rate).toBe(0.0325);
  });
});

describe("Rate Engine: Product Rate Path Derivation", () => {
  const policyRatePath = [
    { month: 0, rate: 0.05 },
    { month: 12, rate: 0.03 }
  ];

  const currentProductRates = {
    floating: 0.075,
    "fixed-1y": 0.065
  };

  const betas = {
    floating: 0.90,
    "fixed-1y": 0.75
  };

  const products = [
    { code: "floating", fixedMonths: null },
    { code: "fixed-1y", fixedMonths: 12 }
  ];

  it("should derive floating and fixed rate paths correctly", () => {
    const derived = deriveProductRatePaths({
      policyRatePath,
      currentProductRates,
      betas,
      products,
      forecastMonths: 12
    });

    // Floating term is 1 month. At month 12, policy rate is 0.03.
    // Expected policy change at month 12 = 0.03 - 0.05 = -0.02
    // Floating rate = 0.075 + 0.90 * (-0.02) = 0.057
    expect(derived.floating[0].rate).toBe(0.075);
    expect(derived.floating[12].rate).toBe(0.057);

    // Fixed terms now use the OCR level at the refix month directly.
    expect(derived["fixed-1y"][0].rate).toBe(0.065);
    expect(derived["fixed-1y"][12].rate).toBe(0.045);
  });

  it("should reprice fixed-1y from the OCR level at the refix month", () => {
    const path = Array.from({ length: 25 }, (_, month) => {
      if (month <= 12) {
        return { month, rate: 0.0225 + (0.01 * month / 12) };
      }
      return { month, rate: 0.0325 };
    });

    const derived = deriveProductRatePaths({
      policyRatePath: path,
      currentProductRates: { "fixed-1y": 0.0465 },
      betas: { "fixed-1y": 0.75 },
      products: [{ code: "fixed-1y", fixedMonths: 12 }],
      forecastMonths: 24
    });

    const expectedRefixRate = 0.0565;

    expect(derived["fixed-1y"][12].rate).toBe(expectedRefixRate);
  });

  it("should apply the same direct OCR delta rule to longer fixed terms", () => {
    const path = [
      { month: 0, rate: 0.0225 },
      { month: 24, rate: 0.0325 }
    ];

    const derived = deriveProductRatePaths({
      policyRatePath: path,
      currentProductRates: { "fixed-2y": 0.0525 },
      betas: { "fixed-2y": 0.55 },
      products: [{ code: "fixed-2y", fixedMonths: 24 }],
      forecastMonths: 24
    });

    expect(derived["fixed-2y"][24].rate).toBe(0.0625);
  });
});
