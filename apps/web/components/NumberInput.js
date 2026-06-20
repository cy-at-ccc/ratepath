"use client";

import { useLayoutEffect, useRef } from "react";

function hasDecimalStep(step) {
  const numericStep = Number(step);
  return Number.isFinite(numericStep) && !Number.isInteger(numericStep);
}

function isFiniteValue(value) {
  const num = Number(value);
  return Number.isFinite(num);
}

function formatNumericText(raw, { allowDecimal, allowNegative }) {
  if (raw === null || raw === undefined) return "";
  const text = String(raw).replace(/,/g, "");
  if (text === "") return "";

  let sign = "";
  let body = text;
  if (allowNegative && body.startsWith("-")) {
    sign = "-";
    body = body.slice(1);
  }

  const parts = allowDecimal ? body.split(".", 2) : [body];
  const integerPart = (parts[0] || "").replace(/\D/g, "");
  const decimalPart = allowDecimal && parts.length > 1 ? parts[1].replace(/\D/g, "") : "";
  if (!integerPart && !decimalPart) return sign ? "-" : "";

  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (!allowDecimal) return `${sign}${grouped}`;
  if (text.endsWith(".") && decimalPart === "") return `${sign}${grouped}.`;
  return decimalPart ? `${sign}${grouped}.${decimalPart}` : `${sign}${grouped}`;
}

function sanitizeNumericText(raw, { allowDecimal, allowNegative }) {
  if (raw === null || raw === undefined) return "";
  let text = String(raw).replace(/,/g, "");
  if (text === "") return "";

  const sign = allowNegative && text.startsWith("-") ? "-" : "";
  if (sign) text = text.slice(1);
  text = text.replace(/[^\d.]/g, "");
  if (!allowDecimal) return `${sign}${text.replace(/\./g, "")}`;

  const firstDot = text.indexOf(".");
  if (firstDot === -1) return `${sign}${text}`;
  const left = text.slice(0, firstDot).replace(/\./g, "");
  const right = text.slice(firstDot + 1).replace(/\./g, "");
  return `${sign}${left}.${right}`;
}

/**
 * NumberInput — unified numeric input primitive that replaces the 6+ raw
 * `<input type="number">` usages across the dashboard / setup / strategy-lab
 * pages. Centralises padding, radius, focus ring, alignment, suffix/prefix
 * and accessibility (`ariaLabel` is required so call sites always provide
 * one).
 *
 * Sizing follows the same scale as the .btn-* classes:
 *   sm: 32px tall, 12px font
 *   md: 40px tall, 13px font (default — matches .form-input)
 *   lg: 48px tall, 14px font
 *
 * Right-align is the default for monetary / percentage values; pass
 * `align="left"` for ID-style values.
 *
 * @param {Object} props
 * @param {string} [props.label] - optional visible label (rendered above)
 * @param {number|string} props.value
 * @param {(e: any) => void} props.onChange
 * @param {number} [props.min]
 * @param {number} [props.max]
 * @param {number|string} [props.step=0.01]
 * @param {string} [props.suffix] - e.g. "%" / "$"
 * @param {string} [props.prefix]
 * @param {"left"|"right"} [props.align="right"]
 * @param {"sm"|"md"|"lg"} [props.size="md"]
 * @param {boolean} [props.disabled=false]
 * @param {string} [props.error]
 * @param {string} [props.placeholder]
 * @param {string} props.ariaLabel - REQUIRED: every call site must pass one
 * @param {string} [props.id]
 * @param {string} [props.className]
 * @param {string} [props.inputMode]
 */
