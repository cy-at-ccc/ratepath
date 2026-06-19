import enNZ from "@/messages/en-NZ.json";
import zhCN from "@/messages/zh-CN.json";

/**
 * Supported locales and their bundled dictionaries. Add a new locale by
 * (1) creating `apps/web/messages/<locale>.json` and (2) adding the entry
 * here. The provider falls back to `zh-CN` then to the bracketed key when
 * a translation is missing, so partial-EN dictionaries stay safe.
 */
export const dictionaries = {
  "en-NZ": enNZ,
  "zh-CN": zhCN
};

/**
 * Source-of-truth locale identifiers. The first entry is the SSR default
 * (English, per the product requirement). The provider honours any of
 * these values when read from `localStorage` or supplied via `setLocale`.
 */
export const SUPPORTED_LOCALES = /** @type {const} */ (["en-NZ", "zh-CN"]);

/**
 * Default locale. Rendered SSR-side; client may switch on mount if
 * `localStorage.ratepath_locale` holds a different supported value.
 */
export const DEFAULT_LOCALE = "en-NZ";

/**
 * Fallback locale. Used when a key is missing in the active locale. We
 * deliberately point this at `zh-CN` (the only dictionary that is fully
 * populated) so partial-EN translations never leak bracketed keys into
 * production.
 */
export const FALLBACK_LOCALE = "zh-CN";

/**
 * Resolve a dictionary for the given locale, falling back to the
 * fallback locale (and finally to `undefined` — the consumer is expected
 * to return the bracketed key form when this happens).
 *
 * @param {string} locale
 * @returns {Record<string, string>|undefined}
 */
export function getDict(locale) {
  if (dictionaries[locale]) return dictionaries[locale];
  if (dictionaries[FALLBACK_LOCALE]) return dictionaries[FALLBACK_LOCALE];
  return undefined;
}

/**
 * Quick membership test for a locale identifier. Accepts the exact string
 * in `SUPPORTED_LOCALES`.
 *
 * @param {string} locale
 * @returns {boolean}
 */
export function isSupportedLocale(locale) {
  return SUPPORTED_LOCALES.includes(/** @type {any} */ (locale));
}
