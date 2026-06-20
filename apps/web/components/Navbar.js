"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "../lib/i18n/useI18n.js";
import LanguageSwitcher from "../lib/i18n/LanguageSwitcher.jsx";

export default function Navbar() {
  const { t } = useI18n();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();

  // Restore collapse state from localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem("nav-collapsed");
      if (saved === "true") {
        setIsCollapsed(true);
      }
    }
  }, []);

  // Auto-close the mobile drawer on route change so users land on the
  // destination page with the menu out of the way.
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Lock body scroll while the mobile drawer is open + close on Escape.
  // v2: also reserve the scrollbar gutter on body via padding-right so
  // the vertical scrollbar disappearing (when overflow flips to hidden)
  // does NOT cause the page to jump horizontally on open/close.
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    const handler = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.paddingRight = prevBodyPaddingRight;
    };
  }, [mobileMenuOpen]);

  const handleToggleCollapse = () => {
    const nextState = !isCollapsed;
    setIsCollapsed(nextState);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("nav-collapsed", String(nextState));
    }
  };

  const navItems = [
    {
      key: "dashboard",
      label: t("nav.dashboard"),
      href: "/",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>
      )
    },
    {
      key: "mortgageSetup",
      label: t("nav.mortgageSetup"),
      href: "/mortgage-setup",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="8" x2="16" y1="10" y2="10"/><line x1="8" x2="12" y1="14" y2="14"/><line x1="8" x2="14" y1="18" y2="18"/></svg>
      )
    },
    {
      key: "strategyLab",
      label: t("nav.strategyLab"),
      href: "/strategy-lab",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 16.5c-1.5 1.26-2.5 3.19-2.5 5.5s1 4.24 2.5 5.5"/><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
      )
    },
    {
      key: "about",
      label: t("nav.about"),
      href: "/about",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
      )
    }
  ];

  return (
    <>
      {/* ================================================================
          DESKTOP SIDEBAR (≥769px)
          Left-positioned, collapsible. The user can define collapsed vs.
          expanded via the chevron button; the choice persists in
          localStorage["nav-collapsed"].
          ================================================================ */}
      <nav className={`nav-sidebar ${isCollapsed ? "collapsed" : ""}`} aria-label="Primary">
        <div className="nav-logo">
          <span className="nav-logo-icon" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 18 L8 14 L11 16 L16 9 L21 12" />
              <polyline points="16 5 21 5 21 10" />
            </svg>
          </span>
          <span className="nav-logo-text">RatePath</span>
          <span className="badge badge-emerald nav-logo-badge">NZ</span>
          <span className="nav-logo-switcher">
            <LanguageSwitcher />
          </span>
        </div>

        <div className="nav-links">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                data-label={item.label}
                className={`nav-link ${isActive ? "active" : ""}`}
                aria-current={isActive ? "page" : undefined}
              >
                <span className="nav-link-icon" aria-hidden="true">{item.icon}</span>
                <span className="nav-link-text">{item.label}</span>
              </Link>
            );
          })}
        </div>

        <button
          type="button"
          onClick={handleToggleCollapse}
          className="collapse-btn"
          title={isCollapsed ? t("nav.expand") : t("nav.collapse")}
          aria-label={isCollapsed ? t("nav.expand") : t("nav.collapse")}
        >
          {isCollapsed ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          )}
        </button>
      </nav>

      {/* ================================================================
          MOBILE TRIGGER (≤768px)
          Fixed top-left corner — a square logo button that opens the
          mobile drawer when tapped. Hidden on desktop.
          ================================================================ */}
      <button
        type="button"
        className="nav-mobile-trigger"
        onClick={() => setMobileMenuOpen(true)}
        aria-label={t("nav.openMenu")}
      >
        <span className="nav-mobile-trigger-icon" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 18 L8 14 L11 16 L16 9 L21 12" />
            <polyline points="16 5 21 5 21 10" />
          </svg>
        </span>
      </button>

      {/* ================================================================
          MOBILE DRAWER (≤768px, opened via state.mobileMenuOpen)
          Slide-in panel from the left with backdrop. Same nav items as
          the desktop sidebar plus a locale switcher pinned at the bottom.
          ================================================================ */}
      {mobileMenuOpen && (
        <div
          className="nav-drawer-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={t("nav.openMenu")}
          onClick={(e) => {
            if (e.target === e.currentTarget) setMobileMenuOpen(false);
          }}
        >
          <aside className="nav-drawer">
            <div className="nav-drawer-header">
              <span className="nav-drawer-logo" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 18 L8 14 L11 16 L16 9 L21 12" />
                  <polyline points="16 5 21 5 21 10" />
                </svg>
              </span>
              <span className="nav-drawer-title">RatePath</span>
              <button
                type="button"
                className="nav-drawer-close"
                onClick={() => setMobileMenuOpen(false)}
                aria-label={t("nav.closeMenu")}
              >
                ×
              </button>
            </div>

            <div className="nav-drawer-links">
              {navItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    data-label={item.label}
                    className={`nav-drawer-link ${isActive ? "active" : ""}`}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <span className="nav-link-icon" aria-hidden="true">{item.icon}</span>
                    <span className="nav-link-text">{item.label}</span>
                  </Link>
                );
              })}
            </div>

            <div className="nav-drawer-footer">
              <LanguageSwitcher />
            </div>
          </aside>
        </div>
      )}

      <style jsx>{`
        /* ====================================================================
           DESKTOP SIDEBAR (visible ≥769px)
           Sticky left rail with a collapsible width. Icon + label share the
           same line; both at the same optical weight (16px icon, 14px label
           — visually balanced, the icon strokeWidth keeps it from looking
           lighter than the label).
           ==================================================================== */
        .nav-sidebar {
          width: var(--sidebar-width, 240px);
          background:
            linear-gradient(180deg, rgba(99, 102, 241, 0.06) 0%, rgba(11, 15, 25, 0.0) 30%),
            rgba(10, 15, 30, 0.9);
          border-right: 1px solid var(--border-glass);
          display: flex;
          flex-direction: column;
          padding: 28px 18px;
          min-height: 100vh;
          transition: width 200ms ease, padding 200ms ease;
          position: sticky;
          top: 0;
          align-self: flex-start;
          max-height: 100vh;
          overflow-y: auto;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
        }

        .nav-sidebar.collapsed {
          width: 76px;
          padding: 30px 10px;
          align-items: center;
        }

        .nav-logo {
          display: flex;
          align-items: center;
          gap: 8px;
          font-family: var(--font-heading);
          font-size: 16px;
          font-weight: 800;
          color: #fff;
          margin-bottom: 36px;
          padding: 4px 4px;
          border-radius: 10px;
          min-width: 0;
        }

        .nav-logo-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          border-radius: 7px;
          background: var(--gradient-primary);
          color: #fff;
          box-shadow: var(--glow-primary);
          flex-shrink: 0;
        }

        .nav-logo-text {
          background: var(--gradient-text-primary);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          color: transparent;
          letter-spacing: -0.02em;
          white-space: nowrap;
          min-width: 0;
          flex-shrink: 1;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .nav-logo-badge {
          margin-left: 2px;
          font-size: 9px;
          padding: 1px 5px;
          letter-spacing: 0.05em;
          flex-shrink: 0;
        }

        .nav-logo-switcher {
          margin-left: auto;
          display: inline-flex;
          align-items: center;
          flex-shrink: 0;
        }

        .nav-sidebar.collapsed .nav-logo-text,
        .nav-sidebar.collapsed .nav-logo-badge,
        .nav-sidebar.collapsed .nav-logo-switcher {
          display: none;
        }

        .nav-sidebar.collapsed .nav-logo {
          padding-left: 0;
          justify-content: center;
          margin-bottom: 30px;
        }

        .nav-links {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .nav-sidebar.collapsed .nav-links {
          align-items: center;
          width: 100%;
          gap: 8px;
        }

        /* nav-link — icon + label share one row, same optical weight */
        :global(.nav-link) {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 14px;
          border-radius: 10px;
          color: var(--text-secondary);
          font-family: var(--font-heading);
          font-weight: 500;
          font-size: 14px;
          transition: background 120ms ease, color 120ms ease, transform 120ms ease;
          width: 100%;
          position: relative;
        }

        :global(.nav-link:hover) {
          color: #fff;
          background: rgba(255, 255, 255, 0.04);
        }

        :global(.nav-link.active) {
          color: #fff;
          background: linear-gradient(90deg, rgba(99, 102, 241, 0.18), rgba(99, 102, 241, 0.06));
          box-shadow: inset 0 0 0 1px rgba(99, 102, 241, 0.3);
        }

        :global(.nav-link.active)::before {
          content: "";
          position: absolute;
          left: -2px;
          top: 8px;
          bottom: 8px;
          width: 3px;
          border-radius: 2px;
          background: var(--gradient-primary);
          box-shadow: var(--glow-primary);
        }

        /* Icon container — explicit 16×16, same size as the 14px label's
           line-box so the icon and label feel like the same unit. */
        :global(.nav-link-icon) {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 16px;
          height: 16px;
          flex-shrink: 0;
          color: inherit;
        }

        :global(.nav-link-icon svg) {
          width: 16px;
          height: 16px;
          display: block;
        }

        :global(.nav-link.active .nav-link-icon) {
          color: var(--color-primary);
          filter: drop-shadow(0 0 4px rgba(99, 102, 241, 0.5));
        }

        :global(.nav-link:hover .nav-link-icon) {
          color: #fff;
        }

        /* Collapsed-mode: hide labels, centre icons */
        .nav-sidebar.collapsed :global(.nav-link) {
          padding: 0;
          justify-content: center;
          width: 44px;
          height: 44px;
          position: relative;
        }

        .nav-sidebar.collapsed :global(.nav-link .nav-link-text) {
          display: none;
        }

        /* Collapsed-mode hover tooltip — pure CSS, single-line label only.
           Pure CSS so it costs no React state and survives hydration
           flicker. The ::before pseudo-element paints a small left-
           pointing arrow that visually anchors the tooltip to the icon;
           the ::after holds the label text.

           Why the 220ms show delay: the sidebar is 76px wide when
           collapsed, so the cursor crosses icon-to-icon quickly while
           moving vertically through the list. Without the delay the
           tooltip flashes on every cell the cursor passes, which feels
           noisy. 220ms is long enough to require an intentional hover,
           short enough to feel responsive. Hide is instant — no delay
           — so the cursor leaving the icon dismisses the tooltip
           immediately. */
        .nav-sidebar.collapsed :global(.nav-link)::after {
          content: attr(data-label);
          position: absolute;
          left: calc(100% + 16px);
          top: 50%;
          transform: translateY(-50%) translateX(-6px);
          background: linear-gradient(180deg, rgba(20, 28, 50, 0.98), rgba(15, 20, 35, 0.98));
          color: #fff;
          font-size: 13px;
          font-weight: 600;
          font-family: var(--font-heading);
          padding: 7px 12px;
          border-radius: 7px;
          white-space: nowrap;
          letter-spacing: 0.01em;
          opacity: 0;
          pointer-events: none;
          border: 1px solid rgba(99, 102, 241, 0.35);
          box-shadow: 0 8px 22px rgba(0, 0, 0, 0.55);
          transition: opacity 0.14s ease 220ms, transform 0.14s ease 220ms;
          z-index: 60;
        }

        .nav-sidebar.collapsed :global(.nav-link)::before {
          content: "";
          position: absolute;
          left: calc(100% + 10px);
          top: 50%;
          width: 0;
          height: 0;
          transform: translateY(-50%) translateX(-4px);
          border-top: 6px solid transparent;
          border-bottom: 6px solid transparent;
          border-right: 6px solid rgba(99, 102, 241, 0.35);
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.14s ease 220ms, transform 0.14s ease 220ms;
          z-index: 60;
        }

        .nav-sidebar.collapsed :global(.nav-link:hover)::after,
        .nav-sidebar.collapsed :global(.nav-link:focus-visible)::after,
        .nav-sidebar.collapsed :global(.nav-link:hover)::before,
        .nav-sidebar.collapsed :global(.nav-link:focus-visible)::before {
          opacity: 1;
          transform: translateY(-50%) translateX(0);
          transition: opacity 0.14s ease, transform 0.14s ease;
        }

        /* Respect reduced-motion — kill the slide-in and the delay. */
        @media (prefers-reduced-motion: reduce) {
          .nav-sidebar.collapsed :global(.nav-link)::after,
          .nav-sidebar.collapsed :global(.nav-link)::before {
            transition: opacity 0.05s linear;
          }
        }

        /* Collapse toggle button */
        .collapse-btn {
          margin-top: auto;
          padding-top: 18px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border-glass);
          border-radius: 10px;
          color: var(--text-secondary);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 10px;
          width: 100%;
          transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
        }

        .collapse-btn:hover {
          color: #fff;
          background: rgba(99, 102, 241, 0.10);
          border-color: rgba(99, 102, 241, 0.3);
          box-shadow: var(--glow-primary);
        }

        .nav-sidebar.collapsed .collapse-btn {
          width: 44px;
          height: 44px;
          padding: 0;
          border-radius: 10px;
        }

        /* ====================================================================
           MOBILE TRIGGER (visible ≤768px)
           Fixed top-left logo button — opens the drawer.
           ==================================================================== */
        .nav-mobile-trigger {
          display: none;
          position: fixed;
          top: 12px;
          left: 12px;
          z-index: 110;
          width: 44px;
          height: 44px;
          border-radius: 11px;
          border: 1px solid var(--border-glass);
          background: rgba(10, 15, 30, 0.92);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          color: #fff;
          cursor: pointer;
          padding: 0;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
        }

        .nav-mobile-trigger-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          border-radius: 7px;
          background: var(--gradient-primary);
          color: #fff;
          box-shadow: var(--glow-primary);
        }

        /* ====================================================================
           MOBILE DRAWER (visible ≤768px)
           Backdrop + slide-in panel from the left.
           ==================================================================== */
        .nav-drawer-backdrop {
          display: none;
          position: fixed;
          inset: 0;
          z-index: 200;
          background: var(--backdrop-scrim);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          animation: nd-fade-in 180ms ease-out;
          padding: 0;
        }

        .nav-drawer {
          width: min(320px, 88vw);
          height: 100vh;
          background:
            linear-gradient(180deg, rgba(99, 102, 241, 0.06) 0%, rgba(11, 15, 25, 0.0) 30%),
            rgba(10, 15, 30, 0.98);
          border-right: 1px solid var(--border-glass);
          display: flex;
          flex-direction: column;
          padding: 18px;
          animation: nd-slide-in 220ms cubic-bezier(0.16, 1, 0.3, 1);
          box-shadow: 8px 0 28px rgba(0, 0, 0, 0.45);
        }

        .nav-drawer-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 24px;
          padding-bottom: 16px;
          border-bottom: 1px solid var(--border-glass);
        }

        .nav-drawer-logo {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 8px;
          background: var(--gradient-primary);
          color: #fff;
          box-shadow: var(--glow-primary);
          flex-shrink: 0;
        }

        .nav-drawer-title {
          font-family: var(--font-heading);
          font-size: 16px;
          font-weight: 800;
          background: var(--gradient-text-primary);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          color: transparent;
          letter-spacing: -0.02em;
          flex: 1;
          min-width: 0;
        }

        .nav-drawer-close {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          border: 1px solid var(--border-glass);
          background: rgba(255, 255, 255, 0.04);
          color: #fff;
          font-size: 20px;
          line-height: 1;
          cursor: pointer;
          flex-shrink: 0;
        }

        .nav-drawer-close:hover,
        .nav-drawer-close:focus-visible {
          background: rgba(255, 255, 255, 0.10);
          outline: none;
        }

        .nav-drawer-links {
          display: flex;
          flex-direction: column;
          gap: 4px;
          flex: 1;
          min-height: 0;
          overflow-y: auto;
        }

        :global(.nav-drawer-link) {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 12px 14px;
          border-radius: 10px;
          color: var(--text-secondary);
          font-family: var(--font-heading);
          font-weight: 500;
          font-size: 15px;
          transition: background 120ms ease, color 120ms ease;
        }

        :global(.nav-drawer-link:hover) {
          color: #fff;
          background: rgba(255, 255, 255, 0.04);
        }

        :global(.nav-drawer-link.active) {
          color: #fff;
          background: linear-gradient(90deg, rgba(99, 102, 241, 0.18), rgba(99, 102, 241, 0.06));
          box-shadow: inset 0 0 0 1px rgba(99, 102, 241, 0.3);
        }

        :global(.nav-drawer-link .nav-link-icon) {
          width: 18px;
          height: 18px;
        }

        :global(.nav-drawer-link .nav-link-icon svg) {
          width: 18px;
          height: 18px;
        }

        :global(.nav-drawer-link.active .nav-link-icon) {
          color: var(--color-primary);
          filter: drop-shadow(0 0 4px rgba(99, 102, 241, 0.5));
        }

        .nav-drawer-footer {
          padding-top: 16px;
          border-top: 1px solid var(--border-glass);
          display: flex;
          align-items: center;
          justify-content: flex-start;
        }

        @keyframes nd-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes nd-slide-in {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }

        /* ====================================================================
           MOBILE BREAKPOINT
           Below 768px: hide sidebar, show trigger + drawer instead.
           ==================================================================== */
        @media (max-width: 768px) {
          .nav-sidebar {
            display: none !important;
          }
          .nav-mobile-trigger {
            display: inline-flex;
            align-items: center;
            justify-content: center;
          }
          .nav-drawer-backdrop {
            display: block;
          }
        }

        /* Reduced motion */
        @media (prefers-reduced-motion: reduce) {
          .nav-drawer-backdrop,
          .nav-drawer {
            animation: none;
          }
          .nav-sidebar {
            transition: none;
          }
        }
      `}</style>
    </>
  );
}