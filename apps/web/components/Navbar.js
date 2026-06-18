"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const pathname = usePathname();

  // Sync collapse state from localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem("nav-collapsed");
      if (saved === "true") {
        setIsCollapsed(true);
      }
    }
  }, []);

  const handleToggle = () => {
    const nextState = !isCollapsed;
    setIsCollapsed(nextState);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("nav-collapsed", String(nextState));
    }
  };

  const navItems = [
    {
      label: "仪表盘",
      href: "/",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>
      )
    },
    {
      label: "房贷配置",
      href: "/mortgage-setup",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="8" x2="16" y1="10" y2="10"/><line x1="8" x2="12" y1="14" y2="14"/><line x1="8" x2="14" y1="18" y2="18"/></svg>
      )
    },
    {
      label: "策略实验室",
      href: "/strategy-lab",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 16.5c-1.5 1.26-2.5 3.19-2.5 5.5s1 4.24 2.5 5.5"/><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
      )
    },
    {
      label: "关于",
      href: "/about",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
      )
    }
  ];

  return (
    <nav className={`nav-sidebar ${isCollapsed ? "collapsed" : ""}`}>
      <div className="nav-logo">
        <span className="nav-logo-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        </span>
        <span className="nav-logo-text">RatePath</span>
        <span className="badge badge-emerald nav-logo-badge">NZ</span>
      </div>
      
      <div className="nav-links">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link key={item.href} href={item.href} data-label={item.label} className={`nav-link ${isActive ? "active" : ""}`} aria-current={isActive ? "page" : undefined}>
              {item.icon}
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>

      <button
        type="button"
        onClick={handleToggle}
        className="collapse-btn"
        title={isCollapsed ? "展开导航栏" : "折叠导航栏"}
      >
        {isCollapsed ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        )}
      </button>

      <style jsx>{`
        .nav-sidebar {
          width: var(--sidebar-width);
          background:
            linear-gradient(180deg, rgba(99, 102, 241, 0.06) 0%, rgba(11, 15, 25, 0.0) 30%),
            rgba(10, 15, 30, 0.9);
          border-right: 1px solid var(--border-glass);
          display: flex;
          flex-direction: column;
          padding: 28px 18px;
          min-height: 100vh;
          transition: var(--transition-smooth);
          position: sticky;
          top: 0;
          align-self: flex-start;
          max-height: 100vh;
          overflow-y: auto;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
        }

        .nav-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          font-family: var(--font-heading);
          font-size: 20px;
          font-weight: 800;
          color: #fff;
          margin-bottom: 36px;
          padding: 4px 8px;
          border-radius: 10px;
          transition: var(--transition-smooth);
        }

        .nav-logo-icon {
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

        .nav-logo-text {
          background: var(--gradient-text-primary);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          color: transparent;
          letter-spacing: -0.02em;
        }

        .nav-logo-badge {
          margin-left: 4px;
          font-size: 10px;
          padding: 2px 7px;
          letter-spacing: 0.05em;
        }

        .nav-links {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        :global(.nav-link) {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          border-radius: 10px;
          color: var(--text-secondary);
          font-family: var(--font-heading);
          font-weight: 500;
          font-size: 14px;
          transition: var(--transition-smooth);
          width: 100%;
          position: relative;
        }

        :global(.nav-link:hover) {
          color: #fff;
          background: rgba(255, 255, 255, 0.04);
          transform: translateX(2px);
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

        :global(.nav-link svg) {
          transition: var(--transition-smooth);
        }

        :global(.nav-link.active svg) {
          color: var(--color-primary);
          filter: drop-shadow(0 0 4px rgba(99, 102, 241, 0.5));
        }

        :global(.nav-link:hover svg) {
          color: #fff;
        }

        /* Collapsed Sidebar Styles */
        .nav-sidebar.collapsed {
          width: 76px;
          padding: 30px 10px;
          align-items: center;
        }

        .nav-sidebar.collapsed .nav-logo {
          padding-left: 0;
          justify-content: center;
          margin-bottom: 30px;
        }

        .nav-sidebar.collapsed .nav-logo-text,
        .nav-sidebar.collapsed .nav-logo-badge {
          display: none;
        }

        .nav-sidebar.collapsed .nav-links {
          align-items: center;
          width: 100%;
          gap: 8px;
        }

        .nav-sidebar.collapsed :global(.nav-link) {
          padding: 0;
          justify-content: center;
          width: 44px;
          height: 44px;
          position: relative;
        }

        .nav-sidebar.collapsed :global(.nav-link span) {
          display: none;
        }

        /* Collapsed-mode hover tooltip — pure CSS */
        .nav-sidebar.collapsed :global(.nav-link)::after {
          content: attr(data-label);
          position: absolute;
          left: calc(100% + 12px);
          top: 50%;
          transform: translateY(-50%) translateX(-4px);
          background: rgba(15, 26, 46, 0.96);
          color: #fff;
          font-size: 12px;
          font-family: var(--font-heading);
          padding: 6px 10px;
          border-radius: 6px;
          white-space: nowrap;
          opacity: 0;
          pointer-events: none;
          border: 1px solid rgba(99, 102, 241, 0.3);
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55);
          transition: opacity 0.15s ease, transform 0.15s ease;
          z-index: 50;
        }

        .nav-sidebar.collapsed :global(.nav-link:hover)::after,
        .nav-sidebar.collapsed :global(.nav-link:focus-visible)::after {
          opacity: 1;
          transform: translateY(-50%) translateX(0);
        }

        /* Collapse Toggle Button */
        .collapse-btn {
          margin-top: 18px;
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
          transition: var(--transition-smooth);
        }

        .collapse-btn:hover {
          color: #fff;
          background: rgba(99, 102, 241, 0.1);
          border-color: rgba(99, 102, 241, 0.3);
          box-shadow: var(--glow-primary);
        }

        .nav-sidebar.collapsed .collapse-btn {
          width: 44px;
          height: 44px;
          padding: 0;
          border-radius: 10px;
        }

        /* Mobile bottom nav layout rules */
        @media (max-width: 768px) {
          .nav-sidebar {
            width: 100% !important;
            height: 64px;
            min-height: auto;
            position: fixed;
            bottom: 0;
            left: 0;
            z-index: 100;
            flex-direction: row;
            justify-content: space-around;
            padding: 0 !important;
            background: rgba(10, 15, 30, 0.95);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border-right: none;
            border-top: 1px solid var(--border-glass);
            align-items: center !important;
          }

          .nav-logo {
            display: none !important;
          }

          .nav-links {
            flex-direction: row !important;
            width: 100%;
            justify-content: space-around;
            gap: 0;
            align-items: center !important;
          }

          :global(.nav-link) {
            flex-direction: column;
            gap: 4px;
            font-size: 10px;
            padding: 8px 4px !important;
            border-radius: 0;
            background: none !important;
            border: none !important;
            flex: 1;
            align-items: center;
            justify-content: center;
            width: auto !important;
            height: auto !important;
          }

          :global(.nav-link span) {
            display: block !important;
            margin: 0;
          }

          .collapse-btn {
            display: none !important;
          }
        }
      `}</style>
    </nav>
  );
}
