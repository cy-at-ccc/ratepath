import { describe, it, expect } from "vitest";
import { generateSplitStrategies } from "../src/index.js";

describe("Strategy Generator Tests", () => {
  const allowedProducts = [
    { code: "floating", type: "floating" },
    { code: "fixed-1y", type: "fixed" },
    { code: "fixed-2y", type: "fixed" }
  ];

  it("should generate split strategies satisfying sum and constraints", () => {
    const strategies = generateSplitStrategies({
      totalAmount: 500000,
      allowedProducts,
      constraints: {
        maxSplits: 3,
        minPercentage: 0.1,
        percentageStep: 0.1,
        maxFloatingPercentage: 0.3,
        minFixedPercentage: 0.7,
        minTrancheAmount: 10000
      }
    });

    expect(strategies.length).toBeGreaterThan(0);

    strategies.forEach(strategy => {
      // Total percentage must sum to exactly 1.0 (100%)
      const totalPct = strategy.allocations.reduce((sum, a) => sum + a.percentage, 0);
      expect(Math.round(totalPct * 10) / 10).toBe(1.0);

      // Total amount must sum to exactly $500,000
      const totalAmount = strategy.allocations.reduce((sum, a) => sum + a.amount, 0);
      expect(totalAmount).toBe(500000);

      // Number of splits must be <= maxSplits (3)
      expect(strategy.allocations.length).toBeLessThanOrEqual(3);

      // Each tranche must be >= minPercentage (10%)
      strategy.allocations.forEach(a => {
        expect(a.percentage).toBeGreaterThanOrEqual(0.1);
        expect(a.amount).toBeGreaterThanOrEqual(50000);
      });

      // Floating percentage must be <= 30%
      const rawFloatingPct = strategy.allocations
        .filter(a => a.productCode === "floating")
        .reduce((sum, a) => sum + a.percentage, 0);
      const floatingPct = Math.round(rawFloatingPct * 1e4) / 1e4;
      expect(floatingPct).toBeLessThanOrEqual(0.3);
    });
  });

  it("should successfully deduplicate order variations", () => {
    const strategies = generateSplitStrategies({
      totalAmount: 500000,
      allowedProducts,
      constraints: {
        maxSplits: 2,
        minPercentage: 0.5,
        percentageStep: 0.5,
        maxFloatingPercentage: 0.5,
        minFixedPercentage: 0.5
      }
    });

    // Valid allocations are:
    // 1. 50% fixed-1y + 50% fixed-2y
    // 2. 50% floating + 50% fixed-1y
    // 3. 50% floating + 50% fixed-2y
    // 4. 100% fixed-1y
    // 5. 100% fixed-2y
    // Any permutation like 50% fixed-2y + 50% fixed-1y must be merged!
    expect(strategies.length).toBe(5);
  });
});
