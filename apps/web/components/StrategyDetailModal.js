"use client";
// @ts-nocheck — Modal CSS lives alongside component via styled-jsx; types
// are tracked as technical debt.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import SvgChart from "./SvgChart.js";
import { useI18n } from "../lib/i18n/useI18n.js";
import useMediaQuery from "../lib/hooks/useMediaQuery.js";

/**
 * StrategyDetailModal — full-detail popup for any benchmark / preference /
 * Pareto-row strategy. Replaces the previous inline expand-in-place
 * "60 个月细节汇总" section with a centred overlay so users always see a
 * consistent, dismissable surface regardless of where they triggered the
 * detail view.
 *
 * Props are intentionally permissive — the page passes either a benchmark
 * record (with pros/cons) or a raw Pareto-row record. The modal normalises
 * both shapes and falls back gracefully when a field is missing.
 *
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {() => void} props.onClose
 * @param {any} props.strategy - ranked-strategy record (or null)
 * @param {any} [props.recommendation] - optional rec context for header badge
 * @param {boolean} [props.showInlineTimeline] - render timeline panel
 * @param {any} [props.detailTimelineData] - prebuilt timeline rows
 * @param {string} [props.detailScenarioLabel] - "概率加权期望路径" etc.
 * @param {boolean} [props.isDetailLoading]
 * @param {(n: number) => string} [props.formatMoney]
 * @param {{whyThisOne: string, tradeOff: Array<{label: string, status: string}>, suitableFor: string[], comparison: Array<{label: string, interestDelta: number, stabilityDelta: number}>} | null} [props.intro]
 *   - v9: personalised "why this card picked this strategy" block. When the
 *     page passes a non-null intro, the modal renders 4 sub-sections above
 *     its metrics grid (whyThisOne / tradeOff / suitableFor / comparison).
 */
