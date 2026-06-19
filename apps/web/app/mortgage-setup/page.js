"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { dbGetAll, dbPut } from "../../features/storage.js";
import { NumberInput, Select } from "../../components/index.js";
import { useI18n } from "../../lib/i18n/useI18n.js";

export default function MortgageSetup() {
  const router = useRouter();
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Simplified Form States
  const [totalAmount, setTotalAmount] = useState(600000);
  const [repaymentFrequency, setRepaymentFrequency] = useState("monthly");
  const [repaymentType, setRepaymentType] = useState("principal-and-interest");

  // Repayment Target Modes: 'term' (Set by payoff years) or 'payment' (Set by periodic payment amount)
  const [targetMode, setTargetMode] = useState("term");
  const [termYears, setTermYears] = useState(25);
  const [termMonths, setTermMonths] = useState(0);
  const [periodicPayment, setPeriodicPayment] = useState(4000);

  useEffect(() => {
    async function loadData() {
      try {
        const list = await dbGetAll("mortgages");
        if (list && list.length > 0) {
          const m = list[0];
          setRepaymentFrequency(m.repaymentFrequency || "monthly");
          setRepaymentType(m.repaymentType || "principal-and-interest");
          setTargetMode(m.targetMode || "term");
          if (m.targetPeriodicPayment) {
            setPeriodicPayment(m.targetPeriodicPayment);
          }

          // Calculate total loan amount from existing tranches
          const totalBal = m.tranches
            ? m.tranches.reduce((/** @type {number} */ sum, /** @type {any} */ t) => sum + t.balance, 0)
            : 600000;
          setTotalAmount(totalBal);

          // Populate term years and months
          const remMonths = m.originalTermMonths || 300;
          setTermYears(Math.floor(remMonths / 12));
          setTermMonths(remMonths % 12);
        }
      } catch (err) {
        console.error("Failed to load IndexedDB data", err);
        const errorVal = /** @type {any} */ (err);
        setError(t("mortgageSetup.errorLoad", { message: errorVal.message || String(errorVal) }));
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [t]);

  /**
   * Calculates required amortization term in months from periodic repayment amount.
   * @param {number} balance - Total loan amount
   * @param {number} payment - Desired payment amount per period
   * @param {string} frequency - weekly, fortnightly, monthly
   * @param {number} annualRate - Current baseline interest rate
   * @param {string} type - principal-and-interest or interest-only
   * @returns {number} Term in months
   */
  const calculateTermFromPayment = (balance, payment, frequency, annualRate, type) => {
    if (type === "interest-only") {
      return 360; // Default 30 years for Interest Only since principal doesn't amortize
    }
    const periodsPerYear = frequency === "weekly" ? 52 : frequency === "fortnightly" ? 26 : 12;
    const r = annualRate / periodsPerYear;

    if (payment <= balance * r) {
      // Payment cannot cover interest! Return max default term (30 years)
      return 360;
    }

    if (r === 0) {
      const totalPeriods = balance / payment;
      const totalMonths = (totalPeriods / periodsPerYear) * 12;
      return Math.max(12, Math.round(totalMonths));
    }

    const numerator = Math.log(payment / (payment - balance * r));
    const denominator = Math.log(1 + r);
    const totalPeriods = numerator / denominator;
    const totalMonths = (totalPeriods / periodsPerYear) * 12;
    return Math.max(12, Math.min(360, Math.round(totalMonths)));
  };

  const handleSave = async (/** @type {any} */ e) => {
    e.preventDefault();
    setError("");

    if (isNaN(totalAmount) || totalAmount <= 1000) {
      setError(t("mortgageSetup.errorAmount"));
      return;
    }

    // Retrieve baseline floating rate from localStorage custom rates or default to 5.79%
    let floatingRate = 0.0579;
    try {
      const saved = localStorage.getItem("ratepath_custom_market_rates");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.floating) {
          floatingRate = parsed.floating;
        }
      }
    } catch (e) {
      console.error("Failed to parse custom market rates on save", e);
    }

    // Determine target amortization months
    let calculatedMonths = 300; // default 25 years
    if (targetMode === "term") {
      const years = isNaN(termYears) ? 25 : termYears;
      const months = isNaN(termMonths) ? 0 : termMonths;
      calculatedMonths = years * 12 + months;
      if (calculatedMonths < 12 || calculatedMonths > 360) {
        setError(t("mortgageSetup.errorTerm"));
        return;
      }
    } else {
      if (isNaN(periodicPayment) || periodicPayment <= 0) {
        setError(t("mortgageSetup.errorPayment"));
        return;
      }
      calculatedMonths = calculateTermFromPayment(
        totalAmount,
        periodicPayment,
        repaymentFrequency,
        floatingRate,
        repaymentType
      );
    }

    // Generate a single starting tranche representing 100% of the loan amount
    // The Strategy Lab will automatically use this to generate optimal splits
    const tranches = [
      {
        id: "tranche-main",
        productCode: "floating",
        balance: totalAmount,
        annualRate: floatingRate,
        fixedUntil: null,
        remainingTermMonths: calculatedMonths,
        repaymentType
      }
    ];

    const mortgageData = {
      id: "mortgage-nz-main",
      name: "新西兰主房贷",
      countryCode: "NZ",
      currencyCode: "NZD",
      originalTermMonths: calculatedMonths,
      remainingTermMonths: calculatedMonths,
      targetMode,
      targetPeriodicPayment: targetMode === "payment" ? periodicPayment : undefined,
      repaymentFrequency,
      repaymentType,
      tranches,
      extraRepayments: []
    };

    try {
      await dbPut("mortgages", mortgageData);
      router.push("/");
    } catch (err) {
      const errorVal = /** @type {any} */ (err);
      setError(t("mortgageSetup.errorSave", { message: errorVal.message }));
    }
  };

  const getFrequencyText = () => {
    switch (repaymentFrequency) {
      case "weekly":
        return t("mortgageSetup.freqWeekly");
      case "fortnightly":
        return t("mortgageSetup.freqFortnightly");
      case "monthly":
      default:
        return t("mortgageSetup.freqMonthly");
    }
  };

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "80vh" }}>
        <div>{t("mortgageSetup.loading")}</div>
      </div>
    );
  }

  return (
    <div className="setup-container">
      <header className="setup-header">
        <h1 className="page-title gradient-text-primary">{t("mortgageSetup.title")}</h1>
        <p className="subtitle">{t("mortgageSetup.subtitle")}</p>
      </header>

      <form onSubmit={handleSave} className="setup-form">
        {error && <div className="error-banner">{error}</div>}

        {/* Global Mortgage Settings Card */}
        <section className="glass-panel form-section accent-primary">
          <h2 className="section-title"><span className="step-num">1</span>{t("mortgageSetup.section1")}</h2>

          <div className="form-row">
            <div className="form-group flex-1">
              <NumberInput
                label={t("mortgageSetup.totalAmount")}
                ariaLabel={t("mortgageSetup.totalAmountAria")}
                min={1000}
                step={1}
                prefix="$"
                size="md"
                value={isNaN(totalAmount) ? "" : totalAmount}
                onChange={(/** @type {any} */e) => {
                  const val = parseFloat(e.target.value);
                  setTotalAmount(isNaN(val) ? NaN : val);
                }}
              />
              <span className="input-tip">{t("mortgageSetup.hintTotalAmount")}</span>
            </div>

            <div className="form-group flex-1">
              <label className="form-label">{t("mortgageSetup.frequencyLabel")}</label>
              <Select
                ariaLabel={t("mortgageSetup.frequencyAria")}
                value={repaymentFrequency}
                onChange={(/** @type {any} */v) => setRepaymentFrequency(v)}
                options={[
                  { value: "weekly", label: t("mortgageSetup.freqWeekly") },
                  { value: "fortnightly", label: t("mortgageSetup.freqFortnightly") },
                  { value: "monthly", label: t("mortgageSetup.freqMonthly") }
                ]}
              />
              <span className="input-tip">{t("mortgageSetup.hintFrequency")}</span>
            </div>

            <div className="form-group flex-1">
              <label className="form-label">{t("mortgageSetup.typeLabel")}</label>
              <Select
                ariaLabel={t("mortgageSetup.typeAria")}
                value={repaymentType}
                onChange={(/** @type {any} */v) => setRepaymentType(v)}
                options={[
                  { value: "principal-and-interest", label: t("mortgageSetup.typePI") },
                  { value: "interest-only", label: t("mortgageSetup.typeIO") }
                ]}
              />
              <span className="input-tip">{t("mortgageSetup.hintRepaymentType")}</span>
            </div>
          </div>
        </section>

        {/* Repayment Target Settings Card */}
        <section className="glass-panel form-section accent-cyan">
          <h2 className="section-title"><span className="step-num">2</span>{t("mortgageSetup.section2")}</h2>

          <div className="hint-box">
            <p>{t("mortgageSetup.hintTermMode")}</p>
          </div>

          {/* Target Mode Selector Tabs */}
          <div style={{ display: "flex", gap: "12px", marginBottom: "8px" }}>
            <button
              type="button"
              className={`btn ${targetMode === "term" ? "btn-primary" : "btn-secondary"}`}
              style={{ flex: 1, padding: "12px" }}
              onClick={() => setTargetMode("term")}
            >
              {t("mortgageSetup.targetTerm")}
            </button>
            <button
              type="button"
              className={`btn ${targetMode === "payment" ? "btn-primary" : "btn-secondary"}`}
              style={{ flex: 1, padding: "12px" }}
              onClick={() => setTargetMode("payment")}
              disabled={repaymentType === "interest-only"}
              title={repaymentType === "interest-only" ? t("mortgageSetup.targetTermDisabledTitle") : ""}
            >
              {t("mortgageSetup.targetPayment")}
            </button>
          </div>

          {targetMode === "term" ? (
            <div className="form-row" style={{ marginTop: "8px" }}>
              <div className="form-group flex-1">
                <NumberInput
                  label={t("mortgageSetup.termYears")}
                  ariaLabel={t("mortgageSetup.termYearsAria")}
                  min={1}
                  max={30}
                  step={1}
                  suffix="yr"
                  size="md"
                  value={isNaN(termYears) ? "" : termYears}
                  onChange={(/** @type {any} */e) => {
                    const val = parseInt(e.target.value, 10);
                    setTermYears(isNaN(val) ? NaN : val);
                  }}
                />
                <span className="input-tip">{t("mortgageSetup.tipMaxTerm")}</span>
              </div>
              <div className="form-group flex-1">
                <NumberInput
                  label={t("mortgageSetup.termMonths")}
                  ariaLabel={t("mortgageSetup.termMonthsAria")}
                  min={0}
                  max={11}
                  step={1}
                  suffix="mo"
                  size="md"
                  value={isNaN(termMonths) ? "" : termMonths}
                  onChange={(/** @type {any} */e) => {
                    const val = parseInt(e.target.value, 10);
                    setTermMonths(isNaN(val) ? NaN : val);
                  }}
                />
              </div>
            </div>
          ) : (
            <div style={{ marginTop: "8px" }}>
              <div className="form-group" style={{ maxWidth: "400px" }}>
                <NumberInput
                  label={t("mortgageSetup.periodicPayment", { freq: getFrequencyText() })}
                  ariaLabel={t("mortgageSetup.periodicPaymentAria")}
                  min={10}
                  step={10}
                  prefix="$"
                  size="md"
                  value={isNaN(periodicPayment) ? "" : periodicPayment}
                  onChange={(/** @type {any} */e) => {
                    const val = parseFloat(e.target.value);
                    setPeriodicPayment(isNaN(val) ? NaN : val);
                  }}
                />
                <span className="input-tip">{t("mortgageSetup.tipPayment")}</span>
              </div>
            </div>
          )}
        </section>

        {/* Action Button Bar */}
        <div className="hint-box hint-box--info">
          <p>{t("mortgageSetup.hintStep2")}</p>
        </div>

        <div className="submit-bar">
          <button type="submit" className="btn btn-primary btn-lg" style={{ padding: "14px 28px" }}>
            {t("mortgageSetup.save")}
          </button>
          <button type="button" onClick={() => router.back()} className="btn btn-secondary btn-lg" style={{ padding: "14px 28px" }}>
            {t("mortgageSetup.cancel")}
          </button>
        </div>
      </form>

      <style jsx>{`
        .setup-container {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .subtitle {
          font-size: 14px;
          color: var(--text-secondary);
          margin-top: 6px;
        }

        .setup-form {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .error-banner {
          background: rgba(244, 63, 94, 0.1);
          border: 1px solid var(--color-rose);
          color: var(--color-rose);
          border-radius: 8px;
          padding: 14px 18px;
          font-size: 14px;
          font-weight: 500;
        }

        .form-section {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .section-title {
          font-size: 16px;
          font-weight: 700;
          color: #fff;
          letter-spacing: -0.01em;
          margin-bottom: 12px;
          padding-bottom: 10px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
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

        .form-row {
          display: flex;
          gap: 20px;
          flex-wrap: wrap;
        }

        .flex-1 {
          flex: 1;
          min-width: 220px;
        }

        .input-tip {
          font-size: 11px;
          color: var(--text-muted);
          margin-top: 6px;
          display: block;
          line-height: 1.5;
        }

        .hint-box {
          background: rgba(96, 165, 250, 0.08);
          border: 1px solid rgba(96, 165, 250, 0.2);
          border-radius: 10px;
          padding: 14px 16px;
        }

        .hint-box p {
          font-size: 12px;
          color: var(--text-secondary);
          line-height: 1.65;
          margin: 0;
        }

        .submit-bar {
          display: flex;
          gap: 16px;
          margin-top: 12px;
        }

        @media (max-width: 768px) {
          .form-row {
            flex-direction: column;
            gap: 12px;
          }
          .submit-bar {
            flex-direction: column;
            width: 100%;
          }
          .submit-bar .btn {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
