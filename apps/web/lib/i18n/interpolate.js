/**
 * Lightweight template interpolation used by the i18n `t()` function.
 *
 * Supports `{name}` placeholders in the template string. Each `{name}` is
 * replaced with the value at `vars[name]`, coerced to a string. Missing
 * variables render as the empty string. Unknown `{` / `}` characters that
 * are not part of a placeholder are passed through verbatim.
 *
 * Designed to be worker-safe (no DOM, no React) so the same implementation
 * can be imported in both the React tree and the simulation Web Worker.
 *
 * @param {string} template - The translation template.
 * @param {Record<string, any>} [vars] - Optional placeholder variables.
 * @returns {string}
 */
export function interpolate(template, vars) {
  if (typeof template !== "string") return String(template ?? "");
  if (!vars) return template;
  // Single regex pass: match `{identifier}` where identifier is a JS-safe
  // variable name. We deliberately do NOT support nested braces or
  // pluralisation — the codebase has no use for ICU.
  return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      const v = vars[key];
      if (v === null || v === undefined) return "";
      return String(v);
    }
    return match;
  });
}
