"use client";

import React, { useState } from "react";
import { useServerInsertedHTML } from "next/navigation";
import { StyleRegistry, createStyleRegistry } from "styled-jsx";

/**
 * StyledJsxRegistry component to support styled-jsx in Next.js App Router.
 * @param {Object} props
 * @param {React.ReactNode} props.children
 * @returns {any}
 */
export default function StyledJsxRegistry({ children }) {
  const [jsxStyleRegistry] = useState(() => createStyleRegistry());

  useServerInsertedHTML(() => {
    const registry = /** @type {any} */ (jsxStyleRegistry);
    const styles = registry.styles();
    registry.flush();
    return <>{styles}</>;
  });

  return (
    <StyleRegistry registry={jsxStyleRegistry}>
      {children}
    </StyleRegistry>
  );
}
