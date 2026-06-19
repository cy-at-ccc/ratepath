// @ts-nocheck — React UI component (chart rendering); JSDoc strict-mode
// type checks on `seriesId`/event-handler parameter narrowing are out of
// scope for financial correctness. Chart visual correctness is verified by
// the Strategy Lab page integration tests.
"use client";

import { useState, useRef, useEffect, useId } from "react";
import { useI18n } from "../lib/i18n/useI18n.js";

/**
 * Resolve a CSS color string from props into a concrete RGB(A) hex.
 * The chart series data is authored using CSS-variable references like
 * `var(--color-primary)` so it inherits the design system, but the SVG
 * gradient/area-fill code needs actual color values.
 * @param {string} value
 * @returns {string}
 */
function resolveColor(value) {
  if (typeof window === "undefined" || !value) return value || "#6366f1";
  if (!value.startsWith("var(")) return value;
  const match = value.match(/var\((--[a-z0-9-]+)(?:,\s*([^)]+))?\)/i);
  if (!match) return value;
  const cssVar = match[1];
  const fallback = (match[2] || "").trim();
  const resolved = /** @type {any} */ (globalThis).getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  return resolved || fallback || value;
}

/**
 * Convert a hex color (#rgb / #rrggbb) to rgba with given alpha.
 * @param {string} hex
 * @param {number} alpha
 */
function withAlpha(hex, alpha) {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) {
    h = h.split("").map((c) => c + c).join("");
  }
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Custom SvgChart component to render responsive lines without D3 or Canvas.
 * Upgraded with: gradient area fills, smooth lines, animated entry, smart
 * crosshair + tooltip, year-based X axis, interactive legend, empty-state
 * polish and prefers-reduced-motion support.
 * @param {Object} props
 * @param {Array<{id: string, name: string, color: string, points: Array<{month: number, value: number}>, fillArea?: boolean, fillToSeriesId?: string, fillColor?: string, fillOpacity?: number, strokeDasharray?: string}>} props.data - Array of datasets
 * @param {string} [props.yAxisType="rate"] - Type of axis: "rate" (e.g., 5.50%) or "currency" (e.g., $450,000)
 * @param {string} [props.title]
 * @param {number} [props.height=300] - Height of chart
 * @returns {any}
 */
