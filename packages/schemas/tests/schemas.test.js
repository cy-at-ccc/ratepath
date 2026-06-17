import { describe, it, expect } from "vitest";
import {
  RatePointSchema,
  MortgageTrancheSchema,
  MortgageSchema,
  RateScenarioSchema,
  SplitStrategySchema
} from "../src/index.js";

describe("Schema Validation Tests", () => {
  describe("RatePointSchema", () => {
    it("should validate a valid RatePoint", () => {
      const valid = { month: 12, rate: 0.0469 };
      const parsed = RatePointSchema.safeParse(valid);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toEqual(valid);
    });

    it("should reject a negative month or rate", () => {
      const invalid = { month: -1, rate: 0.05 };
      expect(RatePointSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe("MortgageTrancheSchema", () => {
    it("should validate a valid tranche", () => {
      const valid = {
        id: "tranche-1",
        productCode: "fixed-1y",
        balance: 250000,
        annualRate: 0.0585,
        fixedUntil: "2027-06-16",
        remainingTermMonths: 300,
        repaymentType: "principal-and-interest"
      };
      const parsed = MortgageTrancheSchema.safeParse(valid);
      expect(parsed.success).toBe(true);
    });

    it("should reject if repaymentType is invalid", () => {
      const invalid = {
        id: "tranche-1",
        productCode: "fixed-1y",
        balance: 250000,
        annualRate: 0.0585,
        fixedUntil: null,
        remainingTermMonths: 300,
        repaymentType: "invalid-type"
      };
      expect(MortgageTrancheSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe("MortgageSchema", () => {
    it("should validate a valid mortgage with tranches and extra repayments", () => {
      const valid = {
        id: "mortgage-1",
        name: "Main Home",
        countryCode: "NZ",
        currencyCode: "NZD",
        originalTermMonths: 360,
        remainingTermMonths: 300,
        repaymentFrequency: "fortnightly",
        repaymentType: "principal-and-interest",
        tranches: [
          {
            id: "tranche-1",
            productCode: "fixed-1y",
            balance: 300000,
            annualRate: 0.052,
            fixedUntil: "2027-06-16",
            remainingTermMonths: 300,
            repaymentType: "principal-and-interest"
          }
        ],
        extraRepayments: [
          {
            id: "extra-1",
            type: "recurring",
            amount: 100,
            frequency: "fortnightly",
            startDate: "2026-07-01",
            endDate: null,
            targetTrancheId: "tranche-1"
          }
        ]
      };
      const parsed = MortgageSchema.safeParse(valid);
      expect(parsed.success).toBe(true);
    });
  });

  describe("RateScenarioSchema", () => {
    it("should validate a valid rate scenario", () => {
      const valid = {
        id: "scenario-base",
        countryCode: "NZ",
        name: "Base Case",
        mode: "policy-rate-derived",
        probability: 0.6,
        forecastMonths: 36,
        policyRatePath: [
          { month: 0, rate: 0.0525 },
          { month: 12, rate: 0.0425 }
        ],
        productRatePaths: {
          "floating": [
            { month: 0, rate: 0.075 },
            { month: 12, rate: 0.065 }
          ]
        },
        assumptions: {
          ocrSpread: 0.02
        }
      };
      expect(RateScenarioSchema.safeParse(valid).success).toBe(true);
    });
  });

  describe("SplitStrategySchema", () => {
    it("should validate a valid split strategy", () => {
      const valid = {
        id: "strategy-1",
        allocations: [
          { productCode: "fixed-1y", percentage: 0.5, amount: 250000 },
          { productCode: "floating", percentage: 0.5, amount: 250000 }
        ],
        refixRule: {
          type: "same-term"
        }
      };
      expect(SplitStrategySchema.safeParse(valid).success).toBe(true);
    });
  });
});
