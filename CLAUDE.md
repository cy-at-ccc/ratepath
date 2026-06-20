# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**RatePath** (根目录: `mortgage-strategy`) — a New Zealand mortgage strategy simulation web app. Users input their loan structure (tranches, repayment type, frequency), and the app simulates future cash flows under low/base/high interest-rate scenarios, generates candidate split strategies, runs the matrix through an amortisation engine, and ranks them with a multi-objective optimiser.

UI is in Simplified Chinese (zh-CN). Data defaults are sourced from RBNZ (NZ OCR as the policy rate).

> **Homepage & page visibility (2026-06-21).** The public homepage is the 6-question Easy Strategy wizard at `/lab`; the root route `/` is a thin client-side redirect to `/lab`. The Mortgage Dashboard, Mortgage Setup, and Strategy Lab are part of the planned PREMIUM tier — they are temporarily hidden from the navbar but the files are kept in the codebase with explicit `⚠️ PREMIUM-GATED PAGE — DO NOT DELETE ⚠️` banners. See [`apps/web/CLAUDE.md`](apps/web/CLAUDE.md) → "Hidden Premium Pages" for the full list, rationale, and re-enable instructions.

## Workspace Layout

Monorepo (npm workspaces) with no build pipeline — packages are consumed by source via path aliases.

```
apps/web/             Next.js 16.2.9 front-end (port 4321)
packages/schemas/     Zod schemas + JSDoc typedefs (single source of truth for domain types)
packages/country-adapters/  Per-market product config + beta sensitivities (only NZ implemented)
packages/rate-engine/       Policy-rate path builder + product-rate derivation + linear interpolation
packages/scenario-engine/   Generates Low/Base/High rate scenarios from controls
packages/strategy-generator/  Recursive grid allocator for candidate split strategies
packages/mortgage-engine/   Core: amortisation, refix logic, scheduled payment, extra-repayment waterfall
packages/simulation-engine/ Runs strategy×scenario matrix in a Web Worker
packages/optimiser/         Pareto-frontier ranking + weighted scoring + Chinese pros/cons
```

## Common Commands

```bash
# From repo root
npm test                  # vitest run (all packages, *.test.js files)
npm run test:watch        # vitest watch
npm run lint              # eslint .
npm run check             # tsc -p jsconfig.json --noEmit (type-check the whole monorepo)

# Web app (apps/web/)
npm run dev               # next dev on port 4321
npm run build             # next build
npm run start             # next start on port 4321
npm run lint              # eslint (uses apps/web/eslint.config.mjs)
```

Run a single test file: `npx vitest run packages/mortgage-engine/tests/amortisation.test.js`

## Architecture & Data Flow

End-to-end pipeline (Strategy Lab page drives it):

1. **Inputs** — `apps/web/app/strategy-lab/page.js` collects: sliders (`shortTermChange`, `mediumTermDirection`, `changeSpeed`, `uncertainty`), split constraints, preference weights, and the saved `Mortgage` from IndexedDB.
2. **Country adapter** — `nzProfile` and `nzBetas` from `@mortgage/country-adapters` define the product catalogue (floating + fixed-6m/1y/18m/2y/3y/5y) and policy-rate → product-rate sensitivity.
3. **Rate engine** (`packages/rate-engine/`)
   - `buildPolicyRatePath` constructs the OCR forecast (Month 0–12 power-curve transition, then linear trend; tunable via `changeSpeed`).
   - `deriveProductRatePaths` rolls each product's future rate using a Beta coefficient against the moving average of the policy rate over the product's term.
4. **Scenario engine** (`packages/scenario-engine/src/index.js`) — `generateScenarios` produces three `RateScenario`s (low/base/high) by applying a piecewise uncertainty multiplier (0% at m=0, 25% at m=3, 50% at m=6, 100% at m≥12) and a symmetric spread-shock offset.
5. **Strategy generator** (`packages/strategy-generator/src/index.js`) — `generateSplitStrategies` is a recursive grid allocator that enumerates allocations respecting `maxSplits`, `minPercentage`, `minTrancheAmount`, floating/fixed ratio caps, and dedupes by sorted productCode key.
6. **Simulation engine** (`packages/simulation-engine/src/index.js`) — `simulateStrategyScenarioMatrix` runs every (strategy, scenario) pair through `simulateMortgageTimeline`, yielding: totalInterest, max/min/avg payment, `maximumPaymentIncrease`, `paymentVolatility`, `maximumConcurrentRefixPercentage`, `floatingExposure`, `affordabilityBreaches`, and per-month timeline. Yields to the event loop every 10 simulations to stay cancellable.
7. **Optimiser** (`packages/optimiser/src/index.js`) — `optimizeStrategies` aggregates metrics via scenario probability, classifies Pareto-optimal strategies over 6 objectives (cost, worst-cost, worst-payment, refix concentration, affordability breaches, flexibility penalty), normalises & scores with sliders (`sliderCostStability`, `sliderFlexibility`) or explicit weights, and emits Chinese-language pros/cons.

