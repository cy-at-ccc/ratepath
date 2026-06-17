# Scheme Two — Technical Debt & Follow-Ups

**Version:** 1.0
**Date:** 2026-06-18
**Source scheme:** `mortgage-strategy` "方案二" 7 阶段开发
**Plan file:** `.claude/plans/tile-declarative-thompson.md`
**Algorithm spec:** `docs/algorithms/scheme-two-correctness-spec.md`

This document records every deliberate, agreed deferral made during the Scheme 2 implementation. Each entry follows the same shape:

- **What** — the concrete deferred item
- **Where** — file paths, line numbers, and the code currently in place
- **Why** — why we deferred it (impact, risk, scope, or budget)
- **Risk** — what could go wrong because of the deferral
- **Trigger** — the event that should cause this to be revisited
- **Action** — concrete remediation steps when triggered
- **Owner** — who is best placed to do the work (algorithm / code / UI / review)

---

## Summary Table

| ID | Priority | Item | Trigger |
| - | - | - | - |
| TD-001 | LOW | `@ts-nocheck` in 2 test files | Next algorithm module addition or test-coverage drop below 80% |
| TD-002 | LOW | `breakFeeSchedule` arithmetic stub in amortisation | First UI exposure of "refinance now" |
| TD-003 | MEDIUM | `floatingExposure` not actually reduced by linked offset in `simulation-engine/index.js` | First real user uses offset and complains interest is wrong |
| TD-004 | LOW | Hard-coded `same-term` refix rule in page | User requests "move to floating" or "specified sequence" |
| TD-005 | MEDIUM | Optimiser still computes Pareto from full `rankedStrategies` (not split by mode in dominance test) | First regression where payment-mode and term-mode strategies are mixed |
| TD-006 | LOW | Pre-existing page.js strict-mode issues in components other than strategy-lab | Move to TypeScript or accept the debt |
| TD-007 | LOW | `getRateForMonth` is duplicated in `mortgage-engine/refix.js` and `rate-engine/interpolation.js` | Next time the rate engine is touched |
| TD-008 | LOW | `apps/web/app/api/ocr/route.js` missing `fetchedAt` on payload | First OCR auto-update incident |
| TD-009 | LOW | `ratepath_saved_simulation` localStorage cleanup orphan | Next localStorage audit |
| TD-010 | LOW | Several `console.log` in `apps/web/features/storage.js` (4 lines) | Next storage refactor |

---

## TD-001 — `@ts-nocheck` in two test files

**What.** `packages/optimiser/tests/optimiser.test.js` and `packages/simulation-engine/tests/simulation.test.js` start with `// @ts-nocheck`. TypeScript's `checkJs` mode is therefore not enforcing JSDoc type annotations on these two test files. The other 6 test files in the repo do not have this pragma and remain strictly checked.

**Where.**
- `/Users/chrisyang/Documents/ratepath/packages/optimiser/tests/optimiser.test.js` line 1
- `/Users/chrisyang/Documents/ratepath/packages/simulation-engine/tests/simulation.test.js` line 1

**Why.** The 12 remaining `npm run check` errors were all in test files (8 implicit-any in `reduce`/`filter` callbacks, 2 "not callable" in optimiser test fixture, 2 implicit-any in async test wrapper). Two earlier files (`amortisation.test.js` and `schemas.test.js`) had already been suppressed the same way; extending the pattern keeps a consistent treatment. Per-file proper JSDoc annotation would have taken ~30–60 minutes and produced 12 churny line changes; user explicitly preferred to ship the product and document the deferral.

**Risk.** **None for app functionality.** The test files are not part of the production bundle. The 8/6 vitest assertions in each file still verify the financial behaviour at runtime. The risk is **developer experience**: a future engineer who adds a new test that calls `simulateStrategyScenario` with a malformed `Mortgage` will not be warned by `checkJs` that the call is type-incorrect. The Zod schema inside `simulateStrategyScenario` will throw at test runtime, so the test will fail loudly, but the failure message will be the engine's `ZodError` rather than a clear "you passed a string where Mortgage was expected" — a worse debugging experience.

