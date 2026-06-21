"use client";

import { useEffect, useState } from "react";

/**
 * Subscribe to a CSS media query. Returns whether the query currently
 * matches. SSR-safe — initial render returns `false`, then the hook
 * subscribes on mount and updates on every media-query change.
 *
 * Usage:
 *   const isPortraitPhone = useMediaQuery("(max-width: 768px) and (orientation: portrait)");
 *
 * Reuses the same listener pattern as `SvgChart.js` (ResizeObserver +
 * matchMedia addEventListener/removeListener fallback for old Safari).
 */
export default function useMediaQuery(query) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const handler = (e) => setMatches(e.matches);
    if (mq.addEventListener) mq.addEventListener("change", handler);
    else mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", handler);
      else mq.removeListener(handler);
    };
  }, [query]);

  return matches;
}
