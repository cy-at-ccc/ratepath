"use client";

import Link from "next/link";
import { useI18n } from "../../../lib/i18n/useI18n.js";

export default function PrivacyPolicy() {
  const { t } = useI18n();
  const buildId = typeof process !== "undefined" && process.env.NEXT_PUBLIC_BUILD_ID
    ? process.env.NEXT_PUBLIC_BUILD_ID
    : "dev";

  return (
    <div className="legal-container">
      <header className="legal-header">
        <Link href="/about" className="back-link">{t("legal.privacy.back")}</Link>
        <h1 className="title gradient-text-primary">{t("legal.privacy.title")}</h1>
        <p className="meta-row">
          <span><strong>{t("legal.privacy.effective")}</strong></span>
          <span><strong>{t("legal.privacy.version")}</strong></span>
          <span><strong>{t("legal.privacy.buildId", { id: buildId })}</strong></span>
        </p>
      </header>

      <section className="glass-panel legal-section">
        <h2 className="section-title">{t("legal.privacy.s1.title")}</h2>
        <p>{t("legal.privacy.s1.p1")}</p>
        <p>{t("legal.privacy.s1.p2")}</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">{t("legal.privacy.s2.title")}</h2>
        <p>{t("legal.privacy.s2.p1")}</p>
        <ul>
          <li>{t("legal.privacy.s2.l1")}</li>
          <li>{t("legal.privacy.s2.l2")}</li>
          <li>{t("legal.privacy.s2.l3")}</li>
          <li>{t("legal.privacy.s2.l4")}</li>
          <li>{t("legal.privacy.s2.l5")}</li>
        </ul>
        <p>{t("legal.privacy.s2.p2")}</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">{t("legal.privacy.s3.title")}</h2>
        <p>{t("legal.privacy.s3.p1")}</p>
        <ul>
          <li>{t("legal.privacy.s3.l1")}</li>
          <li>{t("legal.privacy.s3.l2")}</li>
          <li>{t("legal.privacy.s3.l3")}</li>
          <li>{t("legal.privacy.s3.l4")}</li>
          <li>{t("legal.privacy.s3.l5")}</li>
          <li>{t("legal.privacy.s3.l6")}</li>
          <li>{t("legal.privacy.s3.l7")}</li>
        </ul>
        <p>{t("legal.privacy.s3.p2")}</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">{t("legal.privacy.s4.title")}</h2>
        <p>{t("legal.privacy.s4.p1")}</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">{t("legal.privacy.s5.title")}</h2>
        <p>{t("legal.privacy.s5.p1")}</p>
        <ul>
          <li>{t("legal.privacy.s5.l1")}</li>
          <li>{t("legal.privacy.s5.l2")}</li>
          <li>{t("legal.privacy.s5.l3")}</li>
        </ul>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">{t("legal.privacy.s6.title")}</h2>
        <p>{t("legal.privacy.s6.p1")}</p>
        <p>{t("legal.privacy.s6.p2")}</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">{t("legal.privacy.s7.title")}</h2>
        <p>{t("legal.privacy.s7.p1")}</p>
        <p>{t("legal.privacy.s7.p2")}</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">{t("legal.privacy.s8.title")}</h2>
        <p>{t("legal.privacy.s8.p1")}</p>
      </section>

      <style jsx>{`
        .legal-container {
          display: flex;
          flex-direction: column;
          gap: 20px;
          max-width: 920px;
        }

        .legal-header {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .back-link {
          font-size: 13px;
          color: var(--text-secondary, #94a3b8);
          text-decoration: none;
          align-self: flex-start;
          padding: 4px 0;
        }

        .back-link:hover {
          color: var(--color-primary, #6366f1);
        }

        .meta-row {
          display: flex;
          flex-wrap: wrap;
          gap: 24px;
          font-size: 13px;
          color: var(--text-secondary, #94a3b8);
        }

        .legal-section {
          padding: 22px 24px;
        }

        .section-title {
          font-size: 15px;
          font-weight: 700;
          color: #fff;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          padding-bottom: 8px;
          margin: 0 0 12px;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .section-title::before {
          content: "";
          display: inline-block;
          width: 4px;
          height: 14px;
          border-radius: 2px;
          background: var(--gradient-primary);
          box-shadow: var(--glow-primary);
          flex-shrink: 0;
        }

        .legal-section p {
          font-size: 13px;
          color: var(--text-secondary, #cbd5e1);
          line-height: 1.75;
          margin: 8px 0;
        }

        .legal-section ul {
          padding-left: 22px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .legal-section li {
          font-size: 13px;
          color: var(--text-secondary, #cbd5e1);
          line-height: 1.7;
        }

        .legal-section a {
          color: var(--color-primary, #6366f1);
          text-decoration: none;
        }

        .legal-section a:hover {
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
}
