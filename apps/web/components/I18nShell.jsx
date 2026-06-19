"use client";

import { useEffect } from "react";
import { I18nProvider } from "@/lib/i18n/I18nProvider.jsx";
import { useI18n } from "@/lib/i18n/useI18n.js";

/**
 * Tiny client-only helper that overwrites `document.title` to the
 * active locale's `meta.title` on every change. Necessary because the
 * static Next.js `metadata.title` export only paints the build-time
 * default (English) on the server.
 */
function DocumentTitleSync() {
  const { t } = useI18n();
  useEffect(() => {
    if (typeof document === "undefined") return;
    try {
      document.title = t("meta.title");
    } catch (e) {
      // ignore — best effort
    }
  }, [t]);
  return null;
}

/**
 * The single client boundary that sits between the (server) root
 * layout and the rest of the React tree. Hosts the I18nProvider and
 * synchronises the document title.
 *
 * Kept as a separate component (not merged into I18nProvider) so the
 * provider remains pure and free of DOM side-effects; this shell owns
 * the title sync + future cross-cutting client behaviour.
 *
 * @param {Object} props
 * @param {string} props.initialLocale
 * @param {React.ReactNode} props.children
 */
export default function I18nShell({ initialLocale, children }) {
  return (
    <I18nProvider initialLocale={initialLocale}>
      <DocumentTitleSync />
      {children}
    </I18nProvider>
  );
}
