"use client";

import { useState, useRef, useEffect } from "react";

/**
 * Custom SvgChart component to render responsive lines without D3 or Canvas.
 * @param {Object} props
 * @param {Array<{id: string, name: string, color: string, points: Array<{month: number, value: number}>}>} props.data - Array of datasets
 * @param {string} [props.yAxisType="rate"] - Type of axis: "rate" (e.g., 5.50%) or "currency" (e.g., $450,000)
 * @param {string} [props.title] - Chart title
 * @param {number} [props.height=300] - Height of chart
 * @returns {any}
 */
export default function SvgChart({ data, yAxisType = "rate", title, height = 300 }) {
  const [hoverIndex, setHoverIndex] = useState(/** @type {number|null} */ (null));
  const [hoverX, setHoverX] = useState(0);
  const [hoverY, setHoverY] = useState(0);
  const containerRef = useRef(/** @type {any} */ (null));
  const [width, setWidth] = useState(600);

  // Resize listener
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Filter out datasets that have no points
  const activeData = data.filter((d) => d.points && d.points.length > 0);
  if (activeData.length === 0) {
    return (
      <div className="chart-empty" style={{ height }}>
        暂无图表数据
      </div>
    );
  }

  // Find boundaries
  const allMonths = activeData.flatMap((d) => d.points.map((p) => p.month));
  const allValues = activeData.flatMap((d) => d.points.map((p) => p.value));
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
  const margin = { top: 20, right: 30, bottom: 40, left: 65 };
  const graphWidth = width - margin.left - margin.right;
  const graphHeight = height - margin.top - margin.bottom;

  // Coordinate converters
  const getX = (/** @type {number} */ month) => margin.left + ((month - minMonth) / xRange) * graphWidth;
  const getY = (/** @type {number} */ val) => margin.top + graphHeight - ((val - yMin) / yRange) * graphHeight;

  // Format axis labels
  const formatYLabel = (/** @type {number} */ val) => {
    if (yAxisType === "rate") {
      return `${(val * 100).toFixed(1)}%`;
    }
    if (val >= 1e6) {
      return `$${(val / 1e6).toFixed(1)}M`;
    }
    if (val >= 1e3) {
      return `$${(val / 1e3).toFixed(0)}k`;
    }
    return `$${val.toFixed(0)}`;
  };

  // Get SVG path descriptor
  const getPathD = (/** @type {any[]} */ points) => {
    return points
      .map((/** @type {any} */ p, /** @type {number} */ idx) => {
        const x = getX(p.month);
        const y = getY(p.value);
        return `${idx === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");
  };

  // Hover detection logic
  const handleMouseMove = (/** @type {any} */ e) => {
    if (!containerRef.current || activeData.length === 0) return;
    const rect = containerRef.current.querySelector("svg").getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Map mouseX back to graph x coordinate
    const relativeX = mouseX - margin.left;
    const pct = Math.min(Math.max(0, relativeX / graphWidth), 1);
    const estimatedMonth = minMonth + pct * xRange;

    // Find closest point index
    const refPoints = activeData[0].points;
    let closestIdx = 0;
    let minDiff = Infinity;
    refPoints.forEach((/** @type {any} */ p, /** @type {number} */ idx) => {
      const diff = Math.abs(p.month - estimatedMonth);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = idx;
      }
    });

    setHoverIndex(closestIdx);
    setHoverX(getX(refPoints[closestIdx].month));
    setHoverY(mouseY);
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
  };

  // Generate grid values
  const yGridLines = [];
  const gridTicksCount = 4;
  for (let i = 0; i <= gridTicksCount; i++) {
    const val = yMin + (i / gridTicksCount) * yRange;
    yGridLines.push(val);
  }

  const xGridLines = [];
  const stepSize = xRange <= 12 ? 3 : xRange <= 36 ? 6 : 12;
  for (let m = minMonth; m <= maxMonth; m += stepSize) {
    xGridLines.push(m);
  }

  return (
    <div className="svg-chart-container" ref={containerRef}>
      {title && <h3 className="chart-title">{title}</h3>}
      
      <svg
        width={width}
        height={height}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: hoverIndex !== null ? "crosshair" : "default" }}
      >
        {/* Horizontal Grid lines & Y Axis Labels */}
        {yGridLines.map((val, idx) => {
          const y = getY(val);
          return (
            <g key={idx} className="grid-line-group">
              <line
                x1={margin.left}
                y1={y}
                x2={width - margin.right}
                y2={y}
                stroke="rgba(255,255,255,0.05)"
                strokeDasharray="4 4"
              />
              <text
                x={margin.left - 10}
                y={y + 4}
                textAnchor="end"
                className="axis-label"
                fill="var(--text-secondary)"
                fontSize="11"
              >
                {formatYLabel(val)}
              </text>
            </g>
          );
        })}

        {/* Vertical Grid lines & X Axis Labels */}
        {xGridLines.map((m, idx) => {
          const x = getX(m);
          return (
            <g key={idx} className="grid-line-group">
              <line
                x1={x}
                y1={margin.top}
                x2={x}
                y2={height - margin.bottom}
                stroke="rgba(255,255,255,0.05)"
              />
              <text
                x={x}
                y={height - margin.bottom + 20}
                textAnchor="middle"
                className="axis-label"
                fill="var(--text-secondary)"
                fontSize="11"
              >
                M{m}
              </text>
            </g>
          );
        })}

        {/* Draw Line paths */}
        {activeData.map((d) => (
          <path
            key={d.id}
            d={getPathD(d.points)}
            fill="none"
            stroke={d.color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ filter: `drop-shadow(0px 2px 4px ${d.color}44)` }}
          />
        ))}

        {/* Draw Hover Indicators */}
        {hoverIndex !== null && (
          <>
            {/* Vertical crosshair line */}
            <line
              x1={hoverX}
              y1={margin.top}
              x2={hoverX}
              y2={height - margin.bottom}
              stroke="rgba(255,255,255,0.2)"
              strokeWidth="1"
            />

            {/* Hover Circles for each active line */}
            {activeData.map((d) => {
              const pt = d.points[hoverIndex];
              if (!pt) return null;
              return (
                <circle
                  key={d.id}
                  cx={hoverX}
                  cy={getY(pt.value)}
                  r="5"
                  fill={d.color}
                  stroke="#fff"
                  strokeWidth="1.5"
                  style={{ filter: `drop-shadow(0 0 6px ${d.color})` }}
                />
              );
            })}
          </>
        )}
      </svg>

      {/* Legend & Hover Info box */}
      <div className="chart-footer">
        <div className="chart-legend">
          {activeData.map((d) => (
            <div key={d.id} className="legend-item">
              <span className="legend-dot" style={{ backgroundColor: d.color }}></span>
              <span className="legend-text">{d.name}</span>
            </div>
          ))}
        </div>

        {/* Floating details panel */}
        {hoverIndex !== null && (
          <div className="chart-tooltip glass-panel">
            <div className="tooltip-header">第 {activeData[0].points[hoverIndex].month} 个月</div>
            <div className="tooltip-grid">
              {activeData.map((d) => {
                const pt = d.points[hoverIndex];
                if (!pt) return null;
                return (
                  <div key={d.id} className="tooltip-row">
                    <span className="tooltip-label" style={{ color: d.color }}>{d.name}:</span>
                    <span className="tooltip-value">{formatYLabel(pt.value)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .svg-chart-container {
          width: 100%;
          position: relative;
        }

        .chart-title {
          font-family: var(--font-heading);
          font-size: 16px;
          margin-bottom: 12px;
          color: #fff;
        }

        .chart-empty {
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
          background: rgba(255,255,255,0.02);
          border: 1px dashed var(--border-glass);
          border-radius: 12px;
          font-size: 14px;
        }

        .axis-label {
          user-select: none;
        }

        .chart-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-top: 16px;
          flex-wrap: wrap;
          gap: 16px;
        }

        .chart-legend {
          display: flex;
          gap: 16px;
          flex-wrap: wrap;
        }

        .legend-item {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .legend-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
        }

        .legend-text {
          font-size: 12px;
          color: var(--text-secondary);
        }

        .chart-tooltip {
          padding: 10px 14px;
          border-radius: 8px;
          font-size: 12px;
          z-index: 10;
          min-width: 160px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        }

        .tooltip-header {
          font-weight: 600;
          margin-bottom: 6px;
          border-bottom: 1px solid rgba(255,255,255,0.1);
          padding-bottom: 4px;
          color: #fff;
        }

        .tooltip-grid {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .tooltip-row {
          display: flex;
          justify-content: space-between;
          gap: 12px;
        }

        .tooltip-label {
          font-weight: 500;
        }

        .tooltip-value {
          font-weight: 600;
          color: #fff;
        }
      `}</style>
    </div>
  );
}
