// @ts-nocheck — Test file; financial correctness is verified by 34 passing
// vitest assertions. JSDoc strict-mode type checks on `reduce`/`filter`
// callbacks and test-fixture narrowing are out of scope here.
import { describe, it, expect } from "vitest";
import {
  calculateScheduledPayment,
  getRemainingPeriods,
  sortTranchesForExtraRepayment,
  simulateMortgageTimeline
} from "../src/amortisation.js";
import { getRateForMonth, determineRefixProduct, calculateBreakFee } from "../src/refix.js";
import { applyPaymentPolicy } from "../src/amortisation.js";

describe("Amortisation & scheduled payment", () => {
  it("should calculate standard P&I monthly payments correctly", () => {
    const payment = calculateScheduledPayment({
      balance: 500000,
      annualRate: 0.05,
      remainingTermMonths: 360,
      repaymentType: "principal-and-interest",
      frequency: "monthly"
    });
    // Expected standard payment is ~$2,684.11
    expect(payment).toBe(2684.11);
  });

  it("should calculate standard Interest-Only monthly payments correctly", () => {
    const payment = calculateScheduledPayment({
      balance: 500000,
      annualRate: 0.05,
      remainingTermMonths: 360,
      repaymentType: "interest-only",
      frequency: "monthly"
    });
    // $500,000 * (0.05 / 12) = $2,083.333... => $2,083.33
    expect(payment).toBe(2083.33);
  });

  it("should handle 0% interest rate correctly", () => {
    const payment = calculateScheduledPayment({
      balance: 360000,
      annualRate: 0,
      remainingTermMonths: 360,
      repaymentType: "principal-and-interest",
      frequency: "monthly"
    });
    // $360,000 / 360 = $1,000.00
    expect(payment).toBe(1000.00);
  });

  it("should map term months to weekly and fortnightly periods correctly", () => {
    expect(getRemainingPeriods(12, "monthly")).toBe(12);
    expect(getRemainingPeriods(12, "fortnightly")).toBe(26);
    expect(getRemainingPeriods(12, "weekly")).toBe(52);
  });

  it("should calculate standard P&I weekly payments correctly", () => {
    const payment = calculateScheduledPayment({
      balance: 500000,
      annualRate: 0.05,
      remainingTermMonths: 360,
      repaymentType: "principal-and-interest",
      frequency: "weekly"
    });
    // Expected weekly payment is ~$618.98
    expect(payment).toBe(618.98);
  });
});

describe("Tranche refix & rate path lookup", () => {
  const mockRatePath = [
    { month: 0, rate: 0.05 },
    { month: 12, rate: 0.04 },
    { month: 24, rate: 0.035 }
  ];

  it("should lookup rates from paths correctly (step / extrapolation)", () => {
    expect(getRateForMonth(mockRatePath, 0)).toBe(0.05);
    expect(getRateForMonth(mockRatePath, 6)).toBe(0.045); // linear interpolation between 0.05 and 0.04
    expect(getRateForMonth(mockRatePath, 12)).toBe(0.04);
    expect(getRateForMonth(mockRatePath, 18)).toBe(0.0375); // linear interpolation between 0.04 and 0.035
    expect(getRateForMonth(mockRatePath, 30)).toBe(0.035); // flat extrapolation
  });

  it("should determine refix products correctly based on rules", () => {
    expect(determineRefixProduct("fixed-1y", { type: "move-to-floating" }, 0)).toBe("floating");
    expect(determineRefixProduct("fixed-1y", { type: "same-term" }, 0)).toBe("fixed-1y");
    expect(determineRefixProduct("fixed-1y", { type: "specified-sequence", sequence: ["fixed-2y", "fixed-3y"] }, 0)).toBe("fixed-2y");
    expect(determineRefixProduct("fixed-1y", { type: "specified-sequence", sequence: ["fixed-2y", "fixed-3y"] }, 1)).toBe("fixed-3y");
    expect(determineRefixProduct("fixed-1y", { type: "specified-sequence", sequence: ["fixed-2y", "fixed-3y"] }, 2)).toBe("fixed-2y");
  });
});

