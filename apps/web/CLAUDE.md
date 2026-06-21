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
| `/` | `app/page.js` | **Redirects to `/lab`.** This is a thin client-side `router.replace("/lab")` page; the historical Mortgage Dashboard source is preserved at `app/_legacy/dashboard/page.js` (see "Hidden Premium Pages" below). |
| `/lab` | `app/lab/page.js` | **New public homepage.** 6-question Easy Strategy wizard that produces a single recommended split. Drives the same engine pipeline as Strategy Lab. |
| `/mortgage-setup` | `app/mortgage-setup/page.js` | Mortgage + tranche configuration, persisted to IndexedDB `mortgages` store. **Premium-gated — see below.** |
| `/strategy-lab` | `app/strategy-lab/page.js` | Sliders (`shortTermChange`, `mediumTermDirection`, `changeSpeed`, `uncertainty`), split constraints, preference weights. Posts the full simulation matrix to the worker. **Premium-gated — see below.** |
| `/about` | `app/about/page.js` | Market config (NZ), privacy notice (zero upload, IndexedDB-only, Web Worker sandbox), disclaimer, build info. |
| `/legal/privacy`, `/legal/disclaimer` | `app/legal/privacy/page.js`, `app/legal/disclaimer/page.js` | Privacy policy and disclaimer pages. Linked from `/about` and from the in-app footer. |

## Hidden Premium Pages

Three pages belong to the planned **PREMIUM tier** and are **temporarily hidden from the navbar** for free-tier users. They are still fully present in the codebase and remain accessible via direct URL — the premium gate is not implemented yet (it will be added when the premium user feature is built). **DO NOT DELETE these files.**

| Page | Path | File | Status |
| --- | --- | --- | --- |
| 房贷控制面板 (Dashboard) | `/` → redirected to `/lab`; legacy source kept at `_legacy/dashboard` | `apps/web/app/_legacy/dashboard/page.js` | Premium-only (planned) |
| 房贷信息配置 (Mortgage Setup) | `/mortgage-setup` | `apps/web/app/mortgage-setup/page.js` | Premium-only (planned) |
| 策略仿真实验室 (Strategy Lab) | `/strategy-lab` | `apps/web/app/strategy-lab/page.js` | Premium-only (planned) |

### Why the files are kept

- **Dashboard** (`_legacy/dashboard/page.js`): only writes to the `mortgages` IndexedDB store + custom market rates editor. Premium users will need this view back. The folder is prefixed with `_` so Next.js App Router treats it as a **private (non-routable)** folder — the file is never served at any URL.
- **Mortgage Setup** (`/mortgage-setup`): only writes to the `mortgages` store. Required input for any simulation (lab and strategy-lab both depend on the data model).
- **Strategy Lab** (`/strategy-lab`): drives the `@mortgage/*` engine packages. Removing it would regress engine integration confidence; premium users need the full slider-based surface.

### How to identify these files

Each file starts with a `⚠️ PREMIUM-GATED PAGE — DO NOT DELETE ⚠️` banner explaining why it is kept and how to re-enable it. The banner includes a 4-6 bullet rationale and a pointer to this section.

### How to re-enable (future premium tier)

1. Uncomment the corresponding entry in `apps/web/components/Navbar.js#navItems` (the entries are preserved as a comment block so the i18n keys + icon SVGs are not lost).
2. Add a route guard (`<PremiumGate>`) when the premium system is built.
3. Move the legacy dashboard back to `app/page.js` if `/` should re-route to it for premium users (today it redirects to `/lab`).

### What is NOT premium

- `/lab` (the new public homepage) — free for everyone.
- `/about` (legal + market config) — free for everyone.
- `/legal/privacy`, `/legal/disclaimer` — free for everyone.

## Hidden Premium UI (inside the `/lab` results step)

In addition to the hidden premium **pages** above, the `/lab` results card has one premium **UI element** that is hidden from free-tier users:

| UI element | Location | Status |
| --- | --- | --- |
| "跳到高级实验室 / Open advanced lab" button + matching premium popup modal | `apps/web/app/lab/page.js` results step | Hidden — premium tier not built yet |

### Why this is hidden

The button opens an informational "Advanced Lab" popup (an amber-accented modal) that today only says "this is for premium users, coming soon". Since premium is not implemented, the button would just navigate to a page that doesn't exist yet — so the entire element is hidden from free-tier users.

### Why the code is kept

The button + popup JSX, the `premiumPopupOpen` state, the `upgradeBtnRef` ref, the `closePremiumPopup` callback, the body-scroll-lock effect, and the `.premium-popup-scrim` / `.premium-popup` CSS are all **kept** in the file with `⚠️ PREMIUM-GATED UI — DO NOT DELETE ⚠️` banners. The two render blocks are wrapped in `{false && (...)}` so they compile and lint clean but never reach the DOM.

### How to identify

- Both render blocks begin with `⚠️  PREMIUM-GATED UI — DO NOT DELETE ⚠️`.
- The `premiumPopupOpen` state declaration has the same banner above it.

### How to re-enable this UI element

1. In the results step, change `{false && (` back to `{` (one-line edit on the upgrade button).
2. In the popup JSX, change `{false && premiumPopupOpen && (` back to `{premiumPopupOpen && (`.
3. The premium popup title/body/OK strings (`lab.premium.title`, `lab.premium.body`, `lab.premium.ok`) and the button label (`lab.results.upgrade`) are already in both message files — no i18n work needed.
4. Once premium routing exists, replace the popup body with a real upgrade CTA (e.g. link to `/premium/checkout`).

### Related premium UI (NOT yet hidden — being kept honest)

- `lab.results.upgrade` i18n key — **kept** so future re-enable needs no retranslation.
- `lab.premium.title/body/ok` i18n keys — **kept** for the same reason.
- Privacy-notice clause `legal.privacy.s3.l6` enumerating "提供账号体系、订阅、付费、内购或登录功能" — describes future capabilities, no implementation.

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
