---
name: ratepath-v9-plan
description: RatePath v9 implementation details — 3 new Pareto objectives + worstCaseDefense composite + 4-card recommendations
metadata:
  type: project
---

Implemented the v9 plan from `mortgage-algorithm-architect-agent-app-dazzling-tower.md`. Net result: 113/113 vitest pass, eslint clean, tsc only emits pre-existing errors in `StrategyDetailModal.js` (the file has `@ts-nocheck` but tsc still scans arrow-function callbacks without `/** @type {any} */` annotations).

**Key changes:**
- `packages/optimiser/src/index.js`: added `expectedRefixEventCount: 1` tolerance to both term & payment maps; extended `getTermObjectives` to 12 keys (added 3 new + kept the 2 worst-case ones that were already present); extended `getPaymentObjectives` to 9 keys (added 3 net new); added 3 new bounds (`worstCaseInterest`, `worstCaseBreaches`, `refixEventCount`); added `wWorstCaseDefense` weight reader; added `worstCaseCompositeScore` helper (0.5/0.3/0.2 weighting); collapsed 10 recommendation slots down to 4.
- `packages/optimiser/tests/optimiser.test.js`: added the 3 new keys to all 9 main-fixture rows + 8 auxiliary fixtures; added 6 new v9 tests in a `Plan v9` describe block.
- `apps/web/app/strategy-lab/page.js`: `DEFAULT_WEIGHTS` expanded 7→8 keys (added `worstCaseDefense: 19`, rebalanced others); `handleWeightChange` hard cap 100→25; `percentageStep` default 0.10→0.05; 3 places (`isConstraintsModified`, `handleResetConstraints`, `PRESET_PROFILES.default`) aligned to new defaults; IndexedDB legacy-weights merge with DEFAULT_WEIGHTS; added `recWorstCaseDefense` state; deleted 6 obsolete recommendation cards (lowestWorstCaseCost / lowestWorstCasePayment / lowestRefixConcentration / lowestBudgetBreaches / lowestVolatility / lowestEndingBalance / mostFloating); added new `worstCaseDefense` card; added 3 Pareto table columns (worstCaseInterest, worstCaseAffordabilityBreaches, expectedRefixEventCount); added `buildStrategyIntro` helper that emits 4-section Chinese intro (whyThisOne / tradeOff / suitableFor / comparison); wired `intro` prop into `<StrategyDetailModal>`.
- `apps/web/components/PreferenceWeightsModal.js`: slider `max` 100→25; added aria-live hint region showing "已分配 X% (Y/8 维度); 剩余 Z 维度权重为 0".
- `apps/web/components/StrategyDetailModal.js`: accepts new `intro` prop; renders 4-section `.sdm-intro` block (whyThisOne / tradeOff 12-axis marks / suitableFor tags / comparison deltas); styled-jsx CSS for `.sdm-intro`, `.sdm-intro-section`, `.sdm-intro-title`, `.sdm-intro-body`, `.sdm-intro-list`, `.sdm-intro-row`, `.sdm-intro-status-{top,mid,bottom}`, `.sdm-intro-tags`, `.sdm-intro-tag`, `.sdm-intro-diff`.

**Why:** Plan v9 fixes 4 v6 problems — (A) single-product benchmarks showing up in `lowestCost` etc. (now fixed by `recommendationMinAllocationCount` filtering all 4 cards, plus 25% hard cap forcing 4 dimensions to remain active), (B) `worstCaseInterest` / `worstCaseAffordabilityBreaches` / `expectedRefixEventCount` not first-class Pareto axes (now first-class with `expectedRefixEventCount: 1` tolerance), (C) `percentageStep=0.10` pruning 33-33-33 / 40-30-30 candidates (now 0.05), (D) `isConstraintsModified` and `handleResetConstraints` calling out of sync with `useState` defaults.

**How to apply:** When the user adds another dimension to `DEFAULT_WEIGHTS`, the PreferenceWeightsModal's aria-live hint count is hardcoded as `TOTAL_KEYS = 8` — update both the page's DEFAULT_WEIGHTS and this hardcoded count in lockstep. The optimiser's `getTermObjectives` now contains duplicate keys (12 entries with 2 dups) — this is a deliberate consequence of the plan listing 3 keys to add when 2 already existed. If asked to "remove duplicates", be aware that the dominance check tolerates duplicates fine but the test `expect(objectives.length).toBe(12)` is what enforces the count.

---

## v10 review-fix session (2026-06-19)

Implemented all v10 review findings. Pre-existing C1/C2/C3/C4 in the review spec were already in place from prior v10 work; the actual delta was H1 (JSDoc), H2 (tighten assertion), H3 (new fallback test), M1 (full-width punctuation), M2 (separator).

**Key changes:**
- `packages/optimiser/src/index.js`: added small-pool-fallback contract JSDoc to `pickMin` (lines ~736) and `pickExcluding` (lines ~749) — explains why the fallback re-picks an already-excluded strategy when the filtered pool is empty.
- `packages/optimiser/tests/optimiser.test.js`: tightened T1 assertion `>= 3` → `>= 4` distinct (fixture has 4 candidates A/B/C/D); added new test "v10: small-pool fallback returns global min when filtering empties" — single-row fixture asserting all 4 cards return `"only"`. Optimiser test count: 34 → 35.
- `apps/web/app/strategy-lab/page.js`: line 3196 tooltip `;` → `；` (full-width); line 3017 worstCaseDefense parenthetical separators `/` → `、`.

**Why:** Per the v10 review spec — tighten the test that pins the 4-card distinct-pick invariant, document the small-pool fallback so it isn't mistaken for a bug, normalize Chinese typography across the UI.

**How to apply:** When adding more pickers (5th, 6th cards in some future v11), each new `pickExcluding*` should reference the small-pool-fallback contract on `pickMin`. The "≥ 4 distinct" T1 assertion may need to be relaxed (back to ≥3) if the 5th card is added and it is allowed to re-pick when the pool is exhausted.

**Verification:** Optimiser 35/35 pass. Per-package run (1+35+13+8+18+7+4+35 = 121 tests) all green. `npm run lint` clean. `npm run check` only emits pre-existing errors in `StrategyDetailModal.js` (file has `@ts-nocheck` but tsc still scans arrow callbacks without annotations — same caveat as v9).

**Caveat for future sessions:** `npm test` at the repo root fails all 8 packages with `Cannot read properties of undefined (reading 'config')` — see [[feedback-vitest-root-run]]. Always run per-package.