export default function StrategyDetailModal(/** @type {any} */ props) {
  const {
    isOpen,
    onClose,
    strategy,
    recommendation = null,
    showInlineTimeline = false,
    detailTimelineData = null,
    detailScenarioLabel = null,
    isDetailLoading = false,
    formatMoney: formatMoneyProp,
    intro = null
  } = props;

  const { t, formatMoney: formatMoneyCtx, productDisplayName } = useI18n();
  // Caller-supplied formatter wins so the page can keep its existing
  // money-formatting pipeline; otherwise fall back to the i18n context's
  // locale-aware formatter.
  const formatMoney = formatMoneyProp || formatMoneyCtx;

  const closeBtnRef = useRef(/** @type {any} */ (null));
  const lastFocusedRef = useRef(/** @type {any} */ (null));
  const cardRef = useRef(/** @type {any} */ (null));
  const rotateScrollerRef = useRef(/** @type {any} */ (null));

  // Rotation overlay state — true when user has tapped "横屏查看" on the
  // table header in portrait-mobile and the table is shown fullscreen,
  // rotated 90deg. Resets whenever the modal closes (see useEffect below).
  const [tableRotated, setTableRotated] = useState(false);

  // Show the rotate CTA on narrow portrait viewports, or any viewport
  // too short to comfortably show the full timeline table inline
  // (e.g. landscape phones where vh is typically 320–430 px).
  const showRotateCta = useMediaQuery("(max-width: 768px) and (orientation: portrait), (max-height: 500px)");

  // Focusable selector — used by the focus trap below
  const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'textarea:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  // Escape-to-close, focus management, focus trap
  useEffect(() => {
    if (!isOpen) return;
    lastFocusedRef.current = typeof document !== "undefined" ? document.activeElement : null;
    const handler = (/** @type {any} */ e) => {
      if (e.key === "Escape") {
        // Inner rotation overlay intercepts Escape before the modal closes —
        // user expects to dismiss the layered surface, not lose the whole modal.
        if (tableRotated) {
          setTableRotated(false);
          return;
        }
        onClose?.();
        return;
      }
      // Focus trap: cycle Tab / Shift+Tab inside the modal card
      if (e.key === "Tab" && cardRef.current) {
        const focusables = Array.from(
          cardRef.current.querySelectorAll(FOCUSABLE_SELECTOR)
        ).filter(/** @type {any} */(el) => {
          // Skip elements that are visually hidden (offsetParent is null when display:none)
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
    // Focus close button on next tick so the autofocus doesn't fight the open animation
    const t = setTimeout(() => closeBtnRef.current?.focus(), 60);
    // Lock background scroll while modal open
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      clearTimeout(t);
      document.body.style.overflow = prevOverflow;
      // Restore focus to whatever opened the modal
      try { lastFocusedRef.current?.focus?.(); } catch { /* ignore */ }
    };
  }, [isOpen, onClose, tableRotated]);

  // Reset the rotation overlay whenever the modal closes, so the next open
  // starts in the normal portrait layout (no stale rotated state if the
  // user closed the modal while the table was flipped).
  useEffect(() => {
    if (!isOpen) setTableRotated(false);
  }, [isOpen]);

  // Auto-scroll the rotated scroller to top-left on enter, so the user
  // starts seeing the row labels (leftmost columns of the original table,
  // which appear at the top of the rotated frame). Without this the
  // browser preserves the previous scroll position which can leave the
  // user looking at the wrong end of a wide table.
  useEffect(() => {
    if (!tableRotated) return;
    // Wait one tick so the portal node is mounted before we scroll.
    const id = setTimeout(() => {
      const el = rotateScrollerRef.current;
      if (!el) return;
      el.scrollLeft = 0;
      el.scrollTop = 0;
    }, 0);
    return () => clearTimeout(id);
  }, [tableRotated]);

  if (!isOpen || !strategy) {
    return (
      <style jsx>{`
        .sdm-backdrop { display: none; }
      `}</style>
    );
  }

  const fmtPct = (/** @type {number} */ n) => `${(n * 100).toFixed(1)}%`;
  const fmtMoney = formatMoney;
  const allocationCount = strategy.allocationCount || 1;
  const splitCountLabel = allocationCount === 1 ? t("common.splitCountOne") : t("common.splitCountN", { n: allocationCount });
  const pros = Array.isArray(strategy.pros) ? strategy.pros : [];
  const cons = Array.isArray(strategy.cons) ? strategy.cons : [];
  const badgeLabel = recommendation?.badgeLabel || (recommendation?.type === "preference" ? t("strategyDetail.badgePreference") : t("strategyDetail.badgeStrategyDetail"));
  // Use friendly Chinese label from caller (page passes a label map) before
  // falling back to the rec type. Avoid leaking internal keys like
  // "lowestEndingBalance" to the user.
  const friendlyRecLabel = recommendation?.label
    || (recommendation?.type && recommendation.type !== "row" ? null : null);
  const description = recommendation?.description || t("strategyDetail.description");

  // Allocation list — page enriches strategy.allocations with displayName,
  // percentage, amount, isFloating and fixedMonths. Fall back to [] when
  // the caller forgot to enrich (defensive).
  const allocations = Array.isArray(strategy.allocations) ? strategy.allocations : [];
  const totalAllocationAmount = allocations.reduce((sum, a) => sum + (a.amount || 0), 0);
  const floatingTotal = allocations
    .filter((a) => a.isFloating)
    .reduce((sum, a) => sum + (a.percentage || 0), 0);
  const fixedTotal = 1 - floatingTotal;

  // Compose intro / portfolio description: for a 1-allocation strategy this
  // reads as "<name> 100% 锁定方案"; for multi-allocation it reads as
  // "X% 浮动 + Y% 固定拆分".
  const portfolioIntro = (() => {
    if (allocations.length === 0) return null;
    if (allocations.length === 1) {
      const a = allocations[0];
      const fixed = a.fixedMonths ? t("common.productFixedMonths", { n: a.fixedMonths }) : (a.isFloating ? t("common.productFloating") : t("common.productLocked"));
      return t("common.portfolioSingle", { fixed, name: a.displayName });
    }
    const parts = [];
    if (floatingTotal > 0.001) parts.push(t("common.partFloating", { pct: (floatingTotal * 100).toFixed(0) }));
    if (fixedTotal > 0.001) parts.push(t("common.partFixed", { pct: (fixedTotal * 100).toFixed(0) }));
    return t("common.portfolioMulti", { parts: parts.join(" + "), n: allocations.length });
  })();

  const detailTranches = detailTimelineData?.tranches || [];
  const detailSnapshots = detailTimelineData?.snapshotMonths || [];
  const detailSummary = (() => {
    if (!detailTranches.length || !detailSnapshots.length) return null;
    const sumBy = (list, pick) => list.reduce((sum, item) => sum + (pick(item) || 0), 0);
    const lastSnaps = detailTranches.map((tranche) => tranche.snapshots?.[tranche.snapshots.length - 1]).filter(Boolean);
    const endingBalance = sumBy(lastSnaps, (snap) => snap.balance);
    const totalInterest = sumBy(detailTranches, (tranche) => sumBy(tranche.snapshots || [], (snap) => snap.interestPaid));
    const totalPayment = sumBy(detailTranches, (tranche) => sumBy(tranche.snapshots || [], (snap) => snap.totalPayment));
    const weightedRate = endingBalance > 0
      ? sumBy(lastSnaps, (snap) => snap.rate * snap.balance) / endingBalance
      : 0;
    return { weightedRate, totalPayment, totalInterest, endingBalance };
  })();

  return (
    <div
      className="sdm-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sdm-title"
      aria-describedby="sdm-desc"
      onClick={(e) => {
        // Backdrop click closes; inner card click does not bubble here
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div ref={cardRef} className="sdm-card glass-panel">
        {/* HEADER */}
        <div className="sdm-header">
          <div className="sdm-header-text">
            <div className="sdm-badge-row">
              <span className="badge badge-indigo">{badgeLabel}</span>
              <span className="sdm-split-count">{splitCountLabel}</span>
              {friendlyRecLabel && (
                <span className="sdm-rec-friend-label">{friendlyRecLabel}</span>
              )}
            </div>
            {portfolioIntro && (
              <div className="sdm-portfolio-intro">{portfolioIntro}</div>
            )}
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className="sdm-close"
            onClick={onClose}
            aria-label={t("strategyDetail.closeAria")}
          >
            ×
          </button>
        </div>

        {/* PORTFOLIO COMPOSITION — primary title + ratio bar + per-tranche chips */}
        <div className="sdm-composition">
          {allocations.length > 0 ? (
            <h2 id="sdm-title" className="sdm-composition-title">
              {allocations.map((a, i) => (
                <span key={i} className="sdm-composition-item">
                  {i > 0 && <span className="sdm-composition-plus"> + </span>}
                  <span className="sdm-composition-name">{a.displayName}</span>
                  <span className="sdm-composition-meta">
                    : ${(a.amount || 0).toLocaleString()}
                    <span className="sdm-composition-pct"> ({((a.percentage || 0) * 100).toFixed(0)}%)</span>
                  </span>
                </span>
              ))}
            </h2>
          ) : (
            <h2 id="sdm-title" className="sdm-strategy-title">
              {strategy.strategyId || t("common.unknownStrategy")}
            </h2>
          )}

          {allocations.length > 1 && (
            <div
              className="sdm-ratio-bar"
              role="img"
              aria-label={t("strategyDetail.portfolioAllocation", { parts: allocations
                .map((a) => `${a.displayName} ${((a.percentage || 0) * 100).toFixed(0)}%`)
                .join("；")})}
            >
              {allocations.map((a, i) => {
                const segClass = a.isFloating
                  ? "sdm-segment-floating"
                  : a.fixedMonths
                    ? `sdm-segment-fixed-${a.fixedMonths}`
                    : "sdm-segment-fixed";
                return (
                  <div
                    key={i}
                    className={`sdm-ratio-segment ${segClass}`}
                    style={{ width: `${(a.percentage || 0) * 100}%` }}
                    title={`${a.displayName}: ${((a.percentage || 0) * 100).toFixed(1)}%`}
                  />
                );
              })}
            </div>
          )}

          {allocations.length > 0 && (
            <div className="sdm-portfolio-chips">
              {allocations.map((a, i) => {
                const chipClass = a.isFloating
                  ? "sdm-chip-floating"
                  : a.fixedMonths
                    ? `sdm-chip-fixed-${a.fixedMonths}`
                    : "sdm-chip-fixed";
                return (
                  <div key={i} className={`sdm-portfolio-chip ${chipClass}`}>
                    <span className="sdm-chip-dot" aria-hidden="true" />
                    <span className="sdm-chip-name">{a.displayName}</span>
                    <span className="sdm-chip-amount">${(a.amount || 0).toLocaleString()}</span>
                    <span className="sdm-chip-pct">{((a.percentage || 0) * 100).toFixed(0)}%</span>
                  </div>
                );
              })}
              {allocations.length > 1 && (
                <div className="sdm-portfolio-chip sdm-chip-total">
                  <span className="sdm-chip-dot" aria-hidden="true" />
                  <span className="sdm-chip-name">{t("strategyDetail.totalLabel")}</span>
                  <span className="sdm-chip-amount">${totalAllocationAmount.toLocaleString()}</span>
                  <span className="sdm-chip-pct">100%</span>
                </div>
              )}
            </div>
          )}
        </div>

        <p id="sdm-desc" className="sdm-desc">{description}</p>

        {/* v9: personalised intro block — why this card picked this strategy,
            per-axis trade-off, suitableFor tags, and 2 nearest neighbours by
            score. Rendered when the page passes a non-null `intro` prop. */}
        {intro && (
          <div className="sdm-intro" data-testid="sdm-intro">
            {intro.whyThisOne && (
              <div className="sdm-intro-section">
                <h3 className="sdm-intro-title">{t("strategyDetail.whyThisOne")}</h3>
                <p className="sdm-intro-body">{intro.whyThisOne}</p>
              </div>
            )}
            {Array.isArray(intro.tradeOff) && intro.tradeOff.length > 0 && (
              <div className="sdm-intro-section">
                <h3 className="sdm-intro-title">{t("strategyDetail.tradeOff")}</h3>
                <ul className="sdm-intro-list">
                  {intro.tradeOff.map((/** @type {any} */ item, /** @type {number} */ i) => {
                    const isTop = item.status === t("strategyDetail.statusTop") || item.status === "优异" || item.status === "Top";
                    const isBottom = item.status === t("strategyDetail.statusBottom") || item.status === "较弱" || item.status === "Bottom";
                    const statusClass = isTop ? "top" : isBottom ? "bottom" : "mid";
                    return (
                      <li key={i} className={`sdm-intro-row sdm-intro-row-${statusClass}`}>
                        <span className="sdm-intro-label">{item.label}</span>
                        <span className={`sdm-intro-status sdm-intro-status-${statusClass}`}>{item.status}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {Array.isArray(intro.suitableFor) && intro.suitableFor.length > 0 && (
              <div className="sdm-intro-section">
                <h3 className="sdm-intro-title">{t("strategyDetail.suitableFor")}</h3>
                <div className="sdm-intro-tags">
                  {intro.suitableFor.map((/** @type {any} */ tag, /** @type {number} */ i) => (
                    <span key={i} className="sdm-intro-tag">{tag}</span>
                  ))}
                </div>
              </div>
            )}
            {Array.isArray(intro.comparison) && intro.comparison.length > 0 && (
              <div className="sdm-intro-section">
                <h3 className="sdm-intro-title">{t("strategyDetail.comparison")}</h3>
                <ul className="sdm-intro-list">
                  {intro.comparison.map((/** @type {any} */ c, /** @type {number} */ i) => (
                    <li key={i} className="sdm-intro-row">
                      <span className="sdm-intro-label">{c.label}</span>
                      <span className="sdm-intro-diff">
                        {t("strategyDetail.diffLine", { interest: (c.interestDelta >= 0 ? "+" : "") + c.interestDelta.toLocaleString(), peak: (c.stabilityDelta >= 0 ? "+" : "") + c.stabilityDelta.toLocaleString() })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* METRICS GRID — 4 columns on desktop, 2 on tablet, 1 on phone */}
        <div className="sdm-metrics">
          {detailSummary && (
            <>
              <MetricTile label={t("strategyDetail.metricWeightedRate")} value={fmtPct(detailSummary.weightedRate)} tone="indigo" />
              <MetricTile label={t("strategyDetail.metricTotalPayment")} value={fmtMoney(detailSummary.totalPayment)} tone="indigo" />
              <MetricTile label={t("strategyDetail.metricTotalInterest")} value={fmtMoney(detailSummary.totalInterest)} tone="emerald" />
              <MetricTile label={t("strategyDetail.metricEndingBalance")} value={fmtMoney(detailSummary.endingBalance)} tone="emerald" />
              {strategy.concentration !== undefined && strategy.concentration !== null && (
                <MetricTile label={t("strategyDetail.metricConcentration")} value={`${Math.round((strategy.concentration || 0) * 100)}%`} tone="indigo" />
              )}
            </>
          )}
          {!detailSummary && strategy.expectedInterest !== undefined && (
            <MetricTile label={t("strategyDetail.metricExpectedInterest")} value={fmtMoney(strategy.expectedInterest)} tone="emerald" />
          )}
          {!detailSummary && strategy.expectedMaxPayment !== undefined && (
            <MetricTile label={t("strategyDetail.metricExpectedMaxPayment", { freq: t("common.fortnightly") })} value={fmtMoney(strategy.expectedMaxPayment)} />
          )}
          {!detailSummary && strategy.expectedEndingBalance !== undefined && (
            <MetricTile label={t("strategyDetail.metricExpectedEndingBalance")} value={fmtMoney(strategy.expectedEndingBalance)} tone="emerald" />
          )}
          {!detailSummary && strategy.expectedPaymentVolatility !== undefined && (
            <MetricTile label={t("strategyDetail.metricPaymentVolatility")} value={`±${fmtMoney(strategy.expectedPaymentVolatility)}`} />
          )}
          {!detailSummary && strategy.worstCaseInterest !== undefined && strategy.worstCaseInterest !== null && (
            <MetricTile label={t("strategyDetail.metricWorstCaseInterest")} value={fmtMoney(strategy.worstCaseInterest)} tone="rose" />
          )}
          {!detailSummary && strategy.worstCasePayment !== undefined && strategy.worstCasePayment !== null && (
            <MetricTile label={t("strategyDetail.metricWorstCasePayment")} value={fmtMoney(strategy.worstCasePayment)} tone="rose" />
          )}
          {!detailSummary && strategy.expectedMaxConcurrentRefixPercentage !== undefined && (
            <MetricTile
              label={t("strategyDetail.metricRefixPct")}
              value={fmtPct(strategy.expectedMaxConcurrentRefixPercentage)}
              tone="amber"
            />
          )}
          {!detailSummary && strategy.expectedFloatingExposure !== undefined && (
            <MetricTile
              label={t("strategyDetail.metricFloatingPct")}
              value={fmtPct(strategy.expectedFloatingExposure)}
              tone="cyan"
            />
          )}
          {!detailSummary && strategy.expectedAffordabilityBreaches !== undefined && (
            <MetricTile
              label={t("strategyDetail.metricAffordabilityBreaches")}
              value={t("common.budgetBreachesCount", { n: strategy.expectedAffordabilityBreaches })}
              tone={strategy.expectedAffordabilityBreaches > 0 ? "amber" : "emerald"}
            />
          )}
          {!detailSummary && strategy.expectedPayoffTime !== undefined && strategy.expectedPayoffTime !== null && strategy.expectedPayoffTime !== 0 && (
            <MetricTile label={t("strategyDetail.metricPayoffMonths")} value={`${strategy.expectedPayoffTime} mo`} />
          )}
          {!detailSummary && strategy.isParetoOptimal !== undefined && (
            <MetricTile
              label={t("strategyDetail.metricPareto")}
              value={strategy.isParetoOptimal ? t("common.fallbackYes") : t("common.fallbackNo")}
              tone={strategy.isParetoOptimal ? "emerald" : "rose"}
            />
          )}
          {!detailSummary && strategy.score !== undefined && (
            <MetricTile label={t("strategyDetail.metricScore")} value={strategy.score.toFixed(3)} tone="indigo" />
          )}
        </div>

        {/* PROS / CONS */}
        <div className="sdm-pros-cons">
          <div className="sdm-pros">
            <h3 className="sdm-section-title">{t("strategyDetail.prosHeader")}</h3>
            {pros.length === 0 ? (
              <div className="sdm-muted">{t("strategyDetail.prosEmpty")}</div>
            ) : (
              <ul>
                {pros.map((/** @type {string} */ p, /** @type {number} */ i) => (
                  <li key={i} className="pro-con-item pro-text">
                    <span className="sdm-bullet pro-bullet">✓</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="sdm-cons">
            <h3 className="sdm-section-title">{t("strategyDetail.consHeader")}</h3>
            {cons.length === 0 ? (
              <div className="sdm-muted">{t("strategyDetail.consEmpty")}</div>
            ) : (
              <ul>
                {cons.map((/** @type {string} */ c, /** @type {number} */ i) => (
                  <li key={i} className="pro-con-item con-text">
                    <span className="sdm-bullet con-bullet">✗</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* INLINE TIMELINE — primary balance linechart + per-tranche table */}
        {showInlineTimeline && (
          <div className="sdm-timeline">
            <h3 className="sdm-section-title">
              {t("strategyDetail.timelineHeader")}{detailScenarioLabel ? ` · ${detailScenarioLabel}` : ""}
            </h3>
            {isDetailLoading ? (
              <div className="sdm-muted">{t("strategyDetail.timelineLoading")}</div>
            ) : detailTimelineData && detailTimelineData.tranches && detailTimelineData.tranches.length > 0 ? (
              <BalanceLinechart data={detailTimelineData} />
            ) : null}

            <div className="sdm-timeline-header-row">
              <h3 className="sdm-section-title" style={{ marginTop: "16px" }}>
                {t("strategyDetail.timelineDetailHeader")}{detailScenarioLabel ? ` · ${detailScenarioLabel}` : ""}
              </h3>
              {showRotateCta && (
                <button
                  type="button"
                  className="sdm-rotate-cta"
                  onClick={() => setTableRotated(true)}
                  aria-label={t("strategyDetail.rotateTableCta")}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                    <rect x="6" y="2" width="12" height="20" rx="2" />
                    <path d="M11 18h2" />
                    <path d="M9 5l3-3 3 3" />
                    <path d="M9 19l3 3 3-3" />
                  </svg>
                  <span>{t("strategyDetail.rotateTableCta")}</span>
                </button>
              )}
            </div>
            {isDetailLoading ? (
              <div className="sdm-muted">{t("strategyDetail.timelineLoadingShort")}</div>
            ) : detailTimelineData && detailTimelineData.tranches && detailTimelineData.tranches.length > 0 ? (
              !tableRotated ? (
                <div className="sdm-timeline-table-wrap">
                  <div className="sdm-timeline-table-scroller">
                    <InlineTimelineV2 data={detailTimelineData} />
                  </div>
                </div>
              ) : null
            ) : (
              <div className="sdm-muted">{t("strategyDetail.timelineMissing")}</div>
            )}
          </div>
        )}

        {/* Rotated table overlay — rendered via portal at document.body so
            it escapes the modal card's transform context (the slide-in
            animation leaves a residual `transform: translateY(0) scale(1)`
            which creates a containing block for position:fixed descendants).
            Without the portal, the rotated wrap would be sized/positioned
            relative to the card, not the viewport. */}
        {tableRotated && typeof document !== "undefined" && createPortal(
          <div className="sdm-rotate-portal" role="dialog" aria-modal="true" aria-label={t("strategyDetail.timelineDetailHeader")}>
            <div className="sdm-rotate-portal-scroller" ref={rotateScrollerRef}>
              <InlineTimelineV2 data={detailTimelineData} maxHeight="none" />
            </div>
            <button
              type="button"
              className="sdm-rotate-exit"
              onClick={() => setTableRotated(false)}
              aria-label={t("strategyDetail.rotateTableExitAria")}
            >
              ×
            </button>
          </div>,
          document.body
        )}

        {/* FOOTER */}
        <div className="sdm-footer">
          <div className="sdm-footer-meta">
            {strategy.strategyId && (
              <span className="sdm-footer-meta-item">{t("common.strategyId", { id: strategy.strategyId })}</span>
            )}
          </div>
          <div className="sdm-footer-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
            >
              {t("strategyDetail.close")}
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        .sdm-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.85);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          z-index: 200;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          animation: sdm-fade-in 180ms ease-out;
        }
        .sdm-card {
          position: relative;
          width: min(960px, 100%);
          max-height: calc(100vh - 32px);
          overflow-y: auto;
          border-radius: 14px;
          padding: 22px 24px 18px;
          animation: sdm-slide-in 180ms ease-out;
          scrollbar-width: thin;
        }
        .sdm-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 8px;
        }
        .sdm-badge-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .sdm-split-count {
          font-size: 11px;
          color: var(--text-muted);
          padding: 2px 8px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.05);
        }
        .sdm-subtitle {
          font-size: 12px;
          color: var(--text-muted);
          margin-top: 4px;
          line-height: 1.5;
        }
        .sdm-close {
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: var(--text-primary);
          width: 32px;
          height: 32px;
          border-radius: 8px;
          font-size: 22px;
          line-height: 1;
          cursor: pointer;
          flex-shrink: 0;
          transition: background 120ms ease;
        }
        .sdm-close:hover, .sdm-close:focus-visible {
          background: rgba(255, 255, 255, 0.12);
          outline: none;
        }
        .sdm-strategy-title {
          font-size: 15px;
          font-weight: 600;
          line-height: 1.5;
          margin: 6px 0 8px;
          color: var(--text-primary);
        }

        /* —— Portfolio composition block —— */
        .sdm-rec-friend-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.02em;
          padding: 3px 9px;
          border-radius: 10px;
          background: rgba(99, 102, 241, 0.22);
          color: #c7d2fe;
          border: 1px solid rgba(99, 102, 241, 0.45);
        }

        .sdm-portfolio-intro {
          font-size: 12px;
          color: var(--text-muted);
          margin-top: 4px;
          line-height: 1.5;
        }

        .sdm-composition {
          margin: 12px 0 8px;
          padding: 14px 16px;
          border-radius: 12px;
          background: linear-gradient(180deg, rgba(99,102,241,0.06), rgba(99,102,241,0.02));
          border: 1px solid rgba(99,102,241,0.18);
        }

        .sdm-composition-title {
          font-size: 15px;
          font-weight: 700;
          line-height: 1.55;
          margin: 0 0 10px;
          color: var(--text-primary);
          word-break: break-word;
        }

        .sdm-composition-item {
          display: inline;
        }

        .sdm-composition-name {
          color: #fff;
          font-weight: 700;
        }

        .sdm-composition-meta {
          color: var(--text-secondary);
          font-weight: 500;
          font-variant-numeric: tabular-nums;
        }

        .sdm-composition-pct {
          color: var(--color-primary);
          font-weight: 700;
        }

        .sdm-composition-plus {
          color: var(--text-muted);
          font-weight: 600;
          margin: 0 2px;
        }

        .sdm-ratio-bar {
          display: flex;
          width: 100%;
          height: 8px;
          border-radius: 999px;
          overflow: hidden;
          background: rgba(255,255,255,0.04);
          margin: 8px 0 12px;
          border: 1px solid rgba(255,255,255,0.06);
        }

        .sdm-ratio-segment {
          height: 100%;
          transition: filter 0.15s ease;
        }

        .sdm-ratio-segment:hover {
          filter: brightness(1.25);
        }

        .sdm-segment-floating { background: linear-gradient(90deg, #06b6d4, #22d3ee); }
        .sdm-segment-fixed { background: linear-gradient(90deg, #6366f1, #818cf8); }
        .sdm-segment-fixed-6 { background: linear-gradient(90deg, #6366f1, #818cf8); }
        .sdm-segment-fixed-12 { background: linear-gradient(90deg, #4f46e5, #6366f1); }
        .sdm-segment-fixed-18 { background: linear-gradient(90deg, #4338ca, #6366f1); }
        .sdm-segment-fixed-24 { background: linear-gradient(90deg, #3730a3, #4f46e5); }
        .sdm-segment-fixed-36 { background: linear-gradient(90deg, #312e81, #4338ca); }
        .sdm-segment-fixed-60 { background: linear-gradient(90deg, #1e1b4b, #312e81); }

        .sdm-portfolio-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .sdm-portfolio-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 10px;
          border-radius: 8px;
          font-size: 11.5px;
          font-weight: 600;
          border: 1px solid rgba(255,255,255,0.1);
          background: rgba(255,255,255,0.04);
          color: var(--text-primary);
          line-height: 1.2;
        }

        .sdm-portfolio-chip .sdm-chip-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          flex-shrink: 0;
        }

        .sdm-portfolio-chip .sdm-chip-amount,
        .sdm-portfolio-chip .sdm-chip-pct {
          font-variant-numeric: tabular-nums;
        }

        .sdm-portfolio-chip .sdm-chip-pct {
          padding-left: 4px;
          border-left: 1px solid rgba(255,255,255,0.12);
          font-weight: 700;
        }

        .sdm-chip-floating .sdm-chip-dot { background: #22d3ee; }
        .sdm-chip-floating .sdm-chip-pct { color: #22d3ee; }
        .sdm-chip-fixed .sdm-chip-dot { background: #818cf8; }
        .sdm-chip-fixed .sdm-chip-pct { color: #a5b4fc; }
        .sdm-chip-fixed-6 .sdm-chip-dot { background: #818cf8; }
        .sdm-chip-fixed-12 .sdm-chip-dot { background: #6366f1; }
        .sdm-chip-fixed-18 .sdm-chip-dot { background: #6366f1; }
        .sdm-chip-fixed-24 .sdm-chip-dot { background: #4f46e5; }
        .sdm-chip-fixed-36 .sdm-chip-dot { background: #4338ca; }
        .sdm-chip-fixed-60 .sdm-chip-dot { background: #3730a3; }
        .sdm-chip-fixed-6 .sdm-chip-pct { color: #c7d2fe; }
        .sdm-chip-fixed-12 .sdm-chip-pct { color: #c7d2fe; }
        .sdm-chip-fixed-18 .sdm-chip-pct { color: #a5b4fc; }
        .sdm-chip-fixed-24 .sdm-chip-pct { color: #a5b4fc; }
        .sdm-chip-fixed-36 .sdm-chip-pct { color: #a5b4fc; }
        .sdm-chip-fixed-60 .sdm-chip-pct { color: #c7d2fe; }

        .sdm-chip-total {
          background: rgba(99,102,241,0.16);
          border-color: rgba(99,102,241,0.45);
          color: #fff;
        }
        .sdm-chip-total .sdm-chip-dot { background: #c7d2fe; }
        .sdm-chip-total .sdm-chip-pct { color: #fff; }

        .sdm-desc {
          font-size: 12.5px;
          color: var(--text-muted);
          line-height: 1.55;
          margin: 0 0 16px;
        }
        .sdm-intro {
          display: flex;
          flex-direction: column;
          gap: 14px;
          margin: 0 0 18px;
          padding: 14px 16px;
          border-radius: 12px;
          background: linear-gradient(180deg, rgba(99,102,241,0.06), rgba(99,102,241,0.02));
          border: 1px solid rgba(99,102,241,0.18);
        }
        .sdm-intro-section {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .sdm-intro-title {
          font-size: 12px;
          font-weight: 700;
          color: var(--text-secondary);
          margin: 0;
          letter-spacing: 0.02em;
        }
        .sdm-intro-body {
          font-size: 13px;
          line-height: 1.6;
          margin: 0;
          color: var(--text-primary);
        }
        .sdm-intro-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 6px 14px;
        }
        @media (max-width: 768px) {
          .sdm-intro-list {
            grid-template-columns: 1fr;
          }
        }
        .sdm-intro-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          font-size: 12px;
        }
        .sdm-intro-label {
          color: var(--text-secondary);
        }
        .sdm-intro-status {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 10px;
          font-weight: 600;
        }
        .sdm-intro-status-top { background: rgba(52, 211, 153, 0.18); color: #34d399; }
        .sdm-intro-status-mid { background: rgba(148, 163, 184, 0.18); color: #cbd5e1; }
        .sdm-intro-status-bottom { background: rgba(248, 113, 113, 0.18); color: #f87171; }
        .sdm-intro-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .sdm-intro-tag {
          font-size: 11px;
          padding: 3px 9px;
          border-radius: 10px;
          background: rgba(99, 102, 241, 0.16);
          border: 1px solid rgba(99, 102, 241, 0.30);
          color: #c7d2fe;
        }
        .sdm-intro-diff {
          font-size: 11.5px;
          color: var(--text-secondary);
          font-variant-numeric: tabular-nums;
        }
        .sdm-metrics {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
          margin-bottom: 18px;
        }
        .sdm-metrics :global(.sdm-metric-tile) {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 8px;
          padding: 10px 12px;
        }
        .sdm-pros-cons {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
          margin-bottom: 16px;
        }
        .sdm-pros-cons ul {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .sdm-pros-cons li {
          display: flex;
          gap: 8px;
          align-items: flex-start;
          margin: 6px 0;
          font-size: 12px;
          line-height: 1.5;
        }
        .sdm-section-title {
          font-size: 13px;
          font-weight: 600;
          margin: 0 0 6px;
          color: var(--text-primary);
        }
        .sdm-bullet {
          display: inline-block;
          width: 18px;
          text-align: center;
          flex-shrink: 0;
          font-weight: 700;
        }
        :global(.pro-bullet) { color: #34d399; }
        :global(.con-bullet) { color: #f87171; }
        .sdm-muted {
          font-size: 12px;
          color: var(--text-muted);
          padding: 6px 0;
        }
        .sdm-timeline {
          margin-bottom: 16px;
          padding: 12px;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 8px;
        }
        .sdm-footer {
          position: sticky;
          bottom: 0;
          margin-top: 8px;
          padding-top: 12px;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          background: linear-gradient(180deg, transparent, var(--bg-primary) 40%);
        }
        .sdm-footer-meta {
          font-size: 11px;
          color: var(--text-muted);
        }
        .sdm-footer-actions {
          display: flex;
          gap: 8px;
          margin-left: auto;
        }
        @keyframes sdm-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes sdm-slide-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (max-width: 768px) {
          .sdm-card {
            width: 100vw;
            height: 100vh;
            max-height: 100vh;
            border-radius: 0;
            padding: 16px;
          }
          .sdm-metrics { grid-template-columns: repeat(2, 1fr); }
          .sdm-pros-cons { grid-template-columns: 1fr; }
        }
        @media (max-width: 420px) {
          .sdm-metrics { grid-template-columns: 1fr; }
        }
        /* === Mobile rotation overlay (table fullscreen, rotated 90deg) === */
        .sdm-timeline-header-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 16px;
        }
        .sdm-rotate-cta {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border-radius: 999px;
          background: rgba(99, 102, 241, 0.12);
          border: 1px solid rgba(99, 102, 241, 0.4);
          color: var(--text-primary);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.18s ease, transform 0.18s ease;
          min-height: var(--touch-target, 32px);
        }
        .sdm-rotate-cta:hover { background: rgba(99, 102, 241, 0.2); transform: translateY(-1px); }
        .sdm-rotate-cta:active { transform: scale(0.97); }
        .sdm-rotate-cta svg { width: 14px; height: 14px; }

        .sdm-timeline-table-wrap {
          position: relative;
        }
        /* Rotated overlay is rendered via React portal at document.body so it
           escapes the modal card's transform context. Without the portal, the
           modal's residual transform (translateY(0) scale(1)) would create a
           containing block and position: fixed would resolve against the
           card, not the viewport. */
        .sdm-rotate-portal {
          position: fixed;
          inset: 0;
          z-index: 2147483600;
          background: var(--bg-primary);
          overflow: hidden;
          padding: 0;
          animation: sdm-rotate-fade-in 200ms ease-out both;
        }
        .sdm-rotate-portal-scroller {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 100vh;
          height: 100vw;
          transform: translate(-50%, -50%) rotate(90deg);
          transform-origin: center center;
          overflow: auto;
          background: var(--bg-primary);
        }
        /* Compactness overrides so the rotated table fits within the
           rotated frame width (100vh of the viewport). */
        .sdm-rotate-portal-scroller :global(.sdm-timeline-table-v2) {
          font-size: 11px;
          width: max-content;
          max-width: 100vh;
        }
        .sdm-rotate-portal-scroller :global(.sdm-timeline-table-v2 th),
        .sdm-rotate-portal-scroller :global(.sdm-timeline-table-v2 td) {
          padding: 6px 10px;
        }
        /* Narrower sticky columns in rotated view to fit more snapshots. */
        .sdm-rotate-portal-scroller :global(.sdm-v2-head-sticky-1),
        .sdm-rotate-portal-scroller :global(.sdm-v2-tranche-name) {
          min-width: 120px !important;
          width: 120px !important;
        }
        .sdm-rotate-portal-scroller :global(.sdm-v2-head-sticky-2),
        .sdm-rotate-portal-scroller :global(.sdm-v2-row-label) {
          min-width: 90px !important;
          width: 90px !important;
          left: 120px !important;
        }
        /* Narrower snapshot columns via inline-style override (colgroup uses
           style={{ width: "112px" }} so we need !important). */
        .sdm-rotate-portal-scroller :global(colgroup col) {
          width: 86px !important;
        }
        .sdm-rotate-portal-scroller :global(.sdm-v2-final-col-selector) {
          width: 110px !important;
        }
        .sdm-rotate-exit {
          position: fixed;
          top: max(env(safe-area-inset-top, 0px), 12px);
          right: max(env(safe-area-inset-right, 0px), 12px);
          width: 44px;
          height: 44px;
          border-radius: 50%;
          background: rgba(15, 20, 34, 0.92);
          border: 1px solid rgba(255, 255, 255, 0.18);
          color: #fff;
          font-size: 22px;
          line-height: 1;
          cursor: pointer;
          z-index: 2147483647;
          display: flex;
          align-items: center;
          justify-content: center;
          backdrop-filter: blur(8px);
          font-family: inherit;
          padding: 0;
        }
        .sdm-rotate-exit:hover { background: rgba(40, 50, 75, 0.95); }
        .sdm-rotate-exit:active { transform: scale(0.94); }
        @keyframes sdm-rotate-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .sdm-backdrop, .sdm-card { animation: none; }
          .sdm-rotate-portal { animation: none; }
        }
      `}</style>
    </div>
  );
}

/**
 * Inline metric tile inside the modal. Lives outside the main component to
 * keep the JSX tree readable.
 */
function MetricTile(/** @type {any} */ props) {
  const { label, value, tone = "neutral" } = props;
  return (
    <div className="sdm-metric-tile" data-tone={tone}>
      <div className="sdm-metric-label">{label}</div>
      <div className="sdm-metric-value">{value}</div>
      <style jsx>{`
        .sdm-metric-tile[data-tone="emerald"] .sdm-metric-value { color: #34d399; }
        .sdm-metric-tile[data-tone="rose"] .sdm-metric-value { color: #f87171; }
        .sdm-metric-tile[data-tone="amber"] .sdm-metric-value { color: #fbbf24; }
        .sdm-metric-tile[data-tone="cyan"] .sdm-metric-value { color: #22d3ee; }
        .sdm-metric-tile[data-tone="indigo"] .sdm-metric-value { color: #a5b4fc; }
        .sdm-metric-label {
          font-size: 11px;
          color: var(--text-muted);
          margin-bottom: 4px;
        }
        .sdm-metric-value {
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary);
          font-variant-numeric: tabular-nums;
        }
      `}</style>
    </div>
  );
}

/**
 * Render the strategy split inline. Looks up the strategy via the page's
 * optimiser map; if not available, falls back to a summary label.
 */
// (removed — the page now enriches `strategy.allocations` with displayName +
// percentage + amount, and the modal renders the composition block directly
// from that data. Keeping this stub would leak the bare strategyId again.)

/**
 * Compact inline timeline view for the modal. Renders a small table of
 * per-tranche rate / event / interest snapshots. Kept simple — full month-by-
 * month detail stays in the page's existing 60-month detail section if the
 * user re-opens it.
 */
/**
 * Compact per-tranche × per-snapshot timeline table. One row per allocation;
 * columns are: tranche name + interest paid / principal repaid / remaining
 * balance / refix events at every 6-month snapshot.
 */
function InlineTimeline(/** @type {any} */ props) {
  const { t } = useI18n();
  const { data } = props;
  const { snapshotMonths = [], tranches = [] } = data || {};
  if (!tranches.length || !snapshotMonths.length) {
    return <div className="sdm-muted">{t("strategyDetail.noTimeline")}</div>;
  }

  /** @type {(n: number) => string} */
  const money = (n) => `$${Math.round(n).toLocaleString()}`;
  /** @type {(rate: number) => string} */
  const ratePct = (r) => `${(r * 100).toFixed(2)}%`;
  /** @type {(month: number) => string} */
  const labelFor = (m) => {
    const years = Math.floor(m / 12);
    const months = m % 12;
    return t("common.yearMonthLabel", { y: years, mo: months });
  };

  return (
    <div style={{ overflowX: "auto", maxHeight: "320px" }}>
      <table className="sdm-timeline-table">
        <thead>
          <tr>
            <th rowSpan={2}>{t("strategyDetail.rowInitialBalance")}</th>
            <th rowSpan={2}>{t("strategyDetail.rowInitialBalance")}</th>
            {snapshotMonths.map((/** @type {number} */ m) => (
              <th key={m} colSpan={4}>{labelFor(m)}</th>
            ))}
          </tr>
          <tr>
            {snapshotMonths.map((/** @type {number} */ m) => (
              <th key={`sub-${m}`} className="sdm-subhead">{t("strategyDetail.colRate")}</th>
            )).flatMap((_t, idx) => {
              // For each snapshot month emit 4 sub-headers (利率 / 续约 / 利息 / 本金)
              const out = [];
              for (let i = 0; i < snapshotMonths.length; i++) {
                out.push(<th key={`sub-${snapshotMonths[i]}-rate`} className="sdm-subhead">{t("strategyDetail.colRate")}</th>);
                out.push(<th key={`sub-${snapshotMonths[i]}-ev`} className="sdm-subhead">{t("strategyDetail.colRefix")}</th>);
                out.push(<th key={`sub-${snapshotMonths[i]}-int`} className="sdm-subhead">{t("strategyDetail.colInterest")}</th>);
                out.push(<th key={`sub-${snapshotMonths[i]}-pr`} className="sdm-subhead">{t("strategyDetail.colPrincipal")}</th>);
              }
              return out;
            })}
          </tr>
        </thead>
        <tbody>
          {tranches.map((/** @type {any} */ row, /** @type {number} */ idx) => (
            <tr key={row.trancheId || idx}>
              <td className="sdm-row-label" title={row.productCode}>
                {row.displayName}
                <div className="sdm-row-sublabel">{Math.round(row.initialBalance).toLocaleString()}</div>
              </td>
              <td className="sdm-row-money">{money(row.initialBalance)}</td>
              {snapshotMonths.map((/** @type {number} */ _m, /** @type {number} */ i) => {
                const snap = (row.snapshots || [])[i];
                if (!snap) {
                  return [
                    <td key={`${idx}-${i}-r`}>—</td>,
                    <td key={`${idx}-${i}-e`}>—</td>,
                    <td key={`${idx}-${i}-i`}>—</td>,
                    <td key={`${idx}-${i}-p`}>—</td>
                  ];
                }
                return [
                  <td key={`${idx}-${i}-r`}>{ratePct(snap.rate)}</td>,
                  <td key={`${idx}-${i}-e`} className="sdm-event-cell" title={snap.events?.join(", ") || ""}>
                    {snap.events && snap.events.length > 0 ? `${snap.events.length}×` : "—"}
                  </td>,
                  <td key={`${idx}-${i}-i`}>{money(snap.interestPaid)}</td>,
                  <td key={`${idx}-${i}-p`}>{money(snap.principalRepaid)}</td>
                ];
              })}
            </tr>
          ))}
          {(() => {
            // Totals row: sum interestPaid and principalRepaid across tranches per snapshot.
            return (
              <tr className="sdm-total-row">
                <td className="sdm-row-label" colSpan={2}>{t("strategyDetail.totalLabel")}</td>
                {snapshotMonths.map((/** @type {number} */ _m, /** @type {number} */ i) => {
                  let totalInterest = 0;
                  let totalPrincipal = 0;
                  let totalBalance = 0;
                  let totalRateWeighted = 0;
                  let totalWeight = 0;
                  for (const t of tranches) {
                    const snap = (t.snapshots || [])[i];
                    if (!snap) continue;
                    totalInterest += snap.interestPaid;
                    totalPrincipal += snap.principalRepaid;
                    totalBalance += snap.balance;
                    totalRateWeighted += snap.rate * (snap.balance || 1);
                    totalWeight += snap.balance || 1;
                  }
                  const avgRate = totalWeight > 0 ? totalRateWeighted / totalWeight : 0;
                  return [
                    <td key={`total-${i}-r`}>{ratePct(avgRate)}</td>,
                    <td key={`total-${i}-e`}>—</td>,
                    <td key={`total-${i}-i`}>{money(totalInterest)}</td>,
                    <td key={`total-${i}-p`}>{money(totalPrincipal)}</td>
                  ];
                })}
              </tr>
            );
          })()}
        </tbody>
      </table>
      <style jsx>{`
        .sdm-timeline-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 11px;
          font-variant-numeric: tabular-nums;
        }
        .sdm-timeline-table th, .sdm-timeline-table :global(td) {
          padding: 5px 6px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          text-align: right;
          white-space: nowrap;
        }
        .sdm-timeline-table :global(thead th) {
          background: rgba(255, 255, 255, 0.06);
          position: sticky;
          top: 0;
          font-weight: 600;
          text-align: center;
        }
        .sdm-timeline-table :global(.sdm-subhead) {
          font-size: 10px;
          color: var(--text-muted);
          font-weight: 500;
        }
        .sdm-timeline-table :global(tbody td:first-child),
        .sdm-timeline-table :global(.sdm-row-label) {
          text-align: left;
          font-weight: 500;
        }
        .sdm-row-label {
          position: sticky;
          left: 0;
          background: var(--bg-primary);
          z-index: 1;
        }
        .sdm-row-sublabel {
          font-size: 10px;
          color: var(--text-muted);
        }
        .sdm-row-money { font-weight: 500; }
        .sdm-event-cell { color: #fbbf24; }
        .sdm-total-row {
          font-weight: 600;
          background: rgba(99, 102, 241, 0.08);
        }
        .sdm-total-row :global(.sdm-row-label) {
          background: rgba(99, 102, 241, 0.08);
        }
      `}</style>
    </div>
  );
}

function InlineTimelineV2(/** @type {any} */ props) {
  const { t } = useI18n();
  const { data, maxHeight = "420px" } = props;
  const { snapshotMonths = [], tranches = [] } = data || {};
  if (!tranches.length || !snapshotMonths.length) {
    return <div className="sdm-muted">{t("strategyDetail.noTimeline")}</div>;
  }

  const money = (n) => `$${Math.round(n).toLocaleString()}`;
  const ratePct = (r) => `${(r * 100).toFixed(2)}%`;
  const labelFor = (m) => {
    const years = Math.floor(m / 12);
    const months = m % 12;
    return t("common.yearMonthLabel", { y: years, mo: months });
  };
  const sumBy = (list, pick) => list.reduce((sum, item) => sum + (pick(item) || 0), 0);

  const totalColumns = snapshotMonths.map((/** @type {number} */ _m, /** @type {number} */ i) => {
    const snaps = tranches.map((tranche) => tranche.snapshots?.[i]).filter(Boolean);
    const totalBalance = sumBy(snaps, (snap) => snap.balance);
    return {
      weightedRate: totalBalance > 0 ? sumBy(snaps, (snap) => snap.rate * snap.balance) / totalBalance : 0,
      totalPayment: sumBy(snaps, (snap) => snap.totalPayment),
      totalInterest: sumBy(snaps, (snap) => snap.interestPaid),
      totalBalance
    };
  });

  const finalTotalRate = (() => {
    const snaps = tranches.map((tranche) => tranche.snapshots?.[tranche.snapshots.length - 1]).filter(Boolean);
    const totalBalance = sumBy(snaps, (snap) => snap.balance);
    return totalBalance > 0 ? sumBy(snaps, (snap) => snap.rate * snap.balance) / totalBalance : 0;
  })();

  return (
    <div style={{ overflowX: "auto", maxHeight }}>
      <table className="sdm-timeline-table-v2">
        <colgroup>
          <col style={{ width: "180px" }} />
          <col style={{ width: "140px" }} />
          {snapshotMonths.map((/** @type {number} */ m) => (
            <col key={`col-${m}`} style={{ width: "112px" }} />
          ))}
          <col style={{ width: "148px" }} />
        </colgroup>
        <thead>
          <tr>
            <th className="sdm-v2-head-sticky-1">{t("strategyDetail.rowLabel")}</th>
            <th className="sdm-v2-head-sticky-2">{t("strategyDetail.rowInitialBalance")}</th>
            {snapshotMonths.map((/** @type {number} */ m) => (
              <th key={m}>{labelFor(m)}</th>
            ))}
            <th>{t("common.totalAccumulated")}</th>
          </tr>
        </thead>
        <tbody>
          {tranches.map((/** @type {any} */ tranche, /** @type {number} */ idx) => {
            const snaps = tranche.snapshots || [];
            const totalPayment = sumBy(snaps, (snap) => snap.totalPayment);
            const totalInterest = sumBy(snaps, (snap) => snap.interestPaid);
            const finalBalance = snaps[snaps.length - 1]?.balance || tranche.initialBalance;

            const rows = [
              { key: "rate", label: t("strategyDetail.predictedRate"), valueFor: (snap) => ratePct(snap.rate), finalValue: "—" },
              { key: "payment", label: t("strategyDetail.predictedPayment"), valueFor: (snap) => money(snap.totalPayment), finalValue: money(totalPayment), className: "sdm-tone-indigo" },
              { key: "interest", label: t("strategyDetail.predictedInterest"), valueFor: (snap) => money(snap.interestPaid), finalValue: money(totalInterest), className: "sdm-tone-indigo" },
              { key: "balance", label: t("strategyDetail.predictedBalance"), valueFor: (snap) => money(snap.balance), finalValue: money(finalBalance), className: "sdm-tone-emerald" }
            ];

            return rows.map((row, rowIndex) => (
              <tr key={`${tranche.trancheId || idx}-${row.key}`} className={row.className || ""}>
                {rowIndex === 0 && (
                  <td className="sdm-v2-tranche-name" rowSpan={rows.length} title={tranche.productCode}>
                    <div className="sdm-v2-tranche-title">{tranche.displayName}</div>
                    <div className="sdm-v2-row-sublabel">{money(tranche.initialBalance)}</div>
                  </td>
                )}
                <td className="sdm-v2-row-label">{row.label}</td>
                {snapshotMonths.map((/** @type {number} */ _m, /** @type {number} */ i) => (
                  <td key={`${tranche.trancheId || idx}-${row.key}-${i}`}>
                    {snaps[i] ? row.valueFor(snaps[i]) : "—"}
                  </td>
                ))}
                <td className="sdm-v2-final-col">{row.finalValue}</td>
              </tr>
            ));
          })}

          {[
            { key: "rate", label: t("strategyDetail.predictedRate"), valueFor: (col) => ratePct(col.weightedRate), finalValue: ratePct(finalTotalRate) },
            { key: "payment", label: t("strategyDetail.predictedPayment"), valueFor: (col) => money(col.totalPayment), finalValue: money(sumBy(totalColumns, (col) => col.totalPayment)), className: "sdm-tone-indigo" },
            { key: "interest", label: t("strategyDetail.predictedInterest"), valueFor: (col) => money(col.totalInterest), finalValue: money(sumBy(totalColumns, (col) => col.totalInterest)), className: "sdm-tone-indigo" },
            { key: "balance", label: t("strategyDetail.predictedBalance"), valueFor: (col) => money(col.totalBalance), finalValue: money(totalColumns[totalColumns.length - 1]?.totalBalance || 0), className: "sdm-tone-emerald" }
          ].map((row, rowIndex, rows) => (
            <tr key={`total-${row.key}`} className={`sdm-v2-total-row ${row.className || ""}`}>
              {rowIndex === 0 && (
                <td className="sdm-v2-tranche-name sdm-v2-total-label" rowSpan={rows.length}>
                  {t("strategyDetail.totalAllTranches")}
                </td>
              )}
              <td className="sdm-v2-row-label">{row.label}</td>
              {totalColumns.map((col, i) => (
                <td key={`total-${row.key}-${i}`}>{row.valueFor(col)}</td>
              ))}
              <td className="sdm-v2-final-col">{row.finalValue}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <style jsx>{`
        .sdm-timeline-table-v2 {
          width: max-content;
          min-width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          font-size: 12px;
          font-variant-numeric: tabular-nums;
          table-layout: fixed;
        }
        .sdm-timeline-table-v2 th,
        .sdm-timeline-table-v2 :global(td) {
          padding: 10px 14px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          text-align: right;
          white-space: nowrap;
          overflow: hidden;
        }
        .sdm-timeline-table-v2 :global(thead th) {
          position: sticky;
          top: 0;
          z-index: 4;
          background: rgba(20, 26, 44, 0.98);
          backdrop-filter: blur(8px);
          font-weight: 700;
          text-align: center;
        }
        .sdm-v2-head-sticky-1 {
          left: 0;
          z-index: 7 !important;
          min-width: 180px;
          width: 180px;
          box-shadow: 1px 0 0 rgba(255, 255, 255, 0.06);
        }
        .sdm-v2-head-sticky-2 {
          position: sticky;
          left: 180px;
          z-index: 6 !important;
          min-width: 140px;
          width: 140px;
          box-shadow: 1px 0 0 rgba(255, 255, 255, 0.06);
        }
        .sdm-v2-tranche-name,
        .sdm-v2-row-label {
          text-align: left !important;
        }
        .sdm-v2-tranche-name {
          position: sticky;
          left: 0;
          z-index: 3;
          min-width: 180px;
          width: 180px;
          vertical-align: middle;
          background: rgba(15, 20, 34, 0.98);
          box-shadow: 1px 0 0 rgba(255, 255, 255, 0.06);
        }
        .sdm-v2-row-label {
          position: sticky;
          left: 180px;
          z-index: 2;
          min-width: 140px;
          width: 140px;
          background: rgba(18, 24, 40, 0.98);
          font-weight: 600;
          color: var(--text-secondary);
          box-shadow: 1px 0 0 rgba(255, 255, 255, 0.04);
        }
        .sdm-v2-tranche-title {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-primary);
        }
        .sdm-v2-row-sublabel {
          margin-top: 6px;
          font-size: 11px;
          color: var(--text-muted);
        }
        .sdm-v2-final-col {
          color: #6ee7b7;
          font-weight: 700;
        }
        .sdm-v2-total-row {
          background: rgba(99, 102, 241, 0.08);
          font-weight: 700;
        }
        .sdm-v2-total-row :global(.sdm-v2-tranche-name),
        .sdm-v2-total-row :global(.sdm-v2-row-label) {
          background: rgba(42, 47, 86, 0.98);
        }
        .sdm-v2-total-label {
          color: var(--text-primary);
        }
        .sdm-tone-indigo :global(td),
        .sdm-tone-indigo :global(.sdm-v2-row-label) {
          color: #818cf8;
        }
        .sdm-tone-emerald :global(td),
        .sdm-tone-emerald :global(.sdm-v2-row-label) {
          color: #6ee7b7;
        }
      `}</style>
    </div>
  );
}

/**
 * Principal-balance linechart — visualises total remaining balance over the
 * simulation horizon using the same SvgChart the page-level "detail timeline
 * chart" uses. Renders a single line + shaded area beneath it.
 */
function BalanceLinechart(/** @type {any} */ props) {
  const { t } = useI18n();
  const { data } = props;
  const { snapshotMonths = [], tranches = [] } = data || {};
  if (!tranches.length || !snapshotMonths.length) return null;

  // Sum the per-tranche closing balances across tranches at each snapshot.
  const points = [0, ...snapshotMonths].map((/** @type {number} */ m, /** @type {number} */ i) => {
    let total = 0;
    if (i === 0) {
      for (const t of tranches) total += t.initialBalance || 0;
    } else {
      const snapIdx = i - 1;
      for (const t of tranches) {
        const snap = (t.snapshots || [])[snapIdx];
        if (snap) total += snap.balance || 0;
      }
    }
    return { x: m, y: total };
  });

  // SvgChart is imported at the top of this file (ESM-friendly).
  const maxY = Math.max(...points.map((/** @type {any} */ p) => p.y), 1);
  // SvgChart reads `points[].month` (not `x`) and `points[].value` (not `y`).
  // Map our {x, y} into {month, value}.
  const chartPoints = points.map((p) => ({ month: p.x, value: p.y }));
  return (
    <div style={{ marginTop: "8px", marginBottom: "8px" }}>
      <SvgChart
        data={[
          {
            id: "balance-path",
            label: t("strategyDetail.balancePath"),
            color: "var(--color-primary)",
            fill: true,
            points: chartPoints
          }
        ]}
        yAxisType="currency"
        height={180}
      />
    </div>
  );
}