**Trigger.** Any one of:
- A new algorithm package is added (e.g. `packages/normalisation-engine/` from spec section 16.2 deferred list). At that point re-evaluate whether keeping 2 / 8 test files untyped is acceptable.
- Test coverage of the algorithms drops below 80% (so runtime coverage cannot be relied upon to catch type errors).
- A real-world bug is reported that, in retrospect, would have been caught by `checkJs` on one of these two test files.

**Action.** When triggered, the work is:
1. Remove `// @ts-nocheck` from both files.
2. Run `npm run check` and inspect the new errors.
3. For each error, add the JSDoc annotation that tsc wants. The most common pattern is `(/** @type {number} */ interest, /** @type {number} */ worstInterest, ...)` on test fixture lambdas, and an explicit `/** @type {ReturnType<typeof simulateStrategyScenario>} */ result` on test result locals.
4. The "not callable" error in `optimiser.test.js` line 270-271 is a known deeper issue. Root-cause it before adding the JSDoc; if `buildResults` is being inferred as `never`, the function expression in line 247 has a return-type collision. Fix the function expression (likely by removing the parenthesised array literal in the return position: `=> [{ ... }]` instead of `=> ([{ ... }])`).

**Owner.** Code-implementer agent. Estimated time: 30–60 minutes.

---

## TD-002 — `breakFeeSchedule` arithmetic stub in amortisation

**What.** `packages/mortgage-engine/src/amortisation.js` line 366-380 contains a conditional block that computes a break fee when `userInitiatedBreak === true`. The block:

- Reads `breakFeeSchedule` from `scenario.assumptions` (it should arguably be on the country adapter, not on scenario assumptions — see spec section 4.5).
- Calls `calculateBreakFee(...)` (a helper imported elsewhere in the file).
- Adds the fee to `periodInterest` if the user broke the term early.

The function is currently dead code: no caller in the codebase ever sets `userInitiatedBreak: true`. The `nz.js` adapter declares `breakFeeSchedule: {}` (empty). Therefore the block is exercised by tests but never reached at runtime.

**Where.** `packages/mortgage-engine/src/amortisation.js` lines 365-380.

**Why.** Spec section 3.4 explicitly says "this iteration has no UI for break-fee". Adding the dead branch is forward-compatibility scaffolding so that the next iteration's UI does not require an engine change. The TypeScript fix-up (the JSDoc cast on `scenario.assumptions.breakFeeSchedule`) preserves the contract; the runtime path is unreachable by design.

**Risk.** Low. The branch is gated on `userInitiatedBreak`, which is never set. If a future engineer flips the flag without thinking, the engine will compute a fee using an empty schedule and add zero to the interest, which is correct by accident. If a future engineer populates `breakFeeSchedule` in the NZ adapter without first wiring the UI, the engine will silently start computing break fees on every "scheduled refix" — wait, no, on every "early refix" — and the user will be charged without their consent. **This is a real footgun.**

**Trigger.** The first time the "refinance now" UI control is added to the strategy-lab page.

**Action.** When triggered, the work is:
1. Add an explicit `userInitiatedBreak` boolean to the `MortgageTranche` schema (spec 4.5) — currently it is passed as a function argument to `simulateMortgageTimeline`, not stored.
2. Wire the UI control to set this flag.
3. Add a regression test that asserts the break fee is added to the first period after the break.
4. Add a test that asserts the break fee is **not** added on a normal scheduled refix.
5. Move `breakFeeSchedule` from `scenario.assumptions` (where the implementer put it) to the country adapter (where the spec says it belongs). The amortiser should receive it as a parameter, not read it from the scenario.

**Owner.** Algorithm-architect for the data-model decision, then code-implementer. Estimated time: 2-3 days.

---

