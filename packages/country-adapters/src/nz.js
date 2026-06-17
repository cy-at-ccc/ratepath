/** @typedef {import("@mortgage/schemas").MarketProfile} MarketProfile */

/** @type {MarketProfile} */
export const nzProfile = {
  countryCode: "NZ",
  currencyCode: "NZD",
  locale: "en-NZ",
  timezone: "Pacific/Auckland",
  policyRate: {
    code: "OCR",
    displayName: "Official Cash Rate",
    value: 0.0225,
    effectiveDate: "2026-06-17"
  },
  products: [
    { code: "floating", displayName: "Floating Rate", type: "floating", fixedMonths: null, supportsExtraRepayment: true, supportsOffset: true },
    { code: "fixed-6m", displayName: "6 Month Fixed", type: "fixed", fixedMonths: 6, supportsExtraRepayment: true, supportsOffset: false },
    { code: "fixed-1y", displayName: "1 Year Fixed", type: "fixed", fixedMonths: 12, supportsExtraRepayment: true, supportsOffset: false },
    { code: "fixed-18m", displayName: "18 Month Fixed", type: "fixed", fixedMonths: 18, supportsExtraRepayment: true, supportsOffset: false },
    { code: "fixed-2y", displayName: "2 Year Fixed", type: "fixed", fixedMonths: 24, supportsExtraRepayment: true, supportsOffset: false },
    { code: "fixed-3y", displayName: "3 Year Fixed", type: "fixed", fixedMonths: 36, supportsExtraRepayment: true, supportsOffset: false },
    { code: "fixed-5y", displayName: "5 Year Fixed", type: "fixed", fixedMonths: 60, supportsExtraRepayment: true, supportsOffset: false }
  ],
  rules: {
    minTrancheAmount: 10000,
    maxSplits: 3,
    minPercentage: 0.1,
    percentageStep: 0.1
  },
  modelConfigVersion: "nz-1.0.0"
};

/** @type {Record<string, number>} */
export const nzBetas = {
  "floating": 0.90,
  "fixed-6m": 0.85,
  "fixed-1y": 0.75,
  "fixed-18m": 0.65,
  "fixed-2y": 0.55,
  "fixed-3y": 0.40,
  "fixed-5y": 0.25
};
