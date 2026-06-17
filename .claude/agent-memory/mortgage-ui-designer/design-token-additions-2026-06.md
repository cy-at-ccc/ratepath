---
name: design-token-additions-2026-06
description: Tokens added to apps/web/app/globals.css on 2026-06-18 during the UI polish pass — chart palette, gradients, glows, surface variants.
metadata:
  type: project
---

On 2026-06-18 the UI polish pass added the following design tokens to `apps/web/app/globals.css`:

**Accent palette (chart / callout use only):**
- `--accent-teal: #14b8a6`
- `--accent-cyan: #06b6d4`
- `--accent-blue: #3b82f6`
- `--accent-purple: #8b5cf6`

**Surface variants:**
- `--surface-1: #0f1a2e`
- `--surface-2: #16233b`
- `--surface-3: #1d2b46`
- `--border-strong: rgba(255, 255, 255, 0.12)`

**Font stacks:**
- `--font-num` (tabular numerals)

**Chart palette:**
- `--chart-low` / `--chart-base` / `--chart-high`
- `--chart-grid` / `--chart-axis` / `--chart-baseline`

**Gradients:**
- `--gradient-primary`, `--gradient-primary-soft`, `--gradient-emerald`, `--gradient-rose`
- `--gradient-text-primary`, `--gradient-text-warm`

**Glow shadows:**
- `--glow-primary`, `--glow-emerald`, `--glow-amber`, `--glow-rose`, `--glow-cyan`

**Radii:** `--radius-sm/md/lg/xl`

**Utility classes added:**
- `.glass-panel.accent-{primary|emerald|amber|rose|cyan}` — top accent stripe
- `.gradient-text-primary` / `.gradient-text-warm`
- `.badge-indigo`, `.badge-cyan`
- `.stat-tile` (label + value, hover, optional unit)
- `.btn-cta-run` (gradient + glow Run Simulation button)
- `.progress-bar-fill` (gradient progress)

**Why:** User wanted a richer visual language without disturbing the indigo brand identity. See [[brand-color-is-indigo]].

**How to apply:** When adding new surfaces/cards/charts, reuse these tokens instead of inventing parallel hex values. The `accent-*` modifier classes are the right way to apply the coloured top stripe — don't hand-roll `::before` rules.