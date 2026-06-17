import { describe, it, expect } from "vitest";
import {
  RatePointSchema,
  MortgageTrancheSchema,
  MortgageSchema,
  RateScenarioSchema,
  SplitStrategySchema,
  OffsetEventSchema,
  SimulationResultSchema
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

  describe("OffsetEventSchema", () => {
    it("should validate a one-off offset event", () => {
      const valid = {
        id: "oe-1",
        type: "one-off",
        amount: 10000,
        frequency: "monthly",
        startDate: "2026-07-15",
        endDate: null,
        targetTrancheId: "tranche-1"
      };
      expect(OffsetEventSchema.safeParse(valid).success).toBe(true);
    });

    it("should accept negative amounts (withdrawal)", () => {
      const valid = {
        id: "oe-2",
        type: "recurring",
        amount: -500,
        frequency: "weekly",
        startDate: "2026-06-19",
        endDate: null,
        targetTrancheId: "tranche-1"
      };
      expect(OffsetEventSchema.safeParse(valid).success).toBe(true);
    });

    it("should reject invalid frequency", () => {
      const invalid = {
        id: "oe-3",
        type: "recurring",
        amount: 100,
        frequency: "yearly",
        startDate: "2026-06-15",
        endDate: null,
        targetTrancheId: null
      };
      expect(OffsetEventSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe("MortgageTrancheSchema new field: linkedOffsetBalance", () => {
    it("should default to 0 when not provided", () => {
      const valid = {
        id: "tranche-1",
        productCode: "floating",
        balance: 500000,
        annualRate: 0.06,
        fixedUntil: null,
        remainingTermMonths: 360,
        repaymentType: "principal-and-interest"
      };
      const parsed = MortgageTrancheSchema.safeParse(valid);
      expect(parsed.success).toBe(true);
      expect(/** @type {any} */ (parsed).data.linkedOffsetBalance).toBe(0);
    });

    it("should accept a non-negative starting offset balance", () => {
      const valid = {
        id: "tranche-1",
        productCode: "floating",
        balance: 500000,
        annualRate: 0.06,
        fixedUntil: null,
        remainingTermMonths: 360,
        repaymentType: "principal-and-interest",
        linkedOffsetBalance: 100000
      };
      expect(MortgageTrancheSchema.safeParse(valid).success).toBe(true);
    });

    it("should reject a negative offset balance", () => {
      const invalid = {
        id: "tranche-1",
        productCode: "floating",
        balance: 500000,
        annualRate: 0.06,
        fixedUntil: null,
        remainingTermMonths: 360,
        repaymentType: "principal-and-interest",
        linkedOffsetBalance: -1
      };
      expect(MortgageTrancheSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe("MortgageSchema new fields: paymentPolicy, offsetEvents", () => {
    it("should default paymentPolicy to minimum and offsetEvents to [] when omitted", () => {
      const valid = {
        id: "m-1",
        name: "M",
        countryCode: "NZ",
        currencyCode: "NZD",
        originalTermMonths: 360,
        remainingTermMonths: 300,
        repaymentFrequency: "monthly",
        repaymentType: "principal-and-interest",
        tranches: [],
        extraRepayments: []
      };
      const parsed = MortgageSchema.safeParse(valid);
      expect(parsed.success).toBe(true);
      expect(/** @type {any} */ (parsed).data.paymentPolicy).toBe("minimum");
      expect(/** @type {any} */ (parsed).data.offsetEvents).toEqual([]);
    });

    it("should accept an exact payment policy and an offset event list", () => {
      const valid = {
        id: "m-1",
        name: "M",
        countryCode: "NZ",
        currencyCode: "NZD",
        originalTermMonths: 360,
        remainingTermMonths: 300,
        targetMode: "payment",
        targetPeriodicPayment: 3000,
        paymentPolicy: "exact",
        offsetEvents: [
          {
            id: "oe-1",
            type: "one-off",
            amount: 5000,
            frequency: "monthly",
            startDate: "2026-07-15",
            endDate: null,
            targetTrancheId: "t1"
          }
        ],
        repaymentFrequency: "monthly",
        repaymentType: "principal-and-interest",
        tranches: [
          {
            id: "t1",
            productCode: "floating",
            balance: 300000,
            annualRate: 0.06,
            fixedUntil: null,
            remainingTermMonths: 300,
            repaymentType: "principal-and-interest"
          }
        ],
        extraRepayments: []
      };
      expect(MortgageSchema.safeParse(valid).success).toBe(true);
    });

    it("should reject an invalid payment policy", () => {
      const invalid = {
        id: "m-1",
        name: "M",
        countryCode: "NZ",
        currencyCode: "NZD",
        originalTermMonths: 360,
        remainingTermMonths: 300,
        paymentPolicy: "aggressive",
        repaymentFrequency: "monthly",
        repaymentType: "principal-and-interest",
        tranches: [],
        extraRepayments: []
      };
      expect(MortgageSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe("SimulationResultSchema new fields", () => {
    it("should default isInfeasible to false and infeasibilityReason to null when omitted", () => {
      const valid = {
        strategyId: "s1",
        scenarioId: "base",
        totalInterest: 1000,
        totalRepayments: 5000,
        endingBalance: 0,
        maximumPayment: 500,
        minimumPayment: 100,
        averagePayment: 300,
        maximumPaymentIncrease: 0,
        paymentVolatility: 50,
        refixEventCount: 0,
        maximumConcurrentRefixPercentage: 0,
        floatingExposure: 0,
        affordabilityBreaches: 0,
        refixEvents: [],
        timeline: []
      };
      const parsed = SimulationResultSchema.safeParse(valid);
      expect(parsed.success).toBe(true);
      expect(/** @type {any} */ (parsed).data.isInfeasible).toBe(false);
      expect(/** @type {any} */ (parsed).data.infeasibilityReason).toBe(null);
    });

    it("should accept an infeasible simulation with a reason", () => {
      const valid = {
        strategyId: "s1",
        scenarioId: "base",
        totalInterest: 1000,
        totalRepayments: 5000,
        endingBalance: 0,
        maximumPayment: 500,
        minimumPayment: 100,
        averagePayment: 300,
        maximumPaymentIncrease: 0,
        paymentVolatility: 50,
        refixEventCount: 0,
        maximumConcurrentRefixPercentage: 0,
        floatingExposure: 0,
        affordabilityBreaches: 0,
        isInfeasible: true,
        infeasibilityReason: "mandatory exceeds target under exact policy",
        payoffTime: 12,
        offsetUtilisation: 0.5,
        refixEvents: [],
        timeline: []
      };
      const parsed = SimulationResultSchema.safeParse(valid);
      expect(parsed.success).toBe(true);
      expect(/** @type {any} */ (parsed).data.isInfeasible).toBe(true);
      expect(/** @type {any} */ (parsed).data.infeasibilityReason).toBe("mandatory exceeds target under exact policy");
      expect(/** @type {any} */ (parsed).data.payoffTime).toBe(12);
      expect(/** @type {any} */ (parsed).data.offsetUtilisation).toBe(0.5);
    });
  });
});
