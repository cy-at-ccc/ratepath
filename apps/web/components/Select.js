"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Select — custom dark-mode dropdown replacing the native `<select>`
 * element on the dark-glass UI. The native control renders a stark white
 * popup that breaks the visual language, and its keyboard model is
 * inconsistent across browsers. This primitive:
 *
 * - Renders a button trigger styled like `.form-input`
 * - Opens a glass panel of `role="listbox"` items
 * - Full keyboard support: ↑/↓ to move, Home/End, Enter to commit, Esc to close
 * - aria-activedescendant, aria-expanded, role=combobox on the trigger
 * - On viewports ≤768px the panel snaps to the bottom of the viewport as a
 *   bottom sheet
 * - Closes on outside click and on Escape
 *
 * Options are passed as `{ value, label, description? }`.
 *
 * @param {Object} props
 * @param {string} props.ariaLabel - REQUIRED
 * @param {string|number} props.value
 * @param {(v: string) => void} props.onChange
 * @param {Array<{value: string, label: string, description?: string}>} props.options
 * @param {"sm"|"md"|"lg"} [props.size="md"]
 * @param {string} [props.placeholder]
 * @param {string} [props.id]
 * @param {string} [props.className]
 * @param {boolean} [props.disabled]
 */
export default function Select(/** @type {any} */ props) {
  const {
    ariaLabel,
    value,
    onChange,
    options,
    size = "md",
    placeholder = "请选择",
    id,
    className = "",
    disabled = false
  } = props;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapRef = useRef(/** @type {any} */ (null));
  const listboxId = id ? `${id}-listbox` : undefined;

  const selectedIndex = options.findIndex((/** @type {any} */ o) => o.value === value);
  const current = selectedIndex >= 0 ? options[selectedIndex] : null;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDoc = (/** @type {any} */ e) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Reset active index when opened
  useEffect(() => {
    if (open) {
      setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    } else {
      setActiveIndex(-1);
    }
  }, [open, selectedIndex]);

  const commit = (/** @type {any} */ idx) => {
    if (idx < 0 || idx >= options.length) return;
    const opt = options[idx];
    if (opt) {
      onChange?.(opt.value);
      setOpen(false);
    }
  };

  const onKeyDown = (/** @type {any} */ e) => {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
      } else if (e.key !== "Enter") {
        setActiveIndex((idx) => Math.min(options.length - 1, Math.max(0, idx + 1)));
      } else {
        commit(activeIndex);
      }
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActiveIndex((idx) => Math.max(0, idx - 1));
      return;
    }
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      if (open) setActiveIndex(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      if (open) setActiveIndex(options.length - 1);
      return;
    }
  };

  const triggerLabel = current ? current.label : placeholder;

  return (
    <div
      ref={wrapRef}
      className={["sel-wrap", `sel-size-${size}`, open ? "sel-open" : "", disabled ? "sel-disabled" : "", className].filter(Boolean).join(" ")}
    >
      <button
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        aria-activedescendant={open && activeIndex >= 0 && listboxId ? `${listboxId}-opt-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className="sel-trigger"
      >
        <span className="sel-trigger-label">{triggerLabel}</span>
        <span className="sel-caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className="sel-listbox"
        >
          {options.map((/** @type {any} */ opt, /** @type {number} */ idx) => {
            const isSelected = opt.value === value;
            const isActive = idx === activeIndex;
            return (
              <li
                key={opt.value}
                id={listboxId ? `${listboxId}-opt-${idx}` : undefined}
                role="option"
                aria-selected={isSelected}
                className={["sel-option", isSelected ? "sel-selected" : "", isActive ? "sel-active" : ""].filter(Boolean).join(" ")}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => commit(idx)}
              >
                <span className="sel-option-label">{opt.label}</span>
                {opt.description ? <span className="sel-option-desc">{opt.description}</span> : null}
                {isSelected ? <span className="sel-check" aria-hidden="true">✓</span> : null}
              </li>
            );
          })}
        </ul>
      )}

      <style jsx>{`
        .sel-wrap {
          position: relative;
          display: inline-block;
          width: 100%;
        }
        .sel-trigger {
          width: 100%;
          display: inline-flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border-glass);
          border-radius: var(--radius-sm);
          color: var(--text-primary);
          font-family: var(--font-body);
          cursor: pointer;
          transition: var(--transition-smooth);
          text-align: left;
        }
        .sel-trigger:hover {
          border-color: var(--border-strong);
          background: rgba(255, 255, 255, 0.06);
        }
        .sel-open .sel-trigger,
        .sel-trigger:focus-visible {
          outline: none;
          border-color: var(--color-primary);
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.4);
        }
        .sel-disabled {
          opacity: 0.55;
          pointer-events: none;
        }
        .sel-trigger-label {
          flex: 1 1 auto;
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .sel-caret {
          flex-shrink: 0;
          color: var(--text-secondary);
          font-size: 11px;
          transition: transform 150ms ease;
        }
        .sel-open .sel-caret {
          transform: rotate(180deg);
        }
        .sel-listbox {
          position: absolute;
          left: 0;
          right: 0;
          top: calc(100% + 6px);
          z-index: 50;
          list-style: none;
          margin: 0;
          padding: 6px;
          background: rgba(15, 26, 46, 0.96);
          border: 1px solid var(--border-strong);
          border-radius: var(--radius-md);
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(99, 102, 241, 0.15);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
          max-height: 280px;
          overflow-y: auto;
        }
        .sel-option {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 8px 10px;
          border-radius: var(--radius-sm);
          cursor: pointer;
          color: var(--text-primary);
          font-size: 13px;
          line-height: 1.3;
          transition: background 120ms ease;
          position: relative;
        }
        .sel-option:hover,
        .sel-active {
          background: rgba(99, 102, 241, 0.16);
        }
        .sel-selected {
          background: rgba(99, 102, 241, 0.12);
          color: #fff;
        }
        .sel-option-desc {
          font-size: 11px;
          color: var(--text-secondary);
          line-height: 1.3;
        }
        .sel-check {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--color-primary);
          font-weight: 700;
        }

        /* Sizes */
        .sel-size-sm .sel-trigger {
          height: 32px;
          padding: 0 10px;
          font-size: 12px;
        }
        .sel-size-md .sel-trigger {
          height: 40px;
          padding: 0 12px;
          font-size: 13px;
        }
        .sel-size-lg .sel-trigger {
          height: 48px;
          padding: 0 16px;
          font-size: 14px;
        }

        @media (max-width: 768px) {
          .sel-listbox {
            position: fixed;
            left: 12px;
            right: 12px;
            top: auto;
            bottom: 12px;
            max-height: 60vh;
            border-radius: var(--radius-lg);
          }
        }
      `}</style>
    </div>
  );
}