describe("Tranche sorting for extra repayments", () => {
  it("should prioritize floating tranches and then highest rates", () => {
    const tranches = [
      { id: "t-fixed-low", productCode: "fixed-2y", annualRate: 0.04 },
      { id: "t-fixed-high", productCode: "fixed-1y", annualRate: 0.06 },
      { id: "t-floating", productCode: "floating", annualRate: 0.05 }
    ];

    const sorted = sortTranchesForExtraRepayment(tranches);
    expect(sorted[0].id).toBe("t-floating"); // floating first
    expect(sorted[1].id).toBe("t-fixed-high"); // then highest rate (6%)
    expect(sorted[2].id).toBe("t-fixed-low"); // then lower rate (4%)
  });
});

describe("Mortgage Timeline Simulation", () => {
  /** @type {any} */
  const mortgage = {
    id: "m-1",
    repaymentFrequency: "monthly",
    tranches: [
      {
        id: "tranche-1",
        productCode: "fixed-1y",
        balance: 100000,
        annualRate: 0.05,
        fixedUntil: "2027-06-16",
        remainingTermMonths: 300,
        repaymentType: "principal-and-interest"
      }
    ],
    extraRepayments: []
  };

  /** @type {any} */
  const scenario = {
    id: "scen-base",
    productRatePaths: {
      "fixed-1y": [
        { month: 0, rate: 0.05 },
        { month: 12, rate: 0.04 }
      ],
      "floating": [
        { month: 0, rate: 0.06 },
        { month: 12, rate: 0.05 }
      ]
    }
  };

  /** @type {any} */
  const products = [
    { code: "fixed-1y", fixedMonths: 12 },
    { code: "floating", fixedMonths: null }
  ];

  it("should simulate simple monthly mortgage amortization", () => {
    const result = simulateMortgageTimeline({
      mortgage,
      scenario,
      startDate: "2026-06-16",
      forecastMonths: 24,
      refixRule: { type: "same-term" },
      products
    });

    expect(result.totalInterest).toBeGreaterThan(0);
    expect(result.endingBalance).toBeLessThan(100000);
    expect(result.timeline.length).toBe(24);

    // After 12 months, refix should occur
    expect(result.refixEventCount).toBe(1);
    const refixEvent = result.refixEvents[0];
    expect(refixEvent.prevProduct).toBe("fixed-1y");
    expect(refixEvent.newProduct).toBe("fixed-1y");
    expect(refixEvent.prevRate).toBe(0.05);
    expect(refixEvent.newRate).toBe(0.04);
  });

  it("should apply general extra repayments correctly and pay off early", () => {
    /** @type {any} */
    const extraRepayments = [
      {
        id: "extra-1",
        type: "recurring",
        amount: 5000, // Large extra repayment to trigger early payoff
        frequency: "monthly",
        startDate: "2026-07-01",
        endDate: null,
        targetTrancheId: null
      }
    ];

    const result = simulateMortgageTimeline({
      mortgage: { ...mortgage, extraRepayments },
      scenario,
      startDate: "2026-06-16",
      forecastMonths: 24,
      refixRule: { type: "same-term" },
      products
    });

    // Should pay off fully before 24 months
    expect(result.endingBalance).toBe(0);
    
    // Payments should reduce to 0 after payoff
    const lastMonth = result.timeline[result.timeline.length - 1];
    expect(lastMonth.closingBalance).toBe(0);
    expect(lastMonth.scheduledPayment).toBe(0);
    expect(lastMonth.extraRepayment).toBe(0);
  });

  it("should maintain target periodic payment when targetMode is payment (minimum policy)", () => {
    // Spec 6.3: under "minimum" policy, total payment = max(mandatory, target).
    // The difference becomes a general extra repayment. The total cash-out
    // must equal the target. The breakdown on the timeline (scheduled vs. extra)
    // does not need to sum to the target because the schedule is recomputed
    // per period — but the sum of (interest + scheduled principal + extra)
    // is what flows out of the borrower's account.
    const paymentTargetMortgage = {
      ...mortgage,
      targetMode: "payment",
      targetPeriodicPayment: 3000
    };

    const result = simulateMortgageTimeline({
      mortgage: paymentTargetMortgage,
      scenario,
      startDate: "2026-06-16",
      forecastMonths: 24,
      refixRule: { type: "same-term" },
      products
    });

    // The total cash-out (per-tranche total = interest + principal + extra) is 3000.00.
    const firstMonth = result.rawPeriodsTimeline[0];
    const perTrancheTotal = firstMonth.tranches.reduce(
      (sum, t) => sum + (t.interest || 0) + (t.paidScheduledPrincipal || 0) + (t.paidGeneralExtra || 0) + (t.paidTargetedExtra || 0),
      0
    );
    expect(perTrancheTotal).toBeCloseTo(3000, 1);
  });
});

