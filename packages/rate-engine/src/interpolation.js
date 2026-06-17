/**
 * Linearly interpolates between two coordinates (x0, y0) and (x1, y1) at a target x.
 * @param {number} x0 - Start x
 * @param {number} y0 - Start y
 * @param {number} x1 - End x
 * @param {number} y1 - End y
 * @param {number} x - Target x
 * @returns {number} Interpolated y value
 */
export function interpolateLinear(x0, y0, x1, y1, x) {
  if (x1 === x0) {
    return y0;
  }
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}

/**
 * Resolves the interest rate for a target month from a path of rate points.
 * Supports linear, step, and flat interpolation, with flat boundary extrapolation.
 * @param {Array<{month: number, rate: number}>} path - Array of RatePoints
 * @param {number} month - Target month
 * @param {"flat"|"linear"|"step"} [mode="linear"] - Interpolation mode
 * @returns {number} Evaluated interest rate, rounded to 8 decimal places
 */
export function getRateFromPath(path, month, mode = "linear") {
  if (!path || path.length === 0) {
    return 0;
  }

  const sorted = [...path].sort((a, b) => a.month - b.month);

  if (mode === "flat") {
    return sorted[0].rate;
  }

  // Check exact match
  const exact = sorted.find(p => p.month === month);
  if (exact !== undefined) {
    return exact.rate;
  }

  // Extrapolate below range (flat)
  if (month <= sorted[0].month) {
    return sorted[0].rate;
  }

  // Extrapolate above range (flat)
  if (month >= sorted[sorted.length - 1].month) {
    return sorted[sorted.length - 1].rate;
  }

  // Find lower and upper bounds inside the range
  let lower = sorted[0];
  let upper = sorted[sorted.length - 1];

  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].month <= month && sorted[i + 1].month > month) {
      lower = sorted[i];
      upper = sorted[i + 1];
      break;
    }
  }

  if (mode === "step") {
    return lower.rate;
  }

  // Default: linear interpolation
  const interpolated = interpolateLinear(lower.month, lower.rate, upper.month, upper.rate, month);
  return Math.round(interpolated * 1e8) / 1e8;
}
