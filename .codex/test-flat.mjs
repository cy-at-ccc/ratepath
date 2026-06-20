import { generateSplitStrategies } from "../packages/strategy-generator/src/index.js";
import { nzProfile } from "../packages/country-adapters/src/nz.js";

const products = nzProfile.products.map((p) => ({ code: p.code, type: p.type }));

// New Lab constraints: percentageStep=0.10, maxSplits=3, maxFloating=1.0
const labConstraints = {
  maxSplits: 3,
  minPercentage: 0.1,
  percentageStep: 0.10,
  minTrancheAmount: 10000,
  maxFloatingPercentage: 1.0,
  mustKeepFloating: false
};

const strategies = generateSplitStrategies({
  totalAmount: 600000,
  allowedProducts: products,
  constraints: labConstraints,
  refixRule: { type: "same-term" }
});

console.log(`Lab strategies (new): ${strategies.length}`);
console.log(`Lab total sims: ${strategies.length} x 4 (quantile + expected) = ${strategies.length * 4}`);

// Sample 5 strategies to confirm shape
console.log("\nFirst 5 strategies:");
for (const s of strategies.slice(0, 5)) {
  console.log(`  ${s.id}: ${s.allocations.map(a => `${a.productCode}=${(a.percentage*100).toFixed(0)}%`).join(" + ")}`);
}
