import { z } from "zod";

/**
 * @typedef {Object} RatePoint
 * @property {number} month
 * @property {number} rate
 */
export const RatePointSchema = z.object({
  month: z.number().int().nonnegative(),
  rate: z.number().nonnegative(), // decimal: e.g. 0.0469 for 4.69%
});

/**
 * @typedef {Object} PolicyRateDefinition
 * @property {string} code
 * @property {string} displayName
 * @property {number} value
 * @property {string} effectiveDate
 */
export const PolicyRateDefinitionSchema = z.object({
  code: z.string(),
  displayName: z.string(),
  value: z.number().nonnegative(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
});

/**
 * @typedef {Object} MortgageProductDefinition
 * @property {string} code
 * @property {string} displayName
 * @property {"floating"|"fixed"|"offset"|"revolving"|"arm"} type
 * @property {number|null} fixedMonths
 * @property {boolean} supportsExtraRepayment
 * @property {boolean} supportsOffset
 */
export const MortgageProductDefinitionSchema = z.object({
  code: z.string(),
  displayName: z.string(),
  type: z.enum(["floating", "fixed", "offset", "revolving", "arm"]),
  fixedMonths: z.number().int().positive().nullable(),
  supportsExtraRepayment: z.boolean(),
  supportsOffset: z.boolean(),
});

/**
 * @typedef {Object} MarketRules
 * @property {number} minTrancheAmount
 * @property {number} maxSplits
 * @property {number} minPercentage
 * @property {number} percentageStep
 * @property {number} [maxFloatingPercentage] - Optional upper bound on the share of floating product (0..1).
 *   When set, the strategy-generator derives `minFixedPercentage = 1 - maxFloatingPercentage` internally,
 *   so callers do not need to compute it themselves.
 * @property {boolean} [mustKeepFloating] - When true, every generated strategy must contain at least one floating tranche.
 */
export const MarketRulesSchema = z.object({
  minTrancheAmount: z.number().nonnegative(),
  maxSplits: z.number().int().positive(),
  minPercentage: z.number().min(0).max(1),
  percentageStep: z.number().min(0).max(1),
  maxFloatingPercentage: z.number().min(0).max(1).optional(),
  mustKeepFloating: z.boolean().optional(),
});

/**
 * @typedef {Object} MarketProfile
 * @property {string} countryCode
 * @property {string} currencyCode
 * @property {string} locale
 * @property {string} timezone
 * @property {PolicyRateDefinition} policyRate
 * @property {MortgageProductDefinition[]} products
 * @property {MarketRules} rules
 * @property {string} modelConfigVersion
 * @property {Record<string, Array<{monthsToMaturity: number, feeBps: number}>>} [breakFeeSchedule]
 *   - Per-product break-fee schedule (basis points keyed by months to maturity).
 *     Empty in this iteration: no NZ product exposes a break fee yet. Reserved for
 *     future use per spec section 4.5.
 */
export const MarketProfileSchema = z.object({
  countryCode: z.string().length(2),
  currencyCode: z.string().length(3),
  locale: z.string(),
  timezone: z.string(),
  policyRate: PolicyRateDefinitionSchema,
  products: z.array(MortgageProductDefinitionSchema),
  rules: MarketRulesSchema,
  modelConfigVersion: z.string(),
  breakFeeSchedule: z.record(z.array(z.object({
    monthsToMaturity: z.number().int().nonnegative(),
    feeBps: z.number().nonnegative()
  }))).optional(),
});

/**
 * @typedef {Object} MortgageTranche
 * @property {string} id
 * @property {string} productCode
 * @property {number} balance
 * @property {number} annualRate
 * @property {string|null} fixedUntil
 * @property {number} remainingTermMonths
 * @property {"principal-and-interest"|"interest-only"} repaymentType
 * @property {number} [linkedOffsetBalance] - Starting cash in the linked offset account (0 if not an offset-eligible tranche).
 */
export const MortgageTrancheSchema = z.object({
  id: z.string(),
  productCode: z.string(),
  balance: z.number().nonnegative(),
  annualRate: z.number().nonnegative(), // e.g. 0.0525
  fixedUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), // YYYY-MM-DD
  remainingTermMonths: z.number().int().positive(),
  repaymentType: z.enum(["principal-and-interest", "interest-only"]),
  linkedOffsetBalance: z.number().nonnegative().default(0),
});

