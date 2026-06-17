# 房贷策略模拟 App：MiniMax M3 详细开发计划

> 文件名称建议：`MORTGAGE_STRATEGY_APP_DEVELOPMENT_PLAN.md`  
> 文档版本：1.0  
> 制定日期：2026-06-16  
> 首发市场：新西兰  
> 开发语言：JavaScript  
> Web：Next.js + React  
> Mobile：Expo + React Native  
> AI 开发模型：MiniMax M3  
> AI 开发工具：OpenCode  
> 数据原则：本地优先、无传统数据库 MVP、公共市场数据由轻量后端提供

---

# 0. 本文件的用途

本文件同时作为：

1. 产品开发总规格；
2. 技术架构说明；
3. 金融算法说明；
4. 前后端开发计划；
5. MiniMax M3 开发 Agent 的系统工作指引；
6. 多 Agent 分工和权限配置说明；
7. 各阶段验收标准；
8. 后续代码审查依据。

AI Agent 在开始工作前必须完整阅读本文件，并遵守以下最高优先级规则：

- 不擅自扩大产品范围；
- 不把金融计算逻辑写进 React 页面组件；
- 不把用户贷款数据上传到后端；
- 不在 MVP 中增加传统用户数据库；
- 不把 OCR、NZD 或新西兰固定期限写死在通用计算核心；
- 不使用生成式 AI 直接决定贷款建议；
- 推荐必须来自确定性的数学模拟和评分算法；
- 每一项金融公式必须有单元测试；
- 相同输入在 Web 和 Mobile 必须产生相同结果；
- 未通过测试和审查的阶段不得标记为完成；
- 不允许多个可写 Agent 同时修改同一文件或同一模块。

---

# 1. 产品概述

## 1.1 产品定位

本产品不是普通房贷月供计算器。

它是一个基于多种未来利率情景，对不同贷款固定期限、贷款拆分比例、还款成本、现金流波动和重新定价风险进行模拟比较的房贷策略工具。

核心问题包括：

- 用户的贷款是否应该拆分；
- 应该拆成几份；
- 每一份分别使用浮动、6个月、1年、2年或3年固定；
- 如果未来快速降息、缓慢降息、高利率持续或重新加息，各方案会怎样；
- 哪个方案预期利息最低；
- 哪个方案还款最稳定；
- 哪个方案在多种利率走势下最平衡；
- 预测错误时，哪个方案的风险更小；
- 用户有额外还款计划时，是否应保留浮动或 Offset 部分。

## 1.2 产品必须避免的表述

禁止使用：

- “准确预测 OCR”；
- “保证最优方案”；
- “你一定应该固定两年”；
- “无风险策略”；
- “一定能够节省某个金额”。

建议使用：

- “在当前选择的情景假设下”；
- “预计成本较低”；
- “高利率情景下更稳定”；
- “对预测偏差的敏感度较低”；
- “建议结合银行报价和专业建议决定”。

## 1.3 MVP 目标

MVP 必须允许用户：

1. 输入当前房贷；
2. 输入一笔或多笔贷款 tranche；
3. 使用系统默认利率路径；
4. 通过滑块快速调整未来利率判断；
5. 创建自定义利率路径；
6. 生成低、基准和高利率情景；
7. 设置拆分约束；
8. 本地生成合理拆分组合；
9. 对所有组合进行多情景模拟；
10. 动态获得最低成本、最稳定和综合平衡方案；
11. 查看每个推荐的解释；
12. 查看最高还款、最差情景和 refix 风险；
13. 离线使用已缓存的市场数据；
14. 在 Web、iOS 和 Android 使用相同计算核心。

---

# 2. 产品范围

## 2.1 MVP 包含

- 新西兰房贷市场；
- OCR 作为新西兰政策利率；
- 浮动利率；
- 6个月固定；
- 1年固定；
- 18个月固定，可作为第二优先级；
- 2年固定；
- 3年固定；
- 5年固定，可作为高级选项；
- 本金加利息；
- Interest-only；
- 每周、每两周和每月还款；
- 一笔或多笔现有 tranche；
- 固定到期日；
- 重新固定规则；
- 额外还款；
- 多情景模拟；
- 概率加权；
- 压力测试；
- 动态策略偏好滑块；
- 本地保存；
- 公共利率数据缓存；
- Free/Premium 功能开关预留。

## 2.2 MVP 不包含

- 用户强制登录；
- 用户贷款云端同步；
- 用户收入、资产或贷款信息服务器存储；
- 银行账户连接；
- Open Banking；
- 自动贷款申请；
- 自动联系银行；
- 自动抓取用户个人银行报价；
- 生成式 AI 预测 OCR；
- 生成式 AI 黑盒推荐；
- 实时交易执行；
- 房贷经纪人 CRM；
- 完整付费系统上线；
- 多国家完整产品上线；
- 美国 ARM 和 refinance；
- 澳大利亚 redraw 的完整实现；
- 复杂税务建议。

---

# 3. 核心设计原则

## 3.1 本地优先

以下内容必须在本地设备运行：

- 房贷摊销；
- 利率路径展开；
- 情景生成；
- 拆分组合生成；
- 多情景模拟；
- 方案评分；
- Pareto 筛选；
- 图表数据生成；
- 用户贷款数据；
- 自定义情景；
- 用户偏好；
- 已保存方案。

## 3.2 轻量后端

后端只负责：

- 获取官方公共利率数据；
- 标准化数据；
- 生成版本化 JSON；
- 发布最新市场快照；
- 发布少量历史数据；
- 发布默认模型配置；
- 发布默认情景模板。

## 3.3 无传统数据库 MVP

MVP 后端使用：

- Cloudflare Worker；
- Cloudflare Cron；
- Cloudflare R2；
- 静态 JSON；
- CDN 缓存。

不需要：

- Postgres；
- MySQL；
- MongoDB；
- 用户贷款数据库；
- 长期运行 worker；
- 消息队列。

## 3.4 预测与计算分离

必须分为独立模块：

```text
市场数据
→ Rate Engine
→ 利率情景路径

用户贷款
→ Mortgage Engine
→ 还款现金流

拆分约束
→ Strategy Generator
→ 候选方案

候选方案 × 情景
→ Simulation Engine
→ 模拟结果

模拟结果 + 用户偏好
→ Optimiser
→ 推荐排名
```

## 3.5 国家规则与核心引擎分离

通用计算核心禁止直接写：

```js
ocrPath
nzd
fixed1y
fixed2y
```

应使用：

```js
policyRatePath
currencyCode
productCode
countryAdapter
```

---

# 4. 总体技术架构

```text
┌──────────────────────────────────────────────┐
│  官方公共数据                                 │
│  RBNZ OCR / MPS / B20 / B21 / B30 / B2      │
└───────────────────┬──────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────┐
│  Data Collectors                             │
│  获取、解析、校验、转换                       │
└───────────────────┬──────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────┐
│  Normalisation Layer                         │
│  统一国家、产品、日期、利率格式                │
└───────────────────┬──────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────┐
│  R2 JSON + CDN                               │
│  latest / history / config / scenario        │
└───────────────────┬──────────────────────────┘
                    │
          ┌─────────┴──────────┐
          ▼                    ▼
┌───────────────────┐  ┌──────────────────────┐
│ Next.js Web       │  │ Expo React Native    │
│ IndexedDB         │  │ SQLite/AsyncStorage  │
└─────────┬─────────┘  └──────────┬───────────┘
          └────────────┬──────────┘
                       ▼
┌──────────────────────────────────────────────┐
│ Shared JavaScript Domain Packages            │
│ rate / mortgage / simulation / optimiser     │
└──────────────────────────────────────────────┘
```

---

# 5. 技术栈

## 5.1 语言

使用现代 JavaScript ES Modules。

必须启用：

