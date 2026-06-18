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

/**
 * WeightSliderItem — owns the slider input AND its % display so they can
 * share internal refs without React state in the drag loop.
 *
 * Why uncontrolled: with React controlled inputs, every drag tick triggers
 * a parent state update → component re-render → React briefly loses focus
 * on the slider → browser runs scrollIntoView on the focused element →
 * page jumps to top. By using `defaultValue` and reading the DOM value
 * imperatively, React is fully OUT of the drag loop. The slider's value
 * lives in the DOM until pointer-up, when we sync it back to the parent.
 *
 * Commit fires on:
 *   - pointer up (mouse drag end, touch lift, pen lift)
 *   - keyboard release of arrow / home / end / page keys
 *
 * Cancel: onPointerCancel restores the last committed parent value.
 */
const KEY_COMMIT_KEYS = new Set([
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
  "Home", "End", "PageUp", "PageDown"
]);

function WeightSliderItem(/** @type {any} */ props) {
  const { item, value, onCommit, minText, maxText, explanation, ariaLabel } = props;
  const sliderRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const displayRef = useRef(/** @type {HTMLSpanElement | null} */ (null));
  const draggingRef = useRef(false);

  // External value change (reset, parent re-mount, etc.) → sync DOM
  // imperatively. Skip while user is dragging to avoid snapping mid-drag.
  useEffect(() => {
    if (draggingRef.current) return;
    if (sliderRef.current) {
      sliderRef.current.value = String(value);
      applySliderFill(sliderRef.current);
    }
    if (displayRef.current) {
      displayRef.current.textContent = `${value}%`;
    }
  }, [value]);

  const commit = () => {
    if (!sliderRef.current) return;
    const v = parseInt(sliderRef.current.value, 10);
    if (!Number.isFinite(v)) return;
    onCommit?.(v);
  };

  const updateDisplay = (/** @type {string} */ newVal) => {
    if (displayRef.current) {
      displayRef.current.textContent = `${newVal}%`;
    }
  };

  return (
    <div className="pwm-item">
      <div className="pwm-item-header">
        <span className="pwm-item-label">{item.label}</span>
        <span ref={displayRef} className="pwm-item-value">{value}%</span>
      </div>
      <div className="pwm-slider-wrap">
        <input
          ref={sliderRef}
          type="range"
          defaultValue={value}
          min={0}
          max={25}
          step={1}
          onInput={(e) => {
            updateDisplay(e.currentTarget.value);
            applySliderFill(e.currentTarget);
          }}
          onPointerDown={() => { draggingRef.current = true; }}
          onPointerUp={() => {
            draggingRef.current = false;
            commit();
          }}
          onPointerCancel={() => {
            draggingRef.current = false;
            if (sliderRef.current) {
              sliderRef.current.value = String(value);
              applySliderFill(sliderRef.current);
            }
            updateDisplay(String(value));
          }}
          onKeyUp={(e) => {
            if (KEY_COMMIT_KEYS.has(e.key)) commit();
          }}
          aria-label={ariaLabel}
          aria-valuetext={`${value}%`}
          className="slider-input"
        />
        <div className="pwm-range">
          <span>{minText}</span>
          <span>{maxText}</span>
        </div>
      </div>
      <p className="pwm-item-copy">{explanation}</p>
    </div>
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
 * @param {number} [props.totalKeys] - Total number of weight dimensions. Must
 *   be kept in sync with PREFERENCE_WEIGHT_KEYS.length in strategy-lab/page.js.
 *   Defaults to items.length for backwards compatibility, but the page should
 *   pass the canonical value to avoid drift if a key is hidden in items[].
 */
export default function PreferenceWeightsModal(/** @type {any} */ props) {
  const {
    isOpen,
    onClose,
    weights,
    items,
    onWeightChange,
    onReset,
    isModified,
    totalKeys
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
    // Lock scroll on BOTH html and body — some layouts scroll the document
    // element rather than body, so locking only body leaves a path open for
    // the browser to scroll the page to top when the slider grabs focus.
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    // Also lock scroll position so an accidental scroll-restoration triggered
    // by state changes can't yank the underlying page back to (0, 0).
    const scrollY = window.scrollY;
    const preventScroll = (/** @type {Event} */ e) => {
      if (window.scrollY !== scrollY) {
        window.scrollTo(0, scrollY);
      }
    };
    window.addEventListener("scroll", preventScroll, { passive: true });

    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("scroll", preventScroll);
      clearTimeout(timer);
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
      window.scrollTo(0, scrollY);
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
            <p className="pwm-copy" style={{ marginTop: "6px", color: "var(--text-muted)", fontSize: "12px" }}>
              每项权重上限 25%。至少 4 个维度需同时考虑。
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
          {items.map((/** @type {any} */ item) => (
            <WeightSliderItem
              key={item.key}
              item={item}
              value={weights[item.key] ?? 0}
              onCommit={(/** @type {number} */ v) => onWeightChange(item.key, v)}
              minText={item.minText}
              maxText={item.maxText}
              explanation={item.explanation}
              ariaLabel={`${item.label}权重`}
            />
          ))}
        </div>

        {/* v9: live hint so the user sees how many of the 8 sliders are
            non-zero. Forces them to think before pinning everything on a
            single axis. Total = sum of all 8 sliders; Y = count > 0;
            Z = 8 - Y (silenced axes). The aria-live region announces
            changes to screen-reader users in real time.

            totalKeys is passed in from the page so this component never
            hardcodes the dimension count. Keep in sync with
            PREFERENCE_WEIGHT_KEYS.length in strategy-lab/page.js. Falls back
            to items.length if not provided (back-compat for any other caller). */}
        {(() => {
          const TOTAL_KEYS = totalKeys ?? items.length;
          const itemKeys = items.map((/** @type {any} */ it) => it.key);
          // Sum across both the items rendered AND any extra keys the page
          // owns (so the totals stay honest if a future key is added).
          const knownKeys = new Set(itemKeys);
          const allKeys = [...knownKeys];
          // Sum includes both rendered weights and any persisted keys the
          // page passed in but didn't render (defensive against future drift).
          const total = allKeys.reduce((sum, k) => sum + (weights[k] || 0), 0);
          const activeKeys = allKeys.filter((k) => (weights[k] || 0) > 0).length;
          const zeroKeys = TOTAL_KEYS - activeKeys;
          return (
            <div
              className="pwm-live-hint"
              role="status"
              aria-live="polite"
            >
              已分配 {total}% ({activeKeys}/{TOTAL_KEYS} 维度); 剩余 {zeroKeys} 维度权重为 0
            </div>
          );
        })()}

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
        /* Layout & container — align with strategy-lab control-group */
        .pwm-backdrop {
          position: fixed;
          inset: 0;
          z-index: 1200;
          background: var(--backdrop-scrim);
          backdrop-filter: blur(10px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--sp-6);
        }

        .pwm-card {
          width: min(760px, 100%);
          max-height: min(84vh, 900px);
          overflow: auto;
          padding: 22px;
          border-radius: var(--radius-xl);
        }

        .pwm-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--sp-4);
          margin-bottom: var(--sp-5);
        }

        .pwm-eyebrow {
          font-size: var(--fs-xs);
          color: var(--color-primary);
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
          font-size: var(--fs-md);
          line-height: 1.6;
        }

        .pwm-close {
          width: 36px;
          height: 36px;
          border-radius: var(--radius-pill);
          border: 1px solid var(--border-strong);
          background: rgba(255,255,255,0.04);
          color: #fff;
          cursor: pointer;
          flex-shrink: 0;
        }

        /* Item list — same gap rhythm as .control-group-body */
        .pwm-list {
          display: flex;
          flex-direction: column;
          gap: var(--sp-3);
        }

        /* Per-weight card — matches glass-panel + control-group radius */
        .pwm-item {
          padding: var(--sp-4);
          border-radius: var(--radius-lg);
          background: rgba(255,255,255,0.03);
          border: 1px solid var(--border-glass);
        }

        .pwm-item-header,
        .pwm-range,
        .pwm-footer,
        .pwm-actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--sp-3);
        }

        /* Modal context: label is the primary content, so brighter than
           .form-label. Value unifies to --color-primary across the app. */
        .pwm-item-label {
          color: #fff;
          font-size: var(--fs-md);
          font-weight: 700;
          line-height: 1.4;
        }

        .pwm-item-value {
          color: var(--color-primary);
          font-size: var(--fs-md);
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
        }

        /* Slider uses the global .slider-input class (declared in
           globals.css). Local overrides only for spacing & focus ring
           specific to this modal context. */
        .pwm-slider-wrap {
          margin-top: var(--sp-3);
        }

        .pwm-range {
          margin-top: 2px;
          color: var(--text-muted);
          font-size: var(--fs-xs);
        }

        .pwm-item-copy {
          margin: var(--sp-3) 0 0;
          color: var(--text-secondary);
          font-size: var(--fs-sm);
          line-height: 1.6;
        }

        /* Footer */
        .pwm-footer {
          margin-top: var(--sp-5);
          padding-top: var(--sp-4);
          border-top: 1px solid var(--border-glass);
        }

        .pwm-total {
          color: var(--text-secondary);
          font-size: var(--fs-sm);
          font-weight: 600;
        }

        /* Live hint — uses --accent-soft-indigo + --color-primary, same
           recipe as .param-explanation callout on the lab page. */
        .pwm-live-hint {
          margin-top: var(--sp-3);
          padding: 8px var(--sp-3);
          border-radius: var(--radius-md);
          background: var(--accent-soft-indigo);
          border: 1px solid rgba(99, 102, 241, 0.30);
          color: var(--color-primary);
          font-size: var(--fs-sm);
          line-height: 1.5;
        }

        @media (max-width: 720px) {
          .pwm-backdrop {
            padding: var(--sp-3);
          }

          .pwm-card {
            padding: var(--sp-5);
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
