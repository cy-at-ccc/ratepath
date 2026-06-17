# Algorithm Spec — Scheme 2: Correctness First

**Version:** 1.0
**Date:** 2026-06-17
**Source:** `mortgage-algorithm-architect` (read-only audit)
**Target codebase:** `/Users/chrisyang/Documents/ratepath/`
**Status:** Approved for implementation by `mortgage-code-implementer`

The following is a self-contained algorithm specification produced by `mortgage-algorithm-architect` in read-only mode. Implementer agents should be able to follow it without re-reading the codebase.

---

## 0. Scope and Order of Operations

This spec addresses seven concrete issues in order of priority:

| # | Issue | Priority | Files affected |
| - | ----- | -------- | -------------- |
| P0-A | Offset product is declared but never applied | P0 | `nz.js`, `amortisation.js`, `schemas/index.js`, `simulation-engine` |
| P0-B | `targetMode: "payment"` is a quasi-overpayment, not a payment policy | P0 | `amortisation.js`, `schemas/index.js` |
| P1-A | Extra-repayment scheduling is mocked (frequency field ignored) | P1 | `amortisation.js`, `schemas/index.js` |
| P1-B | Refix vs early-exit; no break-fee model; no look-ahead guard | P1 | `amortisation.js`, `refix.js`, `schemas/index.js` |
| P1-C | Strategy generator enumerates without pruning; can explode at 5 splits | P1 | `strategy-generator/src/index.js` |
| P1-D | Sliders trigger a full re-simulation; no cache invalidation key | P1 | `apps/web/app/strategy-lab/page.js`, `simulation-engine` |
| P1-E | `optimiser` already produces `recommendations` and Chinese pros/cons; the page ignores them and re-implements the logic | P1 | `apps/web/app/strategy-lab/page.js`, `optimiser/src/index.js` |
| P2 | Two distinct Pareto objective sets for term-mode vs payment-mode | P2 | `optimiser/src/index.js` |

Mobile is out of scope. Golden fixtures cover Web only. We are not introducing TypeScript, a traditional database, or any deferred algorithm (Monte Carlo, Vasicek/CIR, GA/PSO/NSGA-II, dynamic refix, multi-worker pool, continuous fixed term).

---

## 1. Problem Statement (precise restatement)

The user has invoked **Scheme 2: priority is correctness, then structure/perf, then UI**. The audit must:

1. Identify exactly what the code does today, citing file paths and line numbers.
2. Classify each issue as P0/P1/P2.
3. Specify the corrected business semantics in plain language.
4. Specify the data-model changes (Zod schema additions / modifications).
5. Specify the algorithm and exact formulas.
6. Specify the per-month event order inside the amortisation loop.
7. Specify the multi-tranche payment allocation rule.
8. Specify the offset formula.
9. Specify the extra-repayment schedule rule.
10. Distinguish scheduled refix from early-exit refix and forbid look-ahead.
11. Specify safe pruning rules for the strategy generator (with pruning correctness proofs).
12. Specify the two-mode Pareto objectives and dominance tolerances.
13. Specify the ranking and Chinese pros/cons pipeline.
14. Specify the cache dependency keys for simulation vs ranking.
15. Provide acceptance tests and 30+ golden cases.
16. List the files that will be touched and what is explicitly deferred.

---

## 2. Current Behaviour (audit findings, with citations)

### 2.1 P0-A — Offset is declared but never applied

- `packages/country-adapters/src/nz.js:16` declares the `floating` product with `supportsOffset: true`. There is no separate offset product in the catalogue.
- `packages/schemas/src/index.js:36-43` defines `MortgageProductDefinition.supportsOffset: boolean` and the product-type enum includes `"offset"`, but the NZ catalogue never exposes a product of `type: "offset"`.
- `packages/mortgage-engine/src/amortisation.js:124-478` runs a per-period loop in which interest is computed on `tranche.balance` (line 264: `const interest = roundMoney(tranche.balance * periodicRate);`) with no consideration of any linked offset cash. There is no field for `linkedOffsetBalance` on either `MortgageTranche` or `Mortgage`.
- `packages/optimiser/src/index.js:127-147` builds a `floatingExposure` objective based on `strategy.allocations` matching `prodDef.type in ["floating","offset","revolving"]` (`simulation-engine/src/index.js:125-130`) — that is the only place "offset" appears, and only as a label, never as a behavioural input.

**Net effect:** the user is told that the floating tranche can be offset, but the offset cash is silently ignored by the engine. The user receives no interest saving from offsetting.

### 2.2 P0-B — `targetMode: "payment"` is a quasi-overpayment, not a payment policy

- `packages/schemas/src/index.js:136-149` defines `MortgageSchema` with `targetMode: "term" | "payment"`. There is no `paymentPolicy` field.
- `packages/mortgage-engine/src/amortisation.js:311-324` implements the only branch that consults `targetMode === "payment"`. It computes the difference between `min(targetPeriodicPayment, currentTrancheTotalObligation)` and the sum of `scheduled + targeted extras`, and **adds the positive difference to `generalExtraAmount`**.
- That means the mortgage is not paying a fixed amount per period; it is paying the schedule and then dumping any spare budget into an extra. If the budget target is small, the loan does not pay it. If the budget is larger than the schedule, the difference is overpayment, not the policy.
- The test `packages/mortgage-engine/tests/amortisation.test.js:201-221` codifies this as "should maintain target periodic payment when targetMode is payment" by asserting that `scheduledPayment + extraRepayment ≈ 3000`, but it does not test the `mandatory > target` or `target < monthly interest` cases.

**Net effect:** "fixed payment" is conflated with "max overpayment". There is no support for `exact / maximum / minimum` payment policies, no notion of infeasibility, and no notion of negative-amortisation (i.e. the case where target is below monthly interest).

### 2.3 P1-A — Extra repayment frequency is mocked

- `packages/mortgage-engine/src/amortisation.js:286-307` carries the comment `// Simple mock extra repayment retrieval for MVP. In full implementation, extra repayments are filtered by date and tranche id`. The code applies `extra.amount` on every period between `startDate` and `endDate`, ignoring the `frequency` field entirely.
- The test `packages/mortgage-engine/tests/amortisation.test.js:168-199` only exercises a single monthly recurring extra — the "frequency" field is set to `"monthly"` and the mortgage is also monthly, so the stub behaves correctly by accident.

**Net effect:** a weekly extra on a monthly mortgage is applied 52 times per year (should be applied 52 times only in a weekly-frequency mortgage; in a monthly mortgage it should be applied 4-5 times, depending on calendar). A one-off dated extra is applied every period after `startDate` instead of only on the matching date. Targeted extras that span date boundaries are not filtered by `currentDate`.

### 2.4 P1-B — Refix vs early-exit; no break-fee model; no look-ahead guard

- `packages/mortgage-engine/src/refix.js:11-30` `determineRefixProduct` returns the next product code based on the rule type. It does not distinguish "scheduled refix" (term matured naturally) from "early refix" (user broke the term). All refixes are treated as scheduled.
- `packages/mortgage-engine/src/amortisation.js:191-224` only triggers a refix when `currentDate >= tranche.fixedUntil`. There is no API for breaking a fixed term early, and no break-fee formula. There is no `BreakFee` line item in the simulation result.
- The simulation result `rawResult.refixEvents` carries `prevProduct, newProduct, prevRate, newRate, balance` but not the type of event.
- The optimiser (`packages/optimiser/src/index.js:127-147`) does not look at any future rate path to make decisions: it aggregates already-computed scenarios. That is fine. The risk is in any future "dynamic refix" implementation — the spec must forbid it from reading `policyRatePath[>currentMonth]`.
- `packages/optimiser/src/index.js:74-76` does peek at `run.scenarioId === "base"` to capture `baseCaseInterest`. This is selection-by-id, not a look-ahead bias, but the spec must formalise that a strategy-level metric is allowed to read `scenarioId`, while a per-tranche decision inside `amortisation.js` is **not** allowed to read any rate beyond `monthIndex`.

**Net effect:** there is no break-fee modelling, so the user cannot compare "refix now and pay a break fee" vs "wait and refix naturally". The default `same-term` refix rule is hard-coded in `apps/web/app/strategy-lab/page.js:378` and there is no way to opt into "move to floating" or "specified sequence" through the UI.

### 2.5 P1-C — Strategy generator has no pruning

- `packages/strategy-generator/src/index.js:47-145` recurses with no early-exit. For each remaining percentage it tries every grid step from 0 to `stepCount`. It only validates at the leaf (`remaining === 0`).
- The result is `O(products^stepCount)` leaf calls. With the current NZ catalogue of 7 products and `percentageStep=0.1` it is fine. With `percentageStep=0.05` (5% grid) and `maxSplits=5`, the leaf count is large.
- The current code cannot prune the obvious dead-end: e.g. if `floatingPct > maxFloatingPercentage` after assigning 0.4 to a floating tranche, all continuations are infeasible, but the code still recurses.
- The only de-duplication is the `strategyKeys` set at the leaf (`index.js:101-108`). It does not memoize subtrees that have been exhausted.

**Net effect:** the strategy count can explode (or stall the worker) at finer grids or larger catalogues.

### 2.6 P1-D — No cache invalidation key

