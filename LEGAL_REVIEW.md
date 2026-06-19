# Legal Review Workstream

> **Status:** _Open — not yet started_
> **Owner:** _TBD (project lead to assign qualified NZ legal counsel)_
> **Priority:** _High — affects consumer-facing copy on every page_

This document tracks the engagement of qualified New Zealand legal counsel to perform a full review of the user-facing legal texts in the RatePath web app. The actual legal text lives in the i18n message dictionaries and is rendered by the `/legal/disclaimer` and `/legal/privacy` pages.

---

## Why this is a separate workstream

The RatePath codebase is a financial-simulation tool. Even though it does **not** provide financial advice and explicitly disclaims that, the disclaimer and privacy texts have direct legal significance under New Zealand consumer and privacy law. Software-engineering review (this PR) can fix bugs, terminology drift, and rendering issues — but **cannot** substitute for a qualified legal review.

The December 2025 i18n audit caught and fixed a number of P0 / P1 / P2 content bugs in this PR:

- **P0:** raw i18n keys leaking to the UI (e.g. `t("strategyLab.progress.currentCombination")` rendered literally)
- **P0:** hard-coded Chinese strings leaking to the en-NZ locale (`关闭`, `所有分片合计`)
- **P1:** ~25–30 hard-coded English UI strings in `strategy-lab/page.js`
- **P1:** `**markdown**` in zh-CN values that did not render as bold
- **P1:** malformed `budgetExample` placeholder (`,000` artefacts)
- **P2:** terminology drift (`分包` vs `分期` for "tranche"), mixed-language explanations, internal jargon (`v11 简化删除`)
- **P2:** ~20 empty v9→v11 dead weight keys removed
- **P2:** ~30 duplicate dictionary keys resolved

What the engineering review **did not** do:

- Substantive rewriting of the disclaimer or privacy texts
- Adding or removing legal claims
- Adjusting statutory citations
- Translating any text into a third language (e.g. `mi-NZ`)
- Engaging counsel to verify whether the existing texts meet CGA 1993, FTA 1986, and Privacy Act 2020 obligations

That remaining scope is captured below.

---

## Scope of the legal review

The reviewer should audit both the **English (`en-NZ`)** and **Chinese (`zh-CN`)** versions of:

| Source | Path | Sections |
|--------|------|----------|
| Disclaimer | `apps/web/messages/{en-NZ,zh-CN}.json` → `legal.disclaimer.*` | 17 narrative sections (`s0`, `s1`, `s1a`, `s1b`, `s2`, `s2a`, `s3`, `s4`, `s5`, `s6`, `s7`, `s8`, `s9`, `s10`, `s11`, `s12`, `s13`, `s14`, `s15`, `s16`) |
| Privacy | `apps/web/messages/{en-NZ,zh-CN}.json` → `legal.privacy.*` | 8 sections (`s1`–`s8`) |
| About summary | `apps/web/messages/{en-NZ,zh-CN}.json` → `about.disclaimerBullets.*` + `about.privacyBullets.*` | Bullet summaries shown on the About page |
| About page | `apps/web/app/about/page.js` | Where the bullets are rendered; the page itself is just markup |
| Disclaimer page | `apps/web/app/legal/disclaimer/page.js` | Renders `legal.disclaimer.*` |
| Privacy page | `apps/web/app/legal/privacy/page.js` | Renders `legal.privacy.*` |

The reviewer should also check the **efficacy** of the legal framing in the about-page summary and the disclaimer page H1, in the context of:

- **Consumer Guarantees Act 1993** — does the "as is" / "no warranty" framing correctly reserve the non-excludable guarantees?
- **Fair Trading Act 1986** — are the "not financial advice" / "mathematical orderings" claims sufficient to avoid misleading conduct?
- **Privacy Act 2020** — does the privacy notice correctly describe the actual data flows (IndexedDB only, no upload, no third-party processors)? Are the Office of the Privacy Commissioner complaint rights correctly described?
- **Contractual capacity / consumer credit** — the app provides mortgage strategy information; is there any risk that NZ regulators (FMA, MBIE) treat it as a financial advice service or a credit advertisement? The current text claims "not advice" and "no forecasts" — is that framing sufficient?

