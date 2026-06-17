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
      label: "设置",
      href: "/settings",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      )
    }
  ];

  return (
    <nav className={`nav-sidebar ${isCollapsed ? "collapsed" : ""}`}>
      <div className="nav-logo">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        <span>RatePath</span>
        <span className="badge badge-emerald" style={{ marginLeft: "6px", fontSize: "10px", padding: "2px 6px" }}>NZ</span>
      </div>
      
      <div className="nav-links">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link key={item.href} href={item.href} className={`nav-link ${isActive ? "active" : ""}`}>
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
          background: rgba(10, 15, 30, 0.9);
          border-right: 1px solid var(--border-glass);
          display: flex;
          flex-direction: column;
          padding: 30px 20px;
          min-height: 100vh;
          transition: var(--transition-smooth);
        }

        .nav-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          font-family: var(--font-heading);
          font-size: 20px;
          font-weight: 800;
          color: #fff;
          margin-bottom: 40px;
          padding-left: 8px;
          transition: var(--transition-smooth);
        }

        .nav-logo :global(.text-primary) {
          color: var(--color-primary);
        }

        .nav-links {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        :global(.nav-link) {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 16px;
          border-radius: 10px;
          color: var(--text-secondary);
          font-family: var(--font-heading);
          font-weight: 500;
          font-size: 14px;
          transition: var(--transition-smooth);
          width: 100%;
        }

        :global(.nav-link:hover) {
          color: #fff;
          background: rgba(255, 255, 255, 0.03);
        }

        :global(.nav-link.active) {
          color: #fff;
          background: rgba(99, 102, 241, 0.12);
          border: 1px solid rgba(99, 102, 241, 0.2);
        }

        :global(.nav-link svg) {
          transition: var(--transition-smooth);
        }

        :global(.nav-link.active svg) {
          color: var(--color-primary);
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

        .nav-sidebar.collapsed .nav-logo span {
          display: none;
        }

        .nav-sidebar.collapsed .nav-links {
          align-items: center;
          width: 100%;
        }

        .nav-sidebar.collapsed :global(.nav-link) {
          padding: 14px 0;
          justify-content: center;
          width: 44px;
          height: 44px;
        }

        .nav-sidebar.collapsed :global(.nav-link span) {
          display: none;
        }

        /* Collapse Toggle Button */
        .collapse-btn {
          margin-top: auto;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border-glass);
          border-radius: 10px;
          color: var(--text-secondary);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 12px;
          width: 100%;
          transition: var(--transition-smooth);
        }

        .collapse-btn:hover {
          color: #fff;
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.15);
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
