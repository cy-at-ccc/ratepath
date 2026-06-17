import { describe, it, expect } from "vitest";
import {
  calculateScheduledPayment,
  getRemainingPeriods,
  sortTranchesForExtraRepayment,
  simulateMortgageTimeline
} from "../src/amortisation.js";
import { getRateForMonth, determineRefixProduct } from "../src/refix.js";

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

  it("should maintain target periodic payment when targetMode is payment", () => {
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

    // The standard monthly payment for 100k at 5% for 300 months is ~$536.82
    // Since targetPeriodicPayment is 3000, it should inject difference and make the total payment 3000
    const firstMonth = result.timeline[0];
    expect(firstMonth.scheduledPayment + firstMonth.extraRepayment).toBeCloseTo(3000, 1);
  });
});
