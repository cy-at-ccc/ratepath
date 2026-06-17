# RatePath Web App (`apps/web`)

> See also: [`AGENTS.md`](./AGENTS.md) — Next.js 16 has breaking changes vs. training data; read `node_modules/next/dist/docs/` before writing Next-specific code.

Next.js 16.2.9 front-end (App Router, React 19.2.4) on port **4321**. UI in `zh-CN`; all default data is for the **New Zealand** mortgage market. The app is a thin presentation layer over the `@mortgage/*` engine packages — it does **no** financial computation itself; everything heavy runs in `workers/simulation.worker.js`.

## Quick Commands

```bash
# From repo root
npm run dev       # next dev on 4321
npm run build     # sets NEXT_PUBLIC_BUILD_ID=$(git rev-parse --short HEAD) then next build
npm run start     # next start on 4321
npm run lint      # eslint (uses apps/web/eslint.config.mjs)
```

`build` stamps a short git SHA into `process.env.NEXT_PUBLIC_BUILD_ID`; the settings page reads it (falls back to `"dev"` outside a git checkout). `eslint-config-next@16.2.9` is pinned to match the bundled Next — don't bump it independently.

## Directory Layout

```text
apps/web/
├── app/
│   ├── layout.js              # Root layout: zh-CN <html>, Navbar, StyledJsxRegistry
│   ├── page.js                # Dashboard (default route "/")
│   ├── mortgage-setup/        # Mortgage configuration page
│   ├── strategy-lab/          # Strategy Lab — main simulation driver
│   ├── about/                 # Market config, privacy notice, version info
│   ├── registry.js            # styled-jsx SSR registry (Server Component)
│   └── globals.css            # Global dark-mode design tokens (CSS variables)
├── components/
│   ├── Navbar.js              # Collapsible sidebar (persists state to localStorage)
│   └── SvgChart.js            # Inline SVG chart helper
├── features/
│   └── storage.js             # IndexedDB wrapper (openDB, dbGet, dbPut, dbGetAll, dbDelete)
└── workers/
    └── simulation.worker.js   # Only place that imports @mortgage/simulation-engine
```

## Routes (App Router)

| Path | Page | Purpose |
| --- | --- | --- |
| `/` | `app/page.js` | Dashboard: read OCR/floating/fixed-6m..5y rates, edit custom market rates (persisted to `localStorage`), and link into setup/strategy-lab. |
| `/mortgage-setup` | `app/mortgage-setup/page.js` | Mortgage + tranche configuration, persisted to IndexedDB `mortgages` store. |
| `/strategy-lab` | `app/strategy-lab/page.js` | Sliders (`shortTermChange`, `mediumTermDirection`, `changeSpeed`, `uncertainty`), split constraints, preference weights. Posts the full simulation matrix to the worker. |
| `/about` | `app/about/page.js` | Market config (NZ), privacy notice (zero upload, IndexedDB-only, Web Worker sandbox), disclaimer, build info. |

## State Persistence

- **IndexedDB** (`features/storage.js`) — DB `MortgageStrategyDB` v1, stores: `mortgages`, `scenarios`, `constraints`, `savedResults`, `marketCache`. All ops are typed in JSDoc; SSR is rejected with a clear error. The `dbPromise` singleton resets itself on `onerror`/`onblocked` so a transient failure can be retried.
- **localStorage** — `ratepath_custom_market_rates` (Dashboard's editable OCR-anchored rate panel) and `nav-collapsed` (Navbar collapsed/expanded flag).
- **Server state / build info** — `process.env.NEXT_PUBLIC_BUILD_ID` (stamped at `build` time).

`features/storage.js` is the only file that touches IndexedDB; pages should not open the DB directly. The `mortgages` store is `keyPath: "id"` but the UI does not enforce an id policy — any pushed object is read back as-is.

## Web Worker Boundary

`workers/simulation.worker.js` is the **single** call site for `simulateStrategyScenarioMatrix` from `@mortgage/simulation-engine`. The page posts:

```js
{ mortgage, strategies, scenarios, products, currentProductRates, startDate, forecastMonths, maxAffordablePayment }
```

…and reads back messages of shape `{ type: "progress" | "success" | "error", ... }`. The worker also forwards an `onProgress(completed, total)` callback as `{ type: "progress" }` messages so the UI can render a progress bar.

## Styling

- **Global dark theme** lives in `app/globals.css` — uses CSS variables (`--bg-primary`, `--text-primary`, `--color-primary`, `--color-emerald/amber/rose`, etc.) and Inter/Outfit font families. All pages assume dark mode; do not introduce a light-mode toggle without coordinating the design tokens.
- **Component styles** use **styled-jsx** (`<style jsx>{`...`}</style>`). The App Router requires the SSR registry in `app/registry.js` — keep `<StyledJsxRegistry>` wrapping `{children}` in `layout.js` or styles will silently fail to flush on the server.
- Common utility classes: `.glass-panel`, `.form-group`, `.form-input`, `.slider-input`, `.btn` / `.btn-primary` / `.btn-secondary`, `.badge` / `.badge-emerald|amber|rose`, `.dashboard-grid`, `.text-emerald|amber|rose|secondary`.
- Layout grid: `.app-container` (flex row → column at ≤768px). The Navbar doubles as a fixed bottom bar on mobile (`@media (max-width: 768px)`); main content gets `padding-bottom: 90px` to clear it.

## Path Aliases

- `@/*` → `./` (resolved via `jsconfig.json` in this package). Used for *intra-app* imports.
- `@mortgage/*` → `packages/*/src` (resolved by the **root** `jsconfig.json` and the **root** `vitest.config.js`). Used to import engine packages — never deep-import into `packages/...` from app code.
- The `next.config.mjs` is the default config (no webpack/alias overrides); Next resolves `@mortgage/*` automatically.

## Things to Watch For

- **Next.js 16 is not the Next you know.** `AGENTS.md` (linked at top) requires reading `node_modules/next/dist/docs/` before writing Next-specific code. APIs, file conventions, and even the App Router shape may differ from older training data.
- **No build pipeline for packages.** `@mortgage/*` deps are pinned to `*`; packages are consumed by source through path aliases. Any breaking change in a package will silently break the web app until a type-check or runtime error surfaces it.
- **Workers cannot import React or DOM APIs.** The worker only calls the pure simulation engine — keep all browser globals (window, localStorage, etc.) out of `workers/`.
- **CSS classes vs styled-jsx scoping.** styled-jsx scopes by component — `:global(...)` is required when targeting global utility classes (e.g. `.nav-link` in `Navbar.js`). Don't sprinkle `:global` needlessly; that defeats the scoping guarantee.
- **Numeric rates are decimals** (`0.0525` = 5.25%) throughout the engine boundary. Do not round or percentage-format before crossing into `@mortgage/*` calls.
- **The Dashboard's "edit market rates" panel anchors everything to OCR** — adjusting the OCR slider shifts every other product rate by the same margin (preserving each product's spread). Replicate this if you refactor the panel.
- **The `mortgages` IndexedDB store has no id uniqueness enforcement at the UI layer.** Treat any pushed object as-is; add schema-level id checks if you need strict de-duplication.
