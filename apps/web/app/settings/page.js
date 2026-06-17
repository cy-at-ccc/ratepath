"use client";

import { nzProfile } from "@mortgage/country-adapters";

export default function Settings() {
  return (
    <div className="settings-container">
      <header className="settings-header">
        <h1 className="title">系统设置 & 声明</h1>
        <p className="subtitle">管理系统偏好设置并查阅安全与合规声明。</p>
      </header>

      <div className="settings-grid">
        
        {/* Market Config */}
        <section className="glass-panel config-section">
          <h2 className="section-title">本地化与市场配置</h2>
          
          <div className="detail-row">
            <span className="detail-lbl">适用房贷市场</span>
            <span className="detail-val">新西兰 (New Zealand)</span>
          </div>
          <div className="detail-row">
            <span className="detail-lbl">本位货币符号</span>
            <span className="detail-val">NZD ($)</span>
          </div>
          <div className="detail-row">
            <span className="detail-lbl">首选地区语言</span>
            <span className="detail-val">{nzProfile.locale}</span>
          </div>
          <div className="detail-row">
            <span className="detail-lbl">系统默认时区</span>
            <span className="detail-val">{nzProfile.timezone}</span>
          </div>
          <div className="detail-row">
            <span className="detail-lbl">核心算法配置版本</span>
            <span className="detail-val">{nzProfile.modelConfigVersion}</span>
          </div>
        </section>

        {/* Privacy Section */}
        <section className="glass-panel privacy-section">
          <h2 className="section-title">数据隐私与离线原则</h2>
          <div className="card-body">
            <p><strong>RatePath 严格遵循“本地优先”的隐私安全原则：</strong></p>
            <ul>
              <li><strong>零数据上传</strong>：您录入的所有房贷金额、分包（Tranches）余额、还款利率和额外还款计划，**仅保存在您当前浏览器的 IndexedDB 本地数据库中**，绝不会上传至任何云端服务器。</li>
              <li><strong>无数据库设计</strong>：本系统在后端不设置任何收集用户信息的数据库，不强制要求用户注册登录，完美保障您的个人财务隐私。</li>
              <li><strong>安全沙箱</strong>：所有房贷摊销演算、拆分组合的概率评分与 Pareto Frontier 过滤，均在您本地设备的后台线程（Web Worker）中完成。</li>
            </ul>
          </div>
        </section>

        {/* Disclaimer Section */}
        <section className="glass-panel disclaimer-section" style={{ gridColumn: "1 / -1" }}>
          <h2 className="section-title">免责声明</h2>
          <div className="card-body">
            <p><strong>在使用本模拟器进行决策前，请务必仔细阅读以下免责声明：</strong></p>
            <ul>
              <li>本系统所展示的利率预期曲线（Low、Base、High）是由用户操作滑块所产生的参数化数学演算结果，**并非新西兰央行（RBNZ）或任何商业银行的未来利率预测或确定性承诺**。</li>
              <li>模拟计算输出的“期望利息成本”和“月供波动性指标”是基于历史 OCR 传导系数（Betas）与特定概率权重的理论期望值。实际经济环境可能会受宏观政策、通胀变化及各商业银行流动性影响，导致实际执行利率与模拟结果产生偏差。</li>
              <li>本模拟器所提供的三种推荐方案（偏好推荐、最低成本、最稳健还款）是基于多指标归一化评分算法作出的确定性数学排序，**不构成任何明示或暗示的专业金融、借贷或税务建议**。</li>
              <li>在签署任何贷款合同、固定利率展期（Refix）或进行提前还款前，建议您结合各大银行的正式报价，并咨询专业的房贷经纪人或持牌理财规划师。对于因使用本系统仿真数据做决策而引起的任何财务损失，本系统概不承担任何法律责任。</li>
            </ul>
          </div>
        </section>

      </div>

      <style jsx>{`
        .settings-container {
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

        .settings-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
          gap: 24px;
        }

        .section-title {
          font-size: 16px;
          font-weight: 700;
          color: #fff;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          padding-bottom: 8px;
          margin-bottom: 16px;
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