export default function NumberInput(/** @type {any} */ props) {
  const {
    label,
    value,
    onChange,
    min,
    max,
    step = 0.01,
    suffix,
    prefix,
    align = "right",
    size = "md",
    disabled = false,
    error,
    placeholder,
    ariaLabel,
    id,
    className = "",
    inputMode = "decimal"
  } = props;
  const inputRef = useRef(null);
  const allowDecimal = hasDecimalStep(step) || inputMode === "decimal";
  const allowNegative = isFiniteValue(min) ? Number(min) < 0 : false;
  const formattedValue = formatNumericText(value ?? "", { allowDecimal, allowNegative });

  useLayoutEffect(() => {
    if (inputRef.current && inputRef.current.value !== formattedValue) {
      inputRef.current.value = formattedValue;
    }
  }, [formattedValue]);

  const emitChange = (event) => {
    const nextRaw = sanitizeNumericText(event.currentTarget.value, { allowDecimal, allowNegative });
    event.currentTarget.value = formatNumericText(nextRaw, { allowDecimal, allowNegative });
    onChange?.({
      ...event,
      target: { ...event.target, value: nextRaw },
      currentTarget: { ...event.currentTarget, value: nextRaw }
    });
  };

  const wrapClass = [
    "ni-wrap",
    `ni-size-${size}`,
    error ? "ni-error" : "",
    disabled ? "ni-disabled" : "",
    className
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={wrapClass}>
      {label ? <label className="ni-label">{label}</label> : null}
      <div
        className="ni-control"
        onClick={() => {
          if (!disabled) inputRef.current?.focus();
        }}
      >
        {prefix ? <span className="ni-prefix">{prefix}</span> : null}
        <input
          ref={inputRef}
          id={id}
          type="text"
          className="ni-input"
          data-align={align}
          defaultValue={formattedValue}
          onChange={emitChange}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-invalid={error ? "true" : undefined}
          placeholder={placeholder}
          inputMode={inputMode === "decimal" || allowDecimal ? "decimal" : "numeric"}
        />
        {suffix ? <span className="ni-suffix">{suffix}</span> : null}
      </div>
      {error ? <div className="ni-error-msg" role="alert">{error}</div> : null}

      <style jsx>{`
        .ni-wrap {
          display: flex;
          flex-direction: column;
          gap: 6px;
          width: 100%;
        }
        .ni-label {
          font-family: var(--font-heading);
          font-size: 12px;
          font-weight: 500;
          color: var(--text-secondary);
          line-height: 1.3;
        }
        .ni-control {
          display: inline-flex;
          align-items: center;
          width: 100%;
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid var(--border-glass);
          border-radius: var(--radius-sm);
          transition: var(--transition-smooth);
          overflow: hidden;
          cursor: text;
        }
        .ni-control:focus-within {
          border-color: var(--color-primary);
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.4);
        }
        .ni-error .ni-control {
          border-color: var(--color-rose);
        }
        .ni-error .ni-control:focus-within {
          box-shadow: 0 0 0 3px rgba(244, 63, 94, 0.35);
        }
        .ni-disabled {
          opacity: 0.55;
          pointer-events: none;
        }
        .ni-input {
          flex: 1 1 auto;
          min-width: 0;
          background: transparent;
          border: none;
          outline: none;
          color: var(--text-primary);
          font-family: var(--font-body);
          font-variant-numeric: tabular-nums;
          line-height: 1.2;
          caret-color: var(--color-primary);
        }
        .ni-input::placeholder {
          color: color-mix(in srgb, var(--text-secondary) 88%, #ffffff);
          opacity: 0.7;
        }
        .ni-input[data-align="right"] {
          text-align: right;
        }
        .ni-input[data-align="left"] {
          text-align: left;
        }
        .ni-prefix,
        .ni-suffix {
          color: var(--text-secondary);
          font-family: var(--font-body);
          flex-shrink: 0;
          user-select: none;
        }
        .ni-error-msg {
          font-size: 11px;
          color: var(--color-rose);
          line-height: 1.3;
        }

        /* Sizes */
        .ni-size-sm .ni-control { height: 32px; padding: 0 10px; gap: 6px; }
        .ni-size-sm .ni-input { font-size: 12px; }
        .ni-size-sm .ni-prefix,
        .ni-size-sm .ni-suffix { font-size: 12px; }

        .ni-size-md .ni-control { height: 40px; padding: 0 12px; gap: 8px; }
        .ni-size-md .ni-input { font-size: 13px; }
        .ni-size-md .ni-prefix,
        .ni-size-md .ni-suffix { font-size: 13px; }

        .ni-size-lg .ni-control { height: 48px; padding: 0 16px; gap: 10px; }
        .ni-size-lg .ni-input { font-size: 14px; }
        .ni-size-lg .ni-prefix,
        .ni-size-lg .ni-suffix { font-size: 14px; }
      `}</style>
    </div>
  );
}