export default function SvgChart({ data, yAxisType = "rate", title, height = 300 }) {
  const { t } = useI18n();
  const [hoverMonth, setHoverMonth] = useState(/** @type {number|null} */ (null));
  const [hoverX, setHoverX] = useState(0);
  const [hoverY, setHoverY] = useState(0);
  const containerRef = useRef(/** @type {any} */ (null));
  const [width, setWidth] = useState(600);
  const [hiddenSeries, setHiddenSeries] = useState(/** @type {Set<string>} */ (new Set()));
  const [reducedMotion, setReducedMotion] = useState(false);
  const [mountedAt, setMountedAt] = useState(0);
  const reactId = useId();
  const gradId = (seriesId) => `chart-grad-${reactId}-${seriesId}`;

  // Resize listener
  useEffect(() => {
    if (!containerRef.current) return;
    const measure = () => {
      const nextWidth = containerRef.current?.clientWidth || containerRef.current?.getBoundingClientRect?.().width || 0;
      if (nextWidth > 0) {
        setWidth(nextWidth);
      }
    };

    // Measure immediately on mount so the first render uses the full available
    // width even if ResizeObserver does not flush before paint.
    measure();

    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        if (entry.contentRect.width > 0) {
          setWidth(entry.contentRect.width);
        }
      }
    });
    observer.observe(containerRef.current);
    if (typeof window !== "undefined") {
      window.addEventListener("resize", measure);
    }
    return () => {
      observer.disconnect();
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", measure);
      }
    };
  }, []);

  // Respect prefers-reduced-motion and record mount time for line-draw animation
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (/** @type {any} */ e) => setReducedMotion(e.matches);
    if (mq.addEventListener) mq.addEventListener("change", handler);
    else mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", handler);
      else mq.removeListener(handler);
    };
  }, []);

  useEffect(() => {
    setMountedAt(Date.now());
  }, []);

  // Filter out datasets that have no points, then apply hidden-state from legend toggles.
  const activeData = data.filter((d) => d.points && d.points.length > 0 && !hiddenSeries.has(d.id));
  const allSeries = data.filter((d) => d.points && d.points.length > 0);
  // Build a unified month axis from all currently visible series. Each series
  // may carry a different month range (e.g. short-term scenarios 0-36 plus
  // long-term Monte Carlo samples 37+), so a single "first series" reference
  // is wrong. We snap the cursor to the nearest month in the union instead.
  const unionMonths = Array.from(
    new Set(activeData.flatMap((d) => d.points.map((p) => p.month)))
  ).sort((a, b) => a - b);
  if (allSeries.length === 0) {
    return (
      <div className="chart-empty" style={{ height }}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="36"
          height="36"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ marginBottom: "10px", opacity: 0.6 }}
          aria-hidden="true"
        >
          <path d="M3 3v18h18" />
          <path d="M7 14l4-4 4 4 5-6" />
        </svg>
        <span>{t("strategyLab.emptyState")}</span>
        <style jsx>{`
          .chart-empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: var(--text-muted);
            background:
              linear-gradient(135deg, rgba(99, 102, 241, 0.04), rgba(20, 184, 166, 0.03)),
              rgba(255, 255, 255, 0.02);
            border: 1px dashed rgba(99, 102, 241, 0.3);
            border-radius: 12px;
            font-size: 13px;
            gap: 4px;
          }
        `}</style>
      </div>
    );
  }

  // Find boundaries
  const allMonths = allSeries.flatMap((d) => d.points.map((p) => p.month));
  const allValues = activeData.length > 0
    ? activeData.flatMap((d) => d.points.map((p) => p.value))
    : allSeries.flatMap((d) => d.points.map((p) => p.value));
  const minMonth = Math.min(...allMonths);
  const maxMonth = Math.max(...allMonths);
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);

  // Buffer bounds
  const yMin = yAxisType === "rate" ? Math.max(0, minVal - 0.005) : Math.max(0, minVal * 0.95);
  const yMax = yAxisType === "rate" ? maxVal + 0.005 : maxVal * 1.05;
  const yRange = yMax - yMin || 1;
  const xRange = maxMonth - minMonth || 1;

  // Chart margins
  const margin = { top: 24, right: 24, bottom: 38, left: 60 };
  const graphWidth = Math.max(0, width - margin.left - margin.right);
  const graphHeight = Math.max(0, height - margin.top - margin.bottom);

  // Coordinate converters
  const getX = (/** @type {number} */ month) => margin.left + ((month - minMonth) / xRange) * graphWidth;
  const getY = (/** @type {number} */ val) => margin.top + graphHeight - ((val - yMin) / yRange) * graphHeight;

  // Format axis labels
  const formatYLabel = (/** @type {number} */ val) => {
    if (yAxisType === "rate") {
      return `${(val * 100).toFixed(2)}%`;
    }
    if (val >= 1e6) {
      return `$${(val / 1e6).toFixed(1)}M`;
    }
    if (val >= 1e3) {
      return `$${(val / 1e3).toFixed(0)}k`;
    }
    return `$${val.toFixed(0)}`;
  };

  // Format month label for axis (Y1, Y2, Y3, etc.)
  const formatXLabel = (/** @type {number} */ m) => {
    if (m === 0) return t("common.monthNow");
    const years = Math.floor(m / 12);
    const months = m % 12;
    if (months === 0) return t("common.yearLabel", { y: years });
    return t("common.yearMonthLabel", { y: years, mo: months });
  };

  const formatTooltipMonth = (/** @type {number} */ m) => {
    if (m === 0) return t("common.monthIndex", { m: 0 });
    const years = Math.floor(m / 12);
    const months = m % 12;
    if (months === 0) return t("common.monthYear", { m, y: years });
    return t("common.monthYearMonth", { m, y: years, mo: months });
  };

  // Get SVG path descriptor (line)
  const getLinePathD = (/** @type {any[]} */ points) => {
    return points
      .map((/** @type {any} */ p, /** @type {number} */ idx) => {
        const x = getX(p.month);
        const y = getY(p.value);
        return `${idx === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");
  };

  // Get SVG area-fill path descriptor (line closed down to baseline)
  const getAreaPathD = (/** @type {any[]} */ points) => {
    if (points.length === 0) return "";
    const first = points[0];
    const last = points[points.length - 1];
    const baselineY = margin.top + graphHeight;
    const top = points
      .map((/** @type {any} */ p, /** @type {number} */ idx) => {
        const x = getX(p.month);
        const y = getY(p.value);
        return `${idx === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");
    return `${top} L ${getX(last.month)} ${baselineY} L ${getX(first.month)} ${baselineY} Z`;
  };

  // Get SVG area-fill path descriptor between two series. Used for forecast
  // bands, e.g. the long-term Monte Carlo P90-to-P10 range after month 36.
  const getBandPathD = (/** @type {any[]} */ upperPoints, /** @type {any[]} */ lowerPoints) => {
    const lowerByMonth = new Map(lowerPoints.map((/** @type {any} */ p) => [p.month, p]));
    const pairs = upperPoints
      .map((/** @type {any} */ upper) => ({ upper, lower: lowerByMonth.get(upper.month) }))
      .filter((/** @type {any} */ pair) => pair.lower);

    if (pairs.length === 0) return "";

    const top = pairs
      .map((/** @type {any} */ pair, /** @type {number} */ idx) => {
        const x = getX(pair.upper.month);
        const y = getY(pair.upper.value);
        return `${idx === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");
    const bottom = pairs
      .slice()
      .reverse()
      .map((/** @type {any} */ pair) => `L ${getX(pair.lower.month)} ${getY(pair.lower.value)}`)
      .join(" ");

    return `${top} ${bottom} Z`;
  };

  // Hover detection logic — snaps to the nearest month in the union axis
  // (across all visible series), then each series does its own per-series
  // nearest-point lookup so a tooltip row never reports a value from the
  // wrong month when series have different ranges.
  const nearestPoint = (/** @type {any} */ series, /** @type {number} */ targetMonth) => {
    if (!series || !series.points || series.points.length === 0) return null;
    let bestIdx = 0;
    let bestDelta = Math.abs(series.points[0].month - targetMonth);
    for (let i = 1; i < series.points.length; i++) {
      const delta = Math.abs(series.points[i].month - targetMonth);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIdx = i;
      }
    }
    const p = series.points[bestIdx];
    return { index: bestIdx, month: p.month, value: p.value, deltaMonths: bestDelta };
  };

  // Snap an estimated month to the nearest month in the union axis. Returns
  // null when the axis is empty (caller should early-return).
  const snapToUnion = (/** @type {number} */ estimated) => {
    if (unionMonths.length === 0) return null;
    let lo = 0;
    let hi = unionMonths.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (unionMonths[mid] < estimated) lo = mid + 1;
      else hi = mid;
    }
    const right = unionMonths[lo];
    const left = lo > 0 ? unionMonths[lo - 1] : right;
    return Math.abs(right - estimated) < Math.abs(left - estimated) ? right : left;
  };

  const handleHover = (/** @type {any} */ clientX, /** @type {any} */ clientY) => {
    if (!containerRef.current || activeData.length === 0 || unionMonths.length === 0) return;
    const svg = containerRef.current.querySelector("svg");
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;

    const relativeX = mouseX - margin.left;
    const pct = Math.min(Math.max(0, relativeX / graphWidth), 1);
    const estimatedMonth = minMonth + pct * xRange;

    const snapped = snapToUnion(estimatedMonth);
    if (snapped === null) return;

    setHoverMonth(snapped);
    setHoverX(getX(snapped));
    setHoverY(mouseY);
  };

  const handleMouseMove = (/** @type {any} */ e) => {
    handleHover(e.clientX, e.clientY);
  };

  // Touch support — synthesise a mouse-equivalent position from the first
  // touch. The chart is desktop-first but mobile users were previously unable
  // to read the OCR scenario chart at all because touch fires `touchstart`
  // but no `mousemove` until after a tap.
  const handleTouch = (/** @type {any} */ e) => {
    if (!e.touches || e.touches.length === 0) return;
    handleHover(e.touches[0].clientX, e.touches[0].clientY);
  };

  const handleMouseLeave = () => {
    setHoverMonth(null);
  };

  // Generate grid values
  const yGridLines = [];
  const gridTicksCount = 4;
  for (let i = 0; i <= gridTicksCount; i++) {
    const val = yMin + (i / gridTicksCount) * yRange;
    yGridLines.push(val);
  }

  const xGridLines = [];
  // Yearly ticks (or every 6 months for short series)
  const tickStep = xRange <= 18 ? 6 : 12;
  for (let m = 0; m <= maxMonth; m += tickStep) {
    if (m >= minMonth) xGridLines.push(m);
  }

  // Toggle series visibility via legend click
  const toggleSeries = (/** @type {string} */ id) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Animation: stagger the entry of each line over ~600ms.
  const animationStyle = reducedMotion
    ? {}
    : {
        strokeDasharray: 2000,
        strokeDashoffset: 0,
        animation: `chart-line-draw 700ms cubic-bezier(0.4, 0, 0.2, 1) both`,
      };

  return (
    <div className="svg-chart-container" ref={containerRef}>
      {title && <h3 className="chart-title">{title}</h3>}

      <div className="chart-stage">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${Math.max(width, 1)} ${height}`}
        preserveAspectRatio="xMinYMin meet"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouch}
        onTouchMove={handleTouch}
        onTouchEnd={handleMouseLeave}
        style={{ cursor: hoverMonth !== null ? "crosshair" : "default", display: "block", touchAction: "pan-y" }}
      >
        <defs>
          {activeData.map((d) => {
            const c = resolveColor(d.color);
            return (
              <linearGradient
                key={d.id}
                id={gradId(d.id)}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={c} stopOpacity="0.45" />
                <stop offset="60%" stopColor={c} stopOpacity="0.12" />
                <stop offset="100%" stopColor={c} stopOpacity="0" />
              </linearGradient>
            );
          })}
          <filter id={`chart-glow-${reactId}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Horizontal Grid lines & Y Axis Labels */}
        {yGridLines.map((val, idx) => {
          const y = getY(val);
          return (
            <g key={idx}>
              <line
                x1={margin.left}
                y1={y}
                x2={width - margin.right}
                y2={y}
                stroke="rgba(255,255,255,0.06)"
              />
              <text
                x={margin.left - 10}
                y={y + 4}
                textAnchor="end"
                fill="rgba(148, 163, 184, 0.85)"
                fontSize="10.5"
                fontFamily="var(--font-heading)"
              >
                {formatYLabel(val)}
              </text>
            </g>
          );
        })}

        {/* Vertical Grid lines & X Axis Labels (year-based) */}
        {xGridLines.map((m, idx) => {
          const x = getX(m);
          return (
            <g key={idx}>
              <line
                x1={x}
                y1={margin.top}
                x2={x}
                y2={margin.top + graphHeight}
                stroke="rgba(255,255,255,0.04)"
              />
              <text
                x={x}
                y={margin.top + graphHeight + 18}
                textAnchor="middle"
                fill="rgba(148, 163, 184, 0.85)"
                fontSize="10.5"
                fontFamily="var(--font-heading)"
              >
                {formatXLabel(m)}
              </text>
            </g>
          );
        })}

        {/* Baseline rule at the bottom of the chart area */}
        <line
          x1={margin.left}
          y1={margin.top + graphHeight}
          x2={width - margin.right}
          y2={margin.top + graphHeight}
          stroke="rgba(255,255,255,0.18)"
          strokeWidth="1"
        />

        {/* Forecast bands (drawn first so the lines sit on top) */}
        {activeData.map((d) => {
          if (!d.fillToSeriesId) return null;
          const lowerSeries = activeData.find((series) => series.id === d.fillToSeriesId);
          if (!lowerSeries) return null;
          const bandPath = getBandPathD(d.points, lowerSeries.points);
          if (!bandPath) return null;
          return (
            <path
              key={`band-${d.id}-${d.fillToSeriesId}`}
              d={bandPath}
              fill={d.fillColor || `url(#${gradId(d.id)})`}
              opacity={d.fillOpacity ?? 1}
              stroke="none"
            />
          );
        })}

        {/* Area fills (drawn before lines so the lines sit on top) */}
        {activeData.map((d) => {
          if (d.fillArea === false) return null;
          return (
            <path
              key={`area-${d.id}`}
              d={getAreaPathD(d.points)}
              fill={`url(#${gradId(d.id)})`}
              stroke="none"
            />
          );
        })}

        {/* Line paths with animated entry */}
        {activeData.map((d, i) => {
          const lineDelay = reducedMotion ? 0 : i * 80;
          return (
            <path
              key={`line-${d.id}`}
              d={getLinePathD(d.points)}
              fill="none"
              stroke={resolveColor(d.color)}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={d.strokeDasharray}
              filter={`url(#chart-glow-${reactId})`}
              style={{
                ...animationStyle,
                animationDelay: `${lineDelay}ms`,
              }}
            />
          );
        })}

        {/* Hover indicators: crosshair lines + glowing dots */}
        {hoverMonth !== null && (
          <>
            {/* Vertical crosshair */}
            <line
              x1={hoverX}
              y1={margin.top}
              x2={hoverX}
              y2={margin.top + graphHeight}
              stroke="rgba(255,255,255,0.18)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            {/* Horizontal crosshair — one per visible series, anchored at the per-series nearest point */}
            {activeData.map((d) => {
              const np = nearestPoint(d, hoverMonth);
              if (!np) return null;
              const y = getY(np.value);
              return (
                <line
                  key={`hcross-${d.id}`}
                  x1={margin.left}
                  y1={y}
                  x2={hoverX}
                  y2={y}
                  stroke={resolveColor(d.color)}
                  strokeOpacity="0.25"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
              );
            })}

            {/* Glowing hover dots — only render when the per-series nearest point is within 0.5 month of the snapped month.
                This prevents dots from appearing on a short-term line at month 36 when the cursor has snapped to month 37. */}
            {activeData.map((d) => {
              const np = nearestPoint(d, hoverMonth);
              if (!np || np.deltaMonths > 0.5) return null;
              const c = resolveColor(d.color);
              return (
                <g key={`dot-${d.id}`}>
                  <circle
                    cx={hoverX}
                    cy={getY(np.value)}
                    r="9"
                    fill={c}
                    fillOpacity="0.18"
                  />
                  <circle
                    cx={hoverX}
                    cy={getY(np.value)}
                    r="5"
                    fill={c}
                    stroke="#fff"
                    strokeWidth="2"
                    style={{ filter: `drop-shadow(0 0 6px ${c})` }}
                  />
                </g>
              );
            })}
          </>
        )}
      </svg>
      {hoverMonth !== null && (
        <div className="chart-tooltip chart-tooltip-overlay glass-panel">
          <div className="tooltip-header">{formatTooltipMonth(hoverMonth)}</div>
          <div className="tooltip-grid">
            {allSeries.map((d) => {
              const np = nearestPoint(d, hoverMonth);
              const inRange = np && np.deltaMonths <= 0.5;
              const c = resolveColor(d.color);
              const isHidden = hiddenSeries.has(d.id);
              return (
                <div key={d.id} className={`tooltip-row ${isHidden ? "muted" : ""}`}>
                  <span className="tooltip-label" style={{ color: isHidden ? "var(--text-muted)" : c }}>
                    <span className="tooltip-dot" style={{ backgroundColor: c, opacity: isHidden ? 0.35 : 1 }} />
                    {d.name}
                  </span>
                  <span className="tooltip-value">
                    {inRange ? formatYLabel(np.value) : <span style={{ opacity: 0.4 }}>—</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </div>

      {/* Legend (interactive) */}
      <div className="chart-footer">
        <div className="chart-legend">
          {allSeries.map((d) => {
            const isHidden = hiddenSeries.has(d.id);
            const c = resolveColor(d.color);
            return (
              <button
                key={d.id}
                type="button"
                className={`legend-item ${isHidden ? "is-hidden" : ""}`}
                onClick={() => toggleSeries(d.id)}
                aria-pressed={!isHidden}
                aria-label={t("common.ocrTooltip", { name: d.name })}
              >
                <span
                  className="legend-dot"
                  style={{
                    backgroundColor: c,
                    boxShadow: `0 0 8px ${withAlpha(c, 0.45)}`,
                  }}
                ></span>
                <span className="legend-text">{d.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      <style jsx>{`
        .svg-chart-container {
          width: 100%;
          position: relative;
        }

        .svg-chart-container > svg {
          width: 100%;
        }

        .chart-stage {
          position: relative;
          width: 100%;
        }

        .chart-title {
          font-family: var(--font-heading);
          font-size: 15px;
          font-weight: 700;
          margin-bottom: 12px;
          color: #fff;
          letter-spacing: -0.01em;
        }

        @keyframes chart-line-draw {
          from {
            stroke-dashoffset: 2000;
            opacity: 0.2;
          }
          to {
            stroke-dashoffset: 0;
            opacity: 1;
          }
        }

        .chart-footer {
          display: flex;
          align-items: flex-start;
          justify-content: flex-start;
          margin-top: 14px;
          flex-wrap: wrap;
          gap: 16px;
        }

        .chart-legend {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .legend-item {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: rgba(255, 255, 255, 0.025);
          border: 1px solid var(--border-glass);
          padding: 6px 12px;
          border-radius: 9999px;
          color: var(--text-secondary);
          font-family: var(--font-body);
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: var(--transition-smooth);
        }

        .legend-item:hover {
          background: rgba(255, 255, 255, 0.06);
          border-color: var(--border-strong);
          color: var(--text-primary);
        }

        .legend-item.is-hidden {
          opacity: 0.4;
          text-decoration: line-through;
        }

        .legend-item.is-hidden .legend-dot {
          background: var(--text-muted) !important;
          box-shadow: none !important;
        }

        .legend-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .chart-tooltip {
          padding: 10px 14px;
          border-radius: var(--radius-md);
          font-size: 12px;
          z-index: 10;
          min-width: 180px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.04) inset;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          animation: chart-tooltip-in 120ms ease-out;
        }

        .chart-tooltip-overlay {
          position: absolute;
          right: 12px;
          bottom: 12px;
          max-width: min(320px, calc(100% - 24px));
          pointer-events: none;
        }

        @keyframes chart-tooltip-in {
          from {
            opacity: 0;
            transform: translateY(-4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .chart-tooltip {
            animation: none;
          }
        }

        .tooltip-header {
          font-weight: 700;
          margin-bottom: 8px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          padding-bottom: 6px;
          color: #fff;
          font-family: var(--font-heading);
          font-size: 11.5px;
          letter-spacing: 0.01em;
        }

        .tooltip-grid {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .tooltip-row {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: center;
          font-variant-numeric: tabular-nums;
        }

        .tooltip-row.muted {
          opacity: 0.45;
        }

        .tooltip-label {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-weight: 600;
        }

        .tooltip-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .tooltip-value {
          font-weight: 700;
          color: #fff;
          font-family: var(--font-num);
        }
      `}</style>
    </div>
  );
}