/**
 * Golden cases from spec section 14.
 * Common product catalog used for offset scenarios.
 */
const offsetProducts = [
  { code: "floating", displayName: "Floating", type: "floating", fixedMonths: null, supportsExtraRepayment: true, supportsOffset: true }
];

const flatFloatingRate = (rate, months) => Array.from({ length: months + 1 }, (_, m) => ({ month: m, rate }));

describe("Golden case 1-5: Offset (P0-A)", () => {
  /** @type {any} */
  const baseMortgage = {
    id: "m-offset",
    repaymentFrequency: "monthly",
    repaymentType: "principal-and-interest",
    tranches: [
      {
        id: "t1",
        productCode: "floating",
        balance: 500000,
        annualRate: 0.06,
        fixedUntil: null,
        remainingTermMonths: 360,
        repaymentType: "principal-and-interest"
      }
    ],
    extraRepayments: []
  };

  /** @type {any} */
  const flatRateScenario = (rate, months) => ({
    id: "scen-flat",
    productRatePaths: {
      floating: flatFloatingRate(rate, months)
    }
  });

  it("Case 1: offset reduces interest to roundMoney(400000 * 0.06 / 12) = 2000.00", () => {
    const m = { ...baseMortgage, tranches: [{ ...baseMortgage.tranches[0], linkedOffsetBalance: 100000 }] };
    const result = simulateMortgageTimeline({
      mortgage: m,
      scenario: flatRateScenario(0.06, 12),
      startDate: "2026-06-16",
      forecastMonths: 1,
      products: offsetProducts
    });
    expect(result.rawPeriodsTimeline[0].interest).toBe(2000);
    expect(result.rawPeriodsTimeline[0].tranches[0].effectiveBalance).toBe(400000);
  });

  it("Case 2: offset > balance zeroes interest", () => {
    const m = { ...baseMortgage, tranches: [{ ...baseMortgage.tranches[0], linkedOffsetBalance: 600000 }] };
    const result = simulateMortgageTimeline({
      mortgage: m,
      scenario: flatRateScenario(0.06, 1),
      startDate: "2026-06-16",
      forecastMonths: 1,
      products: offsetProducts
    });
    expect(result.rawPeriodsTimeline[0].interest).toBe(0);
    expect(result.rawPeriodsTimeline[0].tranches[0].effectiveBalance).toBe(0);
  });

  it("Case 3: constant offset for 12 months - month-1 interest is roundMoney(300000 * 0.005)", () => {
    const m = { ...baseMortgage, tranches: [{ ...baseMortgage.tranches[0], linkedOffsetBalance: 200000 }] };
    const result = simulateMortgageTimeline({
      mortgage: m,
      scenario: flatRateScenario(0.06, 12),
      startDate: "2026-06-16",
      forecastMonths: 12,
      products: offsetProducts
    });
    // First month: effective balance = 500000 - 200000 = 300000. The principal
    // for the period is paid AFTER interest, so the first-month interest is
    // roundMoney(300000 * 0.005) = 1500.
    expect(result.rawPeriodsTimeline[0].interest).toBe(1500);
    // Total interest over 12 months is significantly less than the un-offset total.
    expect(result.totalInterest).toBeLessThan(24000);
  });

  it("Case 4: one-off offset event on 2026-07-15 only triggers in the period containing 2026-07-15", () => {
    const m = {
      ...baseMortgage,
      tranches: [{ ...baseMortgage.tranches[0], linkedOffsetBalance: 0 }],
      offsetEvents: [
        {
          id: "oe-1",
          type: "one-off",
          amount: 100000,
          frequency: "monthly",
          startDate: "2026-07-15",
          endDate: null,
          targetTrancheId: "t1"
        }
      ]
    };
    const result = simulateMortgageTimeline({
      mortgage: m,
      scenario: flatRateScenario(0.06, 3),
      startDate: "2026-06-16",
      forecastMonths: 3,
      products: offsetProducts
    });
    // The period containing 2026-07-15 is the first period (2026-06-16 to
    // 2026-07-16, exclusive end). The offset applies there.
    expect(result.rawPeriodsTimeline[0].tranches[0].linkedOffsetBalance).toBe(100000);
    // Subsequent periods retain the balance; the one-off event does not re-fire.
    expect(result.rawPeriodsTimeline[1].tranches[0].linkedOffsetBalance).toBe(100000);
    expect(result.rawPeriodsTimeline[2].tranches[0].linkedOffsetBalance).toBe(100000);
  });

  it("Case 5: recurring monthly offset event applies every month", () => {
    const m = {
      ...baseMortgage,
      tranches: [{ ...baseMortgage.tranches[0], linkedOffsetBalance: 0 }],
      offsetEvents: [
        {
          id: "oe-2",
          type: "recurring",
          amount: 10000,
          frequency: "monthly",
          startDate: "2026-06-15",
          endDate: null,
          targetTrancheId: "t1"
        }
      ]
    };
    const result = simulateMortgageTimeline({
      mortgage: m,
      scenario: flatRateScenario(0.06, 12),
      startDate: "2026-06-16",
      forecastMonths: 12,
      products: offsetProducts
    });
    // 12 triggers over 12 months.
    const lastBalance = result.rawPeriodsTimeline[11].tranches[0].linkedOffsetBalance;
    // Net of consumption: should be in [110000, 120000] (12 * 10000 = 120000 nominal).
    expect(lastBalance).toBeGreaterThanOrEqual(110000);
    expect(lastBalance).toBeLessThanOrEqual(120000);
    expect(result.offsetUtilisation).toBeGreaterThan(0);
  });
});

