"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { dbGetAll } from "../features/storage.js";
import { nzProfile } from "@mortgage/country-adapters";

export default function Dashboard() {
  const [mortgage, setMortgage] = useState(/** @type {any} */ (null));
  const [loading, setLoading] = useState(true);

  // NZ Market Adapter mock
  const marketPolicyRateName = nzProfile.policyRate.displayName; // OCR
  const marketPolicyRateVal = nzProfile.policyRate.value; // 0.055 (5.50%)
  const marketPolicyRateDate = nzProfile.policyRate.effectiveDate; // 2026-05-27

  const [marketRates, setMarketRates] = useState({
    ocr: 0.0225,
    floating: 0.0579,
    "fixed-6m": 0.0449,
    "fixed-1y": 0.0465,
    "fixed-18m": 0.0495,
    "fixed-2y": 0.0525,
    "fixed-3y": 0.0549,
    "fixed-5y": 0.0589
  });
  const [isEditingRates, setIsEditingRates] = useState(false);
  const [editedRates, setEditedRates] = useState(/** @type {any} */ (null));

  useEffect(() => {
    const saved = localStorage.getItem("ratepath_custom_market_rates");
    if (saved) {
      try {
        setMarketRates(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse custom market rates", e);
      }
    }
  }, []);

  const handleOcrChange = (/** @type {number} */ newOcr) => {
    const prevOcr = editedRates.ocr;
    const nextRates = { ...editedRates, ocr: newOcr };
    const keys = ["floating", "fixed-6m", "fixed-1y", "fixed-18m", "fixed-2y", "fixed-3y", "fixed-5y"];
    keys.forEach(key => {
      const margin = (editedRates[key] || 0) - prevOcr;
      nextRates[key] = Math.round((newOcr + margin) * 10000) / 10000;
    });
    setEditedRates(nextRates);
  };

  const handleRateChange = (/** @type {string} */ key, /** @type {number} */ newRate) => {
    setEditedRates((/** @type {any} */ prev) => ({
      ...prev,
      [key]: newRate
    }));
  };

  const handleMarginChange = (/** @type {string} */ key, /** @type {number} */ newMargin) => {
    const rate = editedRates.ocr + newMargin;
    setEditedRates((/** @type {any} */ prev) => ({
      ...prev,
      [key]: Math.round(rate * 10000) / 10000
    }));
  };

  const handleSaveRates = (/** @type {any} */ e) => {
    e.preventDefault();
    setMarketRates(editedRates);
    localStorage.setItem("ratepath_custom_market_rates", JSON.stringify(editedRates));
    setIsEditingRates(false);
  };

  const handleResetRates = () => {
    const defaults = {
      ocr: 0.0225,
      floating: 0.0579,
      "fixed-6m": 0.0449,
      "fixed-1y": 0.0465,
      "fixed-18m": 0.0495,
      "fixed-2y": 0.0525,
      "fixed-3y": 0.0549,
      "fixed-5y": 0.0589
    };
    setMarketRates(defaults);
    localStorage.removeItem("ratepath_custom_market_rates");
    setIsEditingRates(false);
  };

  useEffect(() => {
    async function loadData() {
      try {
        const list = await dbGetAll("mortgages");
        if (list && list.length > 0) {
          setMortgage(list[0]);
        }
      } catch (err) {
        console.error("Failed to load mortgages from IndexedDB", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const calculateTotalBalance = () => {
    if (!mortgage || !mortgage.tranches) return 0;
    return mortgage.tranches.reduce((/** @type {number} */ sum, /** @type {any} */ t) => sum + t.balance, 0);
  };

  const calculateScheduledRepayment = () => {
    if (!mortgage || !mortgage.tranches) return 0;
    
    const freq = mortgage.repaymentFrequency || "monthly";
    let periodsPerYear = 12;
    if (freq === "weekly") {
      periodsPerYear = 52;
    } else if (freq === "fortnightly") {
      periodsPerYear = 26;
    }

    let total = 0;
    mortgage.tranches.forEach((/** @type {any} */ t) => {
      const remainingTermMonths = t.remainingTermMonths;
      
      let periods = remainingTermMonths;
      if (freq === "weekly") {
        periods = Math.round(remainingTermMonths * 52 / 12);
      } else if (freq === "fortnightly") {
        periods = Math.round(remainingTermMonths * 26 / 12);
      }

      const rate = t.productCode === "floating" ? marketRates.floating : t.annualRate;
      const r = rate / periodsPerYear;
      
      if (t.repaymentType === "interest-only") {
        total += t.balance * r;
      } else if (r === 0) {
        total += t.balance / periods;
      } else {
        total += (t.balance * r * Math.pow(1 + r, periods)) / (Math.pow(1 + r, periods) - 1);
      }
    });

    return Math.round(total * 100) / 100;
  };

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "80vh" }}>
        <div className="loading-spinner">加载中...</div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div>
          <h1 className="welcome-title gradient-text-primary">房贷控制面板</h1>
          <p className="welcome-desc">分析您的贷款配置并进行未来情景演练。</p>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <div className={`badge ${Date.now() - new Date(marketPolicyRateDate).getTime() > 365 * 24 * 60 * 60 * 1000 ? "badge-amber" : "badge-emerald"}`}>
            数据源: RBNZ MPS (更新于 {marketPolicyRateDate})
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <div className="dashboard-grid">
        
        {/* Left Side: Personal Mortgage Overview */}
        <section className="glass-panel summary-card accent-primary">
          <h2 className="card-header"><span className="card-header-accent" />贷款总览</h2>
          {mortgage ? (
            <div className="mortgage-details">
              <div className="metric-row">
                <span className="metric-lbl">贷款总额</span>
                <span className="metric-val metric-val-lg gradient-text-primary">${calculateTotalBalance().toLocaleString()}</span>
              </div>
              <div className="metric-row">
                <span className="metric-lbl">还款频率</span>
                <span className="metric-val">{mortgage.repaymentFrequency === "weekly" ? "每周" : mortgage.repaymentFrequency === "fortnightly" ? "每两周" : "每月"}</span>
              </div>
              <div className="metric-row">
                <span className="metric-lbl">
                  {mortgage.repaymentFrequency === "weekly" ? "分期还款额 (每周)" : mortgage.repaymentFrequency === "fortnightly" ? "分期还款额 (每两周)" : "分期还款额 (每月)"}
                </span>
                <span className="metric-val text-emerald">${calculateScheduledRepayment().toLocaleString()}</span>
              </div>
              <div className="unsplit-details-box">
                <h3 className="section-subtitle section-subtitle-rule">基础贷款参数</h3>

                <div className="details-list">
                  <div className="details-list-row">
                    <span className="details-lbl">当前执行利率</span>
                    <span className="details-val">{(marketRates.floating * 100).toFixed(2)}% <span className="details-tag">(浮动利率)</span></span>
                  </div>
                  <div className="details-list-row">
                    <span className="details-lbl">还款期限目标</span>
                    <span className="details-val">
                      {Math.floor(mortgage.originalTermMonths / 12)}年
                      {mortgage.originalTermMonths % 12 > 0 ? ` ${mortgage.originalTermMonths % 12}个月` : ""}
                    </span>
                  </div>
                  <div className="details-list-row">
                    <span className="details-lbl">还款类型</span>
                    <span className="details-val">
                      {mortgage.repaymentType === "principal-and-interest" ? "本金加利息 (P&I)" : "仅还利息 (Interest Only)"}
                    </span>
                  </div>
                </div>
              </div>
              <div className="action-buttons">
                <Link href="/strategy-lab" className="btn btn-primary" style={{ flex: 1 }}>
                  进入策略实验室
                </Link>
                <Link href="/mortgage-setup" className="btn btn-secondary">
                  重新配置
                </Link>
              </div>
            </div>
          ) : (
            <div className="setup-prompt">
              <div className="setup-prompt-animated-border">
                <div className="setup-prompt-inner">
                  <div className="prompt-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>
                  </div>
                  <h3>暂无贷款数据</h3>
                  <p>请先添加您的贷款基本分包（Tranche）详情，以便对其进行未来的情景利息开销模拟。</p>
                  <Link href="/mortgage-setup" className="btn btn-primary" style={{ marginTop: "20px" }}>
                    立即配置房贷
                  </Link>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Right Side: Market Rates Overview */}
        {!isEditingRates ? (
          <section className="glass-panel market-card accent-cyan">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h2 className="card-header" style={{ margin: 0 }}><span className="card-header-accent" />新西兰当前市场数据</h2>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "6px 12px", fontSize: "12px" }}
                onClick={() => {
                  setEditedRates({ ...marketRates });
                  setIsEditingRates(true);
                }}
              >
                🖊️ 自定义利率
              </button>
            </div>

            <div className="policy-rate-card">
              <div>
                <div className="policy-lbl">{marketPolicyRateName} (新西兰央行官方现金利率)</div>
                <div className="policy-val gradient-text-primary">{(marketRates.ocr * 100).toFixed(2)}%</div>
                <div className="policy-meta">
                  <span>生效日 {marketPolicyRateDate}</span>
                </div>
              </div>
              <div className="policy-gauge" aria-hidden="true">
                <svg viewBox="0 0 36 36" width="72" height="72">
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2.4" />
                  <circle
                    cx="18"
                    cy="18"
                    r="15.9"
                    fill="none"
                    stroke="url(#policy-gauge-grad)"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeDasharray={`${Math.min(100, Math.max(0, marketRates.ocr * 100 * 12))} ${100}`}
                    transform="rotate(-90 18 18)"
                  />
                  <defs>
                    <linearGradient id="policy-gauge-grad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#6366f1" />
                      <stop offset="100%" stopColor="#14b8a6" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
            </div>

            <h3 className="section-subtitle">主要银行平均房贷报价</h3>
            <div className="market-rates-list">
              {(() => {
                // Compute the absolute max margin across all rows so the bar widths
                // are visually comparable.
                const items = [
                  { key: "floating", label: "浮动利率 (Floating)", tone: "rose" },
                  { key: "fixed-6m", label: "6 个月固定 (6 Months)", tone: "emerald" },
                  { key: "fixed-1y", label: "1 年固定 (1 Year Fixed)", tone: "emerald" },
                  { key: "fixed-18m", label: "18 个月固定 (18 Months Fixed)", tone: "cyan" },
                  { key: "fixed-2y", label: "2 年固定 (2 Years Fixed)", tone: "cyan" },
                  { key: "fixed-3y", label: "3 年固定 (3 Years Fixed)", tone: "amber" },
                  { key: "fixed-5y", label: "5 年固定 (5 Years Fixed)", tone: "rose" }
                ];
                const margins = items.map((item) => Math.abs((/** @type {any} */ (marketRates))[item.key] - marketRates.ocr));
                const maxAbs = Math.max(...margins, 0.001);
                return items.map((item) => {
                  const rate = /** @type {any} */ (marketRates)[item.key];
                  const margin = rate - marketRates.ocr;
                  const marginSign = margin >= 0 ? "+" : "";
                  const barWidth = Math.max(8, (Math.abs(margin) / maxAbs) * 100);
                  const toneClass = `bar-${item.tone}`;
                  return (
                    <div key={item.key} className="market-rate-row">
                      <div className="market-rate-meta">
                        <span className="rate-lbl">{item.label}</span>
                        <div className="market-rate-bar">
                          <div
                            className={`market-rate-bar-fill ${toneClass}`}
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                      </div>
                      <div className="market-rate-figures">
                        <span className="rate-margin" data-sign={margin >= 0 ? "pos" : "neg"}>
                          OCR {marginSign}{(margin * 100).toFixed(2)}%
                        </span>
                        <span className="rate-val">{(rate * 100).toFixed(2)}%</span>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            {typeof window !== 'undefined' && localStorage.getItem("ratepath_custom_market_rates") && (
              <div style={{ textAlign: "right", marginTop: "16px" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: "4px 8px", fontSize: "11px", borderColor: "rgba(244, 63, 94, 0.4)", color: "var(--color-rose)" }}
                  onClick={handleResetRates}
                >
                  恢复系统默认报价
                </button>
              </div>
            )}
          </section>
        ) : (
          <section className="glass-panel market-card accent-amber">
            <h2 className="card-header" style={{ marginBottom: "16px" }}><span className="card-header-accent" />自定义当前市场利率</h2>
            
            <div className="glass-panel" style={{ background: "rgba(59, 130, 246, 0.08)", border: "1px solid rgba(59, 130, 246, 0.2)", borderRadius: "8px", padding: "12px", marginBottom: "20px" }}>
              <h4 style={{ margin: "0 0 6px 0", fontSize: "13px", fontWeight: "600", color: "#60a5fa", display: "flex", alignItems: "center", gap: "6px" }}>
                💡 利率与 OCR 联动机制说明
              </h4>
              <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.4" }}>
                新西兰主要商业银行房贷报价由 <strong>官方现金利率 (OCR)</strong> 加上其 <strong>银行加点 (Margin)</strong> 构成。
                <code style={{ display: "block", background: "rgba(0,0,0,0.3)", padding: "4px 8px", borderRadius: "4px", margin: "6px 0", fontFamily: "monospace", fontSize: "11px", color: "var(--text-primary)" }}>
                  房贷利率 = OCR + 银行加点 (Margin)
                </code>
                当您在此处修改 <strong>OCR</strong> 时，系统将基于当前的加点水平<strong>自动推算并更新所有期限房贷利率</strong>。您也可以在下方微调具体期限利率或加点，修改任意一方均会双向实时同步。
              </p>
            </div>

            <form onSubmit={handleSaveRates}>
              <div className="form-group" style={{ marginBottom: "20px" }}>
                <label className="form-label" style={{ fontSize: "13px", fontWeight: "500", color: "var(--text-primary)", marginBottom: "6px", display: "block" }}>
                  {marketPolicyRateName} (新西兰央行官方现金利率)
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="20"
                    value={Math.round(editedRates.ocr * 10000) / 100}
                    onChange={(e) => handleOcrChange(parseFloat(e.target.value) / 100)}
                    className="form-input"
                    style={{ padding: "8px 12px", background: "rgba(0,0,0,0.2)", width: "110px", textAlign: "right" }}
                    required
                  />
                  <span style={{ color: "var(--text-secondary)", fontSize: "14px" }}>%</span>
                </div>
              </div>

              <h3 className="section-subtitle" style={{ marginBottom: "12px", marginTop: "20px" }}>主要银行平均房贷报价</h3>
              
              <div className="edit-rates-grid" style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "24px" }}>
                {[
                  { key: "floating", label: "浮动利率 (Floating)" },
                  { key: "fixed-6m", label: "6 个月固定 (6 Months)" },
                  { key: "fixed-1y", label: "1 年固定 (1 Year Fixed)" },
                  { key: "fixed-18m", label: "18 个月固定 (18 Months Fixed)" },
                  { key: "fixed-2y", label: "2 年固定 (2 Years Fixed)" },
                  { key: "fixed-3y", label: "3 年固定 (3 Years Fixed)" },
                  { key: "fixed-5y", label: "5 年固定 (5 Years Fixed)" }
                ].map((item) => {
                  const rateVal = editedRates[item.key] || 0;
                  const marginVal = rateVal - editedRates.ocr;
                  return (
                    <div key={item.key} style={{ padding: "12px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: "8px", display: "flex", flexDirection: "column", gap: "8px" }}>
                      <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-primary)" }}>{item.label}</span>
                      
                      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                        {/* Rate Input */}
                        <div style={{ flex: "1 1 120px", display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ fontSize: "11px", color: "var(--text-secondary)", minWidth: "32px" }}>利率:</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max="20"
                            value={Math.round(rateVal * 10000) / 100}
                            onChange={(e) => handleRateChange(item.key, parseFloat(e.target.value) / 100)}
                            className="form-input"
                            style={{ padding: "6px 8px", width: "100%", textAlign: "right", background: "rgba(0,0,0,0.2)" }}
                            required
                          />
                          <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>%</span>
                        </div>

                        {/* Margin Input */}
                        <div style={{ flex: "1 1 120px", display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ fontSize: "11px", color: "var(--text-secondary)", minWidth: "32px" }}>加点:</span>
                          <input
                            type="number"
                            step="0.01"
                            min="-10"
                            max="10"
                            value={Math.round(marginVal * 10000) / 100}
                            onChange={(e) => handleMarginChange(item.key, parseFloat(e.target.value) / 100)}
                            className="form-input"
                            style={{ padding: "6px 8px", width: "100%", textAlign: "right", background: "rgba(0,0,0,0.2)", color: marginVal >= 0 ? "#10b981" : "#f43f5e" }}
                            required
                          />
                          <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>%</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: "6px 12px", fontSize: "12px" }}
                  onClick={() => setIsEditingRates(false)}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ padding: "6px 16px", fontSize: "12px" }}
                >
                  保存自定义利率
                </button>
              </div>
            </form>
          </section>
        )}

      </div>

      <style jsx>{`
        .dashboard-container {
          display: flex;
          flex-direction: column;
          gap: 30px;
        }

        .dashboard-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          flex-wrap: wrap;
          gap: 16px;
        }

        .welcome-title {
          font-size: 28px;
          font-weight: 800;
          color: #fff;
          letter-spacing: -0.02em;
        }

        .welcome-desc {
          font-size: 14px;
          color: var(--text-secondary);
          margin-top: 6px;
        }

        .card-header {
          font-size: 17px;
          font-weight: 700;
          color: #fff;
          margin-bottom: 18px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          padding-bottom: 12px;
          display: flex;
          align-items: center;
          gap: 12px;
          letter-spacing: -0.01em;
        }

        .card-header-accent {
          width: 4px;
          height: 18px;
          border-radius: 3px;
          background: var(--gradient-primary);
          box-shadow: var(--glow-primary);
          display: inline-block;
          flex-shrink: 0;
        }

        .section-subtitle {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-secondary);
          margin-bottom: 12px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .section-subtitle-rule {
          border-bottom: 1px solid rgba(255,255,255,0.06);
          padding-bottom: 8px;
        }

        .metric-row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          padding: 14px 0;
          border-bottom: 1px solid rgba(255,255,255,0.04);
          font-size: 14px;
          gap: 12px;
        }

        .metric-row:last-child {
          border-bottom: none;
        }

        .metric-lbl {
          color: var(--text-secondary);
        }

        .metric-val {
          font-weight: 600;
          color: #fff;
          font-family: var(--font-num);
          letter-spacing: -0.01em;
        }

        .metric-val-lg {
          font-size: 22px;
          font-weight: 800;
        }

        .tranche-item {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid var(--border-glass);
          border-radius: 8px;
          padding: 12px;
          margin-bottom: 8px;
        }

        .tranche-header {
          display: flex;
          justify-content: space-between;
          font-weight: 600;
          font-size: 13px;
          color: #fff;
        }

        .tranche-footer {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          color: var(--text-secondary);
          margin-top: 4px;
        }

        .tranche-rate {
          color: var(--color-primary);
          font-weight: 500;
        }

        .setup-prompt {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          text-align: center;
          padding: 24px 4px;
        }

        .setup-prompt-animated-border {
          position: relative;
          padding: 2px;
          border-radius: 16px;
          overflow: hidden;
          background: rgba(99, 102, 241, 0.04);
        }

        .setup-prompt-animated-border::before {
          content: "";
          position: absolute;
          inset: -2px;
          background: conic-gradient(
            from 0deg,
            var(--color-primary) 0deg,
            var(--accent-teal) 90deg,
            var(--accent-purple) 180deg,
            var(--color-rose) 270deg,
            var(--color-primary) 360deg
          );
          animation: spin-border 6s linear infinite;
          opacity: 0.5;
          filter: blur(6px);
          z-index: 0;
        }

        @keyframes spin-border {
          to { transform: rotate(360deg); }
        }

        .setup-prompt-inner {
          position: relative;
          background: rgba(11, 15, 25, 0.9);
          border-radius: 14px;
          padding: 36px 24px;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .prompt-icon {
          width: 72px;
          height: 72px;
          border-radius: 50%;
          background:
            radial-gradient(circle at 30% 30%, rgba(99, 102, 241, 0.25), transparent 60%),
            rgba(99, 102, 241, 0.08);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 20px;
          color: var(--color-primary);
          border: 1px solid rgba(99, 102, 241, 0.25);
          box-shadow: var(--glow-primary);
        }

        .setup-prompt h3 {
          font-size: 18px;
          color: #fff;
          margin-bottom: 10px;
          letter-spacing: -0.01em;
        }

        .setup-prompt p {
          font-size: 13px;
          color: var(--text-secondary);
          max-width: 320px;
          line-height: 1.6;
        }

        .policy-rate-card {
          padding: 18px 20px;
          border-radius: 14px;
          background:
            linear-gradient(135deg, rgba(99, 102, 241, 0.06), rgba(20, 184, 166, 0.04)),
            rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(99, 102, 241, 0.18);
          margin-bottom: 22px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          position: relative;
          overflow: hidden;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.02);
        }

        .policy-rate-card::after {
          content: "";
          position: absolute;
          top: -40%;
          right: -10%;
          width: 240px;
          height: 240px;
          background: radial-gradient(circle, rgba(99, 102, 241, 0.18), transparent 60%);
          pointer-events: none;
          filter: blur(6px);
        }

        .policy-lbl {
          font-size: 10.5px;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 600;
        }

        .policy-val {
          font-size: 38px;
          font-weight: 800;
          line-height: 1;
          letter-spacing: -0.03em;
          margin-top: 4px;
        }

        .policy-meta {
          margin-top: 6px;
          font-size: 11px;
          color: var(--text-muted);
        }

        .policy-gauge {
          position: relative;
          flex-shrink: 0;
          opacity: 0.95;
        }

        .market-rates-list {
          display: flex;
          flex-direction: column;
          gap: 2px;
          margin-top: 4px;
        }

        .market-rate-row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 14px;
          padding: 12px 14px;
          background: rgba(255, 255, 255, 0.012);
          border: 1px solid transparent;
          border-radius: 10px;
          font-size: 13px;
          transition: var(--transition-smooth);
          align-items: center;
        }

        .market-rate-row:hover {
          background: rgba(255, 255, 255, 0.035);
          border-color: var(--border-glass);
          transform: translateX(2px);
        }

        .market-rate-meta {
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
        }

        .rate-lbl {
          color: var(--text-secondary);
          font-weight: 500;
        }

        .market-rate-bar {
          height: 6px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 3px;
          overflow: hidden;
          position: relative;
        }

        .market-rate-bar-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 0.5s ease;
          position: relative;
        }

        .market-rate-bar-fill::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.18));
          border-radius: 3px;
        }

        .market-rate-bar-fill.bar-emerald { background: linear-gradient(90deg, #10b981, #14b8a6); box-shadow: 0 0 8px rgba(16,185,129,0.35); }
        .market-rate-bar-fill.bar-cyan { background: linear-gradient(90deg, #06b6d4, #3b82f6); box-shadow: 0 0 8px rgba(6,182,212,0.35); }
        .market-rate-bar-fill.bar-amber { background: linear-gradient(90deg, #f59e0b, #fbbf24); box-shadow: 0 0 8px rgba(245,158,11,0.35); }
        .market-rate-bar-fill.bar-rose { background: linear-gradient(90deg, #f43f5e, #ec4899); box-shadow: 0 0 8px rgba(244,63,94,0.35); }

        .market-rate-figures {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }

        .rate-margin {
          font-size: 10.5px;
          color: var(--text-muted);
          background: rgba(255, 255, 255, 0.04);
          padding: 3px 7px;
          border-radius: 4px;
          font-family: var(--font-num);
          font-weight: 600;
        }

        .rate-margin[data-sign="pos"] {
          color: var(--color-emerald);
          background: rgba(16, 185, 129, 0.08);
        }

        .rate-margin[data-sign="neg"] {
          color: var(--accent-cyan);
          background: rgba(6, 182, 212, 0.08);
        }

        .rate-val {
          font-weight: 700;
          color: #fff;
          font-family: var(--font-num);
          font-size: 13px;
          min-width: 56px;
          text-align: right;
          letter-spacing: -0.01em;
        }

        .unsplit-details-box {
          margin-top: 22px;
          padding: 18px 18px;
          background: rgba(255, 255, 255, 0.018);
          border: 1px solid var(--border-glass);
          border-radius: 12px;
        }

        .details-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          font-size: 13px;
        }

        .details-list-row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
        }

        .details-lbl {
          color: var(--text-secondary);
        }

        .details-val {
          font-weight: 600;
          color: #fff;
          font-family: var(--font-num);
          text-align: right;
        }

        .details-tag {
          font-weight: 500;
          color: var(--text-secondary);
          font-size: 12px;
          margin-left: 2px;
        }

        .action-buttons {
          margin-top: 24px;
          display: flex;
          gap: 12px;
        }

        @media (max-width: 520px) {
          .market-rate-figures {
            flex-direction: column;
            align-items: flex-end;
            gap: 4px;
          }
          .policy-rate-card {
            flex-direction: column;
            align-items: flex-start;
            gap: 12px;
          }
          .policy-val { font-size: 32px; }
        }
      `}</style>
    </div>
  );
}
