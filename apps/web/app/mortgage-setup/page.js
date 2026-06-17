"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { dbGetAll, dbPut } from "../../features/storage.js";

export default function MortgageSetup() {
  const router = useRouter();
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
        setError("加载本地配置失败: " + (errorVal.message || String(errorVal)));
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

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
      setError("总贷款额必须为有效金额（不小于 $1,000 NZD）。");
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
        setError("还款目标年限必须在 1 年（12个月）至 30 年（360个月）之间。");
        return;
      }
    } else {
      if (isNaN(periodicPayment) || periodicPayment <= 0) {
        setError("每次还款金额必须为大于 0 的有效数值。");
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
      setError("保存配置失败: " + errorVal.message);
    }
  };

  const getFrequencyText = () => {
    switch (repaymentFrequency) {
      case "weekly":
        return "每周";
      case "fortnightly":
        return "每两周";
      case "monthly":
      default:
        return "每月";
    }
  };

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "80vh" }}>
        <div>加载配置中...</div>
      </div>
    );
  }

  return (
    <div className="setup-container">
      <header className="setup-header">
        <h1 className="title">房贷信息配置</h1>
        <p className="subtitle">录入您的房贷全局参数，系统将在此基础上计算出最优的贷款拆包（Split）方案。</p>
      </header>

      <form onSubmit={handleSave} className="setup-form">
        {error && <div className="error-banner">{error}</div>}

        {/* Global Mortgage Settings Card */}
        <section className="glass-panel form-section">
          <h2 className="section-title">1. 房贷基础信息设定</h2>
          
          <div className="form-row">
            <div className="form-group flex-1">
              <label className="form-label">总贷款金额 (NZD)</label>
              <input
                type="number"
                value={isNaN(totalAmount) ? "" : totalAmount}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setTotalAmount(isNaN(val) ? NaN : val);
                }}
                className="form-input"
                min="1000"
                required
              />
            </div>

            <div className="form-group flex-1">
              <label className="form-label">贷款还款频率</label>
              <select
                value={repaymentFrequency}
                onChange={(e) => setRepaymentFrequency(e.target.value)}
                className="form-input"
              >
                <option value="weekly">每周 (Weekly)</option>
                <option value="fortnightly">每两周 (Fortnightly)</option>
                <option value="monthly">每月 (Monthly)</option>
              </select>
            </div>

            <div className="form-group flex-1">
              <label className="form-label">默认还款类型</label>
              <select
                value={repaymentType}
                onChange={(e) => setRepaymentType(e.target.value)}
                className="form-input"
              >
                <option value="principal-and-interest">本金加利息 (P&I)</option>
                <option value="interest-only">仅还利息 (Interest Only)</option>
              </select>
            </div>
          </div>
        </section>

        {/* Repayment Target Settings Card */}
        <section className="glass-panel form-section">
          <h2 className="section-title">2. 还款目标设定方式</h2>
          
          {/* Target Mode Selector Tabs */}
          <div style={{ display: "flex", gap: "12px", marginBottom: "8px" }}>
            <button
              type="button"
              className={`btn ${targetMode === "term" ? "btn-primary" : "btn-secondary"}`}
              style={{ flex: 1, padding: "12px" }}
              onClick={() => setTargetMode("term")}
            >
              按期望还清年限设定
            </button>
            <button
              type="button"
              className={`btn ${targetMode === "payment" ? "btn-primary" : "btn-secondary"}`}
              style={{ flex: 1, padding: "12px" }}
              onClick={() => setTargetMode("payment")}
              disabled={repaymentType === "interest-only"}
              title={repaymentType === "interest-only" ? "仅还利息（Interest Only）无法使用供款额反推年限" : ""}
            >
              按期望每次还款额设定
            </button>
          </div>

          {targetMode === "term" ? (
            <div className="form-row" style={{ marginTop: "8px" }}>
              <div className="form-group flex-1">
                <label className="form-label">期望还清期限 (年)</label>
                <input
                  type="number"
                  value={isNaN(termYears) ? "" : termYears}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    setTermYears(isNaN(val) ? NaN : val);
                  }}
                  className="form-input"
                  min="1"
                  max="30"
                  required
                />
                <span className="input-tip">通常房贷的最长摊销年限为 25 或 30 年。</span>
              </div>
              <div className="form-group flex-1">
                <label className="form-label">期望还清期限 (月 - 选填)</label>
                <input
                  type="number"
                  value={isNaN(termMonths) ? "" : termMonths}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    setTermMonths(isNaN(val) ? NaN : val);
                  }}
                  className="form-input"
                  min="0"
                  max="11"
                />
              </div>
            </div>
          ) : (
            <div style={{ marginTop: "8px" }}>
              <div className="form-group" style={{ maxWidth: "400px" }}>
                <label className="form-label">期望每次还款金额 (NZD) - {getFrequencyText()}供款额</label>
                <input
                  type="number"
                  value={isNaN(periodicPayment) ? "" : periodicPayment}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setPeriodicPayment(isNaN(val) ? NaN : val);
                  }}
                  className="form-input"
                  min="10"
                  required
                />
                <span className="input-tip">输入您每期期望扣划的金额，系统将基于当前的基准浮动利率，自动换算出与之对应的合理摊销年限。</span>
              </div>
            </div>
          )}
        </section>

        {/* Action Button Bar */}
        <div className="submit-bar">
          <button type="submit" className="btn btn-primary btn-lg" style={{ padding: "14px 28px" }}>
            保存配置，返回仪表盘
          </button>
          <button type="button" onClick={() => router.push("/")} className="btn btn-secondary btn-lg" style={{ padding: "14px 28px" }}>
            取消
          </button>
        </div>
      </form>

      <style jsx>{`
        .setup-container {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .title {
          font-size: 28px;
          font-weight: 800;
          color: #fff;
        }

        .subtitle {
          font-size: 14px;
          color: var(--text-secondary);
          margin-top: 4px;
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
          border-bottom: 1px solid rgba(255,255,255,0.06);
          padding-bottom: 8px;
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
