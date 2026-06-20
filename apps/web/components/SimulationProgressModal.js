"use client";
// @ts-nocheck — Modal CSS lives alongside component via styled-jsx; types
// are tracked as technical debt (parity with StrategyDetailModal.js).

import { useEffect, useRef } from "react";
import { useI18n } from "../lib/i18n/useI18n.js";

/**
 * SimulationProgressModal — focused-progress popup shown while the strategy
 * matrix is being computed in the Web Worker. Replaces the inline
 * `.progress-panel` previously embedded in section 8 of the Strategy Lab
 * page so the user can always see progress regardless of where their eyes
 * wandered on the page.
 *
 * Phase model — driven by the page based on existing state slots:
 *   running  → progress bar + counts + current-strategy/scenario trio + cancel
 *   success  → check icon + completion message + close; auto-dismisses
 *   cached   → same as success but with "loaded from cache" copy
 *   error    → error icon + worker message + close; waits for user
 *
 * Backdrop click + Escape are inert while running so the user does not
 * accidentally cancel a long-running matrix; they dismiss on completion
 * and error phases. Accessibility, focus trap, and scroll lock mirror the
 * existing PreferenceWeightsModal / StrategyDetailModal recipes.
 *
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {"running"|"success"|"cached"|"error"} props.phase
 * @param {number} props.progress  - 0..100
 * @param {number} props.completedSims
 * @param {number} props.totalSims
 * @param {{combination?: string, fixTerms?: string, scenarioPath?: string, scenarioIndex?: number, scenarioTotal?: number} | null} props.currentSimulationInfo
 * @param {string | null} props.errorMessage
 * @param {boolean} props.simCountIsHigh
 * @param {number} props.simCountWarningThreshold
 * @param {() => void} props.onCancel
 * @param {() => void} props.onDismiss
 * @param {number} [props.autoDismissMs] - Default 900.
 */
