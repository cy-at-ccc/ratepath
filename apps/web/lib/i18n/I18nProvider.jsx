"use client";

import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_LOCALE,
  FALLBACK_LOCALE,
  dictionaries,
  getDict,
  isSupportedLocale
} from "./dictionaries.js";
import { interpolate } from "./interpolate.js";
import {
  formatInteger as formatIntegerImpl,
  formatMoney as formatMoneyImpl,
  formatPercent as formatPercentImpl,
  productDisplayNameWithDict
} from "./format.js";

/**
 * The localStorage key that holds the user's chosen locale. Kept
 * adjacent to the existing `nav-collapsed` and `ratepath_*` keys.
 */
export const LOCALE_STORAGE_KEY = "ratepath_locale";

/**
 * The React context object consumed by `useI18n`. Exported so the
 * `useI18n` hook can import it without circular references.
 */
export const I18nContext = createContext(/** @type {any} */ (null));

/**
 * Walk a nested dictionary by dot-separated key. Returns the string
 * template if the key resolves to a string, otherwise `undefined`.
 * Used by `makeT` so callers can use dot-paths like
 * `about.features.multiScenario` even when the dictionary stores
 * those keys as nested objects.
 *
 * @param {any} dict
 * @param {string} key
 * @returns {string | undefined}
 */
function lookupDeep(dict, key) {
  if (!dict || typeof dict !== "object") return undefined;
  // The dictionaries in `apps/web/messages/*.json` use a mixed shape:
  //   - Most keys are flat dot-separated strings stored as top-level
  //     properties (e.g. `dict["common.yearFmt"] = "..."`).
  //   - Some keys store nested objects as values (e.g.
  //     `dict["about.features"] = { multiScenario: "...", ... }`), with
  //     the leaf strings reachable only by walking into the object.
  // Try the flat dot-key first; if missing, peel off the longest prefix
  // that resolves to a nested object and recurse into it.
  if (Object.prototype.hasOwnProperty.call(dict, key)) {
    const v = dict[key];
    if (typeof v === "string") return v;
    // If the flat key resolved to an object, descend into it for
    // the remainder of the dotted path.
    if (v && typeof v === "object") {
      const remainder = ""; // already consumed by the prefix
      return lookupDeep(v, remainder);
    }
    return undefined;
  }
  const parts = key.split(".");
  // Try progressively longer flat prefixes: split at the last dot, then
  // the second-to-last, etc. For each, look up the prefix as a flat key;
  // if it resolves to an object, recurse into it with the remaining
  // suffix (everything after the prefix).
  for (let i = parts.length - 1; i >= 1; i--) {
    const prefix = parts.slice(0, i).join(".");
    const suffix = parts.slice(i).join(".");
    if (Object.prototype.hasOwnProperty.call(dict, prefix)) {
      const v = dict[prefix];
      if (v && typeof v === "object") {
        return lookupDeep(v, suffix);
      }
    }
  }
  return undefined;
}

/**
 * Build a `t()` function for a given active dictionary. The function
 * walks the active dictionary first, then the fallback dictionary, and
 * finally returns the bracketed key (with a `console.warn` in dev) so
 * missing translations are visible but never crash the UI.
 *
 * Supports dot-paths so nested dictionary objects resolve too
 * (e.g. `about.features.multiScenario`).
 *
 * @param {Record<string, any>} activeDict
 * @returns {(key: string, vars?: Record<string, any>) => string}
 */
function makeT(activeDict) {
  const fallbackDict = dictionaries[FALLBACK_LOCALE] || {};
  return (key, vars) => {
    const fromActive = lookupDeep(activeDict, key);
    const template = fromActive !== undefined
      ? fromActive
      : lookupDeep(fallbackDict, key);
    if (template === undefined) {
      if (typeof console !== "undefined" && process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn(`[i18n] missing key: ${key}`);
      }
      return `[${key}]`;
    }
    return interpolate(template, vars);
  };
}

/**
 * The provider component. Owns the `locale` state, syncs it to
 * `localStorage` and the document `<html lang>` attribute, and exposes
 * the translator + formatters via context.
 *
 * Designed to be mounted ONCE at the root of the React tree (inside the
 * `I18nShell` client boundary in `app/layout.js`). Re-mounting per page
 * would be safe but pointless.
 *
 * @param {Object} props
 * @param {string} props.initialLocale
 * @param {React.ReactNode} props.children
 */
export function I18nProvider({ initialLocale = DEFAULT_LOCALE, children }) {
  const [locale, setLocaleState] = useState(initialLocale);

  // Read the persisted locale exactly once, after the first paint, to
  // avoid a server/client hydration mismatch (server paints the default
  // English; client may swap to the saved value on the next tick).
  const hydratedFromStorageRef = useRef(false);
  useEffect(() => {
    if (hydratedFromStorageRef.current) return;
    hydratedFromStorageRef.current = true;
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      if (saved && isSupportedLocale(saved) && saved !== initialLocale) {
        setLocaleState(saved);
      }
    } catch (e) {
      // localStorage may be unavailable (private mode, sandboxed iframe);
      // silently fall back to the default.
    }
  }, [initialLocale]);

  // On every locale change: persist to localStorage and keep the
  // document `<html lang>` attribute in sync. The attribute matters for
  // screen readers, browser translation prompts, and the iOS / Chrome
  // auto-zoom heuristics.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch (e) {
      // ignore — best effort
    }
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const setLocale = useCallback((next) => {
    if (!isSupportedLocale(next)) return;
    setLocaleState(next);
  }, []);

  const dict = useMemo(() => getDict(locale) || {}, [locale]);

  const value = useMemo(() => {
    const t = makeT(dict);
    return {
      locale,
      setLocale,
      t,
      dict,
      formatMoney: (/** @type {number} */ n) => formatMoneyImpl(n, locale),
      formatPercent: (/** @type {number} */ r, /** @type {number} */ d) => formatPercentImpl(r, locale, d),
      formatInteger: (/** @type {number} */ n) => formatIntegerImpl(n, locale),
      productDisplayName: (/** @type {string} */ code) => productDisplayNameWithDict(code, dict)
    };
  }, [locale, setLocale, dict]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