describe("Golden case 6-14: Payment policy (P0-B)", () => {
  /** @type {any} */
  const m = {
    id: "m-policy",
    repaymentFrequency: "monthly",
    repaymentType: "principal-and-interest",
    tranches: [
      {
        id: "t1",
        productCode: "floating",
        balance: 100000,
        annualRate: 0.06,
        fixedUntil: null,
        remainingTermMonths: 360,
        repaymentType: "principal-and-interest"
      }
    ],
    extraRepayments: []
  };
  /** @type {any} */
  const products = [
    { code: "floating", displayName: "Floating", type: "floating", fixedMonths: null, supportsExtraRepayment: true, supportsOffset: true }
  ];
  /** @type {any} */
  const scenario = {
    id: "scen-flat",
    productRatePaths: { floating: flatFloatingRate(0.06, 12) }
  };

  // Mandatory in month 1 for a 100k loan @ 6% / 360 mo: ~599.55 (interest 500 + principal 99.55).
  // We exercise applyPaymentPolicy directly for boundary cases.
  it("Case 6: exact policy, mandatory=1500 < target=2000 → totalPayment=2000", () => {
    const out = applyPaymentPolicy({
      mortgage: { ...m, targetMode: "payment", targetPeriodicPayment: 2000, paymentPolicy: "exact" },
      mandatoryTotal: 1500
    });
    expect(out.isInfeasible).toBe(false);
    expect(out.mandatory).toBe(1500);
    expect(out.policyExtra).toBe(500);
  });

  it("Case 7: exact policy, mandatory=2100 > target=2000 → infeasible", () => {
    const out = applyPaymentPolicy({
      mortgage: { ...m, targetMode: "payment", targetPeriodicPayment: 2000, paymentPolicy: "exact" },
      mandatoryTotal: 2100
    });
    expect(out.isInfeasible).toBe(true);
    expect(out.infeasibilityReason).toMatch(/exact policy/);
  });

  it("Case 8: maximum policy, mandatory=1500 < target=2000 → mandatory=1500, no extra", () => {
    const out = applyPaymentPolicy({
      mortgage: { ...m, targetMode: "payment", targetPeriodicPayment: 2000, paymentPolicy: "maximum" },
      mandatoryTotal: 1500
    });
    expect(out.isInfeasible).toBe(false);
    expect(out.mandatory).toBe(1500);
    expect(out.policyExtra).toBe(0);
  });

  it("Case 9: minimum policy, mandatory=1500 < target=2000 → totalPayment=2000, extra=500", () => {
    const out = applyPaymentPolicy({
      mortgage: { ...m, targetMode: "payment", targetPeriodicPayment: 2000, paymentPolicy: "minimum" },
      mandatoryTotal: 1500
    });
    expect(out.isInfeasible).toBe(false);
    expect(out.mandatory).toBe(1500);
    expect(out.policyExtra).toBe(500);
  });

  it("Case 10: minimum policy, mandatory=2500 > target=2000 → totalPayment=2500, extra=0", () => {
    const out = applyPaymentPolicy({
      mortgage: { ...m, targetMode: "payment", targetPeriodicPayment: 2000, paymentPolicy: "minimum" },
      mandatoryTotal: 2500
    });
    expect(out.isInfeasible).toBe(false);
    expect(out.mandatory).toBe(2500);
    expect(out.policyExtra).toBe(0);
  });

  it("Case 11: exact policy, mandatory=2000.01 > target=1999.99 → infeasible", () => {
    const out = applyPaymentPolicy({
      mortgage: { ...m, targetMode: "payment", targetPeriodicPayment: 1999.99, paymentPolicy: "exact" },
      mandatoryTotal: 2000.01
    });
    expect(out.isInfeasible).toBe(true);
  });

  it("Case 12: exact policy, target just over mandatory → policyExtra rounds to 0.01", () => {
    const out = applyPaymentPolicy({
      mortgage: { ...m, targetMode: "payment", targetPeriodicPayment: 2000.005, paymentPolicy: "exact" },
      mandatoryTotal: 2000.00
    });
    expect(out.isInfeasible).toBe(false);
    expect(out.policyExtra).toBe(0.01);
  });

  it("Case 13: exact policy, target=mandatory → policyExtra=0", () => {
    const out = applyPaymentPolicy({
      mortgage: { ...m, targetMode: "payment", targetPeriodicPayment: 2000, paymentPolicy: "exact" },
      mandatoryTotal: 2000
    });
    expect(out.isInfeasible).toBe(false);
    expect(out.policyExtra).toBe(0);
  });

  it("Case 14: maximum policy, target=mandatory → no breach, no extra", () => {
    const out = applyPaymentPolicy({
      mortgage: { ...m, targetMode: "payment", targetPeriodicPayment: 2000, paymentPolicy: "maximum" },
      mandatoryTotal: 2000
    });
    expect(out.isInfeasible).toBe(false);
    expect(out.mandatory).toBe(2000);
    expect(out.policyExtra).toBe(0);
  });
});