export default function SimulationProgressModal(/** @type {any} */ props) {
  const { t } = useI18n();
  const {
    isOpen,
    phase,
    progress,
    completedSims,
    totalSims,
    currentSimulationInfo,
    errorMessage,
    simCountIsHigh,
    simCountWarningThreshold,
    onCancel,
    onDismiss,
    autoDismissMs = 900
  } = props;

  const closeBtnRef = useRef(/** @type {any} */ (null));
  const cancelBtnRef = useRef(/** @type {any} */ (null));
  const lastFocusedRef = useRef(/** @type {any} */ (null));
  const cardRef = useRef(/** @type {any} */ (null));
  const dismissTimerRef = useRef(/** @type {any} */ (null));

  // Focusable selector — same recipe as StrategyDetailModal.js
  const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'textarea:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  // Escape-to-close, focus management, focus trap, scroll lock
  useEffect(() => {
    if (!isOpen) return;
    lastFocusedRef.current = typeof document !== "undefined" ? document.activeElement : null;

    const handler = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === "Escape") {
        // Inert while running — prevents accidental cancellation
        if (phase === "running") return;
        onDismiss?.();
        return;
      }
      // Focus trap: cycle Tab / Shift+Tab inside the modal card
      if (e.key === "Tab" && cardRef.current) {
        const focusables = Array.from(
          cardRef.current.querySelectorAll(FOCUSABLE_SELECTOR)
        ).filter((/** @type {any} */ el) => {
          if (!el || typeof el.getAttribute !== "function") return false;
          if (el.hasAttribute("disabled")) return false;
          if (el.getAttribute("aria-hidden") === "true") return false;
          return el.offsetParent !== null || el === document.activeElement;
        });
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = /** @type {any} */ (focusables[0]);
        const last = /** @type {any} */ (focusables[focusables.length - 1]);
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        } else if (!cardRef.current.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handler);

    // Focus the appropriate action on next tick — close button after
    // completion/error, cancel button while running. The 60 ms delay avoids
    // fighting the open animation.
    const focusTarget = phase === "running" ? cancelBtnRef.current : closeBtnRef.current;
    const timer = setTimeout(() => focusTarget?.focus?.(), 60);

    // Lock scroll on both body AND html — some layouts scroll the document
    // element rather than body, leaving a path open for the browser to
    // scroll the page to top when the focused button grabs focus.
    //
    // v2: also reserve the scrollbar gutter on body via padding-right so the
    // vertical scrollbar disappearing (when overflow flips to hidden) does
    // NOT cause the underlying page to jump horizontally. Without this, the
    // entire layout shifts ~15px on open/close and looks like the page is
    // shaking during frequent progress re-renders.
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      window.removeEventListener("keydown", handler);
      clearTimeout(timer);
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.paddingRight = prevBodyPaddingRight;
      try { lastFocusedRef.current?.focus?.(); } catch { /* ignore */ }
    };
  }, [isOpen, phase, onDismiss]);

  // Auto-dismiss after completion flash (success / cached only).
  // Error waits for the user; running never dismisses.
  useEffect(() => {
    if (!isOpen) return;
    if (phase !== "success" && phase !== "cached") return;
    dismissTimerRef.current = setTimeout(() => {
      onDismiss?.();
    }, autoDismissMs);
    return () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  }, [isOpen, phase, autoDismissMs, onDismiss]);

  if (!isOpen) return null;

  const pct = Math.max(0, Math.min(100, Math.round(progress || 0)));
  const showCancel = phase === "running";
  const showClose = phase !== "running";
  const showWarning = phase === "running" && simCountIsHigh;

  // Phase-driven title and copy
  const titleKey =
    phase === "error"
      ? "strategyLab.progressModal.errorTitle"
      : (phase === "success" || phase === "cached")
        ? "strategyLab.progressModal.completeTitle"
        : "strategyLab.progressModal.title";
  const copyKey =
    phase === "error"
      ? null
      : (phase === "success" || phase === "cached")
        ? null
        : "strategyLab.progressModal.subtitle";

  return (
    <div
      className="prg-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="prg-title"
      aria-describedby={phase === "running" ? "prg-desc" : undefined}
      onClick={(e) => {
        // Backdrop click closes when allowed; inert while running
        if (e.target !== e.currentTarget) return;
        if (phase === "running") return;
        onDismiss?.();
      }}
    >
      <div ref={cardRef} className="prg-card glass-panel" data-phase={phase}>
        {/* HEADER — eyebrow + title + copy + close button (close only on completion/error) */}
        <div className="prg-header">
          <div className="prg-header-text">
            <div className="prg-eyebrow">{t("strategyLab.progressModal.eyebrow")}</div>
            <h3 id="prg-title" className="prg-title">{t(titleKey)}</h3>
            {copyKey && (
              <p id="prg-desc" className="prg-copy">{t(copyKey)}</p>
            )}
          </div>
          {showClose && (
            <button
              ref={closeBtnRef}
              type="button"
              className="prg-close"
              onClick={onDismiss}
              aria-label={t("strategyLab.progressModal.dismissAria")}
            >
              ×
            </button>
          )}
        </div>

        {/* RUNNING: large-count warning when above threshold */}
        {showWarning && (
          <div
            className="prg-warning"
            role="status"
          >
            <div className="prg-warning-title">
              {t("strategyLab.progressModal.warningTitle", { count: totalSims.toLocaleString() })}
            </div>
            <div className="prg-warning-body">
              {t("strategyLab.progressModal.warningBody", { threshold: simCountWarningThreshold.toLocaleString() })}
            </div>
          </div>
        )}

        {/* RUNNING BODY: progress bar + percentage + counts + current simulation trio */}
        {phase === "running" && (
          <div className="prg-body">
            <div
              className="prg-bar-container"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-valuetext={t("strategyLab.progress.simulating", { pct })}
            >
              <div className="prg-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="prg-text-row" aria-live="polite">
              <span className="prg-text-pct">{t("strategyLab.progress.simulating", { pct })}</span>
              <span className="prg-text-counts">
                {t("strategyLab.progress.completed", {
                  done: completedSims.toLocaleString(),
                  total: totalSims.toLocaleString()
                })}
                {currentSimulationInfo?.scenarioTotal > 1 &&
                  t("strategyLab.progress.currentScenario", {
                    idx: (currentSimulationInfo?.scenarioIndex ?? 0) + 1,
                    total: currentSimulationInfo.scenarioTotal
                  })}
              </span>
            </div>
            {currentSimulationInfo && (
              <div className="prg-current-grid">
                <div className="prg-current-cell">
                  <span className="prg-current-label">{t("strategyLab.progress.currentCombination")}</span>
                  <strong className="prg-current-value">{currentSimulationInfo.combination}</strong>
                </div>
                <div className="prg-current-cell">
                  <span className="prg-current-label">{t("strategyLab.progress.currentFixTerms")}</span>
                  <strong className="prg-current-value">{currentSimulationInfo.fixTerms}</strong>
                </div>
                <div className="prg-current-cell">
                  <span className="prg-current-label">{t("strategyLab.progressModal.currentScenarioLabel")}</span>
                  <strong className="prg-current-value">{currentSimulationInfo.scenarioPath}</strong>
                </div>
              </div>
            )}
            <p className="prg-cancel-hint">{t("strategyLab.progressModal.cancelHint")}</p>
          </div>
        )}

        {/* SUCCESS / CACHED: large check icon + completion copy */}
        {(phase === "success" || phase === "cached") && (
          <div className="prg-body prg-body-center">
            <div className="prg-complete" data-tone="emerald">
              <div className="prg-complete-icon" aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className="prg-complete-copy">
                {phase === "cached"
                  ? t("strategyLab.progressModal.completeCached", {
                      done: completedSims.toLocaleString(),
                      total: totalSims.toLocaleString()
                    })
                  : t("strategyLab.progressModal.completeSuccess", {
                      done: completedSims.toLocaleString(),
                      total: totalSims.toLocaleString()
                    })}
              </div>
            </div>
          </div>
        )}

        {/* ERROR: large warning icon + worker message + copy fallback */}
        {phase === "error" && (
          <div className="prg-body prg-body-center">
            <div className="prg-complete prg-complete-error" data-tone="rose">
              <div className="prg-complete-icon prg-error-icon" aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <div className="prg-complete-copy">
                {errorMessage || t("strategyLab.progressModal.errorBody")}
              </div>
            </div>
          </div>
        )}

        {/* FOOTER — single action button (cancel during run, close after) */}
        <div className="prg-footer">
          {showCancel && (
            <button
              ref={cancelBtnRef}
              type="button"
              className="btn btn-secondary"
              onClick={onCancel}
              style={{ width: "100%" }}
            >
              {t("common.cancelSimulation")}
            </button>
          )}
          {showClose && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onDismiss}
              style={{ width: "100%" }}
            >
              {t("strategyLab.progressModal.close")}
            </button>
          )}
        </div>
      </div>

      <style jsx>{`
        /* Layout & container — anchor the modal near the top of the viewport
           (NOT vertically centered) so it does NOT bounce up/down as the
           running content reflows. Centering would amplify even 4-8 px of
           internal height change into a visible shake. */
        .prg-backdrop {
          position: fixed;
          inset: 0;
          z-index: 1205;
          background: #050a12;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 6vh var(--sp-4) var(--sp-4);
          overflow-y: auto;
          animation: prg-fade-in 180ms ease-out;
        }

        .prg-card {
          position: relative;
          width: min(560px, 100%);
          padding: 22px 22px 18px;
          border-radius: var(--radius-xl);
          animation: prg-slide-in 180ms ease-out;
          display: flex;
          flex-direction: column;
          background: #10192d;
          border-color: #263450;
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
        }

        /* Lock card height ONLY for the running phase. Use height (NOT
           min-height) + overflow: hidden so the card NEVER grows or
           shrinks as the simulation streams progress. The previous
           min-height approach let the card expand when the trio's
           current-combination string wrapped onto more lines, which
           made the entire modal visibly bounce. */
        .prg-card[data-phase="running"] {
          height: 420px;
          overflow: hidden;
        }

        /* Header */
        .prg-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--sp-4);
          margin-bottom: var(--sp-5);
        }

        .prg-header-text {
          flex: 1;
          min-width: 0;
        }

        .prg-eyebrow {
          font-size: var(--fs-xs);
          color: var(--color-primary);
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          margin-bottom: 6px;
        }

        .prg-title {
          margin: 0;
          font-size: 20px;
          color: #fff;
          line-height: 1.35;
        }

        .prg-copy {
          margin: 8px 0 0;
          color: var(--text-secondary);
          font-size: var(--fs-md);
          line-height: 1.6;
        }

        .prg-close {
          width: 36px;
          height: 36px;
          border-radius: var(--radius-pill);
          border: 1px solid #394a67;
          background: #16233b;
          color: #fff;
          font-size: 22px;
          line-height: 1;
          cursor: pointer;
          flex-shrink: 0;
          transition: background 120ms ease;
        }

        .prg-close:hover,
        .prg-close:focus-visible {
          background: #1d2b47;
          outline: none;
        }

        /* High-count warning banner (running + simCountIsHigh) */
        .prg-warning {
          margin-bottom: var(--sp-4);
          padding: 10px 12px;
          border-radius: var(--radius-md);
          background: #2a2410;
          border: 1px solid #8a5c11;
          color: var(--chart-amber);
        }

        .prg-warning-title {
          font-weight: 600;
          margin-bottom: 4px;
          font-size: var(--fs-sm);
        }

        .prg-warning-body {
          font-size: var(--fs-xs);
          color: var(--text-muted);
          line-height: 1.5;
        }

        /* Progress bar — 8px track, gradient fill (heavier visual weight than
           the in-page 6px version; matches the gradient used elsewhere). */
        .prg-bar-container {
          height: 8px;
          border-radius: 4px;
          background: #1a2436;
          overflow: hidden;
          margin-bottom: 10px;
        }

        .prg-bar-fill {
          height: 100%;
          background: var(--gradient-primary);
          transition: width 220ms cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: var(--glow-primary);
        }

        .prg-text-row {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: var(--sp-3);
          font-size: var(--fs-sm);
          color: var(--text-secondary);
          margin-bottom: var(--sp-4);
          /* Reserve the row height so changing the count text (e.g.
             "6,281 / 11,508" → "11,508 / 11,508") does NOT push the
             downstream grid up/down. */
          min-height: 20px;
        }

        .prg-text-pct {
          color: var(--color-primary);
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          /* Fixed width prevents the % text from shifting the row's
             baseline when the digit count changes (1-digit → 3-digit). */
          min-width: 96px;
        }

        .prg-text-counts {
          font-variant-numeric: tabular-nums;
          text-align: right;
          flex: 1;
        }

        /* Current simulation trio */
        .prg-current-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
          margin-bottom: var(--sp-4);
        }

        .prg-current-cell {
          padding: 10px 12px;
          border-radius: var(--radius-md);
          background: #16233b;
          border: 1px solid #263450;
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
          /* Lock cell height with overflow hidden. The "current
             combination" string wraps onto 1-3 lines depending on
             allocation count — without a fixed height, each new
             strategy reflows the cell, the grid, the body, and the
             card, making the modal visibly bounce. 78px fits 3 lines
             of 13px text + padding. */
          height: 78px;
          overflow: hidden;
        }

        /* Lock the value's line count so even an unusually long product
           combo (e.g. 4-way split) can't push the cell taller than the
           reserved height. Anything beyond 3 lines is truncated with an
           ellipsis — the combo is also reflected in the page's results
           once the run finishes. */
        .prg-current-value {
          display: -webkit-box;
          -webkit-line-clamp: 3;
          line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
          text-overflow: ellipsis;
          word-break: break-word;
        }

        .prg-current-label {
          font-size: var(--fs-xs);
          color: var(--text-muted);
          font-weight: 500;
        }

        .prg-current-value {
          font-size: var(--fs-sm);
          color: var(--text-primary);
          font-weight: 600;
          line-height: 1.45;
          word-break: break-word;
        }

        .prg-cancel-hint {
          margin: 0;
          padding: 8px 12px;
          border-radius: var(--radius-sm);
          background: #10192d;
          border: 1px solid #263450;
          color: var(--text-muted);
          font-size: var(--fs-xs);
          line-height: 1.5;
        }

        /* Push running-body content to fill the card so the footer (which
           toggles between Cancel and Close) stays anchored to the bottom.
           Without this, the footer would slide up/down as the trio's
           content reflows. */
        .prg-body {
          flex: 1;
          display: flex;
          flex-direction: column;
        }

        /* Centred variant used by the success / error phases — their
           content (icon + copy) is short, so we centre it vertically
           inside the available space instead of pinning to the top. */
        .prg-body-center {
          justify-content: center;
        }

        /* Completion card (success / cached / error) */
        .prg-complete {
          margin: var(--sp-3) 0 var(--sp-4);
          padding: 22px 18px;
          border-radius: var(--radius-lg);
          background: #16233b;
          border: 1px solid #263450;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--sp-3);
          text-align: center;
        }

        .prg-complete[data-tone="emerald"] {
          background: #0f2b21;
          border-color: #1f7a57;
        }

        .prg-complete[data-tone="rose"] {
          background: #2c1219;
          border-color: #8c2940;
        }

        .prg-complete-icon {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: var(--color-emerald);
          color: #042f1e;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: var(--glow-emerald);
          animation: prg-pop-in 320ms cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        .prg-error-icon {
          background: var(--color-rose);
          color: #4c0a1a;
          box-shadow: 0 0 24px rgba(244, 63, 94, 0.35);
        }

        .prg-complete-copy {
          color: var(--text-primary);
          font-size: var(--fs-md);
          line-height: 1.55;
          font-weight: 500;
        }

        /* Footer */
        .prg-footer {
          margin-top: var(--sp-4);
          padding-top: var(--sp-3);
          border-top: 1px solid #263450;
        }

        /* Animations */
        @keyframes prg-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes prg-slide-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes prg-pop-in {
          0%   { opacity: 0; transform: scale(0.6); }
          70%  { opacity: 1; transform: scale(1.08); }
          100% { opacity: 1; transform: scale(1); }
        }

        @media (max-width: 720px) {
          /* Top padding reserves room for the fixed 44×44 mobile nav
             trigger (top: 12px, plus the trigger's own ~44px height).
             The modal is overlay-positioned so it does NOT conflict
             with the trigger itself, but we keep a little extra space
             above the card so the two don't feel crowded. */
          .prg-backdrop {
            padding: calc(12px + 44px + 12px) var(--sp-3) var(--sp-4);
          }
          .prg-card {
            padding: 18px 18px 14px;
            max-height: 92vh;
          }
          /* Mobile: trio grid collapses to 1 column, so three cells stack
             vertically. Total reserved height = 3 cells × 90px + 2 gaps
             × 8px ≈ 286px. The card height here accommodates header +
             bar + text-row + trio + hint + footer + padding. Lock with
             height (not min-height) to prevent any vertical reflow as
             each strategy combo streams in. */
          .prg-card[data-phase="running"] {
            height: 580px;
            overflow: hidden;
          }
          .prg-current-grid {
            grid-template-columns: 1fr;
            gap: 6px;
          }
          .prg-current-cell {
            height: 90px;
            overflow: hidden;
          }
          .prg-title {
            font-size: 18px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .prg-backdrop,
          .prg-card,
          .prg-complete-icon {
            animation: none;
          }
          .prg-bar-fill {
            transition: none;
          }
        }
      `}</style>
    </div>
  );
}
