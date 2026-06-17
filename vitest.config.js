import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.js"],
  },
  resolve: {
    alias: {
      "@mortgage/mortgage-engine": path.resolve(__dirname, "./packages/mortgage-engine/src/amortisation.js"),
      "@mortgage/rate-engine": path.resolve(__dirname, "./packages/rate-engine/src"),
      "@mortgage/scenario-engine": path.resolve(__dirname, "./packages/scenario-engine/src"),
      "@mortgage/strategy-generator": path.resolve(__dirname, "./packages/strategy-generator/src"),
      "@mortgage/simulation-engine": path.resolve(__dirname, "./packages/simulation-engine/src"),
      "@mortgage/optimiser": path.resolve(__dirname, "./packages/optimiser/src"),
      "@mortgage/country-adapters": path.resolve(__dirname, "./packages/country-adapters/src"),
      "@mortgage/schemas": path.resolve(__dirname, "./packages/schemas/src"),
      "@mortgage/shared-utils": path.resolve(__dirname, "./packages/shared-utils/src"),
    },
  },
});