/**
 * @typedef {Object} ExtraRepayment
 * @property {string} id
 * @property {"one-off"|"recurring"} type
 * @property {number} amount
 * @property {"weekly"|"fortnightly"|"monthly"} frequency
 * @property {string} startDate
 * @property {string|null} endDate
 * @property {string|null} targetTrancheId
 */
export const ExtraRepaymentSchema = z.object({
  id: z.string(),
  type: z.enum(["one-off", "recurring"]),
  amount: z.number().positive(),
  frequency: z.enum(["weekly", "fortnightly", "monthly"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), // YYYY-MM-DD
  targetTrancheId: z.string().nullable(),
});

/**
 * @typedef {Object} OffsetEvent
 * @property {string} id
 * @property {"one-off"|"recurring"} type
 * @property {number} amount - Signed: positive = top-up cash into offset; negative = withdrawal.
 * @property {"weekly"|"fortnightly"|"monthly"} frequency
 * @property {string} startDate - ISO YYYY-MM-DD
 * @property {string|null} endDate - ISO YYYY-MM-DD
 * @property {string|null} targetTrancheId - Floating tranche this offset is linked to.
 */
export const OffsetEventSchema = z.object({
  id: z.string(),
  type: z.enum(["one-off", "recurring"]),
  amount: z.number(),
  frequency: z.enum(["weekly", "fortnightly", "monthly"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  targetTrancheId: z.string().nullable(),
});

/**
 * @typedef {Object} Mortgage
 * @property {string} id
 * @property {string} name
 * @property {string} countryCode
 * @property {string} currencyCode
 * @property {number} originalTermMonths
 * @property {number} remainingTermMonths
 * @property {"term"|"payment"} [targetMode]
 * @property {number} [targetPeriodicPayment]
 * @property {"exact"|"maximum"|"minimum"} [paymentPolicy] - Per-period debit policy when in payment mode.
 * @property {OffsetEvent[]} [offsetEvents] - Date-based offset account events.
 * @property {"weekly"|"fortnightly"|"monthly"} repaymentFrequency
 * @property {"principal-and-interest"|"interest-only"} repaymentType
 * @property {MortgageTranche[]} tranches
 * @property {ExtraRepayment[]} extraRepayments
 */
export const MortgageSchema = z.object({
  id: z.string(),
  name: z.string(),
  countryCode: z.string().length(2),
  currencyCode: z.string().length(3),
  originalTermMonths: z.number().int().positive(),
  remainingTermMonths: z.number().int().positive(),
  targetMode: z.enum(["term", "payment"]).optional(),
  targetPeriodicPayment: z.number().positive().optional(),
  paymentPolicy: z.enum(["exact", "maximum", "minimum"]).default("minimum"),
  offsetEvents: z.array(OffsetEventSchema).default([]),
  repaymentFrequency: z.enum(["weekly", "fortnightly", "monthly"]),
  repaymentType: z.enum(["principal-and-interest", "interest-only"]),
  tranches: z.array(MortgageTrancheSchema),
  extraRepayments: z.array(ExtraRepaymentSchema),
});

/**
 * @typedef {Object} SimulationResult
 * @property {string} strategyId
 * @property {string} scenarioId
 * @property {number} totalInterest
 * @property {number} totalRepayments
 * @property {number} endingBalance
 * @property {number} maximumPayment
 * @property {number} minimumPayment
 * @property {number} averagePayment
 * @property {number} maximumPaymentIncrease
 * @property {number} paymentVolatility
 * @property {number} refixEventCount
 * @property {number} maximumConcurrentRefixPercentage
 * @property {number} floatingExposure
 * @property {number} affordabilityBreaches
 * @property {number} [payoffTime] - Month index of full payoff; forecastMonths+1 if not paid off.
 * @property {number} [offsetUtilisation] - Average offset utilisation ratio across active periods.
 * @property {boolean} [isInfeasible] - True if the strategy cannot satisfy its payment policy.
 * @property {string|null} [infeasibilityReason] - Human-readable reason when isInfeasible is true.
 * @property {any[]} refixEvents
 * @property {any[]} timeline
 */
export const SimulationResultSchema = z.object({
  strategyId: z.string(),
  scenarioId: z.string(),
  totalInterest: z.number(),
  totalRepayments: z.number(),
  endingBalance: z.number(),
  maximumPayment: z.number(),
  minimumPayment: z.number(),
  averagePayment: z.number(),
  maximumPaymentIncrease: z.number(),
  paymentVolatility: z.number(),
  refixEventCount: z.number().int().nonnegative(),
  maximumConcurrentRefixPercentage: z.number(),
  floatingExposure: z.number(),
  affordabilityBreaches: z.number().int().nonnegative(),
  payoffTime: z.number().int().nonnegative().optional(),
  offsetUtilisation: z.number().optional(),
  isInfeasible: z.boolean().default(false),
  infeasibilityReason: z.string().nullable().default(null),
  refixEvents: z.array(z.any()),
  timeline: z.array(z.any())
});

/**
 * @typedef {Object} ScenarioAssumptions
 * @property {number} [inflationRate]
 * @property {number} [ocrSpread]
 * @property {number} [uncertainty]
 * @property {number} [spreadShock]
 */
export const ScenarioAssumptionsSchema = z.object({
  inflationRate: z.number().optional(),
  ocrSpread: z.number().optional(),
  uncertainty: z.number().optional(),
  spreadShock: z.number().optional(),
}).catchall(z.any());

/**
 * @typedef {Object} RateScenario
 * @property {string} id
 * @property {string} countryCode
 * @property {string} name
 * @property {"policy-rate-derived"|"direct-product-rates"} mode
 * @property {number} probability
 * @property {number} forecastMonths
 * @property {RatePoint[]} policyRatePath
 * @property {Object<string, RatePoint[]>} productRatePaths
 * @property {ScenarioAssumptions} assumptions
 */
export const RateScenarioSchema = z.object({
  id: z.string(),
  countryCode: z.string().length(2),
  name: z.string(),
  mode: z.enum(["policy-rate-derived", "direct-product-rates"]),
  probability: z.number().min(0).max(1),
  forecastMonths: z.number().int().positive(),
  policyRatePath: z.array(RatePointSchema),
  productRatePaths: z.record(z.array(RatePointSchema)),
  assumptions: ScenarioAssumptionsSchema,
});

/**
 * @typedef {Object} SplitAllocation
 * @property {string} productCode
 * @property {number} percentage
 * @property {number} amount
 */
export const SplitAllocationSchema = z.object({
  productCode: z.string(),
  percentage: z.number().min(0).max(1),
  amount: z.number().nonnegative(),
});

/**
 * @typedef {Object} RefixRule
 * @property {"same-term"|"specified-sequence"|"move-to-floating"} type
 * @property {string[]} [sequence]
 */
export const RefixRuleSchema = z.object({
  type: z.enum(["same-term", "specified-sequence", "move-to-floating"]),
  sequence: z.array(z.string()).optional(),
});

/**
 * @typedef {Object} SplitStrategy
 * @property {string} id
 * @property {SplitAllocation[]} allocations
 * @property {RefixRule} refixRule
 */
export const SplitStrategySchema = z.object({
  id: z.string(),
  allocations: z.array(SplitAllocationSchema),
  refixRule: RefixRuleSchema,
});