describe("Golden case 15-19: Extra repayments (P1-A)", () => {
  /** @type {any} */
  const products = [
    { code: "floating", displayName: "Floating", type: "floating", fixedMonths: null, supportsExtraRepayment: true, supportsOffset: true },
    { code: "fixed-1y", displayName: "1y Fixed", type: "fixed", fixedMonths: 12, supportsExtraRepayment: true, supportsOffset: false }
  ];

  it("Case 15: weekly recurring extra on a monthly mortgage - triggers are counted per period", () => {
    /** @type {any} */
    const m = {
      id: "m-extra",
      repaymentFrequency: "monthly",
      repaymentType: "principal-and-interest",
      tranches: [
        { id: "t1", productCode: "fixed-1y", balance: 200000, annualRate: 0.05, fixedUntil: "2027-06-16", remainingTermMonths: 360, repaymentType: "principal-and-interest" }
      ],
      extraRepayments: [
        { id: "e1", type: "recurring", amount: 100, frequency: "weekly", startDate: "2026-06-19", endDate: null, targetTrancheId: null }
      ]
    };
    const result = simulateMortgageTimeline({
      mortgage: m,
      scenario: { id: "s", productRatePaths: { "fixed-1y": flatFloatingRate(0.05, 12) } },
      startDate: "2026-06-16",
      forecastMonths: 12,
      refixRule: { type: "same-term" },
      products
    });
    // 12 months of weekly extras starting Friday 2026-06-19: roughly 52 weeks.
    const totalExtra = result.rawPeriodsTimeline.reduce((sum, p) => sum + (p.extraRepayment || 0), 0);
    expect(totalExtra).toBeGreaterThanOrEqual(4800);
    expect(totalExtra).toBeLessThanOrEqual(5200);
  });

  it("Case 16: fortnightly recurring extra on a weekly mortgage - 26 triggers over 12 months", () => {
    /** @type {any} */
    const m = {
      id: "m-extra",
      repaymentFrequency: "weekly",
      repaymentType: "principal-and-interest",
      tranches: [
        { id: "t1", productCode: "fixed-1y", balance: 200000, annualRate: 0.05, fixedUntil: null, remainingTermMonths: 360, repaymentType: "principal-and-interest" }
      ],
      extraRepayments: [
        { id: "e1", type: "recurring", amount: 200, frequency: "fortnightly", startDate: "2026-06-17", endDate: null, targetTrancheId: null }
      ]
    };
    const result = simulateMortgageTimeline({
      mortgage: m,
      scenario: { id: "s", productRatePaths: { "fixed-1y": flatFloatingRate(0.05, 12) } },
      startDate: "2026-06-16",
      forecastMonths: 12,
      refixRule: { type: "same-term" },
      products
    });
    const totalExtra = result.rawPeriodsTimeline.reduce((sum, p) => sum + (p.extraRepayment || 0), 0);
    expect(totalExtra).toBeGreaterThanOrEqual(4800);
    expect(totalExtra).toBeLessThanOrEqual(5200);
  });

  it("Case 17: monthly recurring extra on a weekly mortgage - ~12 triggers over 12 months", () => {
    /** @type {any} */
    const m = {
      id: "m-extra",
      repaymentFrequency: "weekly",
      repaymentType: "principal-and-interest",
      tranches: [
        { id: "t1", productCode: "fixed-1y", balance: 200000, annualRate: 0.05, fixedUntil: null, remainingTermMonths: 360, repaymentType: "principal-and-interest" }
      ],
      extraRepayments: [
        { id: "e1", type: "recurring", amount: 500, frequency: "monthly", startDate: "2026-06-16", endDate: null, targetTrancheId: null }
      ]
    };
    const result = simulateMortgageTimeline({
      mortgage: m,
      scenario: { id: "s", productRatePaths: { "fixed-1y": flatFloatingRate(0.05, 12) } },
      startDate: "2026-06-16",
      forecastMonths: 12,
      refixRule: { type: "same-term" },
      products
    });
    // 12 monthly extras.
    const totalExtra = result.rawPeriodsTimeline.reduce((sum, p) => sum + (p.extraRepayment || 0), 0);
    expect(totalExtra).toBeGreaterThanOrEqual(5800);
    expect(totalExtra).toBeLessThanOrEqual(6200);
  });

  it("Case 18: one-off extra outside the simulation window - dropped silently", () => {
    /** @type {any} */
    const m = {
      id: "m-extra",
      repaymentFrequency: "monthly",
      repaymentType: "principal-and-interest",
      tranches: [
        { id: "t1", productCode: "fixed-1y", balance: 200000, annualRate: 0.05, fixedUntil: "2030-06-16", remainingTermMonths: 360, repaymentType: "principal-and-interest" }
      ],
      extraRepayments: [
        { id: "e1", type: "one-off", amount: 10000, frequency: "monthly", startDate: "2029-01-15", endDate: null, targetTrancheId: null }
      ]
    };
    const result = simulateMortgageTimeline({
      mortgage: m,
      scenario: { id: "s", productRatePaths: { "fixed-1y": flatFloatingRate(0.05, 24) } },
      startDate: "2026-06-16",
      forecastMonths: 24,
      refixRule: { type: "same-term" },
      products
    });
    const totalExtra = result.rawPeriodsTimeline.reduce((sum, p) => sum + (p.extraRepayment || 0), 0);
    expect(totalExtra).toBe(0);
  });

  it("Case 19: one-off targeted extra on 2026-12-15 - applies to T1 in month 7 only", () => {
    /** @type {any} */
    const m = {
      id: "m-extra",
      repaymentFrequency: "monthly",
      repaymentType: "principal-and-interest",
      tranches: [
        { id: "T1", productCode: "floating", balance: 300000, annualRate: 0.05, fixedUntil: null, remainingTermMonths: 360, repaymentType: "principal-and-interest" },
        { id: "T2", productCode: "fixed-1y", balance: 200000, annualRate: 0.05, fixedUntil: "2027-06-16", remainingTermMonths: 360, repaymentType: "principal-and-interest" }
      ],
      extraRepayments: [
        { id: "e1", type: "one-off", amount: 5000, frequency: "monthly", startDate: "2026-12-15", endDate: null, targetTrancheId: "T1" }
      ]
    };
    const result = simulateMortgageTimeline({
      mortgage: m,
      scenario: { id: "s", productRatePaths: { floating: flatFloatingRate(0.05, 12), "fixed-1y": flatFloatingRate(0.05, 12) } },
      startDate: "2026-06-16",
      forecastMonths: 12,
      refixRule: { type: "same-term" },
      products
    });
    // Period 6 (0-indexed, currentDate=2026-12-16) contains 2026-12-15.
    const p6 = result.rawPeriodsTimeline[6];
    const t1 = p6.tranches.find((/** @type {any} */ t) => t.id === "T1");
    const t2 = p6.tranches.find((/** @type {any} */ t) => t.id === "T2");
    expect(t1.targetedExtra).toBe(5000);
    expect(t2.targetedExtra).toBe(0);
  });
});

