"use client";

import Link from "next/link";

export default function Disclaimer() {
  return (
    <div className="legal-container">
      <header className="legal-header">
        <Link href="/about" className="back-link">← 返回关于</Link>
        <h1 className="title gradient-text-primary">RatePath 金融模型免责声明与使用条款</h1>
        <p className="meta-row">
          <span><strong>生效日期：</strong>2026-06-17</span>
        </p>
      </header>

      <section className="glass-panel legal-section">
        <h2 className="section-title">1. 工具性质</h2>
        <p>RatePath 提供数学计算、情景建模和结果比较功能。其输出基于：</p>
        <ul>
          <li>您提供的数据；</li>
          <li>您选择或调整的利率情景；</li>
          <li>公共市场数据；</li>
          <li>模型参数；</li>
          <li>概率、期限、还款及产品规则假设。</li>
        </ul>
        <p>输出描述在特定假设成立时可能产生的模拟结果，不是对未来事实的陈述。</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">2. 不保证未来利率或结果</h2>
        <p>OCR、Swap Rate、银行资金成本、银行利差和房贷报价可能随时变化。历史数据、官方预测、市场预期和统计关系均不能保证未来表现。</p>
        <p>所有金额、期限、节省额、还清日期、风险分数和概率仅为模型估计。实际结果可能与模型结果存在重大差异。</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">3. 不构成银行报价或贷款批准</h2>
        <p>RatePath 不是银行，也不代表任何银行作出承诺。页面上的利率不构成：</p>
        <ul>
          <li>正式贷款报价；</li>
          <li>预先批准或无条件批准；</li>
          <li>对用户资格的确认；</li>
          <li>对任何银行产品可得性的保证；</li>
          <li>对续期、再融资或固定利率申请将被接受的保证。</li>
        </ul>
        <p>实际利率和资格由相关贷款机构决定。</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">4. 模型未必包含所有成本和条件</h2>
        <p>除非页面明确显示已纳入计算，否则结果可能不包括：</p>
        <ul>
          <li>Break Cost 或 Early Repayment Cost；</li>
          <li>设立、估值、法律及经纪费用；</li>
          <li>Cashback 退还；</li>
          <li>低净值利率或 LVR 调整；</li>
          <li>提前还款上限；</li>
          <li>Offset 或 Revolving Credit 特殊规则；</li>
          <li>利息计算日、复利和舍入差异；</li>
          <li>税务、保险、汇率或房产交易成本；</li>
          <li>银行内部审批和定价政策；</li>
          <li>未来法律、监管或市场变化。</li>
        </ul>
        <p>用户应查阅贷款合同和银行正式文件。</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">5. 模型排序标签</h2>
        <p>“最低期望成本”、“最稳妥供款”、“最快模拟还清”和“自选权重平衡结果”等标签，仅描述模型在所选情景和评价指标下的数学排序。</p>
        <p>它们不代表：</p>
        <ul>
          <li>某方案适合所有用户；</li>
          <li>某方案必然优于其他方案；</li>
          <li>某方案是唯一合理选择；</li>
          <li>某结果能够保证节省；</li>
          <li>我们已调查您的全部财务状况、需求、法律义务或风险承受能力。</li>
        </ul>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">6. 专业意见</h2>
        <p>在签订、变更、续期、拆分、提前终止或再融资任何贷款前，您应：</p>
        <ul>
          <li>获取贷款机构的正式报价；</li>
          <li>阅读合同及费用条款；</li>
          <li>核实提前还款、Offset 和 Break Cost 规则；</li>
          <li>考虑咨询依法有资格提供相关服务的金融建议提供者、律师、会计师或其他专业人士。</li>
        </ul>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">7. 用户责任</h2>
        <p>您负责：</p>
        <ul>
          <li>输入完整、准确和最新的资料；</li>
          <li>选择合理的模型假设；</li>
          <li>独立核实市场数据和结果；</li>
          <li>评估自身还款能力；</li>
          <li>阅读并遵守贷款合同；</li>
          <li>决定是否依赖模型结果；</li>
          <li>保留必要的资料备份。</li>
        </ul>
        <p>不得将 RatePath 作为作出贷款决定的唯一依据。</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">8. 利率数据来源</h2>
        <p>RatePath <strong>不接入任何外部市场数据源</strong>。页面展示的利率（含 OCR、Swap Rate、各档产品利率）仅来自两类来源：(1) 应用内置的演示默认值，仅供示意，不来自 RBNZ、贷款机构或任何数据提供商的实时或历史报价；(2) 您在仪表盘页面对各项利率的手动调整。这些数值<strong>不构成</strong>任何市场报价、预测或对实际银行挂牌利率的引用。</p>
        <p>RatePath 不向用户展示任何第三方链接、商标或外部内容；本节提及 RBNZ、贷款机构、数据供应商等概念，仅用于说明本应用不依赖外部数据源，不代表 RatePath 与上述任何机构存在合作、认可或背书关系。</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">9. 服务可用性和技术风险</h2>
        <p>我们不保证 RatePath 始终不间断、没有错误、与所有设备或浏览器版本兼容，也不保证您的本地数据永不丢失。</p>
        <p>应用维护、浏览器限制或更新、设备故障、网络中断、您对本机存储的清理（包括清除浏览器站点数据、卸载或切换浏览器），或软件缺陷，都可能影响您对 RatePath 的使用和结果。</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">10. 法定消费者权利</h2>
        <p>本条款不排除、限制或修改新西兰法律规定不能合法排除、限制或修改的任何权利或救济，包括适用的 Fair Trading Act 1986 和 Consumer Guarantees Act 1993 权利。</p>
        <p>如本条款与不可排除的法律权利冲突，应以该法律权利为准。</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">11. 责任限制</h2>
        <p>RatePath 是一款<strong>免费、本地运行</strong>的模拟工具，它不向您收取任何费用，也不保存您的任何个人数据。基于此事实：</p>
        <ul>
          <li>在法律允许的最大范围内，对于因使用、无法使用或依赖 RatePath、其模型或您自行输入的市场数据而产生的间接、附带、特殊或后果性损失（包括但不限于利润、机会、融资成本、决策偏差或预期节省损失），我们不承担责任。</li>
          <li>由于 RatePath 不会持有您的本地数据，因设备故障、浏览器数据被清除、卸载 App 等原因导致的数据丢失，由您自行承担。</li>
          <li>在法律允许限制责任的情况下，我们对与 RatePath 有关的全部索赔承担的累计责任上限不超过 NZ$100，或者您在导致索赔事件前 12 个月内实际向我们支付的费用（以较高者为准；鉴于 RatePath 目前免费，原则上为 NZ$100）。</li>
        </ul>
        <p>本限制<strong>不适用于</strong>法律禁止排除或限制的责任，包括新西兰《Consumer Guarantees Act 1993》和《Fair Trading Act 1986》赋予的、不可通过合同排除的法定权利。如本条款与不可排除的法律权利冲突，应以该法律权利为准。</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">12. 无代理或受托关系</h2>
        <p>除非另有明确书面协议，使用 RatePath 不会在您与我们之间建立：</p>
        <ul>
          <li>银行与借款人关系；</li>
          <li>经纪或代理关系；</li>
          <li>律师—客户关系；</li>
          <li>会计师—客户关系；</li>
          <li>受托关系；</li>
          <li>代表任何贷款机构谈判或提交申请的授权。</li>
        </ul>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">13. 可接受使用</h2>
        <p>您不得：</p>
        <ul>
          <li>干扰、逆向攻击或规避服务安全；</li>
          <li>使用自动化方式滥用服务；</li>
          <li>输入无权使用的他人资料；</li>
          <li>将模型输出误述为银行报价、保证或受监管建议；</li>
          <li>将服务用于违法、欺诈或误导活动。</li>
        </ul>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">14. 条款变更</h2>
        <p>我们可能因服务、法律或监管变化更新条款。重大变化将以合理方式通知。继续使用服务代表您接受当时有效的条款，但该接受不影响您依法享有的不可排除权利。</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">15. 适用法律</h2>
        <p>在不影响消费者根据其他强制性法律享有的权利的前提下，本条款受新西兰法律管辖，新西兰法院具有非专属管辖权。</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">16. 可分割性</h2>
        <p>如果某项条款被认定为无效或不可执行，其余条款继续有效；无效条款应在法律允许的范围内作最小必要调整。</p>
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

        .title {
          font-size: 26px;
          font-weight: 800;
          color: #fff;
          margin: 0;
          letter-spacing: -0.02em;
          line-height: 1.2;
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