- JSDoc；
- `checkJs`；
- Zod；
- ESLint；
- Prettier；
- 单元测试；
- 覆盖率检查。

不使用 TypeScript。

## 5.2 Web

- Next.js；
- React；
- JavaScript；
- Zustand；
- React Hook Form；
- Zod；
- Recharts；
- IndexedDB；
- Web Worker。

## 5.3 Mobile

- Expo；
- React Native；
- JavaScript；
- Expo Router；
- Zustand；
- React Hook Form；
- Zod；
- Expo SQLite，优先；
- AsyncStorage，仅保存简单配置；
- Expo 兼容图表库；
- 分批计算，防止阻塞 UI。

## 5.4 测试

建议：

- Vitest：共享包和 Web；
- React Testing Library；
- Jest：如 Expo 环境需要；
- Playwright：Web E2E；
- Maestro 或 Detox：后续 Mobile E2E。

## 5.5 后端

- Cloudflare Workers；
- Cloudflare Cron；
- Cloudflare R2；
- Zod 校验；
- 静态 JSON；
- ETag 和版本号；
- 不使用传统数据库。

---

# 6. Monorepo 结构

```text
mortgage-strategy/
├── apps/
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── features/
│   │   ├── workers/
│   │   └── public/
│   │
│   └── mobile/
│       ├── app/
│       ├── components/
│       ├── features/
│       └── assets/
│
├── packages/
│   ├── mortgage-engine/
│   │   ├── src/
│   │   └── tests/
│   │
│   ├── rate-engine/
│   │   ├── src/
│   │   └── tests/
│   │
│   ├── scenario-engine/
│   │   ├── src/
│   │   └── tests/
│   │
│   ├── strategy-generator/
│   │   ├── src/
│   │   └── tests/
│   │
│   ├── simulation-engine/
│   │   ├── src/
│   │   └── tests/
│   │
│   ├── optimiser/
│   │   ├── src/
│   │   └── tests/
│   │
│   ├── country-adapters/
│   │   ├── core/
│   │   ├── nz/
│   │   └── tests/
│   │
│   ├── schemas/
│   ├── storage/
│   ├── market-data-client/
│   ├── feature-flags/
│   ├── ui-tokens/
│   └── shared-utils/
│
├── services/
│   └── market-data-api/
│       ├── src/
│       │   ├── collectors/
│       │   ├── normalisers/
│       │   ├── publishers/
│       │   ├── routes/
│       │   └── jobs/
│       └── tests/
│
├── docs/
│   ├── decisions/
│   ├── algorithms/
│   ├── testing/
│   └── data-sources/
│
├── .opencode/
│   ├── agents/
│   ├── commands/
│   └── skills/
│
├── AGENTS.md
├── opencode.json
├── jsconfig.json
├── package.json
└── pnpm-workspace.yaml
```

---

# 7. JavaScript 类型安全规则

## 7.1 `jsconfig.json`

```json
{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "strict": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "target": "ES2022",
    "jsx": "preserve",
    "baseUrl": ".",
    "paths": {
      "@mortgage/*": ["packages/*/src"]
    }
  },
  "exclude": [
    "node_modules",
    "dist",
    ".next",
    "coverage"
  ]
}
```

## 7.2 公共函数必须写 JSDoc

```js
/**
 * @param {Mortgage} mortgage
 * @param {RateScenario} scenario
 * @param {SplitStrategy} strategy
 * @param {SimulationOptions} options
 * @returns {SimulationResult}
 */
export function simulateMortgage(
  mortgage,
  scenario,
  strategy,
  options
) {
  // Pure calculation only.
}
```

## 7.3 外部数据必须经过 Zod

外部数据包括：

- API 返回；
- R2 JSON；
- IndexedDB；
- SQLite；
- 表单；
- 导入文件；
- 用户保存的旧版本配置。

未通过 Zod 的对象不得进入计算引擎。

---

# 8. 领域数据模型

## 8.1 Market Profile

```js
/**
 * @typedef {Object} MarketProfile
 * @property {string} countryCode
 * @property {string} currencyCode
 * @property {string} locale
 * @property {string} timezone
 * @property {PolicyRateDefinition} policyRate
 * @property {MortgageProductDefinition[]} products
 * @property {MarketRules} rules
 * @property {string} modelConfigVersion
 */
```

## 8.2 Mortgage Product

```js
/**
 * @typedef {Object} MortgageProductDefinition
 * @property {string} code
 * @property {string} displayName
 * @property {"floating"|"fixed"|"offset"|"revolving"|"arm"} type
 * @property {number|null} fixedMonths
 * @property {boolean} supportsExtraRepayment
 * @property {boolean} supportsOffset
 */
```

## 8.3 Mortgage

```js
/**
 * @typedef {Object} Mortgage
 * @property {string} id
 * @property {string} name
 * @property {string} countryCode
 * @property {string} currencyCode
 * @property {number} originalTermMonths
 * @property {number} remainingTermMonths
 * @property {"weekly"|"fortnightly"|"monthly"} repaymentFrequency
 * @property {"principal-and-interest"|"interest-only"} repaymentType
 * @property {MortgageTranche[]} tranches
 * @property {ExtraRepayment[]} extraRepayments
 */
```

## 8.4 Mortgage Tranche

```js
/**
 * @typedef {Object} MortgageTranche
 * @property {string} id
 * @property {string} productCode
 * @property {number} balance
 * @property {number} annualRate
 * @property {string|null} fixedUntil
 * @property {number} remainingTermMonths
 * @property {"principal-and-interest"|"interest-only"} repaymentType
 */
```

## 8.5 Rate Point

所有利率内部存为 decimal：

```text
4.69% = 0.0469
```

```js
/**
 * @typedef {Object} RatePoint
 * @property {number} month
 * @property {number} rate
 */
```

## 8.6 Rate Scenario

```js
/**
 * @typedef {Object} RateScenario
 * @property {string} id
 * @property {string} countryCode
 * @property {string} name
 * @property {"policy-rate-derived"|"direct-product-rates"} mode
 * @property {number} probability
 * @property {number} forecastMonths
 * @property {RatePoint[]} policyRatePath
 * @property {Object<string, RatePoint[]>} productRatePaths
 * @property {ScenarioAssumptions} assumptions
 */
```

## 8.7 Split Strategy

```js
/**
 * @typedef {Object} SplitStrategy
 * @property {string} id
 * @property {SplitAllocation[]} allocations
 * @property {RefixRule} refixRule
 */
```

```js
/**
 * @typedef {Object} SplitAllocation
 * @property {string} productCode
 * @property {number} percentage
 * @property {number} amount
 */
```

---

# 9. 市场数据来源与数据层

## 9.1 新西兰首版数据

建议接入：

- 当前 OCR；
- OCR 历史；
- RBNZ Monetary Policy Statement 预测；
- B20 标准房贷利率；
- B21 Special 房贷利率；
- B30 实际新增房贷加权平均利率；
- B2 批发利率和 Swap Rate；
- 可选的存款利率数据；
- 用户手动输入的银行实际报价。

## 9.2 数据优先级

当前房贷报价基线：

```text
用户实际报价
> 经验证的银行挂牌报价
> B21 Special 平均值
> B20 标准平均值
```

模型校准：

```text
B30 实际新增贷款利率
+ B2 Swap Rate
+ OCR 历史
```

## 9.3 后端数据流程

```text
Cloudflare Cron
→ Collector
→ Raw parser
→ Zod validation
→ Normaliser
→ Sanity checks
→ Version generator
→ R2 publish
→ CDN
```

## 9.4 数据文件

```text
/markets/NZ/latest.json
/markets/NZ/history/policy-rate.json
/markets/NZ/history/product-rates.json
/markets/NZ/history/wholesale-rates.json
/markets/NZ/config/model.json
/markets/NZ/scenarios/defaults.json
/markets/index.json
```