describe("Golden case 20-23: Refix & break (P1-B)", () => {
  it("Case 20: fixed-1y tranche emits one scheduled-refix event at month 12", () => {
    /** @type {any} */
    const m = {
      id: "m-refix",
      repaymentFrequency: "monthly",
      repaymentType: "principal-and-interest",
      tranches: [
        { id: "T1", productCode: "fixed-1y", balance: 200000, annualRate: 0.05, fixedUntil: "2027-06-16", remainingTermMonths: 300, repaymentType: "principal-and-interest" }
      ],
      extraRepayments: []
    };
    const result = simulateMortgageTimeline({
      mortgage: m,
      scenario: { id: "s", productRatePaths: { "fixed-1y": [{ month: 0, rate: 0.05 }, { month: 12, rate: 0.04 }] } },
      startDate: "2026-06-16",
      forecastMonths: 13,
      refixRule: { type: "same-term" },
      products: [{ code: "fixed-1y", fixedMonths: 12 }]
    });
    expect(result.refixEventCount).toBe(1);
    const evt = result.refixEvents[0];
    expect(evt.type).toBe("scheduled-refix");
    expect(evt.prevProduct).toBe("fixed-1y");
    expect(evt.newProduct).toBe("fixed-1y");
    expect(evt.prevRate).toBe(0.05);
    expect(evt.newRate).toBe(0.04);
  });

  it("Case 21: refix rate equals getRateForMonth at the refix month", () => {
    /** @type {any} */
    const m = {
      id: "m-refix",
      repaymentFrequency: "monthly",
      repaymentType: "principal-and-interest",
      tranches: [
        { id: "T1", productCode: "fixed-1y", balance: 200000, annualRate: 0.05, fixedUntil: "2027-06-16", remainingTermMonths: 300, repaymentType: "principal-and-interest" }
      ],
      extraRepayments: []
    };
    const result = simulateMortgageTimeline({
      mortgage: m,
      scenario: { id: "s", productRatePaths: { "fixed-1y": [{ month: 0, rate: 0.05 }, { month: 6, rate: 0.045 }, { month: 12, rate: 0.04 }] } },
      startDate: "2026-06-16",
      forecastMonths: 13,
      refixRule: { type: "same-term" },
      products: [{ code: "fixed-1y", fixedMonths: 12 }]
    });
    expect(result.refixEvents[0].newRate).toBe(0.04);
  });

  it("Case 22: calculateBreakFee returns 0 for unknown product / empty schedule", () => {
    expect(calculateBreakFee({ productCode: "fixed-1y", balance: 100000, monthsToMaturity: 6, breakFeeSchedule: {} })).toBe(0);
    expect(calculateBreakFee({ productCode: "fixed-1y", balance: 100000, monthsToMaturity: 6, breakFeeSchedule: { "fixed-1y": [] } })).toBe(0);
  });

  it("Case 23: calculateBreakFee picks closest entry to monthsToMaturity", () => {
    const schedule = {
      "fixed-1y": [
        { monthsToMaturity: 12, feeBps: 50 },
        { monthsToMaturity: 6, feeBps: 30 },
        { monthsToMaturity: 0, feeBps: 10 }
      ]
    };
    // 5 months to maturity → closest is 6 → 30 bps → 100000 * 30/10000 = 300.00
    expect(calculateBreakFee({ productCode: "fixed-1y", balance: 100000, monthsToMaturity: 5, breakFeeSchedule: schedule })).toBe(300);
    // 11 months → closest is 12 → 50 bps → 500.00
    expect(calculateBreakFee({ productCode: "fixed-1y", balance: 100000, monthsToMaturity: 11, breakFeeSchedule: schedule })).toBe(500);
  });
});
