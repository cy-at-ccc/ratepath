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
          <h1 className="welcome-title">房贷控制面板</h1>
          <p className="welcome-desc">分析您的贷款配置并进行未来情景演练。</p>
        </div>
        <div className="market-updated badge badge-emerald">
          数据源: RBNZ MPS (更新于 {marketPolicyRateDate})
        </div>
      </header>

      {/* Main Grid */}
      <div className="dashboard-grid">
        
        {/* Left Side: Personal Mortgage Overview */}
        <section className="glass-panel summary-card">
          <h2 className="card-header">贷款总览</h2>
          {mortgage ? (
            <div className="mortgage-details">
              <div className="metric-row">
                <span className="metric-lbl">贷款总额</span>
                <span className="metric-val">${calculateTotalBalance().toLocaleString()}</span>
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
              <div className="unsplit-details-box" style={{ marginTop: "24px", padding: "16px", background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border-glass)", borderRadius: "12px" }}>
                <h3 className="section-subtitle" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "6px", marginBottom: "12px" }}>基础贷款参数</h3>
                
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-secondary)" }}>当前执行利率</span>
                    <span style={{ fontWeight: "600", color: "var(--color-primary)" }}>{(marketRates.floating * 100).toFixed(2)}% (浮动利率)</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-secondary)" }}>还款期限目标</span>
                    <span style={{ fontWeight: "600", color: "#fff" }}>
                      {Math.floor(mortgage.originalTermMonths / 12)}年
                      {mortgage.originalTermMonths % 12 > 0 ? ` ${mortgage.originalTermMonths % 12}个月` : ""}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-secondary)" }}>还款类型</span>
                    <span style={{ fontWeight: "600", color: "#fff" }}>
                      {mortgage.repaymentType === "principal-and-interest" ? "本金加利息 (P&I)" : "仅还利息 (Interest Only)"}
                    </span>
                  </div>
                </div>
              </div>
              <div className="action-buttons" style={{ marginTop: "30px", display: "flex", gap: "12px" }}>
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
              <div className="prompt-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>
              </div>
              <h3>暂无贷款数据</h3>
              <p>请先添加您的贷款基本分包（Tranche）详情，以便对其进行未来的情景利息开销模拟。</p>
              <Link href="/mortgage-setup" className="btn btn-primary" style={{ marginTop: "20px" }}>
                立即配置房贷
              </Link>
            </div>
          )}
        </section>

        {/* Right Side: Market Rates Overview */}
        {!isEditingRates ? (
          <section className="glass-panel market-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h2 className="card-header" style={{ margin: 0 }}>新西兰当前市场数据</h2>
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
            
            <div className="policy-rate-card glass-panel" style={{ background: "rgba(255,255,255,0.02)", marginBottom: "24px" }}>
              <div className="policy-lbl">{marketPolicyRateName} (新西兰央行官方现金利率)</div>
              <div className="policy-val">{(marketRates.ocr * 100).toFixed(2)}%</div>
            </div>

            <h3 className="section-subtitle">主要银行平均房贷报价</h3>
            <div className="market-rates-list">
              {[
                { key: "floating", label: "浮动利率 (Floating)" },
                { key: "fixed-6m", label: "6 个月固定 (6 Months)" },
                { key: "fixed-1y", label: "1 年固定 (1 Year Fixed)" },
                { key: "fixed-18m", label: "18 个月固定 (18 Months Fixed)" },
                { key: "fixed-2y", label: "2 年固定 (2 Years Fixed)" },
                { key: "fixed-3y", label: "3 年固定 (3 Years Fixed)" },
                { key: "fixed-5y", label: "5 年固定 (5 Years Fixed)" }
              ].map((item) => {
                const rate = /** @type {any} */ (marketRates)[item.key];
                const margin = rate - marketRates.ocr;
                const marginSign = margin >= 0 ? "+" : "";
                return (
                  <div key={item.key} className="market-rate-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0" }}>
                    <span className="rate-lbl" style={{ fontSize: "13px" }}>{item.label}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span className="badge" style={{ fontSize: "11px", color: "var(--text-secondary)", background: "rgba(255,255,255,0.04)", padding: "2px 6px", borderRadius: "4px" }}>
                        OCR {marginSign}{(margin * 100).toFixed(2)}%
                      </span>
                      <span className="rate-val" style={{ fontWeight: "600" }}>{(rate * 100).toFixed(2)}%</span>
                    </div>
                  </div>
                );
              })}
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
          <section className="glass-panel market-card">
            <h2 className="card-header" style={{ marginBottom: "16px" }}>自定义当前市场利率</h2>
            
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
        }

        .welcome-desc {
          font-size: 14px;
          color: var(--text-secondary);
          margin-top: 4px;
        }

        .card-header {
          font-size: 18px;
          font-weight: 700;
          color: #fff;
          margin-bottom: 20px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          padding-bottom: 12px;
        }

        .section-subtitle {
          font-size: 14px;
          font-weight: 600;
          color: #fff;
          margin-bottom: 12px;
        }

        .metric-row {
          display: flex;
          justify-content: space-between;
          padding: 12px 0;
          border-bottom: 1px solid rgba(255,255,255,0.03);
          font-size: 14px;
        }

        .metric-lbl {
          color: var(--text-secondary);
        }

        .metric-val {
          font-weight: 600;
          color: #fff;
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
          align-items: center;
          text-align: center;
          padding: 40px 20px;
        }

        .prompt-icon {
          width: 80px;
          height: 80px;
          border-radius: 50%;
          background: rgba(99, 102, 241, 0.08);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 20px;
        }

        .setup-prompt h3 {
          font-size: 18px;
          color: #fff;
          margin-bottom: 10px;
        }

        .setup-prompt p {
          font-size: 13px;
          color: var(--text-secondary);
          max-width: 320px;
          line-height: 1.6;
        }

        .policy-rate-card {
          padding: 16px;
          border-radius: 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .policy-lbl {
          font-size: 11px;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .policy-val {
          font-size: 28px;
          font-weight: 800;
          color: var(--color-primary);
        }

        .market-rates-list {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .market-rate-row {
          display: flex;
          justify-content: space-between;
          padding: 10px 12px;
          background: rgba(255,255,255,0.01);
          border-radius: 6px;
          font-size: 13px;
          transition: var(--transition-smooth);
        }

        .market-rate-row:hover {
          background: rgba(255,255,255,0.03);
        }

        .rate-lbl {
          color: var(--text-secondary);
        }

        .rate-val {
          font-weight: 600;
          color: #fff;
        }
      `}</style>
    </div>
  );
}