## 9.5 Latest JSON 示例

```json
{
  "schemaVersion": "1.0.0",
  "dataVersion": "NZ-2026-06-16-01",
  "countryCode": "NZ",
  "currencyCode": "NZD",
  "asOf": "2026-06-16T00:00:00Z",
  "policyRate": {
    "code": "OCR",
    "displayName": "Official Cash Rate",
    "value": 0.0225,
    "effectiveDate": "2026-05-27"
  },
  "productRates": {
    "floating": 0.058,
    "fixed-6m": 0.0475,
    "fixed-1y": 0.0469,
    "fixed-2y": 0.0489,
    "fixed-3y": 0.0509
  },
  "wholesaleRates": {
    "swap-1y": 0.026,
    "swap-2y": 0.029,
    "swap-3y": 0.031
  },
  "modelConfigVersion": "nz-1.0.0"
}
```

示例数字不得作为生产数据硬编码。

## 9.6 缓存策略

App 启动：

```text
读取本地缓存
→ 立即显示
→ 请求轻量版本检查
→ 版本未变化：不下载
→ 版本变化：下载并验证
→ 保存本地
```

必须支持：

- ETag；
- `If-None-Match`；
- stale data warning；
- 最后更新时间；
- 网络失败继续运行。

---

# 10. 未来利率预期算法

## 10.1 核心思想

系统不尝试给出唯一准确预测。

系统建立：

1. 市场基准路径；
2. 用户调整后的基准路径；
3. 低利率情景；
4. 高利率情景；
5. 可选延迟降息情景；
6. 可选降息后反弹情景。

## 10.2 市场基准路径

基准路径可结合：

- 当前政策利率；
- 官方发布的政策利率预测；
- 当前 Swap Curve；
- 当前房贷利率；
- 当前银行利差；
- 模型配置。

第一版可使用经过人工校验的默认情景 JSON。

## 10.3 快速模式用户参数

用户不需要输入完整曲线，只操作：

- 未来12个月利率变化；
- 中期走势；
- 变化速度；
- 不确定性；
- 银行利差压力。

```js
/**
 * @typedef {Object} QuickRateControls
 * @property {number} shortTermChange
 * @property {number} mediumTermDirection
 * @property {number} changeSpeed
 * @property {number} uncertainty
 * @property {number} spreadShock
 */
```

推荐范围：

```text
shortTermChange: -1.50% 到 +1.50%
mediumTermDirection: -1 到 +1
changeSpeed: 0 到 1
uncertainty: 0.00% 到 2.00%
spreadShock: -0.50% 到 +0.75%
```

## 10.4 时间节点

默认节点：

```text
当前
3个月
6个月
12个月
18个月
24个月
36个月
60个月
```

## 10.5 路径插值

支持：

- flat；
- linear；
- step；
- custom。

OCR 默认更适合 step。

直接房贷利率可以使用 linear 或 custom。

## 10.6 从政策利率推导房贷利率

MVP 公式：

```text
ForecastProductRate(k,t)
=
CurrentProductRate(k)
+
Beta(k) × ExpectedPolicyRateChange(k,t)
+
SpreadShock(k,t)
+
TermPremiumAdjustment(k,t)
```

其中：

```text
ExpectedPolicyRateChange(k,t)
=
ForecastAveragePolicyRate(k,t)
-
CurrentExpectedAveragePolicyRate(k)
```

对于 1 年固定：

```text
ForecastAveragePolicyRate
=
从 t 开始未来 12 个月政策利率平均值
```

对于 2 年固定：

```text
ForecastAveragePolicyRate
=
从 t 开始未来 24 个月政策利率平均值
```

## 10.7 建议初始 Beta

只作为可配置初始值：

```text
floating: 0.90
fixed-6m: 0.85
fixed-1y: 0.75
fixed-18m: 0.65
fixed-2y: 0.55
fixed-3y: 0.40
fixed-5y: 0.25
```

必须存放在国家模型配置中：

```text
packages/country-adapters/nz/config/
```

不得写死在通用 rate-engine。

## 10.8 更成熟版本

当 Swap 数据稳定后，固定利率优先使用：

```text
ForecastMortgageRate(k,t)
=
ForecastSwapRate(k,t)
+
ObservedMortgageSpread(k)
+
SpreadShock(k,t)
```

政策利率路径先影响 Swap Curve，而不是直接影响固定房贷利率。

---

# 11. 多情景生成算法

## 11.1 基础情景

必须支持：

- Low；
- Base；
- High。

可选：

- Delayed easing；
- Rebound；
- User custom。

## 11.2 基准情景

```text
市场基准路径
+ 用户短期调整
+ 用户中期调整
+ 用户变化速度
+ 用户银行利差调整
```

## 11.3 低利率情景

在基准路径上：

- 降息更早；
- 降息幅度更大；
- 银行利差不变或收窄；
- 不确定性冲击逐步进入。

## 11.4 高利率情景

在基准路径上：

- 降息更晚；
- 利率高于基准；
- 中期反弹；
- 银行利差可能扩大。

## 11.5 不确定性曲线

不要所有月份同时直接加减相同数值。

建议：

```text
第0个月：0
第3个月：25% 冲击
第6个月：50% 冲击
第12个月：100% 冲击
之后逐步维持或衰减
```

## 11.6 概率

简单模式默认：

```text
Low: 20%
Base: 60%
High: 20%
```

用户通过“风险偏向”滑块调整。

高级模式允许直接输入概率。

总概率必须等于 1。

## 11.7 情景验证

每条情景必须通过：

- 概率合法；
- 月份连续；
- 无 NaN；
- 无无限值；
- 利率不低于配置下限；
- 利率不高于配置上限；
- 每种产品路径覆盖完整模拟期；
- 路径没有未定义月份。

---

# 12. 房贷计算引擎

## 12.1 纯函数要求

核心函数不得依赖：

- React；
- Next.js；
- Expo；
- Zustand；
- IndexedDB；
- SQLite；
- API；
- 浏览器全局对象；
- 移动设备全局对象。

## 12.2 标准还款公式

本金加利息：

```text
Payment =
P × r(1+r)^n / ((1+r)^n - 1)
```

必须处理：

- 利率为 0；
- 贷款余额为 0；
- 剩余期数为 1；
- 最后一笔还款；
- 舍入；
- 提前还清；
- 余额不得为负数。

## 12.3 实际还款频率

建议按真实支付频率模拟：

```text
weekly: 52 次/年
fortnightly: 26 次/年
monthly: 12 次/年
```

最终聚合为月度图表。

## 12.4 每期计算

```text
Opening balance
+ Interest
- Scheduled payment
- Extra repayment
= Closing balance
```

本金：

```text
Principal paid
=
Payment - Interest
```

## 12.5 Fixed Tranche

固定期内：

- 利率保持合同值；
- 不随情景变化；
- 到 fixedUntil 才重定价。

## 12.6 Floating Tranche

浮动：

- 根据 scenario 对应产品路径变化；
- 支持传导延迟；
- 支持最小更新时间间隔。

## 12.7 Refix

到期：

1. 读取剩余本金；
2. 读取 refix rule；
3. 确定新产品；
4. 读取当月新利率；
5. 使用剩余期限重新计算支付额；
6. 记录 refix event；
7. 继续模拟。

## 12.8 MVP Refix Rule

- same-term；
- specified-sequence；
- move-to-floating。

## 12.9 额外还款

支持：

- one-off；
- recurring；
- target tranche；
- default allocation。

默认分配建议：

```text
浮动部分
→ 利率最高部分
→ 其他部分
```

必须提示实际银行可能有提前还款限制和 break fee。

---

# 13. 拆分方案生成算法

## 13.1 用户约束

