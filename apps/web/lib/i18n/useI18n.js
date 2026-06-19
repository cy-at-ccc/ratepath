"use client";

import { useContext } from "react";
import { I18nContext } from "./I18nProvider.jsx";

/**
 * Hook into the I18nProvider. Throws if the provider is missing so the
 * developer sees the error during development rather than getting silent
 * `undefined` access.
 *
 * @returns {{
 *   locale: string,
 *   setLocale: (locale: string) => void,
 *   t: (key: string, vars?: Record<string, any>) => string,
 *   formatMoney: (amount: number) => string,
 *   formatPercent: (rate: number, digits?: number) => string,
 *   formatInteger: (n: number) => string,
 *   productDisplayName: (code: string) => string,
 *   dict: Record<string, string>
 * }}
 */
export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used inside <I18nProvider>");
  }
  return ctx;
}
