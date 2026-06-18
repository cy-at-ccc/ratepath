"use client";

import Link from "next/link";

export default function PrivacyPolicy() {
  const buildId = typeof process !== "undefined" && process.env.NEXT_PUBLIC_BUILD_ID
    ? process.env.NEXT_PUBLIC_BUILD_ID
    : "dev";

  return (
    <div className="legal-container">
      <header className="legal-header">
        <Link href="/about" className="back-link">← 返回关于</Link>
        <h1 className="title gradient-text-primary">RatePath 隐私声明</h1>
        <p className="meta-row">
          <span><strong>生效日期：</strong>2026-06-17</span>
          <span><strong>版本：</strong>{buildId}</span>
        </p>
      </header>

      <section className="glass-panel legal-section">
        <h2 className="section-title">1. 概述</h2>
        <p>RatePath 是一款<strong>纯本地运行</strong>的房贷策略模拟工具。所有计算都在您的浏览器或 App 中完成，所有您输入的数据都仅保存在您自己的设备上。</p>
        <p>RatePath <strong>不设后端服务器</strong>，<strong>不收集</strong>您的房贷数据、<strong>不收集</strong>您的个人信息，也不会将您输入的任何资料主动上传到任何云端。</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">2. 我们保存在您设备上的内容</h2>
        <p>以下数据默认仅保存在您当前浏览器或 App 的本地存储中：</p>
        <ul>
          <li><strong>房贷配置</strong>（IndexedDB）：总贷款额、分期（Tranche）余额、利率、剩余期限、还款方式（本金+利息 / 仅还利息）、还款频率、额外还款计划；</li>
          <li><strong>情景与策略</strong>（IndexedDB）：您在策略实验室中保存的自定义利率情景、拆分约束条件、推荐偏好权重；</li>
          <li><strong>模拟结果</strong>（IndexedDB）：您主动保存的模拟运行结果与排序输出；</li>
          <li><strong>市场利率</strong>（IndexedDB + localStorage）：您对 OCR 及各档房贷产品利率的自定义数值；</li>
          <li><strong>界面偏好</strong>（localStorage）：导航栏的展开/折叠状态。</li>
        </ul>
        <p>这些数据完全由您控制。您随时可以通过清除浏览器站点数据、清除本地存储或卸载 App 来删除它们，删除后我们无从也无法恢复。</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">3. 我们不收集的内容</h2>
        <p>RatePath 是一款静态前端应用。它<strong>不</strong>：</p>
        <ul>
          <li>向您索要账户、邮箱、手机号或任何身份凭证；</li>
          <li>向任何自有或第三方服务器上传您的房贷输入、模拟结果或偏好数据；</li>
          <li>集成任何分析、统计、广告或行为追踪脚本；</li>
          <li>集成崩溃报告、性能监控、A/B 测试或类似的遥测服务；</li>
          <li>使用任何用于追踪的 Cookie 或类似标识；</li>
          <li>提供账号体系、订阅、付费、内购或登录功能；</li>
          <li>在用户之间共享、同步或交换任何数据。</li>
        </ul>
        <p>由于 RatePath 本身不向任何后端发起业务请求，<strong>它不会主动记录或保存您的 IP 地址、设备标识、浏览器指纹或访问日志</strong>。需要说明的是：托管 RatePath 站点的服务商（如云平台或 ISP）可能按照其自身政策记录基础的网络请求日志（例如来源 IP、请求时间），这部分属于托管方行为，不属于 RatePath 的隐私实践。</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">4. 本地计算</h2>
        <p>所有房贷摊销演算、利率情景生成、拆分组合枚举、模拟矩阵运行与 Pareto 排序，都<strong>仅在您设备的内存与后台线程</strong>（Web Worker）中完成，不依赖任何远程服务。</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">5. 您的控制权</h2>
        <p>由于 RatePath 不持有您的任何数据：</p>
        <ul>
          <li><strong>查看</strong>、<strong>修改</strong>您的本地数据，请直接通过浏览器开发者工具操作；如需<strong>导出</strong>备份，请使用浏览器对 IndexedDB / localStorage 的导出能力（RatePath 本身不提供导出功能）；</li>
          <li><strong>删除</strong>本地数据，请使用浏览器“清除站点数据”功能，或停止使用 RatePath；</li>
          <li>如您认为 RatePath 持有您的个人信息（实际上它并不持有），您仍可依据新西兰《Privacy Act 2020》向新西兰 Office of the Privacy Commissioner 投诉。</li>
        </ul>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">6. 本地数据安全</h2>
        <p>本地数据的安全由您设备的整体安全状况决定，包括但不限于设备锁屏、操作系统更新、浏览器安全设置、备份习惯以及是否在共享设备上使用。</p>
        <p>RatePath 在传输层使用 HTTPS 加载静态资源，但<strong>不向外部传输任何用户数据</strong>。任何在线服务都无法保证绝对安全，请避免在不受信任的设备或公共网络上保存敏感财务信息。</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">7. 共同借款人 / 第三方资料</h2>
        <p>RatePath 面向能够独立做出贷款决策的成年人。请勿在未获授权的情况下输入共同借款人、担保人、未成年人或其他第三方的个人信息。</p>
        <p>如果您代表他人输入信息，您确认已获得适当授权并已向该人说明相关处理方式。</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">8. 变更</h2>
        <p>我们可能因功能、依赖或法律变化更新本声明。重大变化会通过本页顶部注明的版本号与生效日期体现。建议您定期查看本页。版本号更新后继续使用 RatePath 即视为您接受当时的最新版本。</p>
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