- 最大拆分数；
- 最低拆分比例；
- 最低拆分金额；
- 比例步长；
- 允许产品；
- 最大浮动比例；
- 最低固定比例；
- 是否必须保留浮动；
- 最大可承受还款；
- 用户额外还款计划。

## 13.2 默认约束

```text
maximumSplits: 3
minimumPercentage: 10%
percentageStep: 10%
maximumFloatingPercentage: 30%
minimumFixedPercentage: 70%
forecastMonths: 36
```

## 13.3 组合生成

生成所有满足：

```text
Σ percentage = 100%
```

的组合。

## 13.4 去重

以下应视为相同：

```text
40% 1年 + 60% 2年
60% 2年 + 40% 1年
```

标准化方式：

1. 按 productCode 排序；
2. 创建稳定字符串 key；
3. 使用 Set 去重。

## 13.5 无效组合过滤

排除：

- 总比例不为100%；
- 比例低于最低值；
- 金额低于最低值；
- 超过最大份数；
- 浮动超过上限；
- 固定低于下限；
- 重复产品；
- 用户禁止的期限；
- 预算明显不可承受；
- 不符合国家规则。

## 13.6 组合数量控制

如组合过多：

- 增加比例步长；
- 限制最多3份；
- 先进行粗粒度搜索；
- 对最佳区域进行细粒度二次搜索。

推荐采用两阶段搜索：

```text
Stage 1: 10% 步长
→ 找到表现最佳区域

Stage 2: 在最佳区域使用 5% 步长
→ 精细化候选
```

Premium 可开放更细步长。

---

# 14. 多情景模拟矩阵

```text
有效拆分方案数量
×
启用情景数量
=
总模拟次数
```

例如：

```text
120 个方案 × 3 个情景 = 360 次模拟
```

每次模拟必须确定性一致。

输入不变，输出必须完全相同。

---

# 15. 模拟结果指标

每个 `strategy × scenario` 输出：

```js
/**
 * @typedef {Object} SimulationResult
 * @property {string} strategyId
 * @property {string} scenarioId
 * @property {number} totalInterest
 * @property {number} totalRepayments
 * @property {number} endingBalance
 * @property {number} maximumPayment
 * @property {number} minimumPayment
 * @property {number} averagePayment
 * @property {number} maximumPaymentIncrease
 * @property {number} paymentVolatility
 * @property {number} refixEventCount
 * @property {number} maximumConcurrentRefixPercentage
 * @property {number} floatingExposure
 * @property {number} affordabilityBreaches
 * @property {SimulationTimelinePoint[]} timeline
 */
```

## 15.1 成本指标

- 总利息；
- 总还款；
- 期末余额；
- 额外还款；
- 与最低成本方案差额。

## 15.2 稳定性指标

- 最高还款；
- 最低还款；
- 最大还款增幅；
- 还款标准差；
- 超过预算次数；
- 最坏情景还款。

## 15.3 Refix 指标

- refix 次数；
- 最大同时到期比例；
- 在高利率月份 refix 的本金比例；
- 第一次 refix 时间；
- 到期集中度。

## 15.4 灵活性指标

- 浮动比例；
- Offset 兼容比例；
- 可用于额外还款比例；
- 固定限制暴露；
- 用户计划额外还款可消化程度。

---

# 16. 多情景汇总

## 16.1 概率加权

```text
ExpectedCost
=
Σ ScenarioProbability × ScenarioCost
```

计算：

- expected interest；
- expected repayment；
- expected maximum payment；
- expected ending balance。

## 16.2 风险指标

同时输出：

- best case；
- worst case；
- range；
- downside deviation；
- affordability breaches；
- high-rate maximum payment；
- scenario sensitivity。

不得只显示平均值。

---

# 17. Pareto 非劣解筛选

## 17.1 目的

减少大量没有价值的方案。

若方案 A 同时满足：

- 预计成本不高于 B；
- 最坏还款不高于 B；
- refix 风险不高于 B；
- 灵活性不低于 B；

并且至少一项严格优于 B，则 B 被 A 支配。

B 可以从主要推荐候选中删除。

## 17.2 保留结果

保留：

- Pareto frontier；
- 最低成本极值；
- 最稳定极值；
- 灵活性极值；
- 用户偏好综合最优。

---

# 18. 推荐评分算法

## 18.1 指标标准化

所有指标先转为 0 到 1。

成本越低越好：

```text
normalisedCost
=
(value - min) / (max - min)
```

灵活性越高越好时，需要反向处理。

处理所有值相等的情况，避免除以0。

## 18.2 平衡型默认权重

```text
Expected cost: 40%
Repayment stability: 25%
Refix diversification: 20%
High-rate resilience: 10%
Flexibility: 5%
```

## 18.3 用户偏好滑块

主滑块：

```text
最低成本 ←────────→ 最稳定
```

滑块范围 0 到 1。

例如：

```js
costWeight = 0.65 - slider * 0.40;
stabilityWeight = 0.15 + slider * 0.30;
refixWeight = 0.15 + slider * 0.10;
resilienceWeight = 0.05 + slider * 0.05;
```

第二滑块：

```text
不需要灵活性 ←────────→ 高度需要灵活性
```

调整 flexibility 权重。

最后重新归一化全部权重。

## 18.4 综合评分

```text
Score
=
costWeight × costScore
+
stabilityWeight × stabilityScore
+
refixWeight × refixScore
+
resilienceWeight × resilienceScore
+
flexibilityWeight × flexibilityPenalty
```

分数越低越好。

## 18.5 输出三个主要方案

必须同时显示：

1. 用户偏好推荐；
2. 最低预计成本；
3. 最稳定方案。

可选显示：

4. 最大灵活性；
5. 最低最坏情景损失。

---

# 19. 动态操作界面

## 19.1 Strategy Lab

核心操作集中在单一“策略实验室”页面。

## 19.2 快速模式控件

### 滑块 1：未来12个月政策利率变化

```text
-1.50% ─────────●──────── +1.50%
```

### 滑块 2：中期方向

```text
继续下降 ───────●────── 明显回升
```

### 滑块 3：变化速度

```text
缓慢 ───────────●────── 快速
```

### 滑块 4：不确定性

```text
较低 ───────────●────── 较高
```

### 滑块 5：策略目标

```text
最低成本 ───────●────── 最稳定
```

### 滑块 6：灵活性需要

```text
不重要 ─────────●────── 非常重要
```

## 19.3 动态图表

图表应显示：

- 低利率路径；
- 基准路径；
- 高利率路径；
- 当前节点；
- 用户拖动节点；
- 可切换政策利率或房贷产品利率。

## 19.4 动态推荐卡片

实时显示：

- 拆分比例；
- 每份金额；
- 固定期限；
- 概率加权利息；
- 最坏情景利息；
- 最高还款；
- 最大同时到期比例；
- 推荐原因；
- 主要缺点。

## 19.5 重新计算策略

### 只调整偏好滑块

不重新运行现金流模拟。

执行：

```text
使用已有结果
→ 重新计算权重
→ 重新排名
```

目标响应：接近即时。

### 调整利率路径

需要重新模拟。

执行：

```text
更新利率图预览
→ debounce 200–300ms
→ 预计算产品路径
→ 优先重算前20候选
→ 再完整计算
```

### 调整贷款金额或期限

执行完整重算。

## 19.6 计算进度

显示：

```text
正在比较 118 个方案、3 个情景
72%
```

支持取消。

---

# 20. 前端页面

## 20.1 Dashboard

- 当前政策利率；
- 市场参考利率；
- 数据更新时间；
- 当前贷款余额；
- 当前还款；
- 最近到期；
- 快速进入 Strategy Lab。

## 20.2 Mortgage Setup

- 简单模式；
- 多 tranche 模式；
- 实时总额；
- 比例校验；
- 当前还款估计。

## 20.3 Rate Scenarios

- 默认情景；
- 快速滑块；
- 高级节点编辑；
- 直接产品利率模式；
- 情景概率。

