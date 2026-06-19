"use client";

import Link from "next/link";
import { nzProfile } from "@mortgage/country-adapters";
import { useI18n } from "../../lib/i18n/useI18n.js";

export default function About() {
  const { t } = useI18n();
  return (
    <div className="about-container">
      <header className="about-header">
        <h1 className="page-title gradient-text-primary">{t("about.title")}</h1>
        <p className="subtitle">{t("about.subtitle")}</p>
        <p className="effective-date"><strong>{t("about.effectiveDate")}</strong></p>
      </header>

      <div className="about-grid">

        {/* Market Config */}
        <section className="glass-panel config-section accent-primary">
          <h2 className="section-title"><span className="step-num">1</span>{t("about.section1Title")}</h2>

          <div className="detail-row">
            <span className="detail-lbl">{t("about.marketLabel")}</span>
            <span className="detail-val">{t("about.marketValue")}</span>
          </div>
          <div className="detail-row">
            <span className="detail-lbl">{t("about.currencyLabel")}</span>
            <span className="detail-val">{t("about.currencyValue")}</span>
          </div>
          <div className="detail-row">
            <span className="detail-lbl">{t("about.localeLabel")}</span>
            <span className="detail-val">{nzProfile.locale}</span>
          </div>
          <div className="detail-row">
            <span className="detail-lbl">{t("about.timezoneLabel")}</span>
            <span className="detail-val">{nzProfile.timezone}</span>
          </div>
          <div className="detail-row">
            <span className="detail-lbl">{t("about.modelVersionLabel")}</span>
            <span className="detail-val">{nzProfile.modelConfigVersion}</span>
          </div>
        </section>

        {/* Features at a glance */}
        <section className="glass-panel features-section accent-cyan">
          <h2 className="section-title"><span className="step-num">2</span>{t("about.section2Title")}</h2>
          <div className="card-body">
            <ul>
              <li dangerouslySetInnerHTML={{ __html: t("about.features.multiScenario") }} />
              <li dangerouslySetInnerHTML={{ __html: t("about.features.monteCarlo") }} />
              <li dangerouslySetInnerHTML={{ __html: t("about.features.splitEnumerate") }} />
              <li dangerouslySetInnerHTML={{ __html: t("about.features.realtimeWeights") }} />
              <li dangerouslySetInnerHTML={{ __html: t("about.features.localCompute") }} />
            </ul>
          </div>
        </section>

        {/* Privacy at a glance */}
        <section className="glass-panel privacy-section accent-cyan">
          <h2 className="section-title"><span className="step-num">3</span>{t("about.section3Title")}</h2>
          <div className="card-body">
            <p dangerouslySetInnerHTML={{ __html: t("about.privacyIntro") }} />
            <ul>
              <li dangerouslySetInnerHTML={{ __html: t("about.privacyBullets.noUpload") }} />
              <li dangerouslySetInnerHTML={{ __html: t("about.privacyBullets.noBackend") }} />
              <li dangerouslySetInnerHTML={{ __html: t("about.privacyBullets.sandbox") }} />
            </ul>
          </div>
        </section>

        {/* Disclaimer summary + link to full text */}
        <section className="glass-panel disclaimer-section accent-amber" style={{ gridColumn: "1 / -1" }}>
          <h2 className="section-title"><span className="step-num">4</span>{t("about.section4Title")}</h2>
          <div className="card-body">
            <p dangerouslySetInnerHTML={{ __html: t("about.disclaimerIntro") }} />
            <ul>
              <li dangerouslySetInnerHTML={{ __html: t("about.disclaimerBullets.noWarranty") }} />
              <li dangerouslySetInnerHTML={{ __html: t("about.disclaimerBullets.drift") }} />
              <li dangerouslySetInnerHTML={{ __html: t("about.disclaimerBullets.notAdvice") }} />
              <li dangerouslySetInnerHTML={{ __html: t("about.disclaimerBullets.userRisk") }} />
              <li dangerouslySetInnerHTML={{ __html: t("about.disclaimerBullets.noLiability") }} />
            </ul>
            <p className="legal-link-row">
              <Link href="/legal/disclaimer" className="legal-link">{t("about.disclaimerLink")}</Link>
              <Link href="/legal/privacy" className="legal-link">{t("about.privacyLink")}</Link>
            </p>
          </div>
        </section>

        {/* Version & Build Info */}
        <section className="glass-panel version-section accent-emerald" style={{ gridColumn: "1 / -1" }}>
          <h2 className="section-title"><span className="step-num">5</span>{t("about.section5Title")}</h2>
          <div className="detail-row">
            <span className="detail-lbl">{t("about.versionApp")}</span>
            <span className="detail-val">{t("about.versionAppValue")}</span>
          </div>
          <div className="detail-row">
            <span className="detail-lbl">{t("about.buildId")}</span>
            <span className="detail-val">{t("about.buildIdValue", { id: (typeof process !== "undefined" && process.env.NEXT_PUBLIC_BUILD_ID) ? process.env.NEXT_PUBLIC_BUILD_ID : t("about.buildIdDev") })}</span>
          </div>
          <div className="detail-row">
            <span className="detail-lbl">{t("about.nextVersion")}</span>
            <span className="detail-val">{t("about.nextVersionValue")}</span>
          </div>
          <div className="detail-row">
            <span className="detail-lbl">{t("about.versionStatus")}</span>
            <span className="detail-val">{t("about.versionStatusValue")}</span>
          </div>
        </section>

      </div>

      <style jsx>{`
        .about-container {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .subtitle {
          font-size: 14px;
          color: var(--text-secondary);
          margin-top: 6px;
        }

        .effective-date {
          font-size: 12px;
          color: var(--text-secondary);
          margin-top: 4px;
          opacity: 0.85;
        }

        .legal-link-row {
          display: flex;
          flex-wrap: wrap;
          gap: 18px;
          margin-top: 16px;
          padding-top: 14px;
          border-top: 1px solid rgba(255,255,255,0.06);
        }

        .legal-link {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          color: var(--color-primary);
          text-decoration: none;
          font-size: 13px;
          font-weight: 600;
          padding: 6px 12px;
          border-radius: 8px;
          background: rgba(99,102,241,0.1);
          border: 1px solid rgba(99,102,241,0.3);
          transition: background 0.15s ease, border-color 0.15s ease;
        }

        .legal-link:hover {
          background: rgba(99,102,241,0.18);
          border-color: rgba(99,102,241,0.5);
        }

        .about-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
          gap: 24px;
        }

        .section-title {
          font-size: 16px;
          font-weight: 700;
          color: #fff;
          letter-spacing: -0.01em;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          padding-bottom: 10px;
          margin-bottom: 16px;
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .section-title :global(.step-num) {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: rgba(99, 102, 241, 0.18);
          color: var(--color-primary);
          font-size: 11px;
          font-weight: 800;
          border: 1px solid rgba(99, 102, 241, 0.35);
          flex-shrink: 0;
        }

        .detail-row {
          display: flex;
          justify-content: space-between;
          padding: 12px 0;
          border-bottom: 1px solid rgba(255,255,255,0.03);
          font-size: 14px;
        }

        .detail-lbl {
          color: var(--text-secondary);
        }

        .detail-val {
          font-weight: 600;
          color: #fff;
        }

        .card-body {
          font-size: 13px;
          color: var(--text-secondary);
          line-height: 1.7;
        }

        .card-body p {
          margin-bottom: 12px;
          color: #fff;
        }

        .card-body ul {
          padding-left: 20px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
      `}</style>
    </div>
  );
}
