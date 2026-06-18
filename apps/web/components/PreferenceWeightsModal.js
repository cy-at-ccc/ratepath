"use client";

import { useEffect, useRef } from "react";

function applySliderFill(/** @type {HTMLInputElement | null} */ el) {
  if (!el) return;
  const min = parseFloat(el.min || "0");
  const max = parseFloat(el.max || "100");
  const val = parseFloat(el.value || "0");
  const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
  el.style.setProperty("--slider-fill", `${pct}%`);
}

function WeightSlider(/** @type {any} */ props) {
  const { value, onChange, ...rest } = props;
  const ref = useRef(/** @type {HTMLInputElement | null} */ (null));

  useEffect(() => {
    applySliderFill(ref.current);
  }, [value]);

  return (
    <input
      {...rest}
      ref={ref}
      type="range"
      value={value}
      onChange={(e) => {
        onChange?.(e);
        applySliderFill(e.target);
      }}
      className="pwm-slider"
    />
  );
}

/**
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {() => void} props.onClose
 * @param {Record<string, number>} props.weights
 * @param {Array<any>} props.items
 * @param {(key: string, value: number) => void} props.onWeightChange
 * @param {() => void} props.onReset
 * @param {boolean} props.isModified
 */
export default function PreferenceWeightsModal(/** @type {any} */ props) {
  const {
    isOpen,
    onClose,
    weights,
    items,
    onWeightChange,
    onReset,
    isModified
  } = props;

  const closeBtnRef = useRef(/** @type {any} */ (null));
  const lastFocusedRef = useRef(/** @type {any} */ (null));
  const cardRef = useRef(/** @type {any} */ (null));

  useEffect(() => {
    if (!isOpen) return;

    lastFocusedRef.current = typeof document !== "undefined" ? document.activeElement : null;

    const handler = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === "Escape") {
        onClose?.();
      }
    };

    window.addEventListener("keydown", handler);
    const timer = setTimeout(() => closeBtnRef.current?.focus(), 60);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handler);
      clearTimeout(timer);
      document.body.style.overflow = prevOverflow;
      try { lastFocusedRef.current?.focus?.(); } catch {}
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="pwm-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pwm-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div ref={cardRef} className="pwm-card glass-panel">
        <div className="pwm-header">
          <div>
            <div className="pwm-eyebrow">偏好推荐专用</div>
            <h3 id="pwm-title" className="pwm-title">个人还款偏好</h3>
            <p className="pwm-copy">
              这里只影响“偏好匹配推荐”这张卡。所有权重之和固定为 100%，调高某一项时，其余项会按比例自动缩放。
            </p>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className="pwm-close"
            onClick={onClose}
            aria-label="关闭偏好设置"
          >
            x
          </button>
        </div>

        <div className="pwm-list">
          {items.map((item) => (
            <div key={item.key} className="pwm-item">
              <div className="pwm-item-header">
                <span className="pwm-item-label">{item.label}</span>
                <span className="pwm-item-value">{weights[item.key] ?? 0}%</span>
              </div>
              <WeightSlider
                min={0}
                max={100}
                step={1}
                value={weights[item.key] ?? 0}
                onChange={(e) => onWeightChange(item.key, parseInt(e.target.value, 10))}
                aria-label={`${item.label}权重`}
                aria-valuetext={`${weights[item.key] ?? 0}%`}
              />
              <div className="pwm-range">
                <span>{item.minText}</span>
                <span>{item.maxText}</span>
              </div>
              <p className="pwm-item-copy">{item.explanation}</p>
            </div>
          ))}
        </div>

        <div className="pwm-footer">
          <div className="pwm-total">当前总和: 100%</div>
          <div className="pwm-actions">
            {isModified && (
              <button type="button" className="btn btn-secondary" onClick={onReset}>
                重置默认
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={onClose}>
              完成
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        .pwm-backdrop {
          position: fixed;
          inset: 0;
          z-index: 1200;
          background: rgba(11, 15, 25, 0.7);
          backdrop-filter: blur(10px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
        }

        .pwm-card {
          width: min(760px, 100%);
          max-height: min(84vh, 900px);
          overflow: auto;
          padding: 22px;
          border-radius: 20px;
        }

        .pwm-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 18px;
        }

        .pwm-eyebrow {
          font-size: 11px;
          color: var(--chart-info);
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          margin-bottom: 6px;
        }

        .pwm-title {
          margin: 0;
          font-size: 22px;
          color: #fff;
        }

        .pwm-copy {
          margin: 8px 0 0;
          color: var(--text-secondary);
          font-size: 13px;
          line-height: 1.6;
        }

        .pwm-close {
          width: 36px;
          height: 36px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(255,255,255,0.04);
          color: #fff;
          cursor: pointer;
          flex-shrink: 0;
        }

        .pwm-list {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .pwm-item {
          padding: 14px 16px;
          border-radius: 16px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.06);
        }

        .pwm-item-header,
        .pwm-range,
        .pwm-footer,
        .pwm-actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .pwm-item-label {
          color: #fff;
          font-size: 13px;
          font-weight: 700;
        }

        .pwm-item-value {
          color: var(--chart-info);
          font-size: 13px;
          font-weight: 700;
          flex-shrink: 0;
        }

        .pwm-slider {
          width: 100%;
          margin-top: 10px;
          appearance: none;
          background: transparent;
          height: 22px;
          --slider-fill: 0%;
        }

        .pwm-slider::-webkit-slider-runnable-track {
          height: 6px;
          border-radius: 999px;
          background: linear-gradient(
            90deg,
            var(--color-primary) 0,
            var(--color-primary) var(--slider-fill),
            rgba(255,255,255,0.1) var(--slider-fill),
            rgba(255,255,255,0.1) 100%
          );
        }

        .pwm-slider::-webkit-slider-thumb {
          appearance: none;
          width: 18px;
          height: 18px;
          margin-top: -6px;
          border-radius: 50%;
          background: #fff;
          border: 3px solid var(--color-primary);
          box-shadow: 0 6px 18px rgba(0,0,0,0.28);
        }

        .pwm-slider::-moz-range-track {
          height: 6px;
          border: none;
          border-radius: 999px;
          background: rgba(255,255,255,0.1);
        }

        .pwm-slider::-moz-range-progress {
          height: 6px;
          border-radius: 999px;
          background: var(--color-primary);
        }

        .pwm-slider::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #fff;
          border: 3px solid var(--color-primary);
          box-shadow: 0 6px 18px rgba(0,0,0,0.28);
        }

        .pwm-range {
          margin-top: 4px;
          color: var(--text-muted);
          font-size: 11px;
        }

        .pwm-item-copy {
          margin: 10px 0 0;
          color: var(--text-secondary);
          font-size: 12px;
          line-height: 1.6;
        }

        .pwm-footer {
          margin-top: 18px;
          padding-top: 16px;
          border-top: 1px solid rgba(255,255,255,0.08);
        }

        .pwm-total {
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 600;
        }

        @media (max-width: 720px) {
          .pwm-backdrop {
            padding: 12px;
          }

          .pwm-card {
            padding: 18px;
            max-height: 88vh;
          }

          .pwm-footer {
            align-items: stretch;
            flex-direction: column;
          }

          .pwm-actions {
            width: 100%;
          }

          .pwm-actions :global(button) {
            flex: 1;
          }
        }
      `}</style>
    </div>
  );
}