## 20.4 Strategy Constraints

- 最大拆分数；
- 允许期限；
- 浮动上限；
- 最低金额；
- 比例步长；
- 最大可承受还款；
- 额外还款。

## 20.5 Results

- 推荐；
- 最低成本；
- 最稳定；
- 比较卡片；
- 桌面比较表；
- Mobile 横向卡片。

## 20.6 Strategy Detail

- 贷款结构图；
- 月供曲线；
- 本金曲线；
- 情景对比；
- refix 时间轴；
- 推荐解释；
- 缺点；
- 压力测试。

## 20.7 Settings

- 市场国家；
- 货币显示；
- 数据更新时间；
- 默认风险偏好；
- Free/Premium；
- Disclaimer；
- 隐私说明。

---

# 21. 响应式设计

## 21.1 Desktop

- 左侧导航；
- 右侧主内容；
- Strategy Lab 左侧控件、右侧图表；
- 下方推荐；
- 适当使用表格。

## 21.2 Mobile

- 底部导航；
- 卡片布局；
- 滑块全宽；
- 图表横向滚动或紧凑；
- 不使用宽表；
- 高级设置折叠；
- 主要按钮 sticky；
- 结果卡片易于左右切换。

---

# 22. 本地存储

## 22.1 Web

IndexedDB 保存：

- mortgages；
- tranches；
- scenarios；
- constraints；
- saved results；
- market cache；
- feature flags；
- schema version。

## 22.2 Mobile

Expo SQLite 保存领域数据。

AsyncStorage 只保存：

- 主题；
- onboarding；
- 简单设置；
- 当前选择。

## 22.3 数据迁移

所有本地数据必须包含：

```text
schemaVersion
createdAt
updatedAt
```

每次 schema 变化必须提供 migration。

---

# 23. 多国家扩展

## 23.1 Country Adapter

```js
/**
 * @typedef {Object} CountryMortgageAdapter
 * @property {string} countryCode
 * @property {string} currencyCode
 * @property {PolicyRateDefinition} policyRate
 * @property {MortgageProductDefinition[]} products
 * @property {(input: unknown) => ValidationResult} validateMortgage
 * @property {(context: RefixContext) => RefixResult} applyRefixRule
 * @property {() => RateScenario[]} getDefaultScenarios
 */
```

## 23.2 新西兰适配器

- OCR；
- floating；
- fixed 6m；
- fixed 1y；
- fixed 18m；
- fixed 2y；
- fixed 3y；
- fixed 5y；
- refix；
- offset；
- revolving credit。

## 23.3 未来顺序

1. NZ；
2. AU；
3. UK 或 CA；
4. US。

## 23.4 禁止的硬编码

通用代码不得出现：

```js
if (country === "NZ") {
  // domain calculation
}
```

国家差异必须通过 adapter。

---

# 24. Premium 预留

## 24.1 MVP

只实现功能开关接口，不接真实收费。

```js
export const FEATURES = {
  MULTI_SCENARIO: "multi_scenario",
  ADVANCED_OPTIMISER: "advanced_optimiser",
  FIVE_YEAR_FORECAST: "five_year_forecast",
  UNLIMITED_MORTGAGES: "unlimited_mortgages",
  EXPORT_REPORT: "export_report",
  GLOBAL_MARKETS: "global_markets"
};
```

## 24.2 Free

- 一笔贷款；
- 最多两份拆分；
- 一条默认情景；
- 一条自定义情景；
- 12个月或基础36个月简化结果；
- 基础压力测试；
- 保存一个方案。

## 24.3 Premium

- 多贷款；
- 多情景；
- 3–5年；
- 细粒度优化；
- 高级压力测试；
- Offset；
- Revolving Credit；
- CSV/PDF；
- 多国家；
- 跨设备同步，未来。

## 24.4 未来收费技术

- iOS：Apple IAP；
- Android：Google Play Billing；
- Web：Stripe；
- 权限统一：RevenueCat；
- 贷款数据仍保留本地。

---

# 25. 隐私和安全

## 25.1 MVP 隐私

不向服务器发送：

- 贷款余额；
- 收入；
- 房价；
- 用户自定义方案；
- 还款金额；
- 个人身份。

## 25.2 日志

日志不得包含：

- 完整贷款输入；
- 用户私密数据；
- API Key；
- 支付凭据。

## 25.3 后端安全

- API 只读；
- R2 发布最小权限；
- Cron Key 保存在 Secret；
- Schema 校验；
- 数据异常不发布；
- 保留上一稳定版本；
- 支持回滚。

---

# 26. 性能目标

```text
单笔还款计算：<100ms
利率路径生成：<100ms
约500次模拟：目标 <2秒
偏好重排：<50ms
本地缓存读取：<200ms
首屏可交互：合理移动网络下 <3秒
```

## 26.1 Web

- 使用 Web Worker；
- 传递可序列化数据；
- 不在主线程运行大组合；
- 支持取消 token。

## 26.2 Mobile

- 分批；
- 每批主动 yield；
- 支持进度；
- 支持取消；
- 避免每次结果触发大量 React render。

---

# 27. 测试计划

## 27.1 Mortgage Engine 单元测试

- 0% 利率；
- 常规本金加利息；
- Interest-only；
- weekly；
- fortnightly；
- monthly；
- 额外还款；
- 最后一笔；
- 提前还清；
- refix；
- 多 tranche；
- 无负余额；
- 舍入。

## 27.2 Rate Engine

- flat；
- linear；
- step；
- custom；
- 完整月度覆盖；
- OCR-derived；
- direct override；
- spread shock；
- 上下限；
- 无 NaN。

## 27.3 Strategy Generator

- 总比例100%；
- 去重；
- 最低比例；
- 最低金额；
- 浮动上限；
- 最大份数；
- 国家规则；
- 确定性排序。

## 27.4 Optimiser

- 标准化；
- 所有值相等；
- Pareto；
- 概率加权；
- 滑块权重；
- 极端偏好；
- 排名稳定；
- 解释文本输入正确。

## 27.5 集成测试

- Mortgage + Scenario + Strategy；
- 多 tranche 不同到期；
- 高利率情景；
- 额外还款；
- affordability breach；
- 缓存；
- schema migration。

## 27.6 UI 测试

- 首次流程；
- 表单错误；
- 滑块动态变化；
- 取消计算；
- 离线；
- stale data；
- 结果卡片；
- 高级模式；
- Accessibility。

---

# 28. 开发阶段

## Phase 0：Repository Foundation

任务：

- 建立 pnpm monorepo；
- 创建 apps 和 packages；
- 配置 JavaScript checkJs；
- ESLint；
- Prettier；
- Vitest；
- CI；
- AGENTS.md；
- OpenCode Agent 文件。

验收：

- 根目录运行 install；
- lint 通过；
- checkJs 通过；
- tests 通过；
- Web 和 Mobile 空壳可启动。

## Phase 1：Schemas 和 Shared Types

任务：

- JSDoc 模型；
- Zod schemas；
- money utility；
- percentage utility；
- dates；
- deterministic IDs；
- schema version。

验收：

- 每个外部模型有 Zod；
- 无 `any` 风格的不受控对象；
- 测试覆盖主要 schema。

## Phase 2：Mortgage Engine

任务：

- repayment formula；
- amortisation；
- frequencies；
- interest-only；
- extra payment；
- tranche；
- refix；
- timelines。

验收：

- 独立测试；
- 与人工计算样例一致；
- 无 React 依赖；
- 无负余额。

## Phase 3：Rate Engine

任务：

- key points；
- stages；
- interpolation；
- quick controls；
- policy path；
- product rates；
- spread shock；
- scenario validation。

验收：

- 月度路径完整；
- 直接模式覆盖；
- Beta 配置化；
- 无 NZ 硬编码在核心包。

