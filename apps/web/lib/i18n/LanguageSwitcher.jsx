"use client";

import { useI18n } from "./useI18n.js";

/**
 * Compact two-button language switcher (EN | 中) for the sidebar.
 *
 * Reads the active locale + setter from the i18n context. Visual styling
 * is intentionally minimal — the segmented buttons reuse the design
 * tokens defined in `apps/web/app/globals.css` (color-primary,
 * color-emerald, etc.) and styled-jsx for the segment background.
 *
 * @param {Object} [props]
 * @param {string} [props.className] - Optional className for the outer
 *   wrapper. Used to position the switcher in the sidebar or bottom
 *   tab bar via the consumer's flex layout.
 */
export default function LanguageSwitcher({ className = "" }) {
  const { locale, setLocale, t } = useI18n();
  const isEn = locale === "en-NZ";
  const isZh = locale === "zh-CN";

  return (
    <div
      className={`lang-switch ${className}`}
      role="group"
      aria-label={t("nav.languageToggle")}
    >
      <button
        type="button"
        aria-pressed={isEn}
        className={`lang-btn ${isEn ? "active" : ""}`}
        onClick={() => setLocale("en-NZ")}
      >
        EN
      </button>
      <button
        type="button"
        aria-pressed={isZh}
        className={`lang-btn ${isZh ? "active" : ""}`}
        onClick={() => setLocale("zh-CN")}
      >
        中
      </button>
      <style jsx>{`
        .lang-switch {
          display: inline-flex;
          align-items: center;
          gap: 0;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border-glass);
          border-radius: var(--radius-pill);
          padding: 2px;
          height: 28px;
          flex-shrink: 0;
        }
        .lang-btn {
          appearance: none;
          background: transparent;
          border: 0;
          color: var(--text-secondary);
          font-family: var(--font-heading);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
          padding: 0 10px;
          height: 22px;
          border-radius: var(--radius-pill);
          cursor: pointer;
          transition: var(--transition-smooth);
          min-width: 32px;
        }
        .lang-btn:hover {
          color: #fff;
        }
        .lang-btn.active {
          background: var(--gradient-primary);
          color: #fff;
          box-shadow: 0 0 8px rgba(99, 102, 241, 0.35);
        }
        .lang-btn:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 1px;
        }
      `}</style>
    </div>
  );
}
