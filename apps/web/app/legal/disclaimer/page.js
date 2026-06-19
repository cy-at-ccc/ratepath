"use client";

import Link from "next/link";
import { useI18n } from "../../../lib/i18n/useI18n.js";

export default function Disclaimer() {
  const { t } = useI18n();
  return (
    <div className="legal-container">
      <header className="legal-header">
        <Link href="/about" className="back-link">{t("legal.disclaimer.back")}</Link>
        <h1 className="page-title gradient-text-primary">{t("legal.disclaimer.title")}</h1>
        <p className="meta-row">
          <span><strong>{t("legal.disclaimer.effective")}</strong></span>
          <span><strong>{t("legal.disclaimer.version")}</strong></span>
        </p>
      </header>

      <section className="glass-panel legal-section highlight-warning">
        <h2 className="section-title">{t("legal.disclaimer.s0.title")}</h2>
        <p dangerouslySetInnerHTML={{ __html: t("legal.disclaimer.s0.p1") }} />
        <ul>
          <li dangerouslySetInnerHTML={{ __html: t("legal.disclaimer.s0.l1") }} />
          <li dangerouslySetInnerHTML={{ __html: t("legal.disclaimer.s0.l2") }} />
          <li dangerouslySetInnerHTML={{ __html: t("legal.disclaimer.s0.l3") }} />
          <li dangerouslySetInnerHTML={{ __html: t("legal.disclaimer.s0.l4") }} />
          <li dangerouslySetInnerHTML={{ __html: t("legal.disclaimer.s0.l5") }} />
        </ul>
        <p>{t("legal.disclaimer.s0.p2")}</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">{t("legal.disclaimer.s1.title")}</h2>
        <p>{t("legal.disclaimer.s1.p1")}</p>
        <ul>
          <li>{t("legal.disclaimer.s1.l1")}</li>
          <li>{t("legal.disclaimer.s1.l2")}</li>
          <li>{t("legal.disclaimer.s1.l3")}</li>
          <li>{t("legal.disclaimer.s1.l4")}</li>
          <li>{t("legal.disclaimer.s1.l5")}</li>
        </ul>
        <p>{t("legal.disclaimer.s1.p2")}</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">{t("legal.disclaimer.s1a.title")}</h2>
        <p>{t("legal.disclaimer.s1a.p1")}</p>
        <ul>
          <li>{t("legal.disclaimer.s1a.l1")}</li>
          <li>{t("legal.disclaimer.s1a.l2")}</li>
          <li>{t("legal.disclaimer.s1a.l3")}</li>
        </ul>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">{t("legal.disclaimer.s1b.title")}</h2>
        <p>{t("legal.disclaimer.s1b.p1")}</p>
        <ul>
          <li>{t("legal.disclaimer.s1b.l1")}</li>
          <li>{t("legal.disclaimer.s1b.l2")}</li>
          <li>{t("legal.disclaimer.s1b.l3")}</li>
        </ul>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">{t("legal.disclaimer.s2.title")}</h2>
        <p>{t("legal.disclaimer.s2.p1")}</p>
        <p>{t("legal.disclaimer.s2.p2")}</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">{t("legal.disclaimer.s2a.title")}</h2>
        <p>{t("legal.disclaimer.s2a.p1")}</p>
        <ul>
          <li>{t("legal.disclaimer.s2a.l1")}</li>
          <li>{t("legal.disclaimer.s2a.l2")}</li>
          <li>{t("legal.disclaimer.s2a.l3")}</li>
          <li>{t("legal.disclaimer.s2a.l4")}</li>
          <li>{t("legal.disclaimer.s2a.l5")}</li>
          <li>{t("legal.disclaimer.s2a.l6")}</li>
        </ul>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">{t("legal.disclaimer.s3.title")}</h2>
        <p>{t("legal.disclaimer.s3.p1")}</p>
        <ul>
          <li>{t("legal.disclaimer.s3.l1")}</li>
          <li>{t("legal.disclaimer.s3.l2")}</li>
          <li>{t("legal.disclaimer.s3.l3")}</li>
          <li>{t("legal.disclaimer.s3.l4")}</li>
          <li>{t("legal.disclaimer.s3.l5")}</li>
        </ul>
        <p>{t("legal.disclaimer.s3.p2")}</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">{t("legal.disclaimer.s4.title")}</h2>
        <p>{t("legal.disclaimer.s4.p1")}</p>
        <ul>
          <li>{t("legal.disclaimer.s4.l1")}</li>
          <li>{t("legal.disclaimer.s4.l2")}</li>
          <li>{t("legal.disclaimer.s4.l3")}</li>
          <li>{t("legal.disclaimer.s4.l4")}</li>
          <li>{t("legal.disclaimer.s4.l5")}</li>
          <li>{t("legal.disclaimer.s4.l6")}</li>
          <li>{t("legal.disclaimer.s4.l7")}</li>
          <li>{t("legal.disclaimer.s4.l8")}</li>
          <li>{t("legal.disclaimer.s4.l9")}</li>
          <li>{t("legal.disclaimer.s4.l10")}</li>
        </ul>
        <p>{t("legal.disclaimer.s4.p2")}</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">{t("legal.disclaimer.s5.title")}</h2>
        <p>{t("legal.disclaimer.s5.p1")}</p>
        <p>{t("legal.disclaimer.s5.p2")}</p>
        <ul>
          <li>{t("legal.disclaimer.s5.l1")}</li>
          <li>{t("legal.disclaimer.s5.l2")}</li>
          <li>{t("legal.disclaimer.s5.l3")}</li>
          <li>{t("legal.disclaimer.s5.l4")}</li>
          <li>{t("legal.disclaimer.s5.l5")}</li>
        </ul>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">{t("legal.disclaimer.s6.title")}</h2>
        <p>{t("legal.disclaimer.s6.p1")}</p>
        <p>{t("legal.disclaimer.s6.p2")}</p>
        <ul>
          <li>{t("legal.disclaimer.s6.l1")}</li>
          <li>{t("legal.disclaimer.s6.l2")}</li>
          <li>{t("legal.disclaimer.s6.l3")}</li>
          <li>{t("legal.disclaimer.s6.l4")}</li>
        </ul>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">{t("legal.disclaimer.s7.title")}</h2>
        <p>{t("legal.disclaimer.s7.p1")}</p>
        <ul>
          <li>{t("legal.disclaimer.s7.l1")}</li>
          <li>{t("legal.disclaimer.s7.l2")}</li>
          <li>{t("legal.disclaimer.s7.l3")}</li>
          <li>{t("legal.disclaimer.s7.l4")}</li>
          <li>{t("legal.disclaimer.s7.l5")}</li>
          <li>{t("legal.disclaimer.s7.l6")}</li>
          <li>{t("legal.disclaimer.s7.l7")}</li>
        </ul>
        <p>{t("legal.disclaimer.s7.p2")}</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">{t("legal.disclaimer.s8.title")}</h2>
        <p>{t("legal.disclaimer.s8.p1")}</p>
        <p>{t("legal.disclaimer.s8.p2")}</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">{t("legal.disclaimer.s9.title")}</h2>
        <p>{t("legal.disclaimer.s9.p1")}</p>
        <p>{t("legal.disclaimer.s9.p2")}</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">{t("legal.disclaimer.s10.title")}</h2>
        <p>{t("legal.disclaimer.s10.p1")}</p>
        <p>{t("legal.disclaimer.s10.p2")}</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">{t("legal.disclaimer.s11.title")}</h2>
        <p>{t("legal.disclaimer.s11.p1")}</p>
        <ul>
          <li>{t("legal.disclaimer.s11.l1")}</li>
          <li>{t("legal.disclaimer.s11.l2")}</li>
          <li>{t("legal.disclaimer.s11.l3")}</li>
          <li>{t("legal.disclaimer.s11.l4")}</li>
          <li>{t("legal.disclaimer.s11.l5")}</li>
        </ul>
        <p>{t("legal.disclaimer.s11.p2")}</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">{t("legal.disclaimer.s12.title")}</h2>
        <p>{t("legal.disclaimer.s12.p1")}</p>
        <ul>
          <li>{t("legal.disclaimer.s12.l1")}</li>
          <li>{t("legal.disclaimer.s12.l2")}</li>
          <li>{t("legal.disclaimer.s12.l3")}</li>
          <li>{t("legal.disclaimer.s12.l4")}</li>
          <li>{t("legal.disclaimer.s12.l5")}</li>
          <li>{t("legal.disclaimer.s12.l6")}</li>
        </ul>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">{t("legal.disclaimer.s13.title")}</h2>
        <p>{t("legal.disclaimer.s13.p1")}</p>
        <ul>
          <li>{t("legal.disclaimer.s13.l1")}</li>
          <li>{t("legal.disclaimer.s13.l2")}</li>
          <li>{t("legal.disclaimer.s13.l3")}</li>
          <li>{t("legal.disclaimer.s13.l4")}</li>
          <li>{t("legal.disclaimer.s13.l5")}</li>
        </ul>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">{t("legal.disclaimer.s14.title")}</h2>
        <p>{t("legal.disclaimer.s14.p1")}</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">{t("legal.disclaimer.s15.title")}</h2>
        <p>{t("legal.disclaimer.s15.p1")}</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">{t("legal.disclaimer.s16.title")}</h2>
        <p>{t("legal.disclaimer.s16.p1")}</p>
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

        .legal-section.highlight-warning {
          border-color: rgba(244, 63, 94, 0.45);
          box-shadow: 0 0 0 1px rgba(244, 63, 94, 0.15) inset, 0 8px 24px rgba(244, 63, 94, 0.08);
          background: linear-gradient(180deg, rgba(244, 63, 94, 0.05), rgba(244, 63, 94, 0.01));
        }

        .legal-section.highlight-warning .section-title {
          color: #fecdd3;
        }

        .legal-section.highlight-warning .section-title::before {
          background: linear-gradient(180deg, #f43f5e, #be123c);
          box-shadow: 0 0 8px rgba(244, 63, 94, 0.6);
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
