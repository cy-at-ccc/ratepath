import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

/**
 * Vitest config for the `apps/web` app. Mirrors the root config's
 * `@mortgage/*` aliases (so app tests can import engine packages) and
 * adds the intra-app `@/*` alias defined in `apps/web/jsconfig.json`.
 *
 * Environment: jsdom (the app uses React + DOM APIs; the engine
 * packages do their own node-environment testing under the root config).
 *
 * Run from `apps/web`:
 *   npx vitest run --config vitest.config.js
 * or via the `test:app` npm script.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    include: [
      "lib/**/*.test.{js,jsx}",
      "components/**/*.test.{js,jsx}"
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      "@mortgage/mortgage-engine": path.resolve(repoRoot, "./packages/mortgage-engine/src/amortisation.js"),
      "@mortgage/rate-engine": path.resolve(repoRoot, "./packages/rate-engine/src"),
      "@mortgage/scenario-engine": path.resolve(repoRoot, "./packages/scenario-engine/src"),
      "@mortgage/strategy-generator": path.resolve(repoRoot, "./packages/strategy-generator/src"),
      "@mortgage/simulation-engine": path.resolve(repoRoot, "./packages/simulation-engine/src"),
      "@mortgage/optimiser": path.resolve(repoRoot, "./packages/optimiser/src"),
      "@mortgage/country-adapters": path.resolve(repoRoot, "./packages/country-adapters/src"),
      "@mortgage/schemas": path.resolve(repoRoot, "./packages/schemas/src"),
      "@mortgage/shared-utils": path.resolve(repoRoot, "./packages/shared-utils/src"),
    },
  },
});
