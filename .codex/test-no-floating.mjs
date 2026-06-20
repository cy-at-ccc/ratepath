import { generateSplitStrategies } from "../packages/strategy-generator/src/index.js";
import { nzProfile } from "../packages/country-adapters/src/nz.js";

const products = nzProfile.products.map((p) => ({ code: p.code, type: p.type }));

// New lab constraints with maxFloatingPercentage = 0
const labConstraints = {
  maxSplits: 3,
  minPercentage: 0.1,
  percentageStep: 0.10,
  minTrancheAmount: 10000,
  maxFloatingPercentage: 0,
  mustKeepFloating: false
};

const strategies = generateSplitStrategies({
  totalAmount: 600000,
  allowedProducts: products,
  constraints: labConstraints,
  refixRule: { type: "same-term" }
});

console.log(`Lab strategies (maxFloating=0): ${strategies.length}`);
console.log(`Lab total sims: ${strategies.length} x 4 (P10/P50/P90 + expected) = ${strategies.length * 4}`);
console.log();

// Distribution by split count
const byCount = {};
for (const s of strategies) {
  const c = s.allocations.length;
  byCount[c] = (byCount[c] || 0) + 1;
}
console.log("Strategies by split count:");
for (const [k, v] of Object.entries(byCount).sort()) {
  console.log(`  ${k}-split: ${v}`);
}
console.log();

// Verify no floating in any strategy
const withFloating = strategies.filter(s => s.allocations.some(a => a.productCode === "floating"));
console.log(`Strategies containing "floating": ${withFloating.length} (should be 0)`);
console.log();

// Sample 5 strategies
console.log("First 5 strategies:");
for (const s of strategies.slice(0, 5)) {
  console.log(`  ${s.id}: ${s.allocations.map(a => `${a.productCode}=${(a.percentage*100).toFixed(0)}%`).join(" + ")}`);
}