## Phase 4：Strategy Generator

任务：

- 分割合计；
- 组合；
- 去重；
- 约束；
- 两阶段搜索；
- 国家规则。

验收：

- 所有组合合法；
- 相同输入排序一致；
- 组合规模可控。

## Phase 5：Simulation Engine

任务：

- strategy × scenario；
- monthly/payment-event simulation；
- refix event；
- output metrics；
- progress；
- cancel。

验收：

- 确定性；
- Web Worker 可调用；
- Mobile 可分批调用。

## Phase 6：Optimiser

任务：

- aggregation；
- normalisation；
- Pareto；
- score；
- sliders；
- explanations；
- top candidates。

验收：

- 输出最低成本、最稳定、平衡；
- 修改偏好不重新模拟；
- 解释同时给出优点和缺点。

## Phase 7：Web MVP

任务：

- Dashboard；
- Mortgage Setup；
- Rate Scenarios；
- Strategy Lab；
- Results；
- Detail；
- Stress Test；
- IndexedDB；
- Worker。

验收：

- 完整流程；
- 响应式；
- 离线可用；
- UI 不包含领域计算。

## Phase 8：Mobile MVP

任务：

- Expo Router；
- Mortgage flow；
- Sliders；
- Charts；
- Results；
- SQLite；
- chunked calculation。

验收：

- iOS/Android；
- 结果与 Web 一致；
- 计算不阻塞；
- 本地恢复。

## Phase 9：Market Data API

任务：

- RBNZ collectors；
- normalisers；
- validation；
- R2 publish；
- Cron；
- version API；
- fallback。

验收：

- 无数据库；
- 数据异常不覆盖稳定版本；
- App 离线继续工作；
- 显示来源和更新时间。

## Phase 10：Polish 和 Release

任务：

- Accessibility；
- analytics，隐私友好；
- disclaimer；
- performance；
- error states；
- onboarding；
- store assets；
- release checklist。

---

# 29. MiniMax M3 开发策略

## 29.1 模型用途

MiniMax M3 用于：

- 项目规划；
- 长上下文代码理解；
- 代码实现；
- 重构；
- 测试生成；
- Agent 工具调用；
- 多步骤任务；
- 审查报告。

## 29.2 使用原则

即使模型支持长上下文，也不得无限堆积信息。

必须：

- 维护 AGENTS.md；
- 维护本开发计划；
- 每个模块建立 README；
- 每个重要决策建立 ADR；
- 每个任务有明确输入和验收；
- 完成后提交简短交接；
- 大任务分阶段；
- 定期 compact；
- 不依赖聊天历史作为唯一事实来源。

## 29.3 模型选择字符串

使用 OpenCode Go 时：

```text
opencode-go/minimax-m3
```

使用 MiniMax 官方 Provider 时，先通过 `/models` 确认当前显示的 provider/model 标识，再把所有 Agent 配置中的 model 统一替换。

可能形式：

```text
minimax/MiniMax-M3
```

不得因 provider alias 不同而同时混用两个标识。

## 29.4 Thinking

建议：

- 架构和金融算法任务：开启 thinking；
- 普通 UI 小改：可使用标准思考；
- 代码审查：开启 thinking；
- 格式化和简单文案：无需高推理。

不要在配置中加入未经当前 OpenCode 版本验证的 provider 私有字段。

---

# 30. 是否需要多 Agent

结论：需要，但不是让所有 Agent 同时写代码。

推荐模式：

```text
1 个 Primary Lead
+
5 个专业 Subagent
```

## 30.1 为什么需要

项目同时包含：

- 金融数学；
- 利率模型；
- React Web；
- React Native；
- Cloudflare 数据后端；
- 测试；
- 隐私；
- 多国家架构。

单一通用 Agent 容易：

- 把金融逻辑写入 UI；
- 忽略边界条件；
- 后端过度设计；
- 多端结果不一致；
- 修改范围过大。

## 30.2 单写入者规则

任何时间只能有一个 Agent 对某一模块执行写入。

允许并行：

- 一个 Agent 写 mortgage-engine；
- 一个只读 Reviewer 审查；
- 一个只读 Architect 分析。

禁止并行：

- 两个 Agent 同时修改 mortgage-engine；
- UI Agent 和 Lead 同时修改同一页面；
- Reviewer 自动修复尚未确认的问题。

## 30.3 推荐 Agent

1. `mortgage-lead`
2. `architecture-planner`
3. `financial-engineer`
4. `ui-ux-engineer`
5. `market-data-engineer`
6. `qa-code-reviewer`

可选：

7. `mobile-specialist`
8. `security-privacy-reviewer`

MVP 初期六个足够。

---

# 31. Agent 职责

## 31.1 mortgage-lead

模式：Primary。

职责：

- 接收用户任务；
- 拆解任务；
- 决定调用哪个 Subagent；
- 控制写入顺序；
- 整合代码；
- 运行全部检查；
- 更新任务状态；
- 创建最终提交。

可写范围：整个项目。

但以下操作必须询问：

- 删除大量文件；
- 改数据库方案；
- 改技术栈；
- git push；
- 发布；
- 修改 secret；
- 破坏性迁移。

## 31.2 architecture-planner

模式：Subagent，只读。

职责：

- 架构分析；
- 模块边界；
- ADR；
- 依赖方向；
- 任务拆解；
- 风险识别；
- 不直接改代码。

## 31.3 financial-engineer

模式：Subagent，受限写入。

职责：

- mortgage-engine；
- rate-engine；
- scenario-engine；
- strategy-generator；
- simulation-engine；
- optimiser；
- 金融测试；
- 数值稳定性；
- 不修改 UI。

## 31.4 ui-ux-engineer

模式：Subagent，受限写入。

职责：

- Web 页面；
- Mobile 页面；
- Design tokens；
- Accessibility；
- 滑块交互；
- 图表；
- 不修改金融公式。

## 31.5 market-data-engineer

模式：Subagent，受限写入。

职责：

- Cloudflare Worker；
- RBNZ collector；
- normaliser；
- R2 publisher；
- market data client；
- 不修改用户贷款计算。

## 31.6 qa-code-reviewer

模式：Subagent，只读。

职责：

- 审查 diff；
- 检查需求；
- 检查安全；
- 检查算法；
- 检查测试；
- 提交问题清单；
- 不直接修改代码。

---

# 32. OpenCode 全局配置建议

`opencode.json`：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "default_agent": "mortgage-lead",
  "instructions": [
    "AGENTS.md",
    "MORTGAGE_STRATEGY_APP_DEVELOPMENT_PLAN.md",
    "docs/decisions/*.md",
    "docs/algorithms/*.md"
  ],
  "share": "disabled",
  "snapshot": true,
  "compaction": {
    "auto": true,
    "prune": true,
    "reserved": 16000
  },
  "watcher": {
    "ignore": [
      "node_modules/**",
      ".next/**",
      "dist/**",
      "coverage/**",
      ".expo/**",
      "*.log"
    ]
  },
  "permission": {
    "*": "ask",
    "read": "allow",
    "glob": "allow",
    "grep": "allow",
    "list": "allow",
    "lsp": "allow",
    "skill": "allow",
    "webfetch": "ask",
    "websearch": "ask",
    "external_directory": "deny"
  }
}
```

说明：

- `share` 关闭，避免意外共享代码；
- snapshots 开启；
- 自动 compact；
- 默认工具谨慎授权；
- Agent 自己再覆盖权限。

---

# 33. OpenCode Agent 配置

将以下文件放入：

```text
.opencode/agents/
```

## 33.1 `.opencode/agents/mortgage-lead.md`

```markdown
---
description: Primary development lead for the mortgage strategy simulator. Plans work, delegates specialist analysis, integrates changes, and enforces project architecture and quality gates.
mode: primary
model: opencode-go/minimax-m3
temperature: 0.2
steps: 45
permission:
  read: allow
  glob: allow
  grep: allow
  list: allow
  lsp: allow
  skill: allow
  edit: allow
  bash:
    "*": ask
    "git status*": allow
    "git diff*": allow
    "git log*": allow
    "pnpm lint*": allow
    "pnpm test*": allow
    "pnpm check*": allow
    "pnpm build*": allow
    "pnpm --filter * test*": allow
    "git push*": ask
    "rm -rf *": deny
  task:
    "*": deny
    "architecture-planner": allow
    "financial-engineer": allow
    "ui-ux-engineer": allow
    "market-data-engineer": allow
    "qa-code-reviewer": allow
---

You are the primary development lead for the mortgage strategy simulator.

Mandatory workflow:

1. Read AGENTS.md and the development plan.
2. Inspect the current repository state.
3. Restate the task as explicit acceptance criteria.
4. Ask architecture-planner for design review when module boundaries change.
5. Delegate domain work only to the matching specialist.
6. Enforce the single-writer rule.
7. Run checkJs, lint, unit tests, and relevant builds.
8. Invoke qa-code-reviewer before declaring a phase complete.
9. Fix confirmed issues.
10. Produce a concise handoff with changed files, tests, assumptions, and remaining risks.

Never:
- move financial logic into React components;
- upload personal mortgage data;
- introduce a traditional database during MVP;
- hard-code OCR or NZ rules in shared engines;
- describe a scenario result as guaranteed financial advice;
- mark work complete when tests fail.
```

## 33.2 `.opencode/agents/architecture-planner.md`

```markdown
---
description: Read-only architecture planner for module boundaries, dependency direction, ADRs, task decomposition, performance and migration risks.
mode: subagent
model: opencode-go/minimax-m3
temperature: 0.1
steps: 16
permission:
  read: allow
  glob: allow
  grep: allow
  list: allow
  lsp: allow
  skill: allow
  edit: deny
  bash:
    "*": deny
    "git status*": allow
    "git diff*": allow
    "git log*": allow
  webfetch: ask
  websearch: ask
  task: deny
---

You are a read-only software architect.

Review:
- package boundaries;
- dependency direction;
- country adapter separation;
- local-first privacy;
- no-database backend;
- Web and Mobile code sharing;
- performance and migration risks.

Return:
1. recommended design;
2. files/modules affected;
3. risks;
4. acceptance criteria;
5. explicit non-goals.

Do not edit files.
```

## 33.3 `.opencode/agents/financial-engineer.md`

```markdown
---
description: Specialist for mortgage mathematics, rate scenarios, split generation, deterministic simulation, optimisation and financial test coverage.
mode: subagent
model: opencode-go/minimax-m3
temperature: 0.1
steps: 35
permission:
  read: allow
  glob: allow
  grep: allow
  list: allow
  lsp: allow
  skill: allow
  edit:
    "*": deny
    "packages/mortgage-engine/**": allow
    "packages/rate-engine/**": allow
    "packages/scenario-engine/**": allow
    "packages/strategy-generator/**": allow
    "packages/simulation-engine/**": allow
    "packages/optimiser/**": allow
    "packages/schemas/**": ask
    "packages/country-adapters/**": ask
    "docs/algorithms/**": allow
  bash:
    "*": ask
    "git diff*": allow
    "pnpm --filter * test*": allow
    "pnpm test*": allow
    "pnpm check*": allow
  task: deny
  webfetch: ask
  websearch: ask
---

You are the financial calculation specialist.

Requirements:
- all financial functions must be pure;
- all rates are decimal internally;
- preserve precision and centralise rounding;
- handle zero rates and final payments;
- never allow negative balances;
- use deterministic algorithms;
- add tests before or with implementation;
- do not change UI code;
- do not invent financial facts;
- document every modelling assumption.

When finished, report:
- formulas implemented;
- assumptions;
- edge cases;
- test cases;
- numerical risks;
- files changed.
```

## 33.4 `.opencode/agents/ui-ux-engineer.md`

```markdown
---
description: Specialist for responsive Next.js and Expo interfaces, Strategy Lab sliders, charts, accessibility and progressive disclosure.
mode: subagent
model: opencode-go/minimax-m3
temperature: 0.3
steps: 30
permission:
  read: allow
  glob: allow
  grep: allow
  list: allow
  lsp: allow
  skill: allow
  edit:
    "*": deny
    "apps/web/**": allow
    "apps/mobile/**": allow
    "packages/ui-tokens/**": allow
    "packages/feature-flags/**": ask
    "docs/ui/**": allow
  bash:
    "*": ask
    "git diff*": allow
    "pnpm --filter web test*": allow
    "pnpm --filter mobile test*": allow
    "pnpm check*": allow
  task: deny
---

You are the UI and UX specialist.

Build:
- simple first-time flow;
- accessible sliders;
- responsive charts;
- dynamic recommendation cards;
- mobile-friendly layouts;
- progressive disclosure for advanced settings.

Rules:
- never duplicate mortgage formulas;
- call shared domain packages;
- never infer financial advice in UI text;
- show assumptions and trade-offs;
- support loading, progress, cancel, offline and stale-data states;
- meet accessibility requirements.

Report visual and interaction decisions and the tests run.
```

## 33.5 `.opencode/agents/market-data-engineer.md`

```markdown
---
description: Specialist for Cloudflare Workers, scheduled RBNZ collection, validation, normalisation, R2 publication, caching and no-database market APIs.
mode: subagent
model: opencode-go/minimax-m3
temperature: 0.15
steps: 30
permission:
  read: allow
  glob: allow
  grep: allow
  list: allow
  lsp: allow
  skill: allow
  edit:
    "*": deny
    "services/market-data-api/**": allow
    "packages/market-data-client/**": allow
    "packages/schemas/**": ask
    "packages/country-adapters/nz/**": ask
    "docs/data-sources/**": allow
  bash:
    "*": ask
    "git diff*": allow
    "pnpm --filter market-data-api test*": allow
    "pnpm check*": allow
  webfetch: allow
  websearch: ask
  task: deny
---

You are the public market data specialist.

Build a no-database pipeline:
source → parse → validate → normalise → sanity check → version → publish to R2.

Requirements:
- never publish failed or suspicious data;
- retain the previous stable version;
- include source, effective date and publication date;
- use Zod at every external boundary;
- do not store personal user data;
- make the client work offline with cached data;
- document source changes and parser assumptions.
```

## 33.6 `.opencode/agents/qa-code-reviewer.md`

```markdown
---
description: Read-only reviewer for correctness, regressions, security, privacy, test quality, accessibility and compliance with the development plan.
mode: subagent
model: opencode-go/minimax-m3
temperature: 0.1
steps: 24
permission:
  read: allow
  glob: allow
  grep: allow
  list: allow
  lsp: allow
  skill: allow
  edit: deny
  bash:
    "*": ask
    "git status*": allow
    "git diff*": allow
    "git log*": allow
    "pnpm lint*": allow
    "pnpm test*": allow
    "pnpm check*": allow
    "pnpm build*": allow
  webfetch: ask
  websearch: ask
  task: deny
---

You are a read-only senior reviewer.

Review against:
- acceptance criteria;
- financial correctness;
- edge cases;
- deterministic results;
- JavaScript checkJs;
- test completeness;
- local-first privacy;
- no-database constraint;
- country adapter boundaries;
- accessibility;
- performance;
- error handling.

Classify findings:
- BLOCKER
- HIGH
- MEDIUM
- LOW

For every finding include:
- file and location;
- problem;
- impact;
- reproduction;
- recommended correction.