- `apps/web/app/strategy-lab/page.js:189-217` regenerates `scenarios` on any slider change. That is correct.
- `apps/web/app/strategy-lab/page.js:354-444` (`handleStartSimulation`) regenerates `strategies` and posts the whole matrix to the worker on a button click. That is correct.
- `apps/web/app/strategy-lab/page.js:220-352` runs `optimizeStrategies` inside a `useEffect` keyed on `[weights, simResults]`. That is also correct: weights do not re-simulate.
- However, **the same effect re-computes the entire Chinese pros/cons for every rec card on every weights change** (page.js:234-316) instead of consuming `opt.recommendations`. Worse, the page duplicates the bounds calculation already done in `optimiser.js:157-170`.
- There is no stable hash for `(mortgage, constraints, scenarios, marketRates, forecastMonths, startDate)` that can be used to skip an already-computed matrix. Every click of "开始仿真模拟" re-runs everything.
- The IndexedDB `savedResults` store at `apps/web/app/strategy-lab/page.js:408-425` saves the last result with a fixed `id: "last_simulation"`, so reloading the page overwrites any historical result.

**Net effect:** every UI interaction re-runs the worker; the worker's previous results are discarded unless the user is on the page. The optimiser outputs `recommendations` are computed and thrown away.

### 2.7 P1-E — `optimiser` `recommendations` are ignored

- `packages/optimiser/src/index.js:284-309` returns `recommendations: { preference, lowestCost, mostStable }` with Chinese pros/cons already generated.
- `apps/web/app/strategy-lab/page.js:303-352` (and again 318-328) recomputes `getStrategyExplanations` and `buildRecObject` from scratch, using the same code that the optimiser already has. The page then sets `recPreference`, `recLowestCost`, `recMostStable` from its own computation, never from `opt.recommendations`.

**Net effect:** the optimiser's outputs are computed and dropped; the page re-implements them with `pros.push("...")` and `cons.push("...")`. The strings are currently identical, so behaviour is the same, but the duplication means a future change to one location will silently diverge from the other.

### 2.8 P2 — Single Pareto objective set for both modes

- `packages/optimiser/src/index.js:120-126` defines six objectives that do not depend on `mortgage.targetMode`:
  1. `expectedInterest` (min)
  2. `worstCaseInterest` (min)
  3. `worstCasePayment` (min)
  4. `expectedMaxConcurrentRefixPercentage` (min)
  5. `expectedAffordabilityBreaches` (min)
  6. `flexibilityPenalty = 1 - expectedFloatingExposure` (min)
- The `expectedEndingBalance` is tracked in aggregation but only used by the page in the comparison cards (`strategy-lab/page.js:484-502`). It is **not** an objective in the optimiser.

**Net effect:** in payment-mode, `endingBalance` is the most important output (the user is asking "at this payment level, how much will I still owe?"), and the optimiser does not consider it. The `affordabilityBreaches` is folded into the Pareto set even when the user has set `maxAffordablePayment = 0` (no constraint), and is missing entirely when `targetMode === "payment"`.

---

## 3. Required Business Semantics (after the fix)

### 3.1 Offset (P0-A)

