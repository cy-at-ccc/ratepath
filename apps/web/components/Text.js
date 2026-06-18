"use client";

/**
 * Text — typography primitive. Centralises the >200 inline `fontSize` /
 * `color` declarations scattered across the page components and gives us
 * a single switch to flip the tone scale later.
 *
 * Tones map to existing CSS custom properties where they exist; secondary
 * / muted / etc. resolve to `--text-secondary` etc.
 *
 * @param {Object} props
 * @param {string} [props.as="span"] - HTML tag name (e.g. "span", "p", "div", "label", "h1"–"h6")
 * @param {"xs"|"sm"|"md"|"lg"|"xl"|"2xl"|"3xl"} [props.size="md"]
 * @param {"regular"|"medium"|"semibold"|"bold"} [props.weight="regular"]
 * @param {"default"|"muted"|"secondary"|"primary"|"success"|"warning"|"danger"|"info"} [props.tone="default"]
 * @param {"left"|"center"|"right"} [props.align]
 * @param {boolean} [props.mono=false] - tabular numerals + monospace family
 * @param {string} [props.className]
 * @param {React.ReactNode} props.children
 */
export default function Text(/** @type {any} */ props) {
  const {
    as: Tag = "span",
    size = "md",
    weight = "regular",
    tone = "default",
    align,
    mono = false,
    className = "",
    children,
    ...rest
  } = props;

  const cls = [
    "tx",
    `tx-size-${size}`,
    `tx-w-${weight}`,
    `tx-tone-${tone}`,
    align ? `tx-align-${align}` : "",
    mono ? "tx-mono" : "",
    className
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Tag className={cls} {...rest}>
      {children}
      <style jsx>{`
        .tx {
          display: inline;
          line-height: 1.5;
          color: var(--text-primary);
          font-family: var(--font-body);
        }
        .tx-mono {
          font-family: var(--font-num);
          font-variant-numeric: tabular-nums;
          font-feature-settings: "tnum";
        }

        /* Sizes */
        .tx-size-xs { font-size: var(--fs-xs, 11px); }
        .tx-size-sm { font-size: var(--fs-sm, 12px); }
        .tx-size-md { font-size: var(--fs-md, 13px); }
        .tx-size-lg { font-size: var(--fs-lg, 14px); }
        .tx-size-xl { font-size: var(--fs-xl, 16px); }
        .tx-size-2xl { font-size: var(--fs-2xl, 20px); }
        .tx-size-3xl { font-size: var(--fs-3xl, 28px); }

        /* Weights */
        .tx-w-regular { font-weight: 400; }
        .tx-w-medium { font-weight: 500; }
        .tx-w-semibold { font-weight: 600; }
        .tx-w-bold { font-weight: 700; }

        /* Tones */
        .tx-tone-default { color: var(--text-primary); }
        .tx-tone-muted { color: var(--text-muted); }
        .tx-tone-secondary { color: var(--text-secondary); }
        .tx-tone-primary { color: var(--color-primary); }
        .tx-tone-success { color: var(--color-emerald); }
        .tx-tone-warning { color: var(--color-amber); }
        .tx-tone-danger { color: var(--color-rose); }
        .tx-tone-info { color: var(--accent-cyan); }

        /* Alignment */
        .tx-align-left { text-align: left; }
        .tx-align-center { text-align: center; }
        .tx-align-right { text-align: right; }
      `}</style>
    </Tag>
  );
}