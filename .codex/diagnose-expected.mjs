// Reproduce the bug: at month 0, all quantile paths equal initialRate = 2.25%.
// The buggy formula computes expected = sum(p * rate) = 0.1*2.25 + 0.5*2.25 + 0.1*2.25 = 1.575
// (because total probability = 0.7, not 1.0).
// The expected at month 0 should equal 2.25%, not 1.575%.

const initialRate = 0.0225;
const quantileScenarios = [
  { id: "p10", probability: 0.1, policyRatePath: [{month:0, rate: initialRate}, {month:1, rate: 0.02}] },
  { id: "p50", probability: 0.5, policyRatePath: [{month:0, rate: initialRate}, {month:1, rate: 0.025}] },
  { id: "p90", probability: 0.1, policyRatePath: [{month:0, rate: initialRate}, {month:1, rate: 0.03}] }
];

const buggyExpected = quantileScenarios.map((sc) =>
  quantileScenarios.reduce((sum, s) => sum + (s.probability || 0) * (s.policyRatePath[sc === quantileScenarios[0] ? 0 : 1]?.rate || 0), 0)
);

const totalWeight = quantileScenarios.reduce((sum, s) => sum + (s.probability || 0), 0);
const fixedExpected = quantileScenarios[0].policyRatePath.map((_, idx) =>
  quantileScenarios.reduce((sum, s) => sum + (s.probability || 0) * (s.policyRatePath[idx]?.rate || 0), 0) / totalWeight
);

console.log("Total weight:", totalWeight, "(should be 1.0 for proper expected value)");
console.log();
console.log("Month 0:");
console.log("  P10/P50/P90: 2.25% (all quantiles start at initialRate)");
console.log("  Buggy expected (current code):  ", (buggyExpected[0] * 100).toFixed(3) + "%");
console.log("  Fixed expected (normalize):     ", (fixedExpected[0] * 100).toFixed(3) + "%");
console.log();
console.log("Month 1:");
console.log("  P10=2.00%, P50=2.50%, P90=3.00%");
console.log("  Buggy expected:  ", (buggyExpected[1] * 100).toFixed(3) + "%", " ← but missing the 30% mass!");
console.log("  Fixed expected:  ", (fixedExpected[1] * 100).toFixed(3) + "%", " ← correct expected over the 70% mass");