## TD-003 — `floatingExposure` not actually reduced by linked offset in `simulation-engine/index.js`

**What.** The `floatingExposure` metric on the simulation result is computed as a static sum of allocation amounts whose product type is `floating | offset | revolving`. It does **not** account for the fact that the `linkedOffsetBalance` reduces the **interest-bearing balance** of a floating tranche. A user with a 100% floating mortgage and a $200,000 offset balance will have `floatingExposure = 1.0` even though only $300,000 of their $500,000 loan is interest-bearing. This biases the optimiser's `flexibilityPenalty` upward, making offset-heavy strategies look less flexible than they are.

**Where.** `packages/simulation-engine/src/index.js` line 125-130 (computation of `floatingExposure`) and `packages/optimiser/src/index.js` line 209-211 (the `1 - expectedFloatingExposure` penalty).

**Why.** The Offset (P0-A) implementation makes the **interest** correct (interest accrues on `effectiveBalance = max(0, balance - linkedOffset)`) but does not change the **metric** that the optimiser uses to judge "flexibility". Correcting the metric is non-trivial because `floatingExposure` is per-strategy, while offset balance is per-tranche and time-varying. Spec section 8 defines `offsetUtilisation` (average across active periods of `linkedOffsetBalance / max(tranche.balance, 1)`) but the optimiser does not consume it.

**Risk.** Medium. The financial outputs (interest, payment, balance) are correct after the P0-A fix. The optimisation output is biased against strategies that pair a floating tranche with offset. The user will see a worse recommendation than they should. They will not know.

**Trigger.** The first time a real user with a real offset complains "why is the floating-with-offset strategy not recommended?" — or, preferably, the first time the new `offsetUtilisation` metric is wired into a Pareto objective.

**Action.** When triggered:
1. Add `offsetUtilisation` to the `SimulationResult` schema and to the amortisation's return value (the field already exists on the schema; verify it is populated by the engine).
2. Add a sixth Pareto objective in term mode: `(1 - expectedFloatingExposure) * (1 - expectedOffsetUtilisation)` — i.e. reward both higher floating share **and** higher offset utilisation.
3. Add a regression test that asserts: a 100% floating + $200k offset strategy ranks higher than the same strategy without the offset, all other things equal.

**Owner.** Code-implementer. Estimated time: 0.5-1 day.

---

## TD-004 — Hard-coded `same-term` refix rule in strategy-lab page

**What.** The strategy-lab page's "开始仿真模拟" handler hard-codes `refixRule: { type: "same-term" }` regardless of the user's preference. The `move-to-floating` and `specified-sequence` refix types are defined in the schema and the amortisation engine supports them, but the UI never offers the user a way to choose.

**Where.** `apps/web/app/strategy-lab/page.js` near the `handleStartSimulation` function (the `refixRule: { type: "same-term" }` argument to `generateSplitStrategies`).

**Why.** The `RefixRuleSchema` is part of the spec, and the `SplitStrategy` carries the rule. The user can express a refix preference in principle, but the UI does not. This is a UI gap, not an engine gap.

**Risk.** Low for financial correctness (the engine is correct under "same-term"), medium for user experience (users with a specific refix strategy in mind cannot model it).

**Trigger.** The first time a real user asks "can I model 'move to floating after the 1-year term matures'?"

**Action.** When triggered:
1. Add a refix-rule selector to the strategy-lab page (3 options: same-term, move-to-floating, specified-sequence).
2. If "specified-sequence" is chosen, add a UI to enter the sequence of product codes.
3. Pass the chosen `RefixRule` to `generateSplitStrategies` and to the worker.

**Owner.** UI-designer. Estimated time: 1-2 days.

---

## TD-005 — Optimiser mixes term-mode and payment-mode strategies in dominance test

**What.** The `optimiser.test.js` Golden 30 test (term-mode dominance) and Golden 31 test (payment-mode dominance) are present, but the production code path is: the page calls `optimizeStrategies` with `mode = "term"` (hard-coded), regardless of `mortgage.targetMode`. A user who sets `targetMode: "payment"` will get a term-mode Pareto ranking applied to their payment-mode mortgage, which is semantically wrong.

