import { buildPolicyRatePath, deriveProductRatePaths } from "@mortgage/rate-engine";

/** @typedef {import("@mortgage/schemas").RateScenario} RateScenario */
/** @typedef {import("@mortgage/schemas").MortgageProductDefinition} MortgageProductDefinition */

/**
 * Continuous uncertainty shock curve multiplier:
 * Month 0: 0%
 * Month 3: 25%
 * Month 6: 50%
 * Month 12+: 100%
 * @param {number} month - Month index
 * @returns {number} Uncertainty multiplier factor (0 to 1)
 */
function getUncertaintyFactor(month) {
  if (month <= 0) {
    return 0;
  }
  if (month <= 3) {
    return 0.25 * (month / 3);
  }
  if (month <= 6) {
    return 0.25 + 0.25 * ((month - 3) / 3);
  }
  if (month <= 12) {
    return 0.50 + 0.50 * ((month - 6) / 6);
  }
  return 1.0;
}

/**
 * Validates a Scenario object against domain constraints.
 * @param {RateScenario} scenario - Scenario to validate
 */
export function validateScenario(scenario) {
  if (scenario.probability < 0 || scenario.probability > 1) {
    throw new Error(`Invalid probability for scenario ${scenario.id}: ${scenario.probability}`);
  }
  if (!Array.isArray(scenario.policyRatePath) || scenario.policyRatePath.length === 0) {
    throw new Error(`Policy rate path is empty or invalid for scenario ${scenario.id}`);
  }

  scenario.policyRatePath.forEach(p => {
    if (isNaN(p.rate) || !isFinite(p.rate)) {
      throw new Error(`Invalid rate value ${p.rate} in policy path at month ${p.month}`);
    }
  });

  Object.keys(scenario.productRatePaths).forEach(code => {
    const path = scenario.productRatePaths[code];
    if (path.length !== scenario.forecastMonths + 1) {
      throw new Error(`Incomplete product path for ${code} in scenario ${scenario.id}`);
    }
    path.forEach(p => {
      if (isNaN(p.rate) || !isFinite(p.rate)) {
        throw new Error(`Invalid rate value ${p.rate} in product ${code} path at month ${p.month}`);
      }
    });
  });
}

/**
 * Generates Low, Base, and High rate scenarios based on central policy rate and user slider controls.
 * @param {Object} input
 * @param {number} input.initialRate - Current policy rate (e.g. 0.055)
 * @param {Record<string, number>} input.currentProductRates - Current product rates (e.g. { "fixed-1y": 0.05 })
 * @param {Record<string, number>} input.betas - Product Beta sensitivities
 * @param {MortgageProductDefinition[]} input.products - Product configs from country adapter
 * @param {number} input.forecastMonths - Forecast horizon in months
 * @param {Object} [input.controls] - User UI controls
 * @param {number} [input.controls.shortTermChange] - Rate change over 12 months
 * @param {number} [input.controls.mediumTermDirection] - Slope of rate path after 12 months
 * @param {number} [input.controls.changeSpeed] - Speed of path transition (0 to 1)
 * @param {number} [input.controls.uncertainty] - Max uncertainty shock value (default 0.01)
 * @param {number} [input.controls.spreadShock] - Base spread shock value
 * @returns {RateScenario[]} Array of three validated RateScenario objects (low, base, high)
 */
export function generateScenarios({
  initialRate,
  currentProductRates,
  betas,
  products,
  forecastMonths,
  controls
}) {
  const uncertainty = controls?.uncertainty ?? 0.01;
  const spreadShockVal = controls?.spreadShock ?? 0;

  // 1. Generate Base Policy path (all months)
  const basePolicyPath = buildPolicyRatePath({
    initialRate,
    controls: {
      shortTermChange: controls?.shortTermChange,
      mediumTermDirection: controls?.mediumTermDirection,
      changeSpeed: controls?.changeSpeed
    },
    nodes: Array.from({ length: forecastMonths + 1 }, (_, i) => i)
  });

  // 2. Generate Low and High Policy paths by applying the uncertainty curve
  /** @type {Array<{month: number, rate: number}>} */
  const lowPolicyPath = [];
  /** @type {Array<{month: number, rate: number}>} */
  const highPolicyPath = [];

  basePolicyPath.forEach(point => {
    const m = point.month;
    const factor = getUncertaintyFactor(m);
    const shock = uncertainty * factor;

    lowPolicyPath.push({
      month: m,
      rate: Math.max(0, Math.round((point.rate - shock) * 1e8) / 1e8)
    });

    highPolicyPath.push({
      month: m,
      rate: Math.max(0, Math.round((point.rate + shock) * 1e8) / 1e8)
    });
  });

  // 3. Derive product rate paths for each scenario
  // Base scenario uses base spreadShock
  const baseProductPaths = deriveProductRatePaths({
    policyRatePath: basePolicyPath,
    currentProductRates,
    betas,
    products,
    forecastMonths,
    spreadShock: spreadShockVal
  });

  // Low scenario assumes spread compression (e.g. spreadShock - 0.0025)
  const lowProductPaths = deriveProductRatePaths({
    policyRatePath: lowPolicyPath,
    currentProductRates,
    betas,
    products,
    forecastMonths,
    spreadShock: spreadShockVal - 0.0025
  });

  // High scenario assumes spread expansion (e.g. spreadShock + 0.005)
  const highProductPaths = deriveProductRatePaths({
    policyRatePath: highPolicyPath,
    currentProductRates,
    betas,
    products,
    forecastMonths,
    spreadShock: spreadShockVal + 0.005
  });

  // 4. Construct final RateScenarios
  /** @type {RateScenario[]} */
  const scenarios = [
    {
      id: "low",
      countryCode: "NZ",
      name: "Low Rate Scenario",
      mode: "policy-rate-derived",
      probability: 0.2,
      forecastMonths,
      policyRatePath: lowPolicyPath,
      productRatePaths: lowProductPaths,
      assumptions: { uncertainty, spreadShock: spreadShockVal - 0.0025 }
    },
    {
      id: "base",
      countryCode: "NZ",
      name: "Base Rate Scenario",
      mode: "policy-rate-derived",
      probability: 0.6,
      forecastMonths,
      policyRatePath: basePolicyPath,
      productRatePaths: baseProductPaths,
      assumptions: { uncertainty, spreadShock: spreadShockVal }
    },
    {
      id: "high",
      countryCode: "NZ",
      name: "High Rate Scenario",
      mode: "policy-rate-derived",
      probability: 0.2,
      forecastMonths,
      policyRatePath: highPolicyPath,
      productRatePaths: highProductPaths,
      assumptions: { uncertainty, spreadShock: spreadShockVal + 0.005 }
    }
  ];

  // Perform validation checks on all generated scenarios
  scenarios.forEach(validateScenario);

  return scenarios;
}
