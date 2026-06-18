import { buildPolicyRatePath, deriveProductRatePaths } from "@mortgage/rate-engine";

/** @typedef {import("@mortgage/schemas").RateScenario} RateScenario */
/** @typedef {import("@mortgage/schemas").MortgageProductDefinition} MortgageProductDefinition */

const DETERMINISTIC_HORIZON_MONTHS = 36;
const DEFAULT_MONTE_CARLO_SAMPLE_COUNT = 12;

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
 * Normalises scenario probabilities to sum to 1.
 * @param {{ low?: number, base?: number, high?: number } | undefined} rawProbabilities
 * @returns {{ low: number, base: number, high: number }}
 */
function normaliseScenarioProbabilities(rawProbabilities) {
  const defaults = { low: 0.1, base: 0.8, high: 0.1 };
  const low = rawProbabilities?.low ?? defaults.low;
  const base = rawProbabilities?.base ?? defaults.base;
  const high = rawProbabilities?.high ?? defaults.high;

  if (low < 0 || base < 0 || high < 0) {
    throw new Error("Scenario probabilities must be non-negative.");
  }

  const total = low + base + high;
  if (total <= 0) {
    throw new Error("Scenario probabilities must sum to a positive value.");
  }

  return {
    low: low / total,
    base: base / total,
    high: high / total
  };
}

/**
 * @param {number} rate
 * @returns {number}
 */
function roundRate(rate) {
  return Math.max(0, Math.round(rate * 1e8) / 1e8);
}

/**
 * @param {string} text
 * @returns {number}
 */
function hashSeed(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h >>> 0);
}

/**
 * @param {string} seedText
 * @returns {() => number}
 */