**Where.**
- `apps/web/app/strategy-lab/page.js` — the call to `optimizeStrategies` (line ~191) does not pass `mode` based on `mortgage.targetMode`.
- `packages/optimiser/src/index.js` — `optimizeStrategies` accepts `mode` as a parameter with default `"term"`.

**Why.** The page does not yet surface a payment-mode toggle to the user. The mortgage schema supports `targetMode: "payment"`, but no UI control changes it. Therefore no real user can currently trigger the bug. The fix is small (one-line read of `mortgage.targetMode`) but the UI work to make payment mode useful is out of scope for the correctness-first pass.

**Risk.** Low. The current behaviour is term-mode for all users, which is the conservative default.

**Trigger.** Phase 5 (UI redesign), when the "固定付款模式" control is added to the strategy-lab page.

**Action.** When triggered:
1. In the strategy-lab page, compute `mode = mortgage?.targetMode === "payment" ? "payment" : "term"` and pass it to `optimizeStrategies`.
2. Confirm the Golden 31 test exercises the new code path.

**Owner.** Code-implementer + UI-designer. Estimated time: 0.5 day.

---

## TD-006 — Pre-existing page.js strict-mode issues in non-strategy-lab components

**What.** Pre-existing `npm run check` errors in:
- `apps/web/app/page.js` (8 errors, mostly `localStorage` not in globals)
- `apps/web/app/mortgage-setup/page.js` (1 error)
- `apps/web/app/api/ocr/route.js` (1 error: `fetchedAt` missing on payload)
- `apps/web/features/marketRates.js` (1 error: `fetch` not in globals)
- `apps/web/workers/simulation.worker.js` (3 errors: `crypto`, `TextEncoder`)

**Where.** See above.

**Why.** These errors existed in HEAD before the Scheme 2 implementation began (verified by `git stash` and re-running `checkJs`: baseline 18 errors). The project has not yet defined browser globals (`window`, `document`, `localStorage`, `fetch`, `crypto`, `TextEncoder`, `Response`, `AbortSignal`) in `eslint.config.js`. Adding them is a one-line config change.

**Risk.** None. The errors are spurious — the code runs correctly in the browser because Next.js provides the globals.

**Trigger.** The next time `npm run check` is run in CI, where a clean output is desired.

**Action.** When triggered:
1. Add the browser globals to `eslint.config.js` (file at the repo root):
   ```js
   globals: {
     // ... existing ...
     window: "readonly",
     document: "readonly",
     localStorage: "readonly",
     fetch: "readonly",
     crypto: "readonly",
     TextEncoder: "readonly",
     TextDecoder: "readonly",
     Response: "readonly",
     AbortSignal: "readonly",
     Worker: "readonly",
     // ... etc.
   }
   ```
2. For the `route.js` error, add `fetchedAt: new Date().toISOString()` to the OCR payload (or make `fetchedAt` optional in the schema).
3. Re-run `npm run check`. Expected: 0 errors.

**Owner.** Code-implementer. Estimated time: 15 minutes.

---

## TD-007 — `getRateForMonth` duplicated in two packages

**What.** `packages/mortgage-engine/src/refix.js:67-105` and `packages/rate-engine/src/interpolation.js:25-71` both export a `getRateForMonth` function with slightly different signatures. The mortgage-engine one is linear-interpolation-with-flat-extrapolation; the rate-engine one is `getRateFromPath`. The duplication is a maintenance hazard.

**Where.** As above.

**Why.** Out of scope for the correctness-first pass. The duplication does not cause incorrect results; both functions are tested independently.

**Risk.** Low for correctness; medium for maintenance (a future change to interpolation semantics must be made in two places).

**Trigger.** The next time the rate engine is touched for any reason.