### Mortgage-engine internals (`packages/mortgage-engine/src/`)

- `amortisation.js` — `simulateMortgageTimeline` is the heart: per-period loop that (a) refixes matured fixed tranches, (b) updates floating rates from path, (c) computes periodic interest + scheduled payment, (d) applies extra repayments (targeted by trancheId or general, distributed to floating-first then highest-rate via `sortTranchesForExtraRepayment`), (e) caps to avoid negative balance, (f) collapses to a monthly timeline.
- `refix.js` — `determineRefixProduct` (move-to-floating / same-term / specified-sequence), `getProductFixedMonths` (product catalogue lookup with a naming-convention fallback for `fixed-Ny` / `fixed-Nm`), `getRateForMonth` (linear interpolation with flat extrapolation).
- `utils.js` — `roundMoney`, `addDays`, `addMonths`.

### Schemas (`packages/schemas/src/index.js`)

Zod schemas exporting the canonical typedefs (`Mortgage`, `MortgageTranche`, `RateScenario`, `SplitStrategy`, etc.). Other packages type their inputs via `/** @typedef {import("@mortgage/schemas").X} X */`. Decimal rates throughout (e.g. `0.0525` for 5.25%). Dates are ISO `YYYY-MM-DD`.

## Key Conventions

- **Path aliases.** Two parallel systems: `jsconfig.json` maps `@mortgage/*` to `packages/*/src` for the type-checker, and `vitest.config.js` resolves the same aliases to absolute paths for tests. The web app's `next.config.mjs` is the default — Next.js resolves `@mortgage/*` through the root `jsconfig.json`.
- **No transpilation.** All packages are ESM JS (`"type": "module"`); JSDoc provides types, no `.d.ts` files. The `check` script type-checks via `tsc --noEmit` with `allowJs`/`checkJs`.
- **Worker boundary.** `apps/web/workers/simulation.worker.js` is the only place that calls `simulateStrategyScenarioMatrix`; the strategy-lab page posts `mortgage + strategies + scenarios + ...` to it and reads `{ type: "progress" | "success" | "error" }` messages back.
- **State persistence.** Mortgage / scenarios / constraints / saved results live in IndexedDB (`apps/web/features/storage.js`); custom market rates and the navbar collapse flag live in `localStorage`. The `mortgages` store currently has no `id` enforcement at the UI layer (any object pushed is read back as-is).
- **No semantic versioning of consumer expectations.** `@mortgage/*` deps are `*` and packages are consumed by direct file path; any breaking change in a package will silently break the web app until a type-check or runtime error surfaces it.
- **Next.js caveat.** `apps/web/AGENTS.md` warns the bundled Next.js has breaking changes vs. training data — always read `node_modules/next/dist/docs/` before writing Next-specific code.

## Testing

- Vitest 1.6, `environment: "node"`, globals on (`describe`/`it`/`expect` are global).
- Tests live in `tests/` next to `src/` in each package; matching pattern `**/*.test.js`.
- Schemas, rate/scenario/strategy/simulation/optimiser/adapters packages all have tests; the `Mortgage` engine has the most extensive coverage in `amortisation.test.js`.

## Things to watch for when modifying

- The `Mortgage` schema treats `remainingTermMonths` as the only term field on the mortgage; per-tranche term lives on each `MortgageTranche`. `simulateMortgageTimeline` reduces `tranche.originalRemainingTermMonths` by elapsed months, not the mortgage's term.
- `simulateMortgageTimeline` re-computes `scheduledPayment` on every refix and on every rate change for floating tranches — this is intentional (payment recalc tracks new rate/remaining term), but expensive at long horizons.
- The `targetMode === "payment"` branch in `amortisation.js` distributes general extra repayments up to `targetPeriodicPayment` — this is the only path that converts a `payment`-mode mortgage into actual overpayment.
- Extra-repayment frequency matching in the amortiser is currently MVP-stubbed (it assumes recurring extras match the mortgage's payment frequency rather than the extra's own `frequency` field).
