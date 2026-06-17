---
name: brand-color-is-indigo
description: RatePath's brand/primary color is indigo #6366f1 — do NOT change it; use the palette blues/teals/cyan/purple as accents only.
metadata:
  type: feedback
---

The existing primary token in `apps/web/app/globals.css` is `--color-primary: #6366f1` (indigo) — this is the brand colour. The system prompt's `palette` suggests blues/teals/cyan/purple, but the user explicitly said **keep indigo as the brand colour** and only use the other palette colours as accents in charts and select callouts.

**Why:** The user stated this in the initial polish task spec: "Do not change the existing primary color — keep indigo as the brand color. Add the blues/teals/cyan/purple from the palette as **accent** colors used in charts and select callouts only. This keeps the existing brand identity intact while enriching the visual language."

**How to apply:** When adding new visual treatments:
- Primary borders, gradients, buttons, accents → indigo (`var(--color-primary)` / `#6366f1`).
- Chart low scenario → emerald (`var(--color-emerald)`).
- Chart high scenario → rose (`var(--color-rose)`).
- Chart base scenario → indigo.
- Optional accent stripes/gauges → cyan, teal, purple, rose, amber per surface type.
- See [[design-token-additions-2026-06]] for the full token list introduced in this polish pass.