Do not edit files.
```

---

# 34. Agent 工作流

每个开发任务必须采用：

```text
Lead 分析任务
→ Planner 确认边界，必要时
→ 专业 Agent 实现
→ Lead 运行测试并整合
→ QA Reviewer 审查
→ Lead 修复
→ 再运行检查
→ 更新文档和任务状态
```

## 34.1 任务开始模板

```text
Task:
Scope:
Out of scope:
Acceptance criteria:
Affected packages:
Expected tests:
Risk level:
Assigned agent:
Reviewer:
```

## 34.2 Agent 交接模板

```text
## Completed
- ...

## Files changed
- ...

## Tests run
- ...

## Assumptions
- ...

## Known limitations
- ...

## Risks requiring review
- ...

## Suggested next task
- ...
```

## 34.3 Reviewer 输出模板

```text
## Review result
PASS / PASS WITH ISSUES / FAIL

## Blockers
- ...

## High findings
- ...

## Medium findings
- ...

## Test gaps
- ...

## Recommended decision
- ...
```

---

# 35. Git 和变更控制

建议：

- `main` 保持可构建；
- 每个阶段或 feature 使用分支；
- 小提交；
- 一项提交只做一类变化；
- 不混合格式化和领域逻辑；
- Agent 不自动 push；
- 完成后由用户或 Lead 确认。

提交格式：

```text
feat(mortgage-engine): add fortnightly amortisation
fix(rate-engine): clamp scenario path boundaries
test(optimiser): cover equal metric normalisation
docs(architecture): record no-database decision
```

---

# 36. CI 质量门槛

每个 PR 或阶段完成必须执行：

```bash
pnpm check
pnpm lint
pnpm test
pnpm build
```

建议覆盖率目标：

```text
金融核心包 statement coverage: 90%+
branch coverage: 85%+
UI 组件：按关键交互覆盖
```

阻止合并：

- checkJs 错误；
- lint 错误；
- 测试失败；
- build 失败；
- QA Blocker；
- 结果不一致；
- 用户数据上传风险。

---

# 37. 风险清单

## 37.1 金融模型误导

缓解：

- 强调情景；
- 显示假设；
- 显示最差情况；
- 显示缺点；
- Disclaimer；
- 不使用确定性建议语言。

## 37.2 市场数据变化

缓解：

- Collector 隔离；
- Schema validation；
- 版本；
- 稳定回滚；
- 用户手动输入；
- stale warning。

## 37.3 JavaScript 类型错误

缓解：

- checkJs；
- JSDoc；
- Zod；
- ESLint；
- 单元测试；
- 不传未验证数据。

## 37.4 组合爆炸

缓解：

- 最大3份；
- 10% 步长；
- 两阶段搜索；
- Pareto；
- 预过滤；
- Worker；
- progress/cancel。

## 37.5 多 Agent 冲突

缓解：

- 单写入者；
- 路径权限；
- Lead 统一整合；
- QA 只读；
- 小任务；
- git diff 审查。

## 37.6 多端结果不一致

缓解：

- 共享 domain packages；
- golden test fixtures；
- Web/Mobile 对照测试；
- 禁止 UI 自己计算。

---

# 38. Definition of Done

MVP 完成必须满足：

1. 用户能输入多 tranche；
2. 用户能操作快速利率滑块；
3. 用户能创建自定义情景；
4. 系统能生成完整月度路径；
5. 系统能生成有效拆分组合；
6. 系统能运行多情景模拟；
7. 系统能进行 Pareto 筛选；
8. 系统能动态调整推荐权重；
9. 用户能看到最低成本、最稳定和平衡方案；
10. 用户能看到最差情景；
11. 用户能看到 refix 风险；
12. 用户能看到推荐解释和缺点；
13. Web 和 Mobile 结果一致；
14. 无网络仍可用；
15. 后端无传统数据库；
16. 用户贷款数据不上传；
17. 核心测试达到质量门槛；
18. 主要页面可访问；
19. 免责声明完整；
20. QA 无 Blocker。

---

# 39. 推荐的首批开发任务

## Task 1

建立 monorepo、checkJs、lint、test、CI。

## Task 2

实现 Money、Rate、Date 工具和 Zod schemas。

## Task 3

实现单 tranche 每月还款。

## Task 4

扩展 weekly 和 fortnightly。

## Task 5

实现多 tranche 和 refix。

## Task 6

实现利率节点和月度展开。

## Task 7

实现低、基准、高情景生成。

## Task 8

实现拆分组合生成和去重。

## Task 9

实现 strategy × scenario 模拟。

## Task 10

实现概率汇总、Pareto 和评分。

## Task 11

实现 Strategy Lab Web 原型。

## Task 12

实现 Web Worker。

## Task 13

实现 Mobile 共用计算和分批运行。

## Task 14

实现 RBNZ 轻量数据后端。

---

# 40. 第一个开发里程碑

第一个里程碑只聚焦领域核心，不开发复杂 UI。

必须暴露：

```js
export function calculateScheduledPayment(input) {}

export function buildPolicyRatePath(input) {}

export function deriveProductRatePaths(input) {}

export function generateSplitStrategies(input) {}

export function simulateStrategy(input) {}

export function aggregateStrategyResults(input) {}

export function rankStrategies(input) {}
```

最终组合函数：

```js
/**
 * @param {Mortgage} mortgage
 * @param {RateScenario[]} scenarios
 * @param {StrategyConstraints} constraints
 * @param {OptimisationPreferences} preferences
 * @returns {OptimisationResult}
 */
export function optimiseMortgageStrategy({
  mortgage,
  scenarios,
  constraints,
  preferences
}) {
  // deterministic pipeline
}
```

完成条件：

- 纯 JavaScript；
- checkJs 无错；
- 无 UI 依赖；
- 单元测试；
- golden fixtures；
- QA review 通过。

---

# 41. 给 MiniMax M3 Lead Agent 的启动 Prompt

```text
请按照 MORTGAGE_STRATEGY_APP_DEVELOPMENT_PLAN.md 开发本项目。

你是 mortgage-lead。开始前必须：

1. 阅读 AGENTS.md 和完整开发计划。
2. 检查仓库现状。
3. 不要直接开始大规模写代码。
4. 先把当前任务拆成可验证的最小步骤。
5. 明确本次任务的范围、非范围和验收标准。
6. 需要改变架构时先调用 architecture-planner。
7. 金融算法任务交给 financial-engineer。
8. UI任务交给 ui-ux-engineer。
9. 公共数据后端交给 market-data-engineer。
10. 完成实现后调用 qa-code-reviewer。
11. 遵守单写入者规则。
12. 运行 checkJs、lint、tests 和相关 build。
13. 不允许为了让测试通过而删除或弱化测试。
14. 不允许把用户贷款数据发送到服务器。
15. 不允许增加传统数据库。
16. 不允许在共享计算引擎中硬编码新西兰规则。
17. 最后输出改动文件、测试、假设、风险和下一步。

当前首要目标：
完成 Phase 0 和 Phase 1，然后实现一个经过测试的单 tranche mortgage-engine。
```

---

# 42. 最终架构总结

产品底层本质：

```text
公共市场数据
+
用户通过滑块表达的利率判断
↓
生成多条未来政策利率和房贷利率路径
↓
生成所有符合约束的贷款拆分
↓
本地逐期模拟每个方案
↓
计算成本、现金流、refix和灵活性
↓
筛选 Pareto 非劣方案
↓
根据用户“成本—稳定—灵活性”偏好动态排名
↓
输出推荐、最低成本、最稳定和最坏情景
```

开发底层本质：

```text
MiniMax M3 Primary Lead
+
专业 Subagents
+
单写入者规则
+
严格测试和只读审查
+
共享 JavaScript 领域核心
+
无数据库轻量后端
```

这套设计使首版保持轻量，同时为未来加入：

- 澳大利亚；
- 英国；
- 加拿大；
- 美国；
- Premium；
- 跨设备同步；
- 更成熟的利率模型；

保留扩展空间，而无需重写核心模拟引擎。