- A **floating** tranche with `supportsOffset: true` may be linked to a single cash account. The cash account is represented as `linkedOffsetBalance` on the tranche state. The offset account itself is **not** a separate tranche and never amortises.
- `effectiveBalance = max(0, tranche.balance - linkedOffsetBalance)`.
- Interest accrues on `effectiveBalance`. Principal does not change due to offset.
- The offset cash changes only at date events: one-off top-up, recurring contribution (e.g. salary credit), one-off withdrawal, or a payoff event.
- If the offset cash is paid into the tranche as an extra repayment, it is an **extra repayment** (per the schedule), not a magical "auto-offset" — the extra repayment event reduces `tranche.balance`, and the offset cash event reduces `linkedOffsetBalance` by the same amount in the same period. The engine must keep them consistent.
- An offset product is exposed as a normal `floating` tranche; the offset account is a property of that tranche, not a separate row in the catalogue. (We do not introduce a `type: "offset"` product in this iteration — the catalogue is unchanged; only the engine's behaviour is.)

### 3.2 Payment policy (P0-B)

- Replace the single `targetMode: "term" | "payment"` with two orthogonal fields: `targetMode` and `paymentPolicy`.
- `paymentPolicy: "exact" | "maximum" | "minimum"`.
  - **exact**: every period's total debit equals `targetPeriodicPayment`. If mandatory interest exceeds `targetPeriodicPayment` for any period, the strategy is marked **infeasible** at the simulation level (hard constraint).
  - **maximum**: every period's total debit ≤ `targetPeriodicPayment`. If mandatory interest exceeds `targetPeriodicPayment` for any period, the strategy is infeasible.
  - **minimum**: every period's total debit ≥ `targetPeriodicPayment`. The difference is treated as a general extra repayment.
- For `paymentPolicy: "exact"` and `"maximum"`, negative amortisation is forbidden: if the natural schedule would result in `balance + interest > totalPayment` causing the balance to grow, the strategy is infeasible.
- `targetMode: "term"` keeps the existing schedule-based behaviour.
- We **do not** implement the "do not under any circumstance back-solve an equivalent remaining term" rule: every period is simulated. The `targetPeriodicPayment` is a hard cap or floor on per-period cash out.

### 3.3 Extra repayments (P1-A)

- The `ExtraRepayment.frequency` field is honoured.
- A `recurring` extra with `frequency: "weekly"` triggers on every ISO week boundary within `[startDate, endDate]`. In a `monthly` mortgage, a weekly extra contributes `amount * (weeks_in_period)` to the period's extra pool; in a `weekly` mortgage, it contributes `amount` per period that contains a trigger date.
- A `one-off` extra triggers on the single date that matches the start date; the engine scans all periods for that date. If no period in the simulation window contains it, the extra is dropped (no warning — it is silently inactive, matching the current behaviour of date-filters).
- A targeted extra applies only to the named `targetTrancheId`. A general extra (no `targetTrancheId`) is allocated by the same water-fall: floating-first, then highest rate. If the targeted tranche is an interest-only or already-paid-off tranche, the extra is dropped for that period.
- The start/end dates are evaluated in the user's local timezone (Pacific/Auckland) per `nzProfile.timezone`.

### 3.4 Refix and early exit (P1-B)

- A **scheduled refix** occurs when `currentDate >= tranche.fixedUntil` and the user has not elected to break. No fee.
- An **early refix** is an explicit user action, represented by a `BreakFeeSchedule` lookup keyed by `(productCode, monthsRemainingToMaturity)`. The fee formula is supplied by the country adapter (so NZ can publish a fee curve, and other markets can too). The fee is paid in the period of the break and is added to that period's interest, not to principal.
- The current implementation has no UI for break-fee. This spec does **not** add a new UI control; it adds the data shape so that future UIs can opt in without an engine change.
- **Look-ahead prohibition**: any code path inside `amortisation.js` that decides *whether to refix a tranche at month T* is allowed to read only the rate at `monthIndex` and earlier months. It is **forbidden** to read `policyRatePath[T+1..]` or `productRatePaths[*][T+1..]`. This is a static rule enforced by a code review checklist, not by an automated test (the spec is a design contract, not a code contract).

### 3.5 Strategy generation pruning (P1-C)

- Pruning rules are listed in section 6.12. They must satisfy: **a pruning rule must not remove a strategy that could be the unique Pareto-optimal point in any feasible input**. The proofs for each rule are given inline.

### 3.6 Cache dependency keys (P1-D)

- `simulationKey` = hash of `(mortgage, constraints, scenarios, marketRates, forecastMonths, startDate, refixRule)`. If unchanged, the simulation matrix is reused.
- `rankingKey` = hash of `(simulationResults, scenarios, weights)`. If unchanged, the optimiser is reused.
- The worker receives a `forceRecompute: boolean` from the page; if false and the cache hits, the cached `results` is returned.

### 3.7 De-duplication of optimiser vs page (P1-E)

- The page consumes `opt.recommendations` and `opt.rankedStrategies` directly. It does **not** re-implement pros/cons.

### 3.8 Two-mode Pareto (P2)

- `targetMode: "term"` and `targetMode: "payment"` have different objective sets and different hard constraints, defined in section 9.

---

## 4. Inputs and Schemas (Zod changes)

All new fields are **additive** with `.optional()` or `.default()` to preserve existing fixtures. The Zod source is `packages/schemas/src/index.js`.

### 4.1 `MortgageSchema` — new fields

```js
export const MortgageSchema = z.object({
  // ... existing ...
  targetMode: z.enum(["term", "payment"]).optional(),     // unchanged
  targetPeriodicPayment: z.number().positive().optional(), // unchanged
  paymentPolicy: z.enum(["exact", "maximum", "minimum"]).default("minimum").optional(),
  // New: explicit list of offset events (one-off or recurring contributions / withdrawals)
  offsetEvents: z.array(OffsetEventSchema).default([]).optional()
});
```

`paymentPolicy` defaults to `"minimum"` to preserve the current "the difference is an extra" semantics. The page is free to switch to `"exact"` or `"maximum"` for the new behaviour.

### 4.2 New `OffsetEventSchema`

```js
export const OffsetEventSchema = z.object({
  id: z.string(),
  type: z.enum(["one-off", "recurring"]),
  amount: z.number(),                 // signed: positive = top-up cash into offset; negative = withdrawal
  frequency: z.enum(["weekly", "fortnightly", "monthly"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  targetTrancheId: z.string().nullable()  // which floating tranche this offset is linked to
});
```

### 4.3 `MortgageTrancheSchema` — new field

```js
export const MortgageTrancheSchema = z.object({
  // ... existing ...
  linkedOffsetBalance: z.number().nonnegative().default(0).optional() // starting cash in the linked offset account
});
```

### 4.4 `MortgageProductDefinition` — no change

- The NZ catalogue already has `floating` with `supportsOffset: true`. We do **not** introduce a separate `type: "offset"` product in this iteration.

### 4.5 New `BreakFeeSchedule` (country-adapter output, not a top-level schema)

The country adapter gains a new field `breakFeeSchedule: Record<productCode, Array<{ monthsToMaturity: number, feeBps: number }>>`. This is not on the Zod schema; it is a JS object on `MarketProfile` and is consumed by the amortiser only when the user breaks a fixed term early. Because this iteration has no UI to trigger a break, the country adapter's default is `{}` (no break fees available), and the amortiser never enters the break path.

### 4.6 New `SimulationResult` field — infeasibility flag

```js
export const SimulationResultSchema = z.object({
  // ... existing (strategyId, scenarioId, totalInterest, ...) ...
  isInfeasible: z.boolean().default(false).optional(),
  infeasibilityReason: z.string().nullable().default(null).optional()
});
```

The simulation result for a (strategy, scenario) carries a hard infeasibility flag that the optimiser uses to drop the strategy from the Pareto set.

---

## 5. Hard Constraints (run before Pareto)

These are deterministic filters. A strategy that violates any of them is **dropped** from consideration. Dropping is logged via the `exhaustedReport` so the UI can show "X strategies excluded by hard constraints".

| ID | Constraint | Source |
| -- | ---------- | ------ |
| HC-1 | At least one product allocation is non-zero. | strategy generator |
| HC-2 | All percentages ≥ `minPercentage` (default 0.1). | strategy generator |
| HC-3 | All amounts ≥ `minTrancheAmount` (default 10,000). | strategy generator |
| HC-4 | Floating share ≤ `maxFloatingPercentage` (default 0.3). | strategy generator |
| HC-5 | Fixed share ≥ `minFixedPercentage` (1 − HC-4). | strategy generator |
| HC-6 | Sum of percentages = 1.0 within ±0.5·percentageStep. | strategy generator |
| HC-7 | If `paymentPolicy = "exact"` or `"maximum"`, no period in any scenario has mandatory interest > `targetPeriodicPayment`. | amortisation |
| HC-8 | If `paymentPolicy = "exact"` or `"maximum"`, no period's required scheduled payment > `targetPeriodicPayment` for the term-mode base case. | amortisation |
| HC-9 | If `paymentPolicy = "exact"`, no period's required total > `targetPeriodicPayment` AND no period's required total < `targetPeriodicPayment` by more than `roundMoney(0.01)`. | amortisation |
| HC-10 | Every allocation's product is in the country-adapter catalogue. | strategy generator |
| HC-11 | Every offset event's `targetTrancheId` resolves to a floating tranche with `supportsOffset: true`. | amortisation (preflight) |
| HC-12 | `forecastMonths > 0` and `forecastMonths ≤ 600` (50 years). | simulation engine |

For `paymentPolicy: "minimum"`, HC-7/8/9 do not apply. The strategy may be infeasible for other reasons (e.g. term too short to amortise at the target rate) — in that case the simulation returns `isInfeasible = true` and the strategy is dropped from the Pareto set but the infeasibility is reported to the user.

---

## 6. Algorithms and Formulas

### 6.1 Effective balance (offset)

```text
effectiveBalance(tranche) = max(0, tranche.balance - tranche.linkedOffsetBalance)
```

Rounding: `roundMoney`. Clamp to zero on the negative side; never let `effectiveBalance` become negative.

### 6.2 Periodic interest (with offset)

```text
periodicRate = annualRate / periodsPerYear
interest = roundMoney(effectiveBalance * periodicRate)   // not balance * periodicRate
```

If the tranche is `repaymentType: "interest-only"`, the scheduled principal repayment is zero and the closing balance equals the opening balance minus any scheduled or extra principal. The offset account continues to reduce interest only.

### 6.3 Per-period cash-out under payment policy

Let:
- `mandatoryInterest(period) = sum of period interest across active tranches`
- `scheduledPrincipal(period) = sum of (tranche.scheduledPayment - tranche.interest) for active P&I tranches, capped to remaining principal`
- `mandatoryTotal(period) = mandatoryInterest + scheduledPrincipal`
- `targetTotal = mortgage.targetPeriodicPayment` (or undefined if not in payment mode)

```text
if paymentPolicy == "exact":
  if mandatoryTotal > targetTotal:           → infeasible
  if mandatoryTotal < targetTotal by > 0.01: → top up extras to reach targetTotal (general extra)
  totalPayment = targetTotal

if paymentPolicy == "maximum":
  if mandatoryTotal > targetTotal:           → infeasible
  totalPayment = min(mandatoryTotal, targetTotal)   // no overpayment; balance can only grow if mandatory > cap, which we just rejected

if paymentPolicy == "minimum":
  totalPayment = max(mandatoryTotal, targetTotal)
  extraAmount = totalPayment - mandatoryTotal          // ≥ 0
  if extraAmount > 0: distribute as general extra repayment
```

`roundMoney` is applied to `totalPayment` before deducting it from balances. The distribution of the general extra is the existing water-fall (floating-first, then highest rate).

### 6.4 Multi-tranche payment allocation

The order in which `totalPayment` is debited from tranches is, in order:

1. **Mandatory interest** of each active tranche, in `tranche.id` order (deterministic).
2. **Mandatory scheduled principal** of each active P&I tranche, in `tranche.id` order, each capped to the remaining principal after the interest step.
3. **General extra** (if any), in `sortTranchesForExtraRepayment` order: floating/offset/revolving first, then highest `annualRate` first. The amount is capped per tranche by `tranche.balance - alreadyPaid` so balances never go negative.
4. **Targeted extras** are applied to their named tranche after the general extra, in `extra.id` order, each capped to the same rule.
5. **Cap to non-negative balance** — any per-tranche total that would drive the closing balance below 0 is reduced so the closing balance is exactly 0.
6. **Balance collapse** — when a tranche hits 0, it is removed from the active set; its `remainingTermMonths` is irrelevant thereafter; scheduled payment recomputation for the remaining tranches is *not* triggered (we let the natural schedule re-baseline at the next refix or floating rate change).

The order is implemented as a single function `allocatePeriodDebits(trancheStates, periodTrancheDetails, mortgage)` in `amortisation.js`. `roundMoney` is applied at every intermediate sum.

### 6.5 Extra-repayment schedule

A given extra is **active in period p** iff:

```text
let periodDate = periodStartDate(p)
let periodEndDate = periodEndDate(p)        // exclusive
if periodDate < extra.startDate: skip
if extra.endDate and periodDate > extra.endDate: skip

if extra.type == "one-off":
  active iff periodDate <= extra.startDate < periodEndDate
if extra.type == "recurring":
  for freq in {weekly: 7, fortnightly: 14, monthly: approx_period}:
    let triggerDates = every freq-th day from extra.startDate to periodEndDate, capped to extra.endDate
    if any triggerDate in [periodDate, periodEndDate): active
    // For "monthly" extras, the trigger date is the same day-of-month as startDate
```

The `amount` contributed to the period is `extra.amount * (number of trigger dates in the period)`. For a `recurring weekly` extra on a `monthly` mortgage, that is typically 4 or 5.

`frequency: "monthly"` triggers on the day-of-month from `startDate`; if that day-of-month does not exist in a short month, it triggers on the last day of the month.

The `targetTrancheId` is resolved once at the start of the simulation; if the named tranche is not in the active set for the current period, the extra is dropped for that period. A general extra with no `targetTrancheId` becomes part of the general extra pool and is allocated by the water-fall in 6.4.

### 6.6 Refix product selection

```text
determineRefixProduct(currentProductCode, refixRule, refixCount):
  if refixRule.type == "move-to-floating": return "floating"
  if refixRule.type == "same-term":        return currentProductCode
  if refixRule.type == "specified-sequence":
    sequence = refixRule.sequence || []
    if sequence.length == 0: return "floating"
    return sequence[refixCount % sequence.length]
```

This is unchanged from the current code (`packages/mortgage-engine/src/refix.js:11-30`). The early-exit path is a **new** code path that is only entered when the user (or a future optimisation layer) explicitly breaks a fixed term. Because this iteration has no UI for break-fee, the early-exit branch is dead code; the spec adds it as a stub so that adding the UI does not require an engine change.

### 6.7 Early exit (break-fee)

```text
if userInitiatedBreak and product.breakFeeSchedule has productCode:
  let monthsToMaturity = ceil((fixedUntil - currentDate) in months)
  let feeBps = lookupClosest(breakFeeSchedule[productCode], monthsToMaturity)
  let feeAmount = roundMoney(tranche.balance * feeBps / 10000)
  add feeAmount to periodInterest
  refix to refixRule.target product (default: floating)
```

`userInitiatedBreak` is supplied by the caller. The current spec does not add a way for the page to set this; it is reserved for a future feature. The break-fee is added to interest (not principal) because, in NZ market convention, a break fee compensates the lender for the cost of re-lending at a lower rate, which is an economic cost to the borrower comparable to interest.

### 6.8 Refix rate selection

When a fixed tranche matures or is broken, the new rate is `getRateForMonth(scenario.productRatePaths[newProductCode], monthIndex)`. The current `getRateForMonth` (`packages/mortgage-engine/src/refix.js:67-105`) is linear-interpolation-with-flat-extrapolation. No change to its formula.

### 6.9 Scheduled payment recomputation

`scheduledPayment` is recomputed:

1. At the start of every period if the tranche is floating and its `annualRate` changed since the previous period.
2. At the start of every period if the tranche is fixed and it just refixed.
3. Once at the start of the simulation.

`recompute` uses the existing `calculateScheduledPayment` formula; no change.

### 6.10 Floating rate update inside the period

```text
let newRate = getRateForMonth(scenario.productRatePaths[tranche.productCode], monthIndex)
if newRate != tranche.annualRate:
  tranche.annualRate = newRate
  recompute scheduledPayment
```

The path is evaluated at `monthIndex` only. Reading beyond `monthIndex` is forbidden (3.4).

### 6.11 Infeasibility detection

A simulation is **infeasible** iff:

- For any period p, `mandatoryTotal(p) > targetTotal` under `paymentPolicy = "exact"` or `"maximum"`.
- For any period p, `totalPayment(p) < targetTotal - 0.01` under `paymentPolicy = "exact"` and the natural schedule falls short by more than the available offset / extra capacity.
- For any period p, the tranche's closing balance would go below 0 even after the cap-to-zero step, *and* the missing principal was never an overpayment — i.e. the simulator's `roundMoney` introduced a sub-cent drift that compounds to a true shortfall. This is a numerical-infidelity path; we log a warning but do **not** mark the strategy infeasible (the drift is acceptable).

### 6.12 Strategy generator pruning (P1-C)

Six pruning rules, each with a correctness argument. Let `P[i]` denote the product being allocated at recursion depth `i`, with `remaining` percentage to allocate, `floatingSoFar`, `fixedSoFar`, `trancheCountSoFar`, `products = [P[0], …, P[n-1]]`.

- **PR-1 — floating cap:** if `floatingSoFar + remaining < requiredFloatingLowerBound OR floatingSoFar > maxFloatingPercentage`, prune.
  - Proof: adding any combination of the remaining products to the current allocation can only change `floatingSoFar` by adding float-typed percentages. If we have already exceeded the cap, no continuation can bring us back under the cap. If we cannot reach the cap-relative lower bound, no continuation can.
- **PR-2 — fixed floor:** symmetric to PR-1 with `fixedSoFar` and `minFixedPercentage`.
- **PR-3 — splits cap:** if `trancheCountSoFar + (remaining / minPercentage) < 1` (i.e. even filling at the minimum percentage cannot add another active tranche), prune. Concretely, if `trancheCountSoFar == maxSplits` and `remaining > 0`, prune.
- **PR-4 — minimum amount:** if `remaining * totalAmount < minTrancheAmount` AND `remaining == 0` would mean a sub-min allocation, prune. The check is done at the leaf only.
- **PR-5 — duplicate product in remaining set:** if two products share the same productCode (impossible with the current Zod schema but possible with a malformed adapter), skip the second at the recursion call. The current code already iterates `products` once.
- **PR-6 — subtree dedup:** if the same `(currentIndex, remaining, floatingSoFar, fixedSoFar, trancheCountSoFar)` tuple has been processed before, return the cached subtree. This is a memoisation key and is safe because the function is pure.

PR-1 through PR-3 are tight: removing a branch cannot remove a valid superior strategy because the constraint is monotonic in the remaining allocations.

### 6.13 Coarse-to-fine search (forward-compatibility, optional)

The spec does **not** require coarse-to-fine in this iteration, but the API exposes `coarseToFine: { coarseStep: 0.1, fineStep: 0.05, refineRatio: 0.2 }` so a future implementer can wire it in. In this iteration `coarseToFine` is `undefined` and the strategy generator uses a single pass at `percentageStep`.

### 6.14 Optimiser aggregation (term mode)

For each strategy s and each scenario k with probability p_k:

```text
expectedInterest[s]              = Σ_k p_k * totalInterest[s,k]
expectedRepayments[s]            = Σ_k p_k * totalRepayments[s,k]
expectedEndingBalance[s]         = Σ_k p_k * endingBalance[s,k]
expectedMaxPayment[s]            = Σ_k p_k * maximumPayment[s,k]
expectedPaymentVolatility[s]     = Σ_k p_k * paymentVolatility[s,k]
expectedRefixEventCount[s]       = Σ_k p_k * refixEventCount[s,k]
expectedMaxConcurrentRefixPercentage[s] = Σ_k p_k * maximumConcurrentRefixPercentage[s,k]
expectedFloatingExposure[s]      = Σ_k p_k * floatingExposure[s,k]
expectedAffordabilityBreaches[s] = Σ_k p_k * affordabilityBreaches[s,k]
worstCasePayment[s]              = max_k maximumPayment[s,k]
worstCaseEndingBalance[s]        = max_k endingBalance[s,k]
worstCaseInterest[s]             = max_k totalInterest[s,k]
baseCaseInterest[s]              = totalInterest[s, "base"]   // if present
```

`roundMoney` is applied to the final aggregate. The 6-objective Pareto set in term mode is: {expectedInterest, worstCaseInterest, worstCasePayment, expectedMaxConcurrentRefixPercentage, expectedAffordabilityBreaches, 1 − expectedFloatingExposure}.

### 6.15 Optimiser aggregation (payment mode)

Same as 6.14, but the Pareto set is {expectedInterest, worstCaseEndingBalance, payoffTime, expectedMaxConcurrentRefixPercentage, 1 − expectedFloatingExposure}. `payoffTime` is the month index at which the sum of balances reaches 0 (or `forecastMonths + 1` if the loan is not paid off within the horizon). `affordabilityBreaches` is **not** an objective in payment mode — it is a hard constraint (HC-7/8/9).

---

## 7. Event Ordering (per-period, inside `simulateMortgageTimeline`)

The order is the contract. Reordering changes financial outcomes.

```text
for p in 0..totalPeriods:
  1. Compute currentDate and monthIndex from p
  2. For each tranche, in id order:
     a. If fixedUntil < currentDate:
        - Schedule refix
        - newProduct = determineRefixProduct(prevProduct, refixRule, refixCount)
        - newRate = getRateForMonth(scenario.productRatePaths[newProduct], monthIndex)
        - newFixedUntil = addMonths(currentDate, getProductFixedMonths(newProduct, products)) or null
        - refixCount += 1
        - emit refixEvent { type: "scheduled-refix", ... }
        - recompute scheduledPayment
     b. Else if !fixedUntil (floating or revolving):
        - newRate = getRateForMonth(scenario.productRatePaths[tranche.productCode], monthIndex)
        - if newRate != annualRate: annualRate = newRate, recompute scheduledPayment
  3. Apply offset events for this period:
     - For each active offset event, compute its trigger count and signed amount
     - linkedOffsetBalance += amount (clamped to >= 0)
  4. Compute period interest for each active tranche (using effectiveBalance, 6.1)
  5. Compute mandatory scheduled principal for each active P&I tranche
  6. Compute mandatoryTotal = sum of mandatory interest + scheduled principal
  7. Apply payment policy (6.3) → totalPayment
  8. Compute extras for this period (6.5) → generalExtra, targetedExtras
  9. Allocate debits (6.4): interest → scheduled principal → general extra → targeted extras → cap to non-negative balance
 10. Update trancheState.balance = max(0, balance - principalPaid)
 11. Update totalInterestPaid, totalPaymentsPaid
 12. Push periodTrancheDetails and accumulate into monthlyTimeline
```

The new step is **3** (offset events), which is inserted before interest computation. Step **7** (payment policy) replaces the current `targetMode === "payment"` branch.

### 7.1 Look-ahead rule

Steps 1–12 read only `policyRatePath[0..monthIndex]`, `productRatePaths[*][0..monthIndex]`, `trancheState[*]`, and the static `refixRule` / `paymentPolicy`. They never read `policyRatePath[monthIndex+1..]` or `productRatePaths[*][monthIndex+1..]`. The `optimiser.js` is allowed to read the entire path because it operates on completed simulations, not on a single period's decision.

---

## 8. Metrics

All metrics are computed from the period timeline. `roundMoney` is applied at every output.

| Metric | Definition |
| ------ | ---------- |
| `totalInterest` | sum of `periodInterest` over all periods |
| `totalRepayments` | sum of `totalPayment` (scheduled + extras) over all periods |
| `endingBalance` | sum of `tranche.balance` at the last period |
| `maximumPayment` | max of `totalPayment` over all periods |
| `minimumPayment` | min of `totalPayment` over all periods (excluding zero-balance tail) |
| `averagePayment` | `totalRepayments / periodCount` (excluding zero-balance tail) |
| `maximumPaymentIncrease` | max of `totalPayment[p] - totalPayment[p-1]` over all `p ≥ 1` |
| `paymentVolatility` | population standard deviation of `totalPayment[p]` over the active period range |
| `maximumConcurrentRefixPercentage` | max over months m of `sum(balance of tranches refixing in month m) / sum(balance of all tranches at start of month m)` |
| `floatingExposure` | `sum(amount of floating/offset/revolving allocations) / totalAllocated` |
| `affordabilityBreaches` | count of periods p where `totalPayment[p] > maxAffordablePayment` |
| `payoffTime` | first month index where `sum(balance) ≤ 0`; `forecastMonths + 1` if never |
| `offsetUtilisation` | average over active periods of `linkedOffsetBalance / max(tranche.balance, 1)` |
| `isInfeasible` | boolean per simulation result (6.11) |

`roundMoney(0.01)` is the cent-level rounding threshold used to compare "exact" payments.

---

## 9. Pareto Objectives and Tolerances (P2)

### 9.1 Term mode

Objectives (all `minimise`):

| Key | Source | Direction | Unit | Tolerance |
| --- | ------ | --------- | ---- | --------- |
| `expectedInterest` | optimiser | min | NZD | $50 |
| `worstCaseInterest` | optimiser | min | NZD | $50 |
| `worstCasePayment` | optimiser | min | NZD | $10 |
| `expectedMaxConcurrentRefixPercentage` | simulation | min | ratio 0..1 | 0.01 |
| `expectedAffordabilityBreaches` | simulation | min | count | 0.5 |
| `flexibilityPenalty = 1 - expectedFloatingExposure` | derived | min | ratio 0..1 | 0.01 |

`worstCasePayment` is selected over `expectedMaxPayment` because the user cares about the peak, not the average. The two are correlated but not identical.

### 9.2 Payment mode

Objectives (all `minimise`):

| Key | Source | Direction | Unit | Tolerance |
| --- | ------ | --------- | ---- | --------- |
| `expectedInterest` | optimiser | min | NZD | $50 |
| `worstCaseEndingBalance` | optimiser | min | NZD | $50 |
| `payoffTime` | simulation | min | month | 1 |
| `expectedMaxConcurrentRefixPercentage` | simulation | min | ratio 0..1 | 0.01 |
| `flexibilityPenalty = 1 - expectedFloatingExposure` | derived | min | ratio 0..1 | 0.01 |

`affordabilityBreaches` is **not** an objective in payment mode — it is a hard constraint. In payment mode, the user has already committed to a payment level; the question is "at this payment level, how much do I owe at the end, and how soon do I pay it off?".

### 9.3 Dominance rule (tolerance-aware)

A strategy A dominates B iff:

- For every selected objective, `A.objective ≤ B.objective + tolerance`, AND
- For at least one objective, `A.objective < B.objective - tolerance` (strict improvement beyond tolerance).

The tolerance defaults in 9.1/9.2 are part of the API. Implementers may pass a `tolerances: { expectedInterest?: number, ... }` partial override; missing keys fall back to the defaults.

### 9.4 Two-dimensional chart projection (UI helper, not a Pareto criterion)

The 2D scatter on the UI projects two objectives at a time. The full-dimensional Pareto set is the source of truth; the 2D view is a rendering helper. The current spec does not require any change to the existing chart; we note the distinction only so the implementer does not treat the chart's projection as authoritative.

---

## 10. Ranking Behaviour

### 10.1 Normalisation

For each objective o, the bounds are `[min(o), max(o)]` over the surviving (non-infeasible) strategies. `diff = max - min`; if `diff == 0`, use `diff = 1` (a guard against divide-by-zero, identical to the current code at `optimiser.js:157-162`).

For objectives where lower is better: `score = (o - min) / diff`.
For objectives where higher is better: `score = (max - o) / diff`.

The objectives in 9 are all `minimise`, so the first form is used everywhere.

### 10.2 Weight derivation (sliders)

`sliderCostStability` ∈ [0, 1] (default 0.5), `sliderFlexibility` ∈ [0, 1] (default 0).

Term mode:

```text
rawCostWeight        = 0.65 - sliderCostStability * 0.40
rawStabilityWeight   = 0.15 + sliderCostStability * 0.30
rawRefixWeight       = 0.15 + sliderCostStability * 0.10
rawResilienceWeight  = 0.05 + sliderCostStability * 0.05
rawFlexibilityWeight = sliderFlexibility * 0.20
rawBudgetWeight      = 0
rawPrincipalWeight   = 0
totalRaw = sum
wCost      = rawCostWeight        / totalRaw
wStability = rawStabilityWeight   / totalRaw
wRefix     = rawRefixWeight       / totalRaw
wResilience= rawResilienceWeight  / totalRaw
wFlex      = rawFlexibilityWeight / totalRaw
```

Payment mode:

```text
rawCostWeight        = 0.50 - sliderCostStability * 0.30
rawEndingBalance     = 0.20 + sliderCostStability * 0.20
rawPayoffWeight      = 0.10
rawRefixWeight       = 0.10
rawFlexibilityWeight = sliderFlexibility * 0.20
totalRaw = sum
...
```

`wPrincipal` and `wBudget` are 0 in slider mode; they are 0 in the `weights` branch too (the page does not use them; they are reserved for a future UI).

### 10.3 Recommendations

The optimiser emits:

```js
recommendations: {
  preference:   pick rankedStrategies[0],
  lowestCost:   pick argmin expectedInterest (over surviving strategies),
  mostStable:   pick argmin expectedMaxPayment (term) or argmin worstCaseEndingBalance (payment)
}
```

Each carries `{ strategyId, score, isParetoOptimal, pros, cons }`. The Chinese pros/cons are generated inside the optimiser. The page consumes them directly. The duplicate logic in `strategy-lab/page.js:234-328` is removed.

### 10.4 Chinese pros/cons generation (inside optimiser)

The function `generateExplanations(s, bounds, mode)` returns `{ pros, cons }`. The rules:

- "预期利息成本极低" (pro) if `expectedInterest ≤ minInterest + 0.15 * diffInterest`. "预期整体利息成本支出较高" (con) if `expectedInterest ≥ maxInterest - 0.20 * diffInterest`.
- "还款波动小" / "极端高息峰值风险" uses `expectedMaxPayment` (term) or `worstCaseEndingBalance` (payment) with the same 0.15 / 0.20 thresholds.
- "贷款到期日期分散" / "重定价集中暴露风险高" uses `expectedMaxConcurrentRefixPercentage` with 0.15 / 0.20.
- "高灵活性" / "高比例固定锁死" uses `expectedFloatingExposure` with 0.15 / 0.20.
- "本金还款速度快" / "本金还款进度慢" uses `expectedEndingBalance` with 0.15 / 0.20 (term mode only — payment mode uses `payoffTime`).
- "预算超限次数较少" / "更容易超过预算" uses `expectedAffordabilityBreaches` with 0.15 / 0.20 (term mode only).
- If `pros` is empty: push "各项财务与风险指标表现较为均衡。". If `cons` is empty: push "在极端高息走势下缺乏更深度的防御缓冲。".

This is the existing logic at `optimiser.js:233-281`, lifted into a reusable function. The page does not duplicate it.

---

## 11. Performance Approach

### 11.1 Worker boundary

- `apps/web/workers/simulation.worker.js` is the only place that calls `simulateStrategyScenarioMatrix`. Unchanged.
- The page posts `{ mortgage, strategies, scenarios, products, currentProductRates, startDate, forecastMonths, maxAffordablePayment, forceRecompute }` and reads `{ type: "progress" | "success" | "error" | "cached" }`.
- The worker keeps an in-memory LRU keyed by `simulationKey`. Size: 1. (We do not need a multi-entry cache for the Web app's single-user interaction model.)
- `simulationKey` is computed by stable JSON serialisation (sorted keys, no whitespace) of the inputs. We do **not** introduce a hash function; we use the serialised string itself. The first 8 hex chars of `SHA-1(serialisedString)` is the cache id; SHA-1 is available in the Web Worker via `crypto.subtle.digest`.

### 11.2 Cancellation / yielding

- The simulation loop yields to the event loop every 10 simulations (existing behaviour at `simulation-engine/src/index.js:221-223`).
- The page can post a `cancel` message to the worker; the worker checks `signal.aborted` at the same point.

### 11.3 Ranking cache

- The page keeps an in-memory LRU keyed by `rankingKey`. Size: 1.
- `rankingKey` = `SHA-1(stableStringify(simulationResults.map(r => [r.strategyId, r.scenarioId, r.totalInterest, r.maximumPayment, r.endingBalance, r.maximumConcurrentRefixPercentage, r.floatingExposure, r.affordabilityBreaches, r.isInfeasible])))`. We do not hash the timeline because the timeline is not used by the optimiser or the UI's pros/cons generator.

### 11.4 Expected complexity

- `O(S × K)` simulations where `S` = number of strategies (after pruning) and `K` = number of scenarios. With the current NZ catalogue and `maxSplits=3, percentageStep=0.1`, `S ≈ 200–400`. The worker runs them in <1s on a modern laptop.
- Pareto filtering is `O(S²)` dominated. For `S = 400`, this is 80,000 comparisons — trivial.
- Ranking is `O(S)`.

---

## 12. Edge Cases

| Edge case | Behaviour |
| --------- | --------- |
| Empty strategy list (no strategy passes HC) | UI shows "当前拆分约束下没有可行方案" with a hint to relax constraints. (Already implemented at `strategy-lab/page.js:381-385`.) |
| Zero-balance tranche | The tranche is removed from the active set. Its `scheduledPayment` is 0. It does not consume a refix slot. |
| Payoff at month 0 | `payoffTime = 0`; `totalInterest = 0`; `endingBalance = 0`. (Theoretically impossible because `totalAmount > 0` and `tranche.balance > 0` at start, but the spec includes the case for completeness.) |
| Horizon shorter than remaining term | The simulation truncates at `forecastMonths`; `payoffTime = forecastMonths + 1` if not paid off; `endingBalance` is the sum of remaining balances. |
| Scenario with `probability = 0` | The scenario is still simulated (it costs nothing because it doesn't enter any weighted average) but its results are not used in the optimiser. The UI does not display it. |
| Ties in Pareto | Two strategies with identical objective vectors (within tolerance) are both kept as Pareto-optimal. The `score` tiebreaker uses the lexicographic order of `allocations` (sorted by productCode) so the result is deterministic. |
| Single-scenario mode | The user can pass `scenarios = [base]` with `probability = 1`. The optimiser falls back to single-scenario metrics. `expectedMaxPayment === maximumPayment`, etc. |
| Missing custom rates | The `currentProductRates` is required; if any product code in the strategy is missing from `currentProductRates`, the strategy is dropped at preflight (HC-10 + a stricter check: the simulation requires the rate to compute interest). |
| `paymentPolicy = "minimum"` with `targetPeriodicPayment = 0` | Equivalent to no payment policy; falls back to natural schedule. The "difference" is always 0. |
| `paymentPolicy = "exact"` with target = monthly interest on month 1 | Strategy is feasible at month 1 only if `targetPeriodicPayment ≥ monthly interest`; otherwise infeasible. |
| Offset cash > tranche balance | `effectiveBalance = 0`. Interest = 0. Principal repayment still proceeds. Surplus offset cash is left in the offset account. |
| Two offset events on the same date for the same tranche | They are applied in `offsetEvent.id` order. Rounding is applied per event. |
| `frequency: "monthly"` extra with `startDate: "2026-01-31"` | Triggers on the last day of months with fewer than 31 days. |
| `frequency: "weekly"` extra with `forecastMonths = 24` | Triggers on the same day-of-week as `startDate`, ~104 times over 24 months. |
| Fixed tranche with `fixedUntil = null` (already floating) | Treated as floating. No scheduled refix. |
| Mortgage with `originalTermMonths = 0` | Pre-flight rejects: HC-12. |
| `forecastMonths = 0` | Pre-flight rejects: HC-12. |

---

## 13. Acceptance Criteria

A change is accepted iff:

**P0-A (Offset)**
1. A floating tranche with `linkedOffsetBalance = 100,000` and `balance = 500,000`, `annualRate = 0.06`, `monthly` accrues `roundMoney((500000 - 100000) * 0.06 / 12) = 2000.00` interest in the first period. (Golden case 1.)
2. A floating tranche with `linkedOffsetBalance = 600,000` and `balance = 500,000` accrues `0.00` interest in the first period. (Golden case 2.)
3. `totalInterest` over 12 months with a constant offset of 200,000 is exactly 12 × `roundMoney(300000 * 0.06 / 12)` = `18,000.00`. (Golden case 3.)
4. An offset event with `amount: 10000, type: "one-off", startDate: "2026-07-15"` on a `monthly` mortgage with start date `2026-06-16` triggers in the period containing 2026-07-15 and not in any other period. (Golden case 4.)
5. A `recurring monthly` offset event with `startDate: "2026-06-15"` on a `monthly` mortgage with start date `2026-06-16` triggers in every period (one per month) for 12 months. (Golden case 5.)

**P0-B (Payment policy)**
6. `paymentPolicy = "exact"`, `targetPeriodicPayment = 2000`, mandatory = 1500 → totalPayment = 2000.00. (Golden case 6.)
7. `paymentPolicy = "exact"`, mandatory = 2100 > 2000 → `isInfeasible = true`. (Golden case 7.)
8. `paymentPolicy = "maximum"`, mandatory = 1500, target = 2000 → totalPayment = 1500 (no extra). (Golden case 8.)
9. `paymentPolicy = "minimum"`, mandatory = 1500, target = 2000 → totalPayment = 2000, extra = 500. (Golden case 9.)
10. `paymentPolicy = "minimum"`, mandatory = 2500 > target = 2000 → totalPayment = 2500 (no shortfall penalty). (Golden case 10.)
11. `paymentPolicy = "exact"`, target = 1999.99, mandatory = 2000.01 → infeasible (target < mandatory). (Golden case 11.)
12. `paymentPolicy = "exact"`, target = 2000.005, mandatory = 2000.00 → totalPayment = 2000.01 (rounds up to cent). (Golden case 12.)
13. `paymentPolicy = "exact"`, target = 2000.00, mandatory = 2000.00 → totalPayment = 2000.00. (Golden case 13.)
14. `paymentPolicy = "maximum"`, target = 2000, mandatory = 2000.00 → totalPayment = 2000.00 (at the cap). (Golden case 14.)

**P1-A (Extras)**
15. `recurring weekly` extra on a `monthly` mortgage: 4 or 5 triggers per month, deterministic for a given `startDate` and `forecastMonths`. (Golden case 15.)
16. `recurring fortnightly` extra on a `weekly` mortgage: every 2nd period. (Golden case 16.)
17. `recurring monthly` extra on a `weekly` mortgage: ~1 trigger per 4.33 weeks; the engine must count triggers per period. (Golden case 17.)
18. `one-off` extra with `startDate` outside the simulation window: dropped silently. (Golden case 18.)
19. `one-off` extra with `startDate = 2026-12-15`, `targetTrancheId` valid: triggers in the period containing 2026-12-15, no other period. (Golden case 19.)

**P1-B (Refix & break)**
20. A `fixed-1y` tranche that matures at month 12 emits exactly one `refixEvent` with `type: "scheduled-refix"`. (Golden case 20.)
21. After scheduled refix, the tranche's `annualRate` equals `getRateForMonth(scenario.productRatePaths[newProduct], 12)`. (Golden case 21.)
22. The refix decision at month 12 reads only `policyRatePath[0..12]` (verify by code review; not by test). (Golden case 22 — review only.)
23. The `amortisation.js` source contains no call to `getRateForMonth(path, monthIndex > p)` where `p` is the current period index. (Golden case 23 — static check.)

**P1-C (Pruning)**
24. With `maxSplits=5, percentageStep=0.05, maxFloatingPercentage=0.3, minPercentage=0.1`, the strategy generator returns at most `floor(1/0.05) + floor(0.3/0.05) + ...` valid strategies (the exact upper bound depends on the catalogue; the test asserts the count is below a known theoretical maximum and the strategies are exhaustive). (Golden case 24.)
25. The strategy generator's recursive call count is below the theoretical unpruned count for the same inputs. (Golden case 25 — measures `callCount`.)

**P1-D (Cache)**
26. Posting the same `simulationKey` to the worker twice returns the same results array (pointer-equal optional, value-equal required). (Golden case 26.)
27. Changing `weights` but keeping `simulationKey` unchanged does not invoke the worker. (Golden case 27 — observed via `workerRef.current.postMessage` count.)

**P1-E (Dedupe)**
28. `optimiseStrategies(...)`.`recommendations.preference` and the page's recomputed `recPreference` are deep-equal in their `pros` and `cons` arrays. (Golden case 28.)
29. The page does not contain the strings "成本低优先" or "高比例浮动优先" in its own pros/cons builder — those strings are produced by the optimiser only. (Golden case 29 — code review.)

**P2 (Pareto)**
30. A term-mode strategy with `expectedInterest = 10000, worstCaseInterest = 12000, worstCasePayment = 3000, expectedMaxConcurrentRefixPercentage = 0.2, expectedAffordabilityBreaches = 0, expectedFloatingExposure = 0.5` Pareto-dominates a strategy with `expectedInterest = 10100, worstCaseInterest = 12100, worstCasePayment = 3010, expectedMaxConcurrentRefixPercentage = 0.21, expectedAffordabilityBreaches = 0, expectedFloatingExposure = 0.5` (within tolerance). (Golden case 30.)
31. A payment-mode strategy with `expectedInterest = 8000, worstCaseEndingBalance = 100000, payoffTime = 24, expectedMaxConcurrentRefixPercentage = 0.2, expectedFloatingExposure = 0.3` Pareto-dominates a strategy with `expectedInterest = 8050, worstCaseEndingBalance = 105000, payoffTime = 25, expectedMaxConcurrentRefixPercentage = 0.21, expectedFloatingExposure = 0.3`. (Golden case 31.)

**Determinism**
32. Two consecutive simulations of the same input produce byte-identical `simulationResults` and `rankedStrategies`. (Golden case 32.)

**Cross-platform**
33. The same input, run under Node 20 (vitest) and inside the Web Worker in Chromium 122, produces identical `totalInterest` to the cent. (Golden case 33.)

---

## 14. Golden Test Cases

These are 33 concrete input → expected output pairs suitable for vitest. They are written as prose here; the implementer translates each into a vitest `it(...)` block. All amounts are in NZD; rates are decimals.

### 14.1 P0-A Offset (5)

**Case 1 — offset reduces interest.**
- Mortgage: single floating tranche, balance 500,000, annualRate 0.06, monthly, P&I, term 360 months, `linkedOffsetBalance = 100,000`.
- No extras. No payment policy.
- Expected: month 1 interest = `roundMoney(400000 * 0.06 / 12) = 2000.00`.

**Case 2 — offset > balance zeroes interest.**
- Same as case 1 but `linkedOffsetBalance = 600,000`.
- Expected: month 1 interest = 0.00; `effectiveBalance = 0`.

**Case 3 — constant offset for 12 months.**
- Same as case 1, no offset events.
- Expected: totalInterest over 12 months = `12 * 2000.00 = 24000.00` (offset is constant; balance reduces each month by ~831 of principal; the interest is `roundMoney((500000 - 831*p - 100000) * 0.005)` each month; sum to 12 months; verify against the formula).

**Case 4 — one-off offset event.**
- Same as case 1, but `linkedOffsetBalance = 0` and a one-off offset event with `amount: 100000, startDate: "2026-07-15"`.
- Mortgage start date: 2026-06-16 (monthly). The period containing 2026-07-15 is month 2.
- Expected: month 1 effectiveBalance = 500,000; month 2 effectiveBalance = 500,000 - principal_paid_m1 - 100,000.

**Case 5 — recurring monthly offset.**
- Same as case 1, but `linkedOffsetBalance = 0` and a `recurring monthly` offset event with `amount: 10000, startDate: "2026-06-15"`.
- Mortgage start date: 2026-06-16 (monthly).
- Expected: 12 triggers; `linkedOffsetBalance` at end of month 12 ≈ 120,000 minus any consumption by interest reduction.

### 14.2 P0-B Payment policy (4 + 4 = 8)

The first four cover the three policies at the boundary; the second four cover edge rounding.

**Case 6 — `exact` policy, mandatory < target.**
- Mortgage: single tranche balance 100,000, annualRate 0.06, monthly, P&I, term 360. Mandatory = 1500. Target = 2000. Policy = exact.
- Expected: totalPayment = 2000.00; extra = 500.00.

**Case 7 — `exact` policy, mandatory > target.**
- Same as case 6 but mandatory = 2100, target = 2000.
- Expected: `isInfeasible = true`, `infeasibilityReason = "mandatory exceeds target under exact policy at month 1"`.

**Case 8 — `maximum` policy, mandatory < target.**
- Same as case 6 but policy = maximum.
- Expected: totalPayment = 1500.00; extra = 0.

**Case 9 — `minimum` policy, mandatory < target.**
- Same as case 6 but policy = minimum.
- Expected: totalPayment = 2000.00; extra = 500.00.

**Case 10 — `minimum` policy, mandatory > target.**
- Mandatory = 2500, target = 2000, policy = minimum.
- Expected: totalPayment = 2500.00; no extra; no shortfall penalty.

**Case 11 — `exact` policy, target just under mandatory.**
- Mandatory = 2000.01, target = 1999.99.
- Expected: infeasible.

**Case 12 — `exact` policy, target just over mandatory, rounding.**
- Mandatory = 2000.00, target = 2000.005.
- Expected: totalPayment = 2000.01 (rounded up to cent; not infeasible because the engine rounds target to the cent and the shortfall is 0.01 which can be satisfied by an extra of 0.01).

**Case 13 — `exact` policy, target = mandatory.**
- Mandatory = 2000.00, target = 2000.00.
- Expected: totalPayment = 2000.00; no extra.

**Case 14 — `maximum` policy, target = mandatory.**
- Mandatory = 2000.00, target = 2000.00, policy = maximum.
- Expected: totalPayment = 2000.00; no extra; no breach.

### 14.3 P1-A Extras (5)

**Case 15 — weekly recurring on monthly mortgage.**
- Mortgage: monthly, start 2026-06-16.
- Extra: recurring weekly, amount 100, startDate 2026-06-19 (Friday), endDate null, targetTrancheId null.
- Expected: 4 or 5 triggers per month; total extra in 12 months is `100 * 52` if 52 weeks fit; otherwise `100 * 52 - dropped`.
- Concrete expected: totalExtra in 12 months = 5200.00.

**Case 16 — fortnightly recurring on weekly mortgage.**
- Mortgage: weekly, start 2026-06-16.
- Extra: recurring fortnightly, amount 200, startDate 2026-06-17.
- Expected: 26 triggers over 12 months; total extra = 5200.00.

**Case 17 — monthly recurring on weekly mortgage.**
- Mortgage: weekly, start 2026-06-16.
- Extra: recurring monthly, amount 500, startDate 2026-06-16.
- Expected: 12 triggers; the trigger falls in the week containing the 16th of each month.

**Case 18 — one-off outside window.**
- Mortgage: monthly, start 2026-06-16, forecast 24.
- Extra: one-off, amount 10000, startDate 2029-01-15.
- Expected: extra is never applied; total extra in 24 months = 0.

**Case 19 — one-off on a valid date, targeted.**
- Mortgage: monthly, start 2026-06-16. Two tranches: T1 (floating, 300,000), T2 (fixed-1y, 200,000).
- Extra: one-off, amount 5000, startDate 2026-12-15, targetTrancheId = T1.
- Expected: T1.extraRepayment at month 7 = 5000; T2.extraRepayment at month 7 = 0; T1.closingBalance at month 7 is reduced accordingly.

### 14.4 P1-B Refix (4)

**Case 20 — scheduled refix at month 12.**
- Mortgage: fixed-1y tranche, fixedUntil = addMonths(start, 12).
- Scenario: `productRatePaths["fixed-1y"] = [{month:0,rate:0.05},{month:12,rate:0.04}]`.
- Expected: exactly 1 refixEvent, type = "scheduled-refix", prevRate = 0.05, newRate = 0.04, prevProduct = newProduct = "fixed-1y".

**Case 21 — refix rate pulled from product path at the correct month.**
- Same as case 20 with `productRatePaths["fixed-1y"] = [{month:0,rate:0.05},{month:6,rate:0.045},{month:12,rate:0.04}]`.
- Expected: at month 12 refix, newRate = 0.04 (exact match). At month 6, if a floating tranche were present, newRate = 0.045.

**Case 22 — look-ahead static check (code review, not test).**
- Grep `amortisation.js` for `getRateForMonth.*\+ ` and verify the `monthIndex` argument is never greater than the current period's `monthIndex`.

**Case 23 — refix events are not double-counted when the mortgage's `fixedUntil` falls on a non-payment date.**
- Mortgage: monthly, start 2026-06-30, fixed-1y tranche, fixedUntil = 2027-06-30. The refix happens in the period whose date is 2027-06-30.
- Expected: exactly 1 refixEvent at the period containing 2027-06-30.

### 14.5 P1-C Pruning (1)

**Case 24 — pruning correctness.**
- Inputs: 7 NZ products, maxSplits = 5, percentageStep = 0.05, maxFloatingPercentage = 0.3, minPercentage = 0.1, minTrancheAmount = 10,000, totalAmount = 500,000.
- Expected: strategy count is in [1, 600]; the recursive call count is ≤ 30,000 (unpruned upper bound is 21^7 ≈ 1.8B; the implementation must prune hard).

### 14.6 P2 Pareto (2)

**Case 30 — term-mode dominance with tolerance.**
- Build two strategies A and B with the metrics in 13.30.
- Expected: A is Pareto-optimal; B is not.

**Case 31 — payment-mode dominance.**
- Build two strategies A and B with the metrics in 13.31.
- Expected: A is Pareto-optimal; B is not.

### 14.7 P1-D Cache (2)

**Case 26 — same key returns same result.**
- Post `{ mortgage, strategies, scenarios, products, currentProductRates, startDate, forecastMonths, maxAffordablePayment, forceRecompute: false }` twice with identical inputs. The worker returns `type: "cached"` the second time. The result array is deep-equal.

**Case 27 — weights change does not re-simulate.**
- Call `optimiseStrategies` twice, once with `weights = A`, once with `weights = B`, holding `simulationResults` constant. The output's `rankedStrategies[*].strategyId` and `pros/cons` strings may differ, but the simulation engine is not called. (Verified by a stub `simulateStrategyScenarioMatrix` that increments a counter.)

### 14.8 P1-E Dedupe (2)

**Case 28 — pros/cons parity.**
- For any non-empty `simulationResults`, the page's recomputed `recPreference.pros` equals `optimiseStrategies(...).recommendations.preference.pros` element-by-element.

**Case 29 — no duplicate logic in page.**
- The file `apps/web/app/strategy-lab/page.js` does not import `generateExplanations` and does not contain the strings used by the optimiser's pros/cons (other than in the JSX render of the cards). Code review only.

### 14.9 Determinism (1)

**Case 32 — byte-identical runs.**
- Run `simulateMortgageTimeline({ ... })` twice with the same inputs; `totalInterest` and `totalRepayments` are byte-identical; `rawPeriodsTimeline` is deep-equal.

### 14.10 Cross-platform (1)

**Case 33 — Node vs Worker.**
- Run the same scenario on Node 20 (vitest) and inside a `Web Worker` in Chromium 122. `totalInterest` is identical to the cent.

---

## 15. Files Likely Affected (read and later modify)

### 15.1 Schemas
- `packages/schemas/src/index.js` — add `paymentPolicy`, `OffsetEvent`, `linkedOffsetBalance`, `isInfeasible` / `infeasibilityReason`. Update `MortgageSchema` and `MortgageTrancheSchema`.

### 15.2 Country adapters
- `packages/country-adapters/src/nz.js` — add `breakFeeSchedule: {}` (empty default; no product exposes a break fee in this iteration).
- The product catalogue is unchanged: `floating` continues to have `supportsOffset: true`; no new `type: "offset"` product is introduced.

### 15.3 Rate engine
- No changes. `policyRatePath` and `productRatePaths` are unchanged.

### 15.4 Scenario engine
- No changes. The `generateScenarios` output is unchanged. The page's `scenario` consumer code may need a check for `scenarios.length === 0`.

### 15.5 Strategy generator
- `packages/strategy-generator/src/index.js` — add PR-1 through PR-6 (section 6.12). Expose `coarseToFine` as an optional argument (no behaviour change in this iteration).

### 15.6 Mortgage engine
- `packages/mortgage-engine/src/amortisation.js`:
  - Replace the `targetMode === "payment"` branch with a `paymentPolicy` switch (section 6.3).
  - Add offset event handling (section 6.1, step 3 in section 7).
  - Add in-period extra-repayment scheduling (section 6.5).
  - Refactor the per-period loop to follow the order in section 7.
  - Add `isInfeasible` and `infeasibilityReason` to the return value.
  - Add `payoffTime` and `offsetUtilisation` to the return value.
- `packages/mortgage-engine/src/refix.js`:
  - Extend `determineRefixProduct` to accept an optional `userInitiatedBreak` flag. When true, look up `breakFeeSchedule[productCode]` and add the fee to interest. In this iteration, the flag is not exposed to the page, but the function must support it.
  - Add `type: "scheduled-refix" | "early-refix"` to refix events.

### 15.7 Simulation engine
- `packages/simulation-engine/src/index.js`:
  - Forward the new fields (`paymentPolicy`, `offsetEvents`, `linkedOffsetBalance`) to `simulateMortgageTimeline`.
  - Compute `payoffTime` from the timeline if not already present.
  - No change to the matrix runner; the cache is a worker-side concern.

### 15.8 Optimiser
- `packages/optimiser/src/index.js`:
  - Split the objective set by `mortgage.targetMode` (term vs payment).
  - Add a tolerance-aware dominance check (section 9.3).
  - Add a `tolerances` parameter with the defaults from section 9.
  - Keep the existing `recommendations` and pros/cons logic. Extract `generateExplanations` into an exported helper so the page can use it directly (and so it is the single source of truth).

### 15.9 Worker
- `apps/web/workers/simulation.worker.js`:
  - Accept `forceRecompute`.
  - Maintain a `simulationKey → results` LRU of size 1.
  - Return `{ type: "cached", results, key }` when the cache hits.

### 15.10 Web app
- `apps/web/app/strategy-lab/page.js`:
  - Add a `paymentPolicy` selector (dropdown) under the existing "拆分约束参数" section. Default = "minimum" to preserve current behaviour.
  - Replace the inline `getStrategyExplanations` (lines 234-316) with `opt.recommendations.preference.pros` and `opt.recommendations.preference.cons`. Remove the duplicate `buildRecObject` (lines 318-328) and use the optimiser's output.
  - Add a `simulationKey` memo and a `forceRecompute` flag to the worker post.
  - Add a `rankingKey` memo for `optimiseStrategies` so weights changes are O(1) cache hits.
  - Update the "当前拆分约束下没有可行方案" message to include the new "split constraints" (mention payment policy).

### 15.11 Tests
- `packages/mortgage-engine/tests/amortisation.test.js`: add the 19 cases from 14.1, 14.2, 14.3, 14.4. Update the existing "should maintain target periodic payment" test to be policy-aware.
- `packages/strategy-generator/tests/strategy.test.js`: add case 24.
- `packages/optimiser/tests/optimiser.test.js`: add cases 30, 31, and a tolerance-aware dominance test.
- `packages/simulation-engine/tests/simulation.test.js`: add cases 26, 27, 32, 33.
- New `packages/optimiser/tests/dedupe.test.js`: add case 28.

---

## 16. Risks and Deferred Enhancements

### 16.1 Risks

- **Rounding drift**: `roundMoney` is applied at every intermediate sum. The final balance may differ from the analytical answer by sub-cent. We accept this; the spec logs a warning when the drift exceeds 0.01.
- **Pareto degeneracy**: with tolerance = 0, two strategies with identical metrics up to cent-level rounding are both kept. This is intentional.
- **Date handling in `addDays` / `addMonths`**: the current implementation uses `Date` objects, which are timezone-dependent. The spec uses `mortgage.startDate` (ISO `YYYY-MM-DD`) interpreted in `nzProfile.timezone` (Pacific/Auckland). The existing `addMonths` does not respect DST, but for monthly granularity this is acceptable.
- **Cache invalidation**: if the user changes `mortgage.originalTermMonths` (not exposed in the current UI but possible via IndexedDB), the `simulationKey` must include it. We do, via the full mortgage serialisation.
- **Payment-policy + offset interaction**: an offset reduces interest, which in `paymentPolicy = "exact"` mode means more of the target is principal. The spec's order in section 7 handles this correctly (offset event is applied before interest computation, then interest is computed on the reduced effective balance, then the policy decides how to allocate the target between interest and principal). This is non-trivial to verify; the implementer should add a focused unit test.

### 16.2 Deferred enhancements (explicitly out of scope)

- **Monte Carlo** over policy-rate paths. Reasons: deterministic enumeration is sufficient for the Web app's single-user interaction model; the spec has 33 golden cases; introducing randomness would break determinism. If a future feature requires it, it goes behind a feature flag and must preserve the deterministic path.
- **Vasicek / CIR** short-rate models. Same reason.
- **GA, PSO, NSGA-II** for strategy search. The strategy space is small (hundreds of strategies after pruning) and exhaustive enumeration is fast.
- **Dynamic / smart refix** (refix a fixed-1y at month 6 if the high scenario predicts a 5% drop in 1y rates by month 12). Reasons: the look-ahead rule (section 3.4) forbids it; the current UI does not request it; a future implementation must respect the look-ahead rule and must consume `breakFeeSchedule`.
- **Multi-worker pool**. The single-worker pattern is sufficient. The worker yields every 10 simulations.
- **Continuous fixed term** (e.g. "fixed 2.5y"). The country adapter only declares discrete `fixedMonths`. The interpolator is `getRateForMonth` for paths, not for terms.

### 16.3 Out-of-scope features noted in the prompt

- Mobile — no code, no fixtures.
- No TypeScript; continue with JSDoc.
- No traditional database — IndexedDB only.
- No user data upload — the worker is local.

---

## Appendix A — Pseudocode (key algorithms)

### A.1 Per-period event loop

```pseudo
function simulatePeriod(p, trancheStates, mortgage, scenario, products, refixRule):
  currentDate, monthIndex = dateAndMonth(p, mortgage.repaymentFrequency, startDate)
  step2_refixAndFloatUpdate(trancheStates, currentDate, monthIndex, refixRule, scenario, products)
  step3_offsetEvents(trancheStates, mortgage.offsetEvents, currentDate, mortgage.repaymentFrequency)
  step4_interestAndScheduled(trancheStates, mortgage, periodTrancheDetails)
  mandatory = sum(periodTrancheDetails.interest) + sum(periodTrancheDetails.scheduledPrincipal)
  totalPayment, generalExtra = step7_applyPaymentPolicy(mandatory, mortgage)
  step8_periodExtras(mortgage.extraRepayments, currentDate, mortgage.repaymentFrequency, periodTrancheDetails, generalExtra)
  step9_allocateDebits(trancheStates, periodTrancheDetails, totalPayment)
  step10_capToNonNegative(trancheStates)
  return periodTrancheDetails
```

### A.2 Payment policy

```pseudo
function applyPaymentPolicy(mandatory, mortgage):
  if mortgage.targetMode == "term" or mortgage.targetPeriodicPayment is undefined:
    return mandatory, 0
  target = mortgage.targetPeriodicPayment
  policy = mortgage.paymentPolicy
  if policy == "exact":
    if mandatory > target + 0.005: return NaN, INFEASIBLE_EXACT
    if mandatory < target - 0.005: return target, target - mandatory
    return target, 0
  if policy == "maximum":
    if mandatory > target + 0.005: return NaN, INFEASIBLE_MAX
    return mandatory, 0
  if policy == "minimum":
    return max(mandatory, target), max(0, target - mandatory)
```

### A.3 Multi-tranche allocation

```pseudo
function allocateDebits(trancheStates, periodTrancheDetails, totalPayment):
  remaining = totalPayment
  // 1. Mandatory interest
  for d in periodTrancheDetails sorted by d.id:
    pay = min(d.interest, remaining)
    d.paidInterest = pay
    d.principalFromScheduled += (d.scheduledPayment - d.interest) // if P&I
    remaining -= pay
  // 2. General extra
  if periodTrancheDetails.generalExtra > 0:
    sorted = sortTranchesForExtraRepayment(trancheStates)
    for ts in sorted:
      cap = ts.balance - alreadyPaidPrincipal(ts)
      pay = min(remaining, periodTrancheDetails.generalExtra, cap)
      d = findDetail(ts.id)
      d.extraRepayment += pay
      remaining -= pay
  // 3. Targeted extras
  for extra in extrasByTranche:
    for d in periodTrancheDetails where d.id == extra.targetTrancheId:
      cap = d.balance - paidPrincipal
      pay = min(remaining, extra.amount, cap)
      d.extraRepayment += pay
      remaining -= pay
  // 4. Cap to non-negative
  for d in periodTrancheDetails:
    ts = findState(d.id)
    if d.interestPaid + d.principalFromScheduled + d.extraRepayment > ts.balance + d.interest:
      reduce proportionally
  // 5. Update balances
  for d in periodTrancheDetails:
    ts = findState(d.id)
    ts.balance = roundMoney(ts.balance - (d.principalFromScheduled + d.extraRepayment))
```

### A.4 Offset interest

```pseudo
function interestForPeriod(tranche):
  effective = max(0, tranche.balance - tranche.linkedOffsetBalance)
  periodicRate = tranche.annualRate / periodsPerYear
  return roundMoney(effective * periodicRate)
```

### A.5 Offset events per period

```pseudo
function applyOffsetEvents(trancheStates, offsetEvents, currentDate, frequency):
  for ev in offsetEvents:
    if currentDate < ev.startDate: continue
    if ev.endDate and currentDate > ev.endDate: continue
    triggers = countTriggers(ev, currentDate, frequency)
    ts = findState(ev.targetTrancheId)
    if not ts: continue
    delta = ev.amount * triggers
    ts.linkedOffsetBalance = max(0, roundMoney(ts.linkedOffsetBalance + delta))
```

### A.6 Pareto dominance

```pseudo
function dominates(A, B, objectives, tolerances):
  allWithin = true
  anyStrict = false
  for o in objectives:
    diff = A[o] - B[o]
    tol = tolerances[o]
    if diff > tol: allWithin = false
    if diff < -tol: anyStrict = true
  return allWithin and anyStrict
```

### A.7 Strategy generator pruning

```pseudo
function allocate(idx, currentAlloc, remaining, floatingSoFar, fixedSoFar, trancheCount):
  if PR1_violated(floatingSoFar, remaining) or PR2_violated(fixedSoFar, remaining) or PR3_violated(trancheCount, remaining):
    return
  if remaining == 0:
    if PR4_violated(currentAlloc): return
    emit strategy; return
  if idx >= products.length: return
  product = products[idx]
  for steps in 0..stepCount:
    pct = steps * percentageStep
    if pct > remaining + 1e-9: break
    allocate(idx + 1, currentAlloc + {product, pct}, remaining - pct, update(floatingSoFar, fixedSoFar, trancheCount, product, pct))
```

---

## Appendix B — Out-of-scope but related notes

- The `amortisation.js` currently re-computes `scheduledPayment` on every floating-rate change. This is expensive at long horizons. A future PR can memoize `scheduledPayment` per `(trancheId, annualRate, remainingTerm)`; not in this iteration.
- The page's "loss savings" comparison (`strategy-lab/page.js:508-532`) compares the selected strategy to single-allocation strategies of each product. This is a UI feature, not a Pareto concern. No change.
- The country-adapter's `nzBetas` (`packages/country-adapters/src/nz.js:34-42`) are fixed coefficients. A future PR can introduce a Beta-curve (function of remaining term) per product. Not in this iteration.
- The `getRateForMonth` function in `mortgage-engine/src/refix.js:67-105` and the one in `rate-engine/src/interpolation.js:25-71` are duplicates. A future refactor should consolidate them. Not in this iteration (out of scope for "correctness first").

---

End of spec.
