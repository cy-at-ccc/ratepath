/**
 * Builds a deterministic policy rate path (e.g., OCR forecast) over time.
 * @param {Object} input
 * @param {number} input.initialRate - The policy rate value at Month 0 (decimal, e.g., 0.055)
 * @param {Object} input.controls - User controls from UI sliders
 * @param {number} [input.controls.shortTermChange] - Expected change in next 12 months (-0.02 to +0.02)
 * @param {number} [input.controls.mediumTermDirection] - Direction after 12 months (-1 to +1)
 * @param {number} [input.controls.changeSpeed] - Speed of transition (0 to 1, default 0.5)
 * @param {number} [input.controls.mediumTermEndMonth] - Last month where medium-term trend applies (default 36)
 * @param {number[]} [input.nodes] - Month nodes to evaluate (default [0, 3, 6, 12, 18, 24, 36, 60])
 * @returns {Array<{month: number, rate: number}>} Evaluated policy rate path
 */
export function buildPolicyRatePath({
  initialRate,
  controls,
  nodes = [0, 3, 6, 12, 18, 24, 36, 60]
}) {
  const shortTermChange = controls?.shortTermChange ?? 0;
  const mediumTermDirection = controls?.mediumTermDirection ?? 0;
  const changeSpeed = controls?.changeSpeed ?? 0.5;
  const mediumTermEndMonth = Math.max(12, controls?.mediumTermEndMonth ?? 36);
  /** @type {Array<{month: number, rate: number}>} */
  const path = [];

  nodes.forEach(month => {
    let rate = initialRate;

    if (month <= 12) {
      if (month === 0) {
        rate = initialRate;
      } else {
        const fraction = month / 12;
        // Adjust transition curve based on speed:
        // speed = 0.5 yields linear interpolation (power = 1.0)
        // speed = 1.0 yields instant initial change (power -> 0)
        // speed = 0.0 yields slow delayed change (power = 2.0)
        const power = Math.max(0.1, 2.0 - 2.0 * changeSpeed);
        const factor = Math.pow(fraction, power);
        rate = initialRate + shortTermChange * factor;
      }
    } else {
      const rateAtMonth12 = initialRate + shortTermChange;
      const cappedMonth = Math.min(month, mediumTermEndMonth);
      const yearsAfter12 = (cappedMonth - 12) / 12;
      // 1 unit of direction represents a 0.5% (0.005) policy rate change per year
      const annualTrend = mediumTermDirection * 0.005;
      rate = rateAtMonth12 + annualTrend * yearsAfter12;
    }

    // Ensure rate is not negative and rounded cleanly
    const finalRate = Math.max(0, Math.round(rate * 1e8) / 1e8);
    path.push({ month, rate: finalRate });
  });

  return path;
}