function createRng(seedText) {
  let seed = hashSeed(seedText) || 1;
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * @param {Array<{month: number, rate: number}>} path
 * @param {number} fromMonth
 * @returns {number}
 */
function averageRate(path, fromMonth) {
  const points = path.filter((p) => p.month >= fromMonth);
  if (points.length === 0) return path[path.length - 1]?.rate || 0;
  return points.reduce((sum, p) => sum + p.rate, 0) / points.length;
}

/**
 * @param {Object} input
 * @param {Array<{month: number, rate: number}>} input.prefixPath
 * @param {number} input.forecastMonths
 * @param {number} input.cycleMonths
 * @param {number} input.reversalBias
 * @param {number} input.uncertainty
 * @param {string} input.seedText
 * @returns {Array<{month: number, rate: number}>}
 */
function buildLongTermMonteCarloPolicyPath({
  prefixPath,
  forecastMonths,
  cycleMonths,
  reversalBias,
  uncertainty,
  seedText
}) {
  if (forecastMonths <= DETERMINISTIC_HORIZON_MONTHS) {
    return prefixPath.map((p) => ({ ...p }));
  }

  const rng = createRng(seedText);
  const path = prefixPath.map((p) => ({ ...p }));
  const month12Rate = path[Math.min(12, path.length - 1)]?.rate ?? path[0]?.rate ?? 0;
  const month36Rate = path[Math.min(DETERMINISTIC_HORIZON_MONTHS, path.length - 1)]?.rate ?? month12Rate;
  const mediumTermDelta = month36Rate - month12Rate;
  const monthlyTrendStep = Math.max(0.00006, Math.abs(mediumTermDelta) / 24 * 0.75);
  const baseNoiseScale = Math.max(0.00012, uncertainty * 0.09);

  let currentRate = month36Rate;
  let initialPreferredDirection = mediumTermDelta > 0.00001 ? -1 : mediumTermDelta < -0.00001 ? 1 : (rng() < 0.5 ? -1 : 1);
  let cycleDirection = initialPreferredDirection;
  let cycleMagnitude = monthlyTrendStep;
  let cycleNoiseScale = baseNoiseScale;
  let cyclePhaseOffset = 0;

  for (let month = DETERMINISTIC_HORIZON_MONTHS + 1; month <= forecastMonths; month++) {
    const cycleIndex = Math.floor((month - (DETERMINISTIC_HORIZON_MONTHS + 1)) / cycleMonths);
    const monthInCycle = (month - (DETERMINISTIC_HORIZON_MONTHS + 1)) % cycleMonths;

    if (monthInCycle === 0) {
      const preferredDirection = cycleIndex % 2 === 0 ? initialPreferredDirection : -initialPreferredDirection;
      cycleDirection = rng() < reversalBias ? preferredDirection : -preferredDirection;
      cycleMagnitude = monthlyTrendStep * (0.8 + rng() * 0.6);
      cycleNoiseScale = baseNoiseScale * (0.75 + rng() * 0.75);
      cyclePhaseOffset = rng() * Math.PI * 2;
    }

    const phase = monthInCycle / Math.max(1, cycleMonths - 1);
    const directionalDrift = cycleDirection * cycleMagnitude * (0.7 + 0.3 * Math.cos(Math.PI * phase));
    const oscillation = Math.sin(phase * Math.PI * 2 + cyclePhaseOffset) * cycleMagnitude * 0.18;
    const meanReversion = (month36Rate - currentRate) * 0.018;
    const noise = (rng() - 0.5) * 2 * cycleNoiseScale;

    currentRate = roundRate(currentRate + directionalDrift + oscillation + meanReversion + noise);
    path[month] = { month, rate: currentRate };
  }

  return path;
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
 * @param {{ low?: number, base?: number, high?: number }} [input.controls.scenarioProbabilities] - Scenario probability weights
 * @param {number} [input.controls.longTermCycleYears] - Post-36-month dominant swing cycle length in years
 * @param {number} [input.controls.longTermReversalBias] - Probability that the next long-term cycle reverses the 13-36m trend
 * @param {number} [input.controls.monteCarloSampleCount] - Number of Monte Carlo samples per scenario family
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
  const scenarioProbabilities = normaliseScenarioProbabilities(controls?.scenarioProbabilities);
  const longTermCycleMonths = Math.max(12, (controls?.longTermCycleYears ?? 2) * 12);
  const longTermReversalBias = Math.min(0.95, Math.max(0.5, controls?.longTermReversalBias ?? 0.7));
  const monteCarloSampleCount = Math.max(3, Math.round(controls?.monteCarloSampleCount ?? DEFAULT_MONTE_CARLO_SAMPLE_COUNT));

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

  const baseSpecs = [
    { id: "low", name: "Low Rate Scenario", probability: scenarioProbabilities.low, policyRatePath: lowPolicyPath, spreadShock: spreadShockVal - 0.0025 },
    { id: "base", name: "Base Rate Scenario", probability: scenarioProbabilities.base, policyRatePath: basePolicyPath, spreadShock: spreadShockVal },
    { id: "high", name: "High Rate Scenario", probability: scenarioProbabilities.high, policyRatePath: highPolicyPath, spreadShock: spreadShockVal + 0.005 }
  ];

  /** @type {RateScenario[]} */
  const scenarios = [];

  if (forecastMonths <= DETERMINISTIC_HORIZON_MONTHS) {
    baseSpecs.forEach((spec) => {
      const productRatePaths = deriveProductRatePaths({
        policyRatePath: spec.policyRatePath,
        currentProductRates,
        betas,
        products,
        forecastMonths,
        spreadShock: spec.spreadShock
      });

      scenarios.push({
        id: spec.id,
        countryCode: "NZ",
        name: spec.name,
        mode: "policy-rate-derived",
        probability: spec.probability,
        forecastMonths,
        policyRatePath: spec.policyRatePath,
        productRatePaths,
        assumptions: /** @type {any} */ ({
          uncertainty,
          spreadShock: spec.spreadShock,
          scenarioFamily: spec.id,
          deterministicHorizonMonths: DETERMINISTIC_HORIZON_MONTHS,
          isMonteCarloTail: false
        })
      });
    });
  } else {
    baseSpecs.forEach((spec) => {
      for (let sampleIndex = 0; sampleIndex < monteCarloSampleCount; sampleIndex++) {
        const scenarioId = `${spec.id}-mc-${String(sampleIndex + 1).padStart(2, "0")}`;
        const policyRatePath = buildLongTermMonteCarloPolicyPath({
          prefixPath: spec.policyRatePath,
          forecastMonths,
          cycleMonths: longTermCycleMonths,
          reversalBias: longTermReversalBias,
          uncertainty,
          seedText: `${scenarioId}-${forecastMonths}-${longTermCycleMonths}-${longTermReversalBias}`
        });
        const productRatePaths = deriveProductRatePaths({
          policyRatePath,
          currentProductRates,
          betas,
          products,
          forecastMonths,
          spreadShock: spec.spreadShock
        });

        scenarios.push({
          id: scenarioId,
          countryCode: "NZ",
          name: `${spec.name} Monte Carlo ${sampleIndex + 1}`,
          mode: "policy-rate-derived",
          probability: spec.probability / monteCarloSampleCount,
          forecastMonths,
          policyRatePath,
          productRatePaths,
          assumptions: /** @type {any} */ ({
            uncertainty,
            spreadShock: spec.spreadShock,
            scenarioFamily: spec.id,
            deterministicHorizonMonths: DETERMINISTIC_HORIZON_MONTHS,
            isMonteCarloTail: true,
            monteCarloSampleIndex: sampleIndex,
            longTermCycleMonths,
            longTermReversalBias,
            post36AverageRate: averageRate(policyRatePath, DETERMINISTIC_HORIZON_MONTHS + 1),
            finalPolicyRate: policyRatePath[policyRatePath.length - 1]?.rate ?? 0
          })
        });
      }
    });
  }

  scenarios.forEach(validateScenario);

  return scenarios;
}
