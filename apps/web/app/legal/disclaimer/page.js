"use client";

import Link from "next/link";

export default function Disclaimer() {
  return (
    <div className="legal-container">
      <header className="legal-header">
        <Link href="/about" className="back-link">← 返回关于</Link>
        <h1 className="page-title gradient-text-primary">RatePath 金融模型免责声明与使用条款</h1>
        <p className="meta-row">
          <span><strong>生效日期：</strong>2026-06-19</span>
          <span><strong>应用版本：</strong>0.2.0（Beta）</span>
        </p>
      </header>

      <section className="glass-panel legal-section highlight-warning">
        <h2 className="section-title">0. 仿真性质与无质量保证（请先阅读）</h2>
        <p>RatePath 是一款<strong>完全本地运行</strong>的房贷策略<strong>数学模拟工具</strong>，按"现状"（AS IS）提供。在法律允许的最大范围内：</p>
        <ul>
          <li><strong>所有输出均为模拟结果</strong>，包括但不限于：利率路径、OCR 预测、期望利息、月供曲线、剩余本金、风险指标、Pareto 排序与"推荐方案"。它们由参数化模型与蒙特卡洛随机抽样生成，<strong>不构成</strong>对未来事实、市场利率、银行报价、贷款资格或投资收益的预测、保证或陈述。</li>
          <li><strong>零质量保证（No Warranty）</strong>：本应用对其输出的<strong>准确性、可靠性、完整性、时效性、适销性、特定用途适用性</strong>不作任何明示或暗示的保证。所有结果按"原样"提供，可能包含错误、遗漏或与现实显著偏离的内容。</li>
          <li><strong>不进行质量控制</strong>：本应用不对任何输出执行金融机构级别的<strong>校验、复核、审计或质量控制流程</strong>。您不应假设任何输出已通过独立验证。</li>
          <li><strong>Beta 版本</strong>：当前 v0.2.0 仍处于 Beta 阶段，模型、参数与界面均在持续迭代，输出可能随版本变化而显著变化。</li>
          <li><strong>不构成专业建议</strong>：本应用不提供金融、借贷、税务、法律或投资建议。所有"推荐"仅为数学排序结果，<strong>不构成</strong>任何明示或暗示的咨询意见。</li>
        </ul>
        <p>继续使用 RatePath 即表示您已理解并接受上述条款。</p>
      </section>

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
        <h2 className="section-title">1A. 蒙特卡洛模拟的概率性质</h2>
        <p>RatePath 在 36 个月以后的长期路径预测中使用<strong>蒙特卡洛随机抽样</strong>：</p>
        <ul>
          <li>每次运行会从用户定义的不确定性带中抽取一组样本路径，<strong>每次运行的输出可能不同</strong>；</li>
          <li>蒙特卡洛输出<strong>仅描述概率分布</strong>（如分位数、置信区间），不代表任何"最可能"或"应当发生"的未来路径；</li>
          <li>样本数量、随机种子与抽样的具体分布均由 RatePath 模型内置决定，<strong>不构成</strong>对真实经济过程的统计建模或预测。</li>
        </ul>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">1B. 情景概率权重由用户控制</h2>
        <p>低 / 基准 / 高三条 OCR 路径以及它们的概率权重（默认 15% / 70% / 15%）<strong>由您设定或调整</strong>，不来自任何市场数据源、央行或第三方机构：</p>
        <ul>
          <li>RatePath 不获取、不存储、不验证您设置的权重数值；</li>
          <li>改变权重<strong>不</strong>意味着市场预期发生改变，它只是改变您查看综合期望指标时的混合方式；</li>
          <li>汇总后的"期望"指标是数学加权结果，<strong>不是</strong>对现实发生概率的统计估计。</li>
        </ul>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">2. 不保证未来利率或结果</h2>
        <p>OCR、Swap Rate、银行资金成本、银行利差和房贷报价可能随时变化。历史数据、官方预测、市场预期和统计关系均不能保证未来表现。</p>
        <p>所有金额、期限、节省额、还清日期、风险分数和概率仅为模型估计，<strong>无任何准确性或合理性的保证</strong>。实际结果可能与模型结果存在重大差异，包括但不限于：利率升高、贷款被拒、合同条款与模型假设不符、银行政策变化等。</p>
      </section>

      <section className="glass-panel legal-section">
        <h2 className="section-title">2A. 模型局限</h2>
        <p>RatePath 的模型存在以下已知局限，<strong>任何忽略这些局限而依赖输出的决策均被视为用户自行承担风险</strong>：</p>
        <ul>
          <li>OCR 传导系数（Betas）是基于<strong>历史观测</strong>的统计估计，<strong>不保证</strong>未来银行实际报价会以相同幅度跟随 OCR；</li>
          <li>36 个月后路径默认使用蒙特卡洛抽样 + 平滑趋势，<strong>不代表</strong>任何具体的宏观经济情景；</li>
          <li>固定产品利率在 refix 月使用<strong>当月 OCR 水平</strong>重新定价，<strong>不模拟</strong>银行内部的流动性溢价、关系定价或促销活动；</li>
          <li>还款频次匹配规则在摊销器中按"匹配按揭还款频次"实现，<strong>不</strong>支持每次额外还款的独立频次；</li>
          <li>目标付款模式（payment-mode）只在显式启用时触发超额还款，<strong>不</strong>等同于 Offset 账户的即时冲抵；</li>
          <li>模型<strong>不</strong>模拟税务、保险、利率 cap/collar 衍生品、汇率、跨币种贷款或司法冻结等场景。</li>
        </ul>
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
        <p><strong>RatePath 不提供、也不替代</strong>金融、借贷、税务、法律或投资领域的专业意见。任何使用本应用输出进行决策的行为，均应被视为：在未取得专业意见的情况下自行做出的判断。</p>
        <p>在签订、变更、续期、拆分、提前终止或再融资任何贷款前，您应：</p>
        <ul>
          <li>获取贷款机构的正式书面报价；</li>
          <li>阅读合同及费用条款，特别是 Break Cost、Early Repayment Cost 与 Offset 条款；</li>
          <li>考虑咨询依法有资格提供相关服务的金融建议提供者、律师、会计师或其他专业人士；</li>
          <li>对模型输出的<strong>每一项数字</strong>独立核实，不应假设任何数字已经过验证。</li>
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
          <li><strong>无质量保证</strong>：在法律允许的最大范围内，本应用<strong>不作任何</strong>关于其输出准确性、可靠性、完整性、可用性或特定用途适用性的保证。</li>
          <li><strong>无间接损失责任</strong>：对于因使用、无法使用或依赖 RatePath、其模型或您自行输入的市场数据而产生的<strong>间接、附带、特殊、惩罚性或后果性损失</strong>（包括但不限于利润损失、机会损失、融资成本上升、决策偏差、预期节省落空、信用受损、合同损失），我们<strong>不承担责任</strong>。</li>
          <li><strong>无直接损失责任（在法律允许范围内）</strong>：对于可归因于本应用模拟错误或界面缺陷的<strong>直接损失</strong>，在法律允许限制责任的情况下，我们承担的累计责任上限不超过 NZ$100，或者您在导致索赔事件前 12 个月内实际向我们支付的费用（以较高者为准；鉴于 RatePath 目前免费，原则上为 NZ$100）。</li>
          <li><strong>本地数据丢失由用户承担</strong>：由于 RatePath 不会持有您的本地数据，因设备故障、浏览器数据被清除、卸载 App、操作系统重装、浏览器更新不兼容等原因导致的数据丢失、IndexedDB 损坏或迁移失败，<strong>由您自行承担</strong>。</li>
          <li><strong>您应自行备份</strong>：RatePath 不提供云备份服务。建议您定期通过浏览器开发者工具导出 IndexedDB 内容。</li>
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
