/**
 * Locale-aware formatting helpers. These intentionally stay thin — we use
 * the built-in `Intl` APIs with an explicit locale argument so the output
 * is deterministic across server-rendered HTML and the client. The `$`
 * (NZD) symbol is kept as a literal for both locales: the audience is
 * New Zealand borrowers regardless of UI language, and `NZ$` / `NZD `
 * prefixes were rejected as regressions for both groups.
 *
 * Every helper is a pure function — no DOM, no React — so it is safe to
 * import from both the React tree and the simulation Web Worker.
 */

/**
 * Map a `nzProfile.products[i].code` (e.g. `floating`, `fixed-1y`) to a
 * dictionary key under `common.*`. Used by the page-level product name
 * helper so the strategy detail split can be rendered in the active
 * language without duplicating the country-adapter's product list.
 *
 * @param {string} productCode
 * @returns {string}
 */
function productCodeToKey(productCode) {
  switch (productCode) {
    case "floating": return "floating";
    case "fixed-6m": return "fixed6m";
    case "fixed-1y": return "fixed1y";
    case "fixed-18m": return "fixed18m";
    case "fixed-2y": return "fixed2y";
    case "fixed-3y": return "fixed3y";
    case "fixed-5y": return "fixed5y";
    default: return productCode;
  }
}

/**
 * Return a localised display name for the given product code, or the
 * raw code if no translation is found (mirrors the `nzProfile` fallback).
 *
 * The implementation reads the active dictionary directly (no `t()`
 * closure) so it can be invoked before the provider is mounted (e.g. in
 * the I18nShell) without a circular dependency.
 *
 * @param {string} productCode
 * @param {Record<string, any>} dict
 * @returns {string}
 */
export function productDisplayNameWithDict(productCode, dict) {
  const key = `common.${productCodeToKey(productCode)}`;
  if (dict && typeof dict[key] === "string") return dict[key];
  return productCode;
}

/**
 * Format a currency amount as `$<grouped-integer>`. The grouping shape
 * follows the locale (en-NZ: `,` thousands separator; zh-CN: same), and
 * we round to the nearest dollar because sub-dollar precision in this UI
 * is meaningless (loan amounts are ≥$1,000).
 *
 * @param {number} amount
 * @param {string} locale
 * @returns {string}
 */
export function formatMoney(amount, locale) {
  const value = Number.isFinite(amount) ? Math.round(amount) : 0;
  let formatted;
  try {
    formatted = new Intl.NumberFormat(locale, {
      maximumFractionDigits: 0
    }).format(value);
  } catch (_) {
    formatted = String(value);
  }
  return `$${formatted}`;
}

/**
 * Format a decimal rate (e.g. `0.0525`) as a localised percentage string
 * (e.g. `"5.25%"`). The number of digits is configurable.
 *
 * @param {number} rate
 * @param {string} locale
 * @param {number} [digits=2]
 * @returns {string}
 */
export function formatPercent(rate, locale, digits = 2) {
  const value = Number.isFinite(rate) ? rate : 0;
  try {
    return new Intl.NumberFormat(locale, {
      style: "percent",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    }).format(value);
  } catch (_) {
    return `${(value * 100).toFixed(digits)}%`;
  }
}

/**
 * Format an integer count with the locale's grouping separator. Useful
 * for sim counts, table counts, and similar non-currency integers.
 *
 * @param {number} n
 * @param {string} locale
 * @returns {string}
 */
export function formatInteger(n, locale) {
  const value = Number.isFinite(n) ? Math.round(n) : 0;
  try {
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits: 0
    }).format(value);
  } catch (_) {
    return String(value);
  }
}
