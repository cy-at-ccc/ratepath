---
name: svg-chart-upgrade-pattern
description: Recipe for adding gradient area fills, animated entry, smart crosshair and year-based axis to the SvgChart component.
metadata:
  type: project
---

The `apps/web/components/SvgChart.js` was upgraded on 2026-06-18 with the following reusable pattern (preserve when extending):

1. **Resolve CSS-variable colours** — series `data[].color` may be `var(--color-primary)`; use `resolveColor()` to walk `getComputedStyle(document.documentElement)` for the actual hex. Required because `<linearGradient>` `<stop>` elements need real colours, not `var()` references.

2. **Gradient area fill** — emit `<linearGradient id="chart-grad-{reactId}-{seriesId}">` inside `<defs>` with three stops (top: high alpha, mid: low alpha, bottom: 0). Close the line path to the baseline to form the area `<path>`. Render the area *before* the line so the line sits on top.

3. **Animated entry** — `stroke-dasharray: 2000` + `stroke-dashoffset: 2000` → `0` over ~700ms, with `animation-delay` per series for staggered entry. Respect `prefers-reduced-motion` via a `matchMedia` listener and skip the animation when reduced.

4. **Year-based X axis** — tick every 6 months for ≤18-month series, every 12 months otherwise. Format as `Y1`, `Y2`, `Y3` (with optional `m6` for mid-year ticks). Tooltip uses `第 N 个月 (Y{n}m{m})`.

5. **Smart crosshair** — vertical dashed line + per-series horizontal dashed segment. Glow-ring dot on each active series (inner solid + outer translucent). The `aria-hidden` and tab order are unchanged — chart is decorative for the hover details panel.

6. **Interactive legend** — pill buttons toggle a `hiddenSeries` Set; muted/line-through styling when off; tooltip rows show muted state for hidden series. Each legend item uses `aria-pressed` and `aria-label`.

7. **Empty state** — centered dashed glass box with a small icon and label, not plain text.

8. **Linter gotcha** — accessing `getComputedStyle` requires `globalThis.getComputedStyle(...)` cast as `any` to satisfy `no-undef` eslint without polluting the browser globals allowlist.

**Why:** User explicitly asked for premium-grade charts ("make the charts and data visualisations look genuinely premium-grade, not just functional") — see the original polish task.

**How to apply:** Future chart work should extend this component (e.g. add scenarios overlay or comparative plots) rather than fork it. New series should still supply `{id, name, color, points}` so legend/hidden-state machinery keeps working.