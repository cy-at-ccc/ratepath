import { generateSplitStrategies } from "../packages/strategy-generator/src/index.js";
import { nzProfile } from "../packages/country-adapters/src/nz.js";

const products = nzProfile.products.map((p) => ({ code: p.code, type: p.type }));
const totalAmount = 600000;

const labStrategies = generateSplitStrategies({
  totalAmount,
  allowedProducts: products,
  constraints: {
    maxSplits: 3,
    minPercentage: 0.1,
    percentageStep: 0.05,
    minTrancheAmount: 10000,
    maxFloatingPercentage: 1.0,
    mustKeepFloating: false
  },
  refixRule: { type: "same-term" }
});

const slDefault = generateSplitStrategies({
  totalAmount,
  allowedProducts: products,
  constraints: {
    maxSplits: 3,
    minPercentage: 0.1,
    percentageStep: 0.10,
    minTrancheAmount: 10000,
    maxFloatingPercentage: 0.10
  },
  refixRule: { type: "same-term" }
});

const slDiversification = generateSplitStrategies({
  totalAmount,
  allowedProducts: products,
  constraints: {
    maxSplits: 4,
    minPercentage: 0.1,
    percentageStep: 0.05,
    minTrancheAmount: 10000,
    maxFloatingPercentage: 0.30
  },
  refixRule: { type: "same-term" }
});

const slMax = generateSplitStrategies({
  totalAmount,
  allowedProducts: products,
  constraints: {
    maxSplits: 5,
    minPercentage: 0.1,
    percentageStep: 0.05,
    minTrancheAmount: 10000,
    maxFloatingPercentage: 0.50
  },
  refixRule: { type: "same-term" }
});

const labScenarios = 3;
const slScenarios = 4;

console.log(`Lab strategies: ${labStrategies.length}`);
console.log(`Lab total sims: ${labStrategies.length} x ${labScenarios} = ${labStrategies.length * labScenarios}`);
console.log();
console.log(`Strategy-Lab (default) strategies: ${slDefault.length}`);
console.log(`Strategy-Lab (default) total sims: ${slDefault.length} x ${slScenarios} = ${slDefault.length * slScenarios}`);
console.log();
console.log(`Strategy-Lab (diversification) strategies: ${slDiversification.length}`);
console.log(`Strategy-Lab (diversification) total sims: ${slDiversification.length} x ${slScenarios} = ${slDiversification.length * slScenarios}`);
console.log();
console.log(`Strategy-Lab (max) strategies: ${slMax.length}`);
console.log(`Strategy-Lab (max) total sims: ${slMax.length} x ${slScenarios} = ${slMax.length * slScenarios}`);