**Action.** When triggered:
1. Promote `getRateFromPath` (or the mortgage-engine `getRateForMonth`) to `packages/rate-engine/src/interpolation.js` as the canonical implementation.
2. Re-export from `packages/mortgage-engine/src/refix.js` for backwards compatibility.
3. Update the mortgage-engine call site to import from `@mortgage/rate-engine`.
4. Add a cross-package test that asserts the two old functions produced the same outputs on the same inputs.

**Owner.** Code-implementer. Estimated time: 0.5 day.

---

## TD-008 — OCR auto-update payload missing `fetchedAt`

**What.** `apps/web/app/api/ocr/route.js` constructs a `MarketCacheEntry` without a `fetchedAt` field. The Zod schema (`MarketCacheEntrySchema`) requires it. The route currently relies on a permissive validation path; the error is reported as TS2741.

**Where.** `apps/web/app/api/ocr/route.js` line 91.

**Why.** Pre-existing. The route was written before the `MarketCacheEntrySchema` was tightened to require `fetchedAt`.

**Risk.** Low — the route's caller (the page) does not currently use the auto-update path. The error only surfaces under static type analysis.

**Trigger.** The first time the OCR auto-update path is exercised in production.

**Action.** When triggered:
1. Add `fetchedAt: new Date().toISOString()` to the payload.
2. Re-run `npm run check`.

**Owner.** Code-implementer. Estimated time: 5 minutes.

---

## TD-009 — `ratepath_saved_simulation` localStorage key cleanup

**What.** `apps/web/app/strategy-lab/page.js` line 123 calls `localStorage.removeItem("ratepath_saved_simulation")` on mount. The reason: the implementation moved the saved-simulation storage from localStorage to IndexedDB. The localStorage key is no longer set, but old browsers may have it from a previous deployment. The `removeItem` call is defensive cleanup.

**Where.** `apps/web/app/strategy-lab/page.js` line 123.

**Why.** Forward-compatible migration. The key is currently harmless (no-op if absent).

**Risk.** None. If the key is absent, `removeItem` is a no-op. If the key is present, it is removed.

**Trigger.** After one full release cycle (so all old users have visited the new page at least once), this cleanup can be removed.

**Action.** When triggered:
1. Remove line 123 from `apps/web/app/strategy-lab/page.js`.
2. Re-run `npm test` and `npm run build`.

**Owner.** Code-implementer. Estimated time: 1 minute.

---

## TD-010 — `console.log` left in `apps/web/features/storage.js`

**What.** Four `console.log` statements remain in `storage.js`:
- Line 21: `"[IndexedDB] Opening database:"`
- Line 27: `"[IndexedDB] Error opening database:"`
- Line 32: `"[IndexedDB] Database opened successfully"`
- Line 36: `"[IndexedDB] Database upgrade needed"`

**Where.** `apps/web/features/storage.js` lines 21, 27, 32, 36.

**Why.** Pre-existing. Added during early development for debugging; never cleaned up.

**Risk.** None. The logs are in development/debugging style and do not leak sensitive data, but they are noise in production.

**Trigger.** The next time the storage layer is refactored.

**Action.** When triggered:
1. Replace the four `console.log` calls with calls to a `logger.debug(...)` helper gated by `process.env.NODE_ENV === "development"`.
2. Re-run `npm test`.

**Owner.** Code-implementer. Estimated time: 5 minutes.

---

## How this list is reviewed

This document is part of the Scheme 2 deliverable. It is reviewed:

- Before each new scheme begins (to decide which of these to fix in the new scheme).
- Whenever a new algorithm is added (TD-001, TD-003).
- Whenever a new UI control is added (TD-002, TD-004, TD-005).
- Whenever the rate engine is touched (TD-007).
- Before any production deploy (TD-008, TD-009, TD-010).

The list is **not** a backlog of bugs. It is a list of deliberate, agreed deferrals with concrete remediation plans.

---

**End of follow-ups document.**
