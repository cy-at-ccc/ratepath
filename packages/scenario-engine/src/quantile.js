// @ts-check
/**
 * Quantile aggregation for Monte Carlo scenario pools.
 *
 * `buildQuantileScenarios` takes the raw 3N scenarios emitted by
 * `generateScenarios({ ..., monteCarloSampleCount: N })` and reduces them to
 * K quantile scenarios (one per requested quantile). Each output scenario has
 * the same shape as the input (`RateScenario`) so the simulation engine can
 * consume it without any extra wiring.
 *
 * The aggregation runs per month across all input scenarios: for each month
 * m, we sort the N rates, then take the q-th quantile via linear
 * interpolation (R type-7). This yields one deterministic policy rate path
 * per quantile.
 */

import { deriveProductRatePaths } from "@mortgage/rate-engine";

/**
 * Linear-interpolation quantile of an ascending-sorted array (R type-7).
 *
 * @param {number[]} sortedAsc - ascending-sorted numeric array
 * @param {number} q - quantile in [0, 1]
 * @returns {number}
 */
function quantileOfSorted(sortedAsc, q) {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  if (n === 1) return sortedAsc[0];
  const h = q * (n - 1);
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] * (1 - (h - lo)) + sortedAsc[hi] * (h - lo);
}

/**
 * Map a quantile to a short stable scenario id used by the worker and chart
 * legend. Canonical values 0.1 / 0.5 / 0.9 map to "p10" / "p50" / "p90".
 * Non-canonical quantiles fall back to "q<value>".
 *
 * @param {number} q
 * @returns {string}
 */
function quantileToFamilyId(q) {
  if (q === 0.1) return "p10";
  if (q === 0.5) return "p50";
  if (q === 0.9) return "p90";
  return `q${q}`;
}

/**
 * Aggregate a Monte Carlo pool into K quantile scenarios.
 *
 * The output scenarios are tagged `assumptions.scenarioFamily ∈ {"p10","p50","p90"}`
 * so the worker progress display can resolve them via `describeScenario`,
 * and so the Strategy Lab chart can render them as 3 solid lines + a band.
 *
 * Probability weights reflect the tail-mass interpretation:
 * - P50 = 50% central mass
 * - P10/P90 = 10% tails each
 * - Total = 70%; the remaining 30% is implicit in the smoothing
 *   of the quantile algorithm itself.
 *
 * @param {import("@mortgage/schemas").RateScenario[]} mcScenarios
 * @param {number[]} quantiles - e.g. [0.1, 0.5, 0.9]
 * @param {Object} derivedParams
 * @param {number} derivedParams.forecastMonths
 * @param {Record<string, number>} derivedParams.currentProductRates
 * @param {Record<string, number>} derivedParams.betas
 * @param {import("@mortgage/schemas").MortgageProductDefinition[]} derivedParams.products
 * @returns {import("@mortgage/schemas").RateScenario[]}
 */
export function buildQuantileScenarios(mcScenarios, quantiles, derivedParams) {
  if (!Array.isArray(mcScenarios) || mcScenarios.length === 0) return [];
  if (!Array.isArray(quantiles) || quantiles.length === 0) return [];

  const { forecastMonths, currentProductRates, betas, products } = derivedParams;
  if (typeof forecastMonths !== "number" || forecastMonths < 0) {
    throw new Error("buildQuantileScenarios: forecastMonths must be a non-negative number");
  }

  // Bucket rates by month for O(N × M) per-month quantile lookup.
  /** @type {number[][]} */
  const monthBuckets = [];
  for (let m = 0; m <= forecastMonths; m++) {
    /** @type {number[]} */
    const bucket = [];
    for (const s of mcScenarios) {
      const point = s?.policyRatePath?.[m];
      if (point && Number.isFinite(point.rate)) {
        bucket.push(point.rate);
      }
    }
    bucket.sort((a, b) => a - b);
    monthBuckets.push(bucket);
  }

  /** @type {import("@mortgage/schemas").RateScenario[]} */
  const out = [];
  for (const q of quantiles) {
    const familyId = quantileToFamilyId(q);

    // Quantile policy rate path.
    const policyPath = monthBuckets.map((bucket, m) => ({
      month: m,
      rate: quantileOfSorted(bucket, q)
    }));

    // Re-derive product paths from the quantile path using the rate engine.
    // quantile scenarios carry no spread shock — they are family-neutral
    // statistical aggregates.
    const productRatePaths = deriveProductRatePaths({
      policyRatePath: policyPath,
      currentProductRates,
      betas,
      products,
      forecastMonths,
      spreadShock: 0
    });

    out.push({
      id: familyId,
      countryCode: "NZ",
      name: familyId.toUpperCase(),
      mode: "policy-rate-derived",
      probability: familyId === "p50" ? 0.5 : 0.1,
      forecastMonths,
      policyRatePath: policyPath,
      productRatePaths,
      assumptions: /** @type {any} */ ({
        scenarioFamily: familyId,
        deterministicHorizonMonths: 36,
        stochasticStartMonth: 37,
        isMonteCarloTail: true,
        isQuantileScenario: true,
        quantile: q,
        sourceMonteCarloSampleCount: mcScenarios.length
      })
    });
  }
  return out;
}

export { quantileOfSorted };