---

## New Zealand statutory anchors (current text already cites these)

- **Consumer Guarantees Act 1993** (sections on non-excludable guarantees, sections 5–6)
- **Fair Trading Act 1986** (sections on misleading conduct, sections 9–13)
- **Privacy Act 2020** (privacy notice + OPC complaint rights)
- **New Zealand law as governing law** (disclaimer s15) — NZ courts, non-exclusive jurisdiction

The reviewer should confirm these citations are still current, that the section numbers are right, and that the framing of reserved rights is unambiguous.

---

## Specific items the reviewer should validate

1. **Liability cap.** The current text caps liability at NZ$100 or fees paid in the last 12 months (whichever higher) — with the note that the app is currently free, so the cap is in principle NZ$100. Is this cap enforceable against consumers? Is it consistent with the CGA's non-excludable guarantees?

2. **"Not financial advice" framing.** The current text says "pure mathematical orderings" and "does not constitute professional financial, lending, tax, or legal advice." Is this framing sufficient under NZ law, or does the app cross a line into regulated activity given the depth of the simulation?

3. **Cross-locale parity.** The English and Chinese texts should be substantively equivalent, not just literal translations. The reviewer should confirm that no legal claim is present in one language and absent in the other.

4. **Effective date.** Currently stamped `2026-06-19` in both `en-NZ` and `zh-CN` (in `about.effectiveDate`, `legal.disclaimer.effective`, `legal.privacy.effective`). The reviewer should confirm the date is the actual last-updated date and that the stamping convention is appropriate.

5. **Bilingual asymmetry.** The `about.effectiveDate` zh-CN value adds a `"本声明"` prefix that the en-NZ does not. This is a stylistic asymmetry, not a substantive issue, but the reviewer should confirm it is acceptable.

6. **No additional languages.** The current scope is `en-NZ` and `zh-CN` only. If the app needs to be deployed in markets where other languages are required, the reviewer should flag the gap.

---

## Engineering checklist (this PR has completed all of these)

- [x] Raw i18n keys do not leak to the rendered UI
- [x] No hard-coded Chinese strings in en-NZ-rendered components
- [x] No hard-coded English strings in zh-CN-rendered UI surfaces
- [x] Both dictionaries parse cleanly
- [x] No duplicate keys
- [x] No dead v9→v11 weight keys
- [x] Markdown `**bold**` replaced with `<strong>` in zh-CN where rendering context requires HTML
- [x] `dashboard.emptyDesc` uses `分期` (consistent with the rest of the app)
- [x] `balanceExplain` (zh-CN) no longer contains untranslated English fragments
- [x] `worstCaseDefenseExplain` (zh-CN) no longer contains cryptic internal jargon
- [x] `budgetExample` is a coherent sentence in both locales
- [x] Strategy Lab warning banners render in both locales
- [x] `StrategyDetailModal` close button + total row read in the active locale
- [x] Progress panel labels read in the active locale
- [x] Existing legal pages unchanged; NZ CGA 1993, FTA 1986, Privacy Act 2020 still cited

---

## What happens after the review

The reviewer will produce a written report. The project lead will triage the findings into:

- **Substantive changes** (alter the meaning of a claim) — require a new PR with both-locale text changes and a code review by the project lead
- **Terminology changes** (improve precision) — handled in the same i18n PR pipeline as the December 2025 audit
- **No-op confirmations** (current text is fine) — captured in this document's acceptance log

---

## Acceptance log

Once the legal review is complete, capture the outcome here. Format:

```
## YYYY-MM-DD — review by <counsel name>, <firm>

- [ ] Disclaimer text: <status>
- [ ] Privacy text: <status>
- [ ] About-page bullets: <status>
- [ ] Statutory citations: <status>
- [ ] Cross-locale parity: <status>
- [ ] Effective date: <status>

Follow-up actions: <list or "none">
```

---

## Out of scope (intentionally)

- The legal review **does not** cover the engine code (`packages/*/src/`) — those are math, not legal claims.
- The legal review **does not** cover the design system, accessibility, or general UI text — those are engineering concerns.
- The legal review **does not** involve rewriting the engine or adding new algorithms.
