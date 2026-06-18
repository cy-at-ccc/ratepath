"use client";

import Link from "next/link";
import { nzProfile } from "@mortgage/country-adapters";

export default function About() {
  return (
    <div className="about-container">
      <header className="about-header">
        <h1 className="page-title gradient-text-primary">关于 RatePath</h1>
        <p className="subtitle">了解 RatePath 的本地优先设计理念、市场配置与使用条款。</p>
        <p className="effective-date"><strong>本声明生效日期：</strong>2026-06-19</p>
      </header>

      <div className="about-grid">

        {/* Market Config */}
        <section className="glass-panel config-section accent-primary">
          <h2 className="section-title"><span className="step-num">1</span>本地化与市场配置</h2>

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

        {/* Features at a glance */}
        <section className="glass-panel features-section accent-cyan">
          <h2 className="section-title"><span className="step-num">2</span>功能概览</h2>
          <div className="card-body">
            <ul>
              <li><strong>多情景利率模拟</strong>：根据 OCR 短期变化、中期方向、变化速度与不确定性四条滑块生成低 / 基准 / 高三条未来 OCR 路径，并按用户自定义概率权重汇总期望指标。</li>
              <li><strong>蒙特卡洛长期路径</strong>：在 36 个月以后用蒙特卡洛随机抽样生成可能更长的路径，每次运行的样本是概率性结果，<strong>不构成对未来事实的预测</strong>。</li>
              <li><strong>拆分策略枚举与排序</strong>：在您设置的拆分数、浮动比例上限、固定期限比例下限等约束下穷举候选 split，并按 Pareto 多目标（成本、最坏利息、最坏月供、refix 集中度、爆预算次数、本金压缩速度、浮动比例）排序。</li>
              <li><strong>实时偏好加权</strong>：7 个偏好权重滑块（成本稳定性 / 灵活性 / ...）实时影响"偏好匹配推荐"卡的排序，但不重新跑模拟。</li>
              <li><strong>本地化计算与存储</strong>：所有演算、评分、排序均在您的设备后台线程（Web Worker）中完成，结果只写到您的 IndexedDB / localStorage。</li>
            </ul>
          </div>
        </section>

        {/* Privacy at a glance */}
        <section className="glass-panel privacy-section accent-cyan">
          <h2 className="section-title"><span className="step-num">3</span>数据隐私与离线原则</h2>
          <div className="card-body">
            <p><strong>RatePath 严格遵循"本地优先"的隐私安全原则：</strong></p>
            <ul>
              <li><strong>零数据上传</strong>：您录入的所有房贷金额、分包（Tranches）余额、还款利率和额外还款计划，<strong>仅保存在您当前浏览器的 IndexedDB 本地数据库</strong>，绝不会上传至任何云端服务器。</li>
              <li><strong>无数据库设计</strong>：本系统在后端不设置任何收集用户信息的数据库，不强制要求用户注册登录。</li>
              <li><strong>安全沙箱</strong>：所有房贷摊销演算、拆分组合的概率评分与 Pareto Frontier 过滤，均在您本地设备的后台线程（Web Worker）中完成。</li>
            </ul>
          </div>
        </section>

        {/* Disclaimer summary + link to full text */}
        <section className="glass-panel disclaimer-section accent-amber" style={{ gridColumn: "1 / -1" }}>
          <h2 className="section-title"><span className="step-num">4</span>使用条款与免责声明（摘要）</h2>
          <div className="card-body">
            <p><strong>使用 RatePath 前请理解：本应用是一款本地运行的数学模拟工具，不提供任何形式的金融建议或承诺。</strong></p>
            <ul>
              <li><strong>纯仿真、零质量保证</strong>：所有曲线、数值、推荐排序均为参数化数学演算与蒙特卡洛随机样本，<strong>不代表</strong>新西兰央行（RBNZ）、任何商业银行或权威机构的预测、报价或背书。</li>
              <li><strong>结果可能与实际偏差显著</strong>：期望利息、月供波动性、剩余本金等指标受您输入的假设、概率权重、模型参数影响；宏观政策、通胀、银行流动性等真实因素均未被建模。</li>
              <li><strong>不构成金融建议</strong>：推荐方案（偏好匹配、最低成本、最稳供款等）只是数学排序结果，<strong>不构成</strong>明示或暗示的专业金融、借贷、税务或法律建议。</li>
              <li><strong>用户自负决策责任</strong>：在签署任何贷款合同、固定利率展期或提前还款前，请以银行正式报价为准并咨询持牌专业人士。</li>
              <li><strong>不承担责任</strong>：在法律允许的最大范围内，对于因使用、无法使用或依赖本应用输出而产生的任何直接或间接损失，本应用概不承担责任。</li>
            </ul>
            <p className="legal-link-row">
              <Link href="/legal/disclaimer" className="legal-link">阅读完整免责声明与使用条款 →</Link>
              <Link href="/legal/privacy" className="legal-link">阅读完整隐私声明 →</Link>
            </p>
          </div>
        </section>

        {/* Version & Build Info */}
        <section className="glass-panel version-section accent-emerald" style={{ gridColumn: "1 / -1" }}>
          <h2 className="section-title"><span className="step-num">5</span>版本与构建信息</h2>
          <div className="detail-row">
            <span className="detail-lbl">应用版本</span>
            <span className="detail-val">0.2.0（Beta）</span>
          </div>
          <div className="detail-row">
            <span className="detail-lbl">构建编号</span>
            <span className="detail-val">{typeof process !== "undefined" && process.env.NEXT_PUBLIC_BUILD_ID ? process.env.NEXT_PUBLIC_BUILD_ID : "dev"}</span>
          </div>
          <div className="detail-row">
            <span className="detail-lbl">Next.js 版本</span>
            <span className="detail-val">16.2.9</span>
          </div>
          <div className="detail-row">
            <span className="detail-lbl">版本状态</span>
            <span className="detail-val">Beta 版（功能与条款仍在迭代中，请定期查看本页）</span>
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
