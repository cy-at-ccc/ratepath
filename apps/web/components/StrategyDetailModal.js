"use client";
// @ts-nocheck — Modal CSS lives alongside component via styled-jsx; types
// are tracked as technical debt.

import { useEffect, useRef } from "react";
import SvgChart from "./SvgChart.js";

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
    formatMoney = (/** @type {number} */ n) => `$${Math.round(n).toLocaleString()}`
  } = props;

  const closeBtnRef = useRef(/** @type {any} */ (null));
  const lastFocusedRef = useRef(/** @type {any} */ (null));
  const cardRef = useRef(/** @type {any} */ (null));

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
  }, [isOpen, onClose]);

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
  const splitCountLabel = allocationCount === 1 ? "1 拆分" : `${allocationCount} 拆分`;
  const pros = Array.isArray(strategy.pros) ? strategy.pros : [];
  const cons = Array.isArray(strategy.cons) ? strategy.cons : [];
  const badgeLabel = recommendation?.badgeLabel || (recommendation?.type === "preference" ? "偏好匹配推荐" : "策略详情");
  const subtitle = recommendation?.subtitle || recommendation?.type || "完整明细";
  const description = recommendation?.description || "查看该策略在所有 Pareto 维度的完整指标、优劣势与时间线。";

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
            </div>
            <div className="sdm-subtitle">{subtitle}</div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className="sdm-close"
            onClick={onClose}
            aria-label="关闭详情弹窗"
          >
            ×
          </button>
        </div>
        <h2 id="sdm-title" className="sdm-strategy-title">{renderSplitInline(strategy)}</h2>
        <p id="sdm-desc" className="sdm-desc">{description}</p>

        {/* METRICS GRID — 4 columns on desktop, 2 on tablet, 1 on phone */}
        <div className="sdm-metrics">
          {detailSummary && (
            <>
              <MetricTile label="加权平均利率" value={fmtPct(detailSummary.weightedRate)} tone="indigo" />
              <MetricTile label="总还款" value={fmtMoney(detailSummary.totalPayment)} tone="indigo" />
              <MetricTile label="总利息" value={fmtMoney(detailSummary.totalInterest)} tone="emerald" />
              <MetricTile label="期末总本金余额" value={fmtMoney(detailSummary.endingBalance)} tone="emerald" />
            </>
          )}
          {!detailSummary && strategy.expectedInterest !== undefined && (
            <MetricTile label="期望总利息" value={fmtMoney(strategy.expectedInterest)} tone="emerald" />
          )}
          {!detailSummary && strategy.expectedMaxPayment !== undefined && (
            <MetricTile label="期望最高双周供" value={fmtMoney(strategy.expectedMaxPayment)} />
          )}
          {!detailSummary && strategy.expectedEndingBalance !== undefined && (
            <MetricTile label="期望剩余本金" value={fmtMoney(strategy.expectedEndingBalance)} tone="emerald" />
          )}
          {!detailSummary && strategy.expectedPaymentVolatility !== undefined && (
            <MetricTile label="还款波动 (stddev)" value={`±${fmtMoney(strategy.expectedPaymentVolatility)}`} />
          )}
          {!detailSummary && strategy.expectedWorstCaseInterest !== undefined && strategy.expectedWorstCaseInterest !== null && (
            <MetricTile label="最坏情景总利息" value={fmtMoney(strategy.expectedWorstCaseInterest)} tone="rose" />
          )}
          {!detailSummary && strategy.expectedWorstCasePayment !== undefined && strategy.expectedWorstCasePayment !== null && (
            <MetricTile label="最坏月供峰值" value={fmtMoney(strategy.expectedWorstCasePayment)} tone="rose" />
          )}
          {!detailSummary && strategy.expectedMaxConcurrentRefixPercentage !== undefined && (
            <MetricTile
              label="单月同时到期占比"
              value={fmtPct(strategy.expectedMaxConcurrentRefixPercentage)}
              tone="amber"
            />
          )}
          {!detailSummary && strategy.expectedFloatingExposure !== undefined && (
            <MetricTile
              label="浮动 / Offset 占比"
              value={fmtPct(strategy.expectedFloatingExposure)}
              tone="cyan"
            />
          )}
          {!detailSummary && strategy.expectedAffordabilityBreaches !== undefined && (
            <MetricTile
              label="超预算次数"
              value={`${strategy.expectedAffordabilityBreaches} 次`}
              tone={strategy.expectedAffordabilityBreaches > 0 ? "amber" : "emerald"}
            />
          )}
          {!detailSummary && strategy.expectedPayoffTime !== undefined && strategy.expectedPayoffTime !== null && strategy.expectedPayoffTime !== 0 && (
            <MetricTile label="预计偿清月数" value={`${strategy.expectedPayoffTime} 月`} />
          )}
          {!detailSummary && strategy.isParetoOptimal !== undefined && (
            <MetricTile
              label="帕累托前沿"
              value={strategy.isParetoOptimal ? "是" : "否 (被支配)"}
              tone={strategy.isParetoOptimal ? "emerald" : "rose"}
            />
          )}
          {!detailSummary && strategy.score !== undefined && (
            <MetricTile label="综合评分" value={strategy.score.toFixed(3)} tone="indigo" />
          )}
        </div>

        {/* PROS / CONS */}
        <div className="sdm-pros-cons">
          <div className="sdm-pros">
            <h3 className="sdm-section-title">✓ 优势</h3>
            {pros.length === 0 ? (
              <div className="sdm-muted">无明显优势标签</div>
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
            <h3 className="sdm-section-title">✗ 不足</h3>
            {cons.length === 0 ? (
              <div className="sdm-muted">无明显不足标签</div>
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
              本金余额路径 {detailScenarioLabel ? `· ${detailScenarioLabel}` : ""}
            </h3>
            {isDetailLoading ? (
              <div className="sdm-muted">正在按当前选定策略即时生成详细 timeline。为避免内存峰值,系统不会再为所有策略预先保存整包明细。</div>
            ) : detailTimelineData && detailTimelineData.tranches && detailTimelineData.tranches.length > 0 ? (
              <BalanceLinechart data={detailTimelineData} />
            ) : null}

            <h3 className="sdm-section-title" style={{ marginTop: "16px" }}>
              明细项 {detailScenarioLabel ? `· ${detailScenarioLabel}` : ""}
            </h3>
            {isDetailLoading ? (
              <div className="sdm-muted">正在按当前选定策略即时生成详细 timeline...</div>
            ) : detailTimelineData && detailTimelineData.tranches && detailTimelineData.tranches.length > 0 ? (
              <InlineTimelineV2 data={detailTimelineData} />
            ) : (
              <div className="sdm-muted">时间线数据未生成,可点击底部"设为当前对比策略"按钮触发即时计算。</div>
            )}
          </div>
        )}

        {/* FOOTER */}
        <div className="sdm-footer">
          <div className="sdm-footer-meta">
            {strategy.strategyId && (
              <span className="sdm-footer-meta-item">策略 ID: {strategy.strategyId}</span>
            )}
          </div>
          <div className="sdm-footer-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
            >
              关闭
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
        .sdm-desc {
          font-size: 12.5px;
          color: var(--text-muted);
          line-height: 1.55;
          margin: 0 0 16px;
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
        @media (prefers-reduced-motion: reduce) {
          .sdm-backdrop, .sdm-card { animation: none; }
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
function renderSplitInline(/** @type {any} */ strategy) {
  const s = strategy;
  // The page's ranked strategies don't include allocation detail by default;
  // the user can see the full split via the strategy-split renderer in the
  // page. The modal just shows the strategyId and a generic summary.
  if (s.strategyId) return s.strategyId;
  return "(unknown strategy)";
}

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
  const { data } = props;
  const { snapshotMonths = [], tranches = [] } = data || {};
  if (!tranches.length || !snapshotMonths.length) {
    return <div className="sdm-muted">无时间线数据</div>;
  }

  /** @type {(n: number) => string} */
  const money = (n) => `$${Math.round(n).toLocaleString()}`;
  /** @type {(rate: number) => string} */
  const ratePct = (r) => `${(r * 100).toFixed(2)}%`;
  /** @type {(month: number) => string} */
  const labelFor = (m) => {
    const years = Math.floor(m / 12);
    const months = m % 12;
    return `Y${years}M${months}`;
  };

  return (
    <div style={{ overflowX: "auto", maxHeight: "320px" }}>
      <table className="sdm-timeline-table">
        <thead>
          <tr>
            <th rowSpan={2}>明细项</th>
            <th rowSpan={2}>初始本金</th>
            {snapshotMonths.map((/** @type {number} */ m) => (
              <th key={m} colSpan={4}>{labelFor(m)}</th>
            ))}
          </tr>
          <tr>
            {snapshotMonths.map((/** @type {number} */ m) => (
              <th key={`sub-${m}`} className="sdm-subhead">利率</th>
            )).flatMap((_t, idx) => {
              // For each snapshot month emit 4 sub-headers (利率 / 续约 / 利息 / 本金)
              const out = [];
              for (let i = 0; i < snapshotMonths.length; i++) {
                out.push(<th key={`sub-${snapshotMonths[i]}-rate`} className="sdm-subhead">利率</th>);
                out.push(<th key={`sub-${snapshotMonths[i]}-ev`} className="sdm-subhead">续约</th>);
                out.push(<th key={`sub-${snapshotMonths[i]}-int`} className="sdm-subhead">利息</th>);
                out.push(<th key={`sub-${snapshotMonths[i]}-pr`} className="sdm-subhead">本金</th>);
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
                <td className="sdm-row-label" colSpan={2}>合计</td>
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
  const { data } = props;
  const { snapshotMonths = [], tranches = [] } = data || {};
  if (!tranches.length || !snapshotMonths.length) {
    return <div className="sdm-muted">无时间线数据</div>;
  }

  const money = (n) => `$${Math.round(n).toLocaleString()}`;
  const ratePct = (r) => `${(r * 100).toFixed(2)}%`;
  const labelFor = (m) => {
    const years = Math.floor(m / 12);
    const months = m % 12;
    return `Y${years}M${months}`;
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
    <div style={{ overflowX: "auto", maxHeight: "420px" }}>
      <table className="sdm-timeline-table-v2">
        <thead>
          <tr>
            <th className="sdm-v2-head-sticky-1">贷款分片</th>
            <th className="sdm-v2-head-sticky-2">明细项</th>
            {snapshotMonths.map((/** @type {number} */ m) => (
              <th key={m}>{labelFor(m)}</th>
            ))}
            <th>期末/累计总计</th>
          </tr>
        </thead>
        <tbody>
          {tranches.map((/** @type {any} */ tranche, /** @type {number} */ idx) => {
            const snaps = tranche.snapshots || [];
            const totalPayment = sumBy(snaps, (snap) => snap.totalPayment);
            const totalInterest = sumBy(snaps, (snap) => snap.interestPaid);
            const finalBalance = snaps[snaps.length - 1]?.balance || tranche.initialBalance;

            const rows = [
              { key: "rate", label: "加权平均利率", valueFor: (snap) => ratePct(snap.rate), finalValue: "—" },
              { key: "payment", label: "总还款", valueFor: (snap) => money(snap.totalPayment), finalValue: money(totalPayment), className: "sdm-tone-indigo" },
              { key: "interest", label: "总利息", valueFor: (snap) => money(snap.interestPaid), finalValue: money(totalInterest), className: "sdm-tone-indigo" },
              { key: "balance", label: "总本金余额", valueFor: (snap) => money(snap.balance), finalValue: money(finalBalance), className: "sdm-tone-emerald" }
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
            { key: "rate", label: "加权平均利率", valueFor: (col) => ratePct(col.weightedRate), finalValue: ratePct(finalTotalRate) },
            { key: "payment", label: "总还款", valueFor: (col) => money(col.totalPayment), finalValue: money(sumBy(totalColumns, (col) => col.totalPayment)), className: "sdm-tone-indigo" },
            { key: "interest", label: "总利息", valueFor: (col) => money(col.totalInterest), finalValue: money(sumBy(totalColumns, (col) => col.totalInterest)), className: "sdm-tone-indigo" },
            { key: "balance", label: "总本金余额", valueFor: (col) => money(col.totalBalance), finalValue: money(totalColumns[totalColumns.length - 1]?.totalBalance || 0), className: "sdm-tone-emerald" }
          ].map((row, rowIndex, rows) => (
            <tr key={`total-${row.key}`} className={`sdm-v2-total-row ${row.className || ""}`}>
              {rowIndex === 0 && (
                <td className="sdm-v2-tranche-name sdm-v2-total-label" rowSpan={rows.length}>
                  所有分片合计
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
          width: 100%;
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
            label: "本金余额",
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
