# RatePath 完整模拟流程与算法说明

> 面向开发者的端到端文档。涵盖从用户输入到帕累托推荐的完整数据流,以及每个阶段的算法逻辑、数学公式、案例与图表。

---

## 0. 一图看懂全流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         用户输入 (Strategy Lab)                        │
│  · OCR 短期变化  · 中期方向  · 切换速度  · 不确定性  · 情景概率       │
│  · 最大拆分数量  · 浮动上限  · 最低金额  · 偏好权重(7 项)              │
│  · 还款预算上限  · 蒙特卡洛样本数  · 长期周期年数                       │
└────────────┬────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ ① Country Adapter (NZ)                                                 │
│   nzProfile (7 个产品)  +  nzBetas (β 敏感度)                          │
└────────────┬────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ ② Rate Engine — 政策利率路径 + 产品利率路径                            │
│   buildPolicyRatePath(controls)  →  policyRatePath[]                   │
│   deriveProductRatePaths(...)    →  productRatePaths{}                 │
└────────────┬────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ ③ Scenario Engine — 三情景(low/base/high) + 长期蒙特卡洛               │
│   generateScenarios(...)       →  RateScenario[]                       │
│   概率归一化 15/70/15%  +  不确定性曲线  +  spread shock                │
└────────────┬────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ ④ Strategy Generator — 候选拆解策略生成                                │
│   generateSplitStrategies(...) →  SplitStrategy[]                      │
│   递归网格分配  +  PR-1..PR-6 剪枝  +  排序去重                         │
└────────────┬────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ ⑤ Simulation Engine — 策略 × 情景 矩阵模拟                             │
│   simulateStrategyScenarioMatrix(...) →  SimulationResult[]             │
│   Web Worker 后台运行  +  进度回调  +  取消信号                         │
│   迭代顺序:scenario outer,strategy inner(共享 CPU 缓存)                │
└────────────┬────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ ⑥ Mortgage Engine — 摊还核心(单次模拟内部)                            │
│   simulateMortgageTimeline(...) →  monthlyTimeline[]                  │
│   每期 12 步流水:refix → 浮动 → offset → 计息 → 还款 → 余款           │
└────────────┬────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ ⑦ Optimiser — 帕累托前沿 + 排名 + 推荐                                │
│   optimizeStrategies(...) →  rankedStrategies + recommendations         │
│   9 个 objective  +  tolerance-aware dominance                         │
│   10 张推荐卡(7 benchmark + preference + 2 个 worst-case)              │
└────────────┬────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ ⑧ UI 层渲染 — Strategy Lab 页面                                       │
│   偏好滑块 → 重排(Pareto 不变)                                        │
│   推荐卡片 + 帕累托表 + 详情弹窗(timeline + linechart + table)         │
└─────────────────────────────────────────────────────────────────────────┘
```

每一层都是一个独立的 npm 包,通过 `@mortgage/*` 路径别名被消费。

---

## 1. Country Adapter: NZ 产品目录

文件:`packages/country-adapters/src/nz.js`

NZ 是当前唯一实现的市场。提供两件事:

### 1.1 产品目录(`nzProfile.products`)

| Code          | 类型     | 固定期  | 支持提前还款 | 支持 Offset |
|---------------|----------|---------|---------------|-------------|
| `floating`    | floating | —       | ✅             | ✅           |
| `fixed-6m`    | fixed    | 6 月    | ✅             | ❌           |
| `fixed-1y`    | fixed    | 12 月   | ✅             | ❌           |
| `fixed-18m`   | fixed    | 18 月   | ✅             | ❌           |
| `fixed-2y`    | fixed    | 24 月   | ✅             | ❌           |
| `fixed-3y`    | fixed    | 36 月   | ✅             | ❌           |
| `fixed-5y`    | fixed    | 60 月   | ✅             | ❌           |

### 1.2 β 敏感度(`nzBetas`)

β 描述一个产品利率对 OCR 变化的"传导系数":

| Code        | β     | 含义                                  |
|-------------|-------|---------------------------------------|
| `floating`  | 0.90  | 几乎 1:1 跟随 OCR                     |
| `fixed-6m`  | 0.85  | 短期定价,传导快                       |
| `fixed-1y`  | 0.75  | 1 年平均后传导                        |
| `fixed-18m` | 0.65  |                                       |
| `fixed-2y`  | 0.55  |                                       |
| `fixed-3y`  | 0.40  | 长锁定期,市场已部分吸收预期           |
| `fixed-5y`  | 0.25  | 5 年平均后传导,变化最慢               |

> **设计意图**:β 越低,该产品对未来 OCR 变化的"打折"越多。固定期越长,β 越小,因为市场已经把未来几年的预期折现进今天的报价。

---

## 2. Rate Engine:OCR 路径 + 产品路径

文件:`packages/rate-engine/src/{policyRate.js, productRate.js, interpolation.js}`

### 2.1 OCR 政策利率路径

**函数**:`buildPolicyRatePath({ initialRate, controls })`

```
Month 0  ──────────────── initialRate
Month 12 ─────────────── initialRate + shortTermChange
Month 36 ─────────────── Month 12 + direction × 0.005 × (24/12)  [线性外推]
Month 60 ─────────────── Month 12 + direction × 0.005 × (48/12)
```

**短期过渡(0-12 月)的幂曲线**:

```
rate(t) = initialRate + shortTermChange × (t/12)^power
power = max(0.1, 2.0 − 2.0 × changeSpeed)
```

| changeSpeed | power | 曲线形态 |
|-------------|-------|----------|
| 0.0         | 2.0   | 慢启动,后段加速 |
| 0.5         | 1.0   | **线性**(默认) |
| 1.0         | 0.1   | 几乎瞬时到位 |

**案例**:`initialRate=5%`, `shortTermChange=−1%`, `changeSpeed=0.5`

```
Month:  0    1    2    3    4    5    6    7    8    9   10   11   12
Rate: 5.0% 4.92 4.83 4.75 4.67 4.58 4.50 4.42 4.33 4.25 4.17 4.08 4.00
        └─── power=1,线性下降 ───┘
```

### 2.2 产品利率路径推导

**函数**:`deriveProductRatePaths({ policyRatePath, currentProductRates, betas, products, forecastMonths, spreadShock })`

**公式**:

```
fixed  : ForecastRate(k, t) = CurrentRate(k) + (OCR(t) − OCR(0)) + spreadShock
floating: ForecastRate(k, t) = CurrentRate(k) + β(k) × (OCR(t) − OCR(0)) + spreadShock
```

固定产品被视为"在每个时点重新报价的全市场利率",而浮动产品只按 β 比例传导。

**案例**:OCR 上升 1%(`OCR(12) − OCR(0) = +1%`)

| 产品          | β   | 涨幅    | 当前 5% → 12 月时 |
|---------------|-----|---------|---------------------|
| `floating`    | 0.9 | +0.90%  | 5.90%               |
| `fixed-1y`    | 0.75| +0.75%  | 5.75%               |
| `fixed-3y`    | 0.40| +0.40%  | 5.40%               |
| `fixed-5y`    | 0.25| +0.25%  | 5.25%               |

> 这就是为什么"长期固定"在加息周期是防御性配置:它们被锁定在旧的低利率里,直到到期。

### 2.3 插值器(`getRateFromPath`)

支持三种模式:
- **flat**:始终返回路径起点(已弃用)
- **linear**:路径点之间线性插值(默认),端点外**平直外推**
- **step**:使用左侧节点的利率

实际场景下每月都需要查询利率,使用 `linear` 模式。

---

## 3. Scenario Engine:三情景生成

文件:`packages/scenario-engine/src/index.js`

### 3.1 不确定性曲线

围绕 Base 路径生成 Low / High 两条边带:

```
Month 0:   0%  不确定性乘数
Month 3:  25%
Month 6:  50%
Month 12: 100%
Month 12+:100%(恒定)
```

```
不确定性乘数
1.0 ┤                              ●───────●
    │                            ╱
0.5 ┤                  ●──────●
    │                ╱
0.25┤      ●────●
    │    ╱
0.0 ●●
    └──┬──┬──┬──┬──┬──┬──→ Month
       0  3  6  9 12 15 24
```

**公式**:

```js
shock(m) = uncertainty × multiplier(m)
low_rate(m)  = base_rate(m) − shock(m)
high_rate(m) = base_rate(m) + shock(m)
```

### 3.2 概率归一化

默认 `low: 0.15, base: 0.70, high: 0.15`,自动归一化使三者之和为 1。

### 3.3 Spread Shock(情景偏移)

每个情景叠加一个产品间差异:

| 情景 | spreadShock |
|------|-------------|
| low  | spreadShock - 0.0025 |
| base | spreadShock           |
| high | spreadShock + 0.005  |

模拟了"低利率周期利差收窄、高利率周期利差扩大"的真实市场现象。

### 3.4 长期蒙特卡洛(forecastMonths > 36)

当用户拉长预测窗口(超过 3 年)时,启用蒙特卡洛模式:

1. 0-36 月:沿用确定性 base/low/high 路径
2. 37 月至 forecastMonths:每个情景生成 N 条样本路径

**长期路径生成**(`buildLongTermMonteCarloPolicyPath`):

```
每个周期:
  direction  ← 周期反转概率(reversalBias)
  magnitude  ← 步长
  noise      ← 高斯噪声(基于 uncertainty)

rate(t+1) = rate(t) + directional_drift + oscillation + mean_reversion + noise
```

- `cycleMonths`:长期主导周期(默认 2 年 = 24 月)
- `reversalBias`:下一周期反转上一周期趋势的概率(默认 0.7)
- `monteCarloSampleCount`:每个情景族的样本数(默认 1)

**案例**:36 月时 base 路径 = 4.0%, medium 趋势下降 → 长期样本循环:

```
Month:    36   40   44   48   52   56   60   64   68   72
Sample 1: 4.0  3.8  3.6  3.4  3.5  3.7  3.9  4.1  4.3  4.2
Sample 2: 4.0  3.9  3.8  3.7  3.8  3.9  4.0  4.1  4.2  4.1
Sample 3: 4.0  4.1  4.2  4.3  4.2  4.1  4.0  3.9  3.8  3.7
```

---

## 4. Strategy Generator:拆解候选生成

文件:`packages/strategy-generator/src/index.js`

### 4.1 任务

枚举所有满足约束的 allocation 组合(产品 + 百分比),如:

```
50% floating + 50% fixed-1y        (2 拆分)
20% floating + 80% fixed-3y        (2 拆分)
30% floating + 40% fixed-1y + 30% fixed-3y  (3 拆分)
```

### 4.2 递归网格分配

**核心思路**:遍历每个产品,从 0 到 `1 / percentageStep` 的网格步长分配百分比。

```
allocate(currentIndex, currentAllocation, remaining%, floatingSoFar, fixedSoFar, trancheCount)
  ├─ remaining = 0  → 校验 + 写入策略
  ├─ currentIndex ≥ products.length  → 剪枝
  └─ for steps in 0..stepCount:
       ├─ 试分配 steps × step 给当前产品
       ├─ 递归到下一个产品
       └─ 收集所有合法结果
```

### 4.3 六条剪枝规则(PR-1 .. PR-6)

| PR | 检查                           | 触发条件                                  |
|----|--------------------------------|--------------------------------------------|
| PR-1 | 浮动上限                  | `floatingSoFar > maxFloating%`             |
| PR-2 | 固定下限                  | `fixedSoFar + remaining < minFixed%`      |
| PR-3 | 拆分数量上限              | `trancheCount ≥ maxSplits && remaining > 0`|
| PR-4 | 最低金额                  | 任一 allocation × total < minTrancheAmount |
| PR-5 | 重复产品                  | catalog 去重                              |
| PR-6 | 重复组合                  | 按 sorted(productCode) 排序后 key 去重     |

### 4.4 案例:7 个 NZ 产品,maxSplits=5,step=5%

```
candidate 数量: 35 个组合  (vs 不剪枝的 21^7 ≈ 1.8 亿)
递归调用次数: ~2,000 次   (vs 不剪枝的 1.8 亿)
剪枝效果:    99.999% 减少
```

---

## 5. Mortgage Engine:摊还核心

文件:`packages/mortgage-engine/src/{amortisation.js, refix.js, utils.js}`

### 5.1 单期 12 步流水线

每个还款周期(weekly / fortnightly / monthly)执行:

```
┌────────────────────────────────────────────────────────────────┐
│ Step 1: 计算 currentDate 和 monthIndex                          │
│ Step 2: 对每个 tranche:refix 或更新浮动利率                    │
│ Step 3: 应用 Offset events(如有)                              │
│ Step 4-5: 每 tranche:period interest + scheduled principal    │
│ Step 6: mandatoryTotal = Σ scheduled                           │
│ Step 7: applyPaymentPolicy(mandatoryTotal, target, policy)    │
│ Step 8: 处理 extraRepayments → targetedExtras + generalExtra  │
│ Step 9: 分配扣款                                              │
│   9.1 利息(按 tranche.id 顺序)                              │
│   9.2 计划本金(按 tranche.id 顺序)                          │
│   9.3 general extra → 浮动先,后高利率                         │
│   9.4 targeted extra → 指定 tranche                          │
│   9.5 防护 cap 防止负余额                                     │
│ Step 10: 更新 tranche.balance                                 │
│ Step 11: 累加 totals                                          │
│ Step 12: 折叠成 monthly timeline                              │
└────────────────────────────────────────────────────────────────┘
```

### 5.2 Refix 决策(`determineRefixProduct`)

| Rule 类型               | 行为                                  |
|-------------------------|---------------------------------------|
| `move-to-floating`(默认)| 到期 → 转为 floating                 |
| `same-term`             | 到期 → 续期同一固定期限                |
| `specified-sequence`    | 按 sequence 列表轮转                  |

> spec 默认推荐 `same-term`(滚动续期),在 NZ 是最常见的"自动再融资"模式。

### 5.3 计划还款公式(`calculateScheduledPayment`)

**P&I(本息同还)**:

```
payment = balance × (r × (1+r)^n) / ((1+r)^n − 1)

其中:
  r = annualRate / periodsPerYear  (周期利率)
  n = remainingPeriods              (剩余期数)
```

**Interest-Only(只还利息)**:

```
payment = balance × r
```

**案例**(测试 fixture):$500,000 贷款,5% 年利率,30 年 P&I 月供

```
r = 0.05 / 12 = 0.00416667
n = 360
(1+r)^n = 6.0226
payment = 500,000 × (0.00416667 × 6.0226) / (6.0226 − 1)
        = 500,000 × 0.004167 × 1.0034   ← 简化
        ≈ $2,684.11
```

### 5.4 Extra Repayment 排序

`sortTranchesForExtraRepayment`:浮动优先,后按利率降序。

```
floating (任意利率)
  ↓
fixed-5y @ 4.5%
  ↓
fixed-3y @ 5.0%
  ↓
fixed-1y @ 6.5%
```

> 理由:浮动没有 break fee,提前还款无成本,资金效率最高;锁定的高息先还更划算。

### 5.5 月度 timeline 折叠

周/双周还款被折叠成月度数据,所有 tranche detail 在同一月份累加:

```
每周日  累积到月底  →  month 1  timeline 行
每双周日 累积到月底  →  month 1  timeline 行
每月底                 →  month 1  timeline 行
```

---

## 6. Simulation Engine:矩阵模拟

文件:`packages/simulation-engine/src/index.js`

### 6.1 单次模拟(`simulateStrategyScenario`)

输入:(mortgage, strategy, scenario, products, currentProductRates)
输出:`SimulationResult` 包含:

| 字段                              | 含义                                |
|-----------------------------------|-------------------------------------|
| `totalInterest`                   | 总利息                              |
| `totalRepayments`                 | 总还款                              |
| `endingBalance`                   | 期末余额                            |
| `maximumPayment`                  | 最高月供                            |
| `minimumPayment`                  | 最低月供                            |
| `averagePayment`                  | 平均月供                            |
| `maximumPaymentIncrease`          | 相邻月最大涨幅                      |
| `paymentVolatility`               | 月供标准差                          |
| `refixEventCount`                 | refix 事件数                        |
| `maximumConcurrentRefixPercentage`| 单月最大并发 refix 比例             |
| `floatingExposure`                | 浮动比例                            |
| `affordabilityBreaches`           | 超过 maxAffordablePayment 的期数    |
| `payoffTime`                      | 偿清月份(forecastMonths+1 = 未清)  |
| `timeline[]`                      | 月度详细时间线                      |
| `refixEvents[]`                   | refix 事件列表                      |

### 6.2 矩阵迭代顺序(scenario outer, strategy inner)

```js
for (let scenarioIndex = 0; scenarioIndex < scenarios.length; scenarioIndex++) {
  for (const strategy of strategies) {
    const result = simulateStrategyScenario(...);
    onProgress(completed, total, { scenario, strategy, scenarioIndex, scenarioTotal });
  }
}
```

**为什么这样安排?**

1. **CPU 缓存命中率**:相同 scenario 共享 policyRatePath / productRatePaths,连续访问 N 次策略能把这些热数据留在 L1/L2 cache 里。
2. **进度条更直观**:UI 显示 "情景 1/3: 33%" 而不是 "策略 5/30: 17%"。
3. **蒙特卡洛批处理友好**:同一情景族的多个样本被一次性处理完。

### 6.3 取消 + 进度

每完成 10 次模拟:`await setTimeout(0)` 让出事件循环,让 UI 有机会渲染进度条。`AbortController.signal` 用于用户取消。

---

## 7. Optimiser:帕累托 + 排名 + 推荐

文件:`packages/optimiser/src/index.js`

### 7.1 输入聚合

把 `simulationResults` 按 strategyId 分组,每组对所有情景做概率加权:

```
expectedInterest = Σ scenario.prob × run.totalInterest
worstCasePayment = max over all scenarios of run.maximumPayment
expectedFloatingExposure = Σ scenario.prob × run.floatingExposure
... (其他 9 个指标类似)
```

### 7.2 九个帕累托 objective

**Term mode**(默认,目标 = 按时还清):

| # | Objective 键                       | 方向     | 单位   | 默认 tolerance |
|---|-------------------------------------|----------|--------|-----------------|
| 1 | `expectedInterest`                  | minimize | $      | 20              |
| 2 | `worstCaseInterest`                 | minimize | $      | 50              |
| 3 | `worstCasePayment`                  | minimize | $/期   | 10              |
| 4 | `expectedMaxConcurrentRefixPercentage` | minimize | 0..1 | 0.02            |
| 5 | `expectedAffordabilityBreaches`     | minimize | 计数  | 1               |
| 6 | `flexibilityPenalty` (1 − floatingExposure) | minimize | 0..1 | 0.02     |
| 7 | `expectedPaymentVolatility`         | minimize | $/期   | 0.05            |
| 8 | `expectedEndingBalance`             | minimize | $      | 200             |
| 9 | `worstCaseAffordabilityBreaches`    | minimize | 计数  | 1               |

**Payment mode**(目标 = 提前偿清):

| # | Objective 键          | 方向     | tolerance |
|---|------------------------|----------|------------|
| 1 | `expectedInterest`     | minimize | 20         |
| 2 | `worstCaseEndingBalance` | minimize | 50       |
| 3 | `payoffTime`           | minimize | 3 月       |
| 4 | `expectedMaxConcurrentRefixPercentage` | minimize | 0.02 |
| 5 | `flexibilityPenalty`   | minimize | 0.02       |
| 6 | `expectedPaymentVolatility` | minimize | 0.05    |

> payment 模式没有 endingBalance objective,因为 payoffTime 已经表达了同一信号(还清时 balance=0)。

### 7.3 Tolerance-aware Dominance

```
A dominates B ⇔
  ∀ objective o: A.o ≤ B.o + tolerance(o)   (容忍窗口内不输)
  ∧ ∃ objective o: A.o < B.o − tolerance(o) (至少一项明显赢)
```

**案例**(测试 fixture 中):

| Strategy | expInterest | worstPay | refixPct | floating | affordability |
|----------|-------------|----------|----------|----------|----------------|
| A        | $16,000     | $4,200   | 0.0      | 1.0      | 1              |
| B        | $18,000     | $3,100   | 0.2      | 0.0      | 0              |
| C        | $18,000     | $4,300   | 0.5      | 0.8      | 1              |

- A dominates C(A 每项 ≤ C + tolerance,且 A 在 interest/worstPay/refix 都明显赢)
- B 是 Pareto-optimal(在稳定性方面独有优势)
- C 被 dominated

### 7.4 评分公式

每个 strategy 在每个维度归一化到 `[0, 1]`:

```
costScore        = (expectedInterest − bounds.cost.min) / bounds.cost.diff
resilienceScore  = (worstCasePayment − bounds.resilience.min) / bounds.resilience.diff
smoothnessScore  = (expectedPaymentVolatility − bounds.smoothness.min) / bounds.smoothness.diff
...

overallScore = Σᵢ wᵢ × scoreᵢ
```

用户权重归一化后用于 `preference` 推荐,**但不**影响 7 张 benchmark 卡。

### 7.5 十张推荐卡

| 卡名 | 含义 | 不受用户权重影响 |
|------|------|-------------------|
| `preference`              | 用户权重加权最优                  | ❌ 受影响          |
| `lowestCost`              | expectedInterest 最小             | ✅                |
| `lowestWorstCaseCost`     | worstCaseInterest 最小(term)      | ✅                |
| `lowestWorstCasePayment`  | worstCasePayment 最小(term)       | ✅                |
| `lowestRefixConcentration`| refix 集中度最小                  | ✅                |
| `lowestBudgetBreaches`    | budget 违约次数最少(term)        | ✅                |
| `lowestVolatility`        | paymentVolatility 最小            | ✅                |
| `lowestEndingBalance`     | 期末余额最小(term)                | ✅                |
| `mostFloating`            | floating 比例最大                 | ✅                |
| `mostStable`              | term→worstPayment 最小 / payment→worstEndingBalance 最小 | ✅ |

> 设计意图:用户拖动权重时,7 张 benchmark 卡保持不变(它们是数学最优),只有 `preference` 卡响应用户偏好。这是产品行为,不是 bug。

### 7.6 中文 pros/cons 生成

基于策略在各维度的归一化位置 + 模式(term/payment),自动生成中文说明:

- cost 在 15% 内 → "预期利息成本极低,利息支出控制最佳。"
- refix 在 50% 内 + diversification 预设 → "分散化预设下:再融资风险分散到不同月份,单次冲击的影响更可控。"
- flex 在 80% 内 → "高比例固定锁死了贷款,限制了随时对冲或大额提前还款。"

---

## 8. 完整案例:用测试 fixture 走一遍

来源:`packages/optimiser/tests/optimiser.test.js` 的策略 1/2/3。

### 8.1 输入

贷款:$500k, 25 年剩余,30 年原始,P&I 月供
市场:OCR 5%, NZ 7 个产品

### 8.2 三策略定义

| 策略 | Allocation           | 含义       |
|------|----------------------|------------|
| 1    | 100% floating        | 全浮动     |
| 2    | 100% fixed-1y        | 全 1 年定  |
| 3    | 80% floating + 20% fixed-1y | 偏向浮动 |

### 8.3 模拟结果(测试 fixture 注入值)

```
┌──────────┬─────────┬────────┬─────────┬────────┬──────────┬──────────┬──────────┐
│ Strategy │ Scen    │ TotInt │ EndBal  │ MaxPay │ Volat.   │ Refix%   │ Breach   │
├──────────┼─────────┼────────┼─────────┼────────┼──────────┼──────────┼──────────┤
│ 1        │ low     │ 10,000 │ 400,000 │ 3,000  │ 150      │ 0        │ 0        │
│ 1        │ base    │ 15,000 │ 405,000 │ 3,200  │ 180      │ 0        │ 0        │
│ 1        │ high    │ 25,000 │ 415,000 │ 4,200  │ 300      │ 0        │ 1        │
│ 2        │ low     │ 16,500 │ 408,000 │ 3,100  │ 0        │ 0.2      │ 0        │
│ 2        │ base    │ 16,500 │ 408,000 │ 3,100  │ 0        │ 0.2      │ 0        │
│ 2        │ high    │ 16,500 │ 408,000 │ 3,100  │ 0        │ 0.2      │ 0        │
│ 3        │ low     │ 12,000 │ 402,000 │ 3,100  │ 160      │ 0.5      │ 0        │
│ 3        │ base    │ 17,000 │ 407,000 │ 3,300  │ 190      │ 0.5      │ 0        │
│ 3        │ high    │ 27,000 │ 417,000 │ 4,300  │ 310      │ 0.5      │ 1        │
└──────────┴─────────┴────────┴─────────┴────────┴──────────┴──────────┴──────────┘

概率: low=0.20, base=0.60, high=0.20
```

### 8.4 聚合(概率加权)

```
Strategy 1 (全浮动):
  expectedInterest    = 10,000×0.2 + 15,000×0.6 + 25,000×0.2 = 16,000
  expectedMaxPayment  = 3,000×0.2 + 3,200×0.6 + 4,200×0.2 = 3,360
  worstCasePayment    = max(3,000, 3,200, 4,200) = 4,200
  expectedFloatingExp = 1.0
  expectedRefixPct    = 0
  expAffordBreaches   = 0×0.2 + 0×0.6 + 1×0.2 = 0.2

Strategy 2 (全 1 年定):
  expectedInterest    = 16,500
  worstCasePayment    = 3,100
  expectedFloatingExp = 0
  expectedRefixPct    = 0.2

Strategy 3 (浮动主导):
  expectedInterest    = 12,000×0.2 + 17,000×0.6 + 27,000×0.2 = 18,000
  expectedMaxPayment  = 3,100×0.2 + 3,300×0.6 + 4,300×0.2 = 3,460
  worstCasePayment    = 4,300
  expectedFloatingExp = 0.8
  expectedRefixPct    = 0.5
```

### 8.5 帕累托判定

| Strategy | cost | worstPay | refix | flexibility |
|----------|------|----------|-------|-------------|
| 1        | 16k  | 4.2k     | 0     | 1.0         |
| 2        | 16.5k| 3.1k     | 0.2   | 0           |
| 3        | 18k  | 4.3k     | 0.5   | 0.8         |

- **Strategy 1 Pareto-optimal**:成本最低 + 灵活度最高(每项 ≤ S3 + tolerance,明显赢 cost 和 flex)
- **Strategy 2 Pareto-optimal**:稳定性独有优势(worstPay 3.1k 比 S1/S3 都低)
- **Strategy 3 dominated**:cost / worstPay / refix / flexibility 四项都输

→ 推荐卡:
- `lowestCost` = Strategy 1
- `mostStable` = Strategy 2
- `preference` (默认权重 cost=15% + others 平衡) → 取决于 slider

### 8.6 趋势图:加权得分 vs 权重滑块

```
score
  ↑
  │
0.3┤  ─── Strategy 1 ───────────  (cost 占主导)
  │      ●●●
0.2┤  ───────●───── Strategy 3 ──
  │             ●●●
0.1┤  ───────────────●────── Strategy 2 ────────  (resilience 占主导)
  │                                            ●●●
0.0┤
  └──┬────┬────┬────┬────┬────┬────→ sliderCostStability
     0.0  0.2  0.4  0.6  0.8  1.0
```

---

## 9. 图表汇总

### 9.1 OCR 路径(典型案例)

```
OCR
6.0% ┤
5.5% ┤  ●
5.0% ┤  ╲  ◀ initialRate = 5.0%
4.5% ┤    ●───────●
4.0% ┤              ╲  ◀ shortTermChange = -1% → 12 月
3.5% ┤                ●─────────●  ◀ mediumTermDirection = -1
3.0% ┤                           ╲
     └──┬──┬──┬──┬──┬──┬──┬──→ Month
        0  6 12 18 24 30 36 60
```

### 9.2 三情景利率带

```
Rate
5.5% ┤                              ╱╲  high
5.0% ┤  ───●───────●──── base
4.5% ┤        ╲   ╱
4.0% ┤          ●
3.5% ┤              ───●─────●────── low
3.0% ┤                  ╲
     └──┬──┬──┬──┬──┬──┬──→ Month
        0  6 12 18 24 36
```

### 9.3 月供曲线(全浮动,三情景)

```
$/月
4500 ┤                          ╱ high:4,200
4000 ┤                       ╱
3500 ┤                    ╱
3000 ┤  ─── base:3,200  ─────  低波动
2500 ┤  ─── low:2,800
2000 ┤
     └──┬──┬──┬──┬──┬──┬──→ Month
        0  6 12 18 24 30 36
```

### 9.4 月供曲线(全 1 年定,三情景)

```
$/月
3500 ┤  ─── flat line @ 3,100  ───  (rate locked 12mo)
3000 ┤                       ●  ← refix 跳变
     └──┬──┬──┬──┬──┬──┬──→ Month
        0  6 12 18 24 30 36
```

### 9.5 帕累托散点(cost vs refix)

```
       worstRefix%
1.0 ┤              ●
    │           ╱
0.5 ┤       ●      ← Strategy 3(dominated)
    │      ╱
0.2 ┤  ●             ← Strategy 2 (Pareto)
    │   ╲
0.0 ┤    ●          ← Strategy 1 (Pareto)
    └──┬────┬────┬────→ expectedInterest
       16k  17k  18k
```

### 9.6 长期蒙特卡洛扇形

```
PolicyRate
5.0% ┤
     │        ╱╲   ╱╲
4.0% ┤  ───●──╲─●╱──╲●──  ← 36mo boundary
     │     ╱    ╳    ╲╱
3.0% ┤   ╱   ╱  ╲   ╱
     │  ╱   ╱    ╲ ╱
2.0% ┤ ╱   ╱      ╳
     │╱   ╱      ╱ ╲
1.0% ┤   ╱      ╱   ╲
     └──┬──┬──┬──┬──┬──→ Month
        0 24 48 72 96
        └──┬──┘
       deterministic  MC samples fan-out
```

---

## 10. 偏好权重体系

### 10.1 七大偏好维度

| Key            | 中文含义                | 关联 objective                |
|----------------|-------------------------|--------------------------------|
| `cost`         | 期望利息                | expectedInterest               |
| `principal`    | 本金压缩速度            | expectedEndingBalance          |
| `refix`        | refix 分散度            | expectedMaxConcurrentRefixPct  |
| `flex`         | 浮动灵活度              | flexibilityPenalty(inverted)   |
| `resilience`   | 最坏情况防御            | worstCasePayment               |
| `budget`       | 预算内可控              | expectedAffordabilityBreaches  |
| `smoothness`   | 月供稳定                | expectedPaymentVolatility      |

### 10.2 默认权重(V6)

```js
{ cost: 15, principal: 15, refix: 15, flex: 15, resilience: 15, budget: 10, smoothness: 15 }
```

总计 100,各维度接近均匀 — 没有任何单一维度压倒性主导。

### 10.3 25% 硬上限

任何单一维度的权重被 UI 强制限制在 `[0, 25]`,确保至少 4 个维度同时被考虑。

```
权重条:
cost        ████████░░░░░░░░░░░░░░░░  15%
principal   ████████░░░░░░░░░░░░░░░░  15%
refix       ████████░░░░░░░░░░░░░░░░  15%
flex        ████████░░░░░░░░░░░░░░░░  15%
resilience  ████████░░░░░░░░░░░░░░░░  15%
budget      █████░░░░░░░░░░░░░░░░░░░  10%
smoothness  ████████░░░░░░░░░░░░░░░░  15%
              ↑ 拖到这里 UI 强制 cap 25
```

### 10.4 推荐计算中的权重转换

用户传入 `weights` 后:

```js
totalRaw = Σ weights[key]
wᵢ = weights[i] / totalRaw
overallScore = Σᵢ wᵢ × normalizedScoreᵢ
```

排序:分数升序(分数越低越好),`preference` = 排名第一。

> 注意:benchmark 卡 (lowestCost 等) **不**用权重,它们是数学最优。

---

## 11. 测试覆盖与确定性保证

### 11.1 测试统计

| 包                       | 测试数 | 关键覆盖                                       |
|--------------------------|--------|------------------------------------------------|
| `schemas`                | ~10    | Zod schema 校验                                |
| `country-adapters`       | ~5     | nzProfile / nzBetas shape                      |
| `rate-engine`            | ~10    | 插值 + 政策路径 + 产品路径                     |
| `scenario-engine`        | ~5     | 三情景生成 + 蒙特卡洛扩展 + 概率归一化        |
| `strategy-generator`     | ~3     | 网格枚举 + 剪枝 + 去重                        |
| `mortgage-engine`        | ~34    | 摊还核心 + refix + 排序 + 月度折叠            |
| `simulation-engine`      | ~6     | 单次 + 矩阵 + 进度 + 取消 + 确定性 + scenario outer |
| `optimiser`              | ~16    | 帕累托 + 9 objective + tolerance + benchmark   |

**总计:104 测试,全部通过。**

### 11.2 确定性

`simulation-engine` 内的 Golden case 32 + 33 验证:相同输入矩阵两次运行 → 输出完全一致(JSON.stringify 等价)。Monte Carlo 路径用 hashSeed + createRng 保证可重现。

### 11.3 Scenario-Grouped 迭代验证

Golden case:3 情景 × 2 策略 = 6 次模拟,`onProgress` 回调记录顺序:

```
期望:
  [(scenario 0, strategy A),
   (scenario 0, strategy B),
   (scenario 1, strategy A),
   (scenario 1, strategy B),
   (scenario 2, strategy A),
   (scenario 2, strategy B)]
```

测试断言 scenarioIndex 单调非降,且每个情景内策略顺序保持。

---

## 12. UI 层整合(`apps/web/app/strategy-lab/page.js`)

### 12.1 Slider 控件矩阵

| 控件                   | 默认 | 范围       | 影响                              |
|------------------------|------|------------|-----------------------------------|
| `shortTermChange`      | 0%   | −2% ~ +2%  | 12 月内的 OCR 变化幅度           |
| `mediumTermDirection`  | 0    | −1 ~ +1    | 12 月后趋势(每单位 = 0.5%/年)  |
| `changeSpeed`          | 0.5  | 0 ~ 1      | 短期过渡曲线曲率                  |
| `uncertainty`          | 1%   | 0 ~ 2%     | 情景带宽度                        |
| `scenarioProbabilities`| 15/70/15 | 任意(归一化) | 概率权重 |
| `longTermCycleYears`   | 2    | 1 ~ 10     | 蒙特卡洛周期                      |
| `longTermReversalBias` | 0.7  | 0.5 ~ 0.95 | 周期反转概率                      |
| `maxSplits`            | 3    | 1 ~ 5      | 候选生成时的拆分上限              |
| `maxFloatingPercentage`| 50%  | 0 ~ 80%    | 浮动比例上限                      |
| `percentageStep`       | 10%  | 1% / 5% / 10% | 网格步长                       |
| `maxAffordablePayment` | $5,000 | 任意    | budget 违约阈值                   |
| `simDurationYears`     | 5    | 1 ~ 10     | 预测窗口(受 mortgage term 限制)  |
| 7 个权重滑块           | 各 15% | 0 ~ 25%   | preference 评分                   |

### 12.2 Web Worker 边界

`apps/web/workers/simulation.worker.js` 是唯一调用 `simulateStrategyScenarioMatrix` 的地方。

```
Page ───────────────► Worker
       { type: 'run',
         mortgage, strategies, scenarios,
         products, currentProductRates,
         startDate, forecastMonths,
         maxAffordablePayment }

Worker ─────────────► Page
       { type: 'progress',
         completed, total, current }

Worker ─────────────► Page
       { type: 'success',
         results: SimulationResult[] }

Worker ─────────────► Page
       { type: 'error',
         message }
```

### 12.3 20K 模拟警告

当 `strategies.length × scenarios.length > 20,000` 时,UI 显示警告条 + 简化建议:

- 减少 `maxSplits`
- 加大 `percentageStep`
- 减少 `monteCarloSampleCount`
- 缩短 `simDurationYears`

### 12.4 详情弹窗(StrategyDetailModal)

点击任意推荐卡 / Pareto 表行 → 打开 modal:

- 顶部 badge + 关闭按钮
- 12 格 metrics 网格
- pros/cons 双列(自动生成的中文)
- BalanceLinechart(SvgChart)
- InlineTimeline(每 4 月一个快照 × 每 tranche 利率/事件/利息/本金)

---

## 13. 文件清单(按依赖顺序)

```
packages/
├── schemas/src/index.js               Zod 类型 + typedef
├── country-adapters/src/nz.js         NZ 产品目录 + β
├── rate-engine/src/
│   ├── policyRate.js                  buildPolicyRatePath
│   ├── productRate.js                 deriveProductRatePaths
│   └── interpolation.js               getRateFromPath / interpolateLinear
├── scenario-engine/src/index.js       generateScenarios / validateScenario
├── strategy-generator/src/index.js    generateSplitStrategies(PR-1..PR-6)
├── mortgage-engine/src/
│   ├── amortisation.js                simulateMortgageTimeline (12 步)
│   ├── refix.js                       determineRefixProduct / getRateForMonth
│   └── utils.js                       roundMoney / addDays / addMonths
├── simulation-engine/src/index.js     simulateStrategyScenarioMatrix
└── optimiser/src/index.js             optimizeStrategies (9 objective + 10 cards)

apps/web/
├── app/strategy-lab/page.js           Slider + Worker 调用 + 结果渲染
├── components/StrategyDetailModal.js  详情弹窗
├── components/SvgChart.js             SVG 折线/柱状
├── components/PreferenceWeightsModal.js  偏好权重弹窗
├── features/storage.js                IndexedDB 封装
└── workers/simulation.worker.js       唯一调用 simulation-engine 的地方
```

---

## 14. 关键数学公式速查

| 概念              | 公式                                                     |
|-------------------|----------------------------------------------------------|
| 周期利率           | `r = annualRate / periodsPerYear`                        |
| P&I 月供           | `P = B × r(1+r)^n / ((1+r)^n − 1)`                      |
| 浮动产品利率       | `forecast = current + β × ΔOCR + spreadShock`            |
| 固定产品利率       | `forecast = current + ΔOCR + spreadShock`                |
| 蒙特卡洛长期噪声   | `rate(t+1) = rate(t) + drift + oscillation + meanRev + noise` |
| Tol-aware dominance | `∀o: A.o ≤ B.o + tol(o) ∧ ∃o: A.o < B.o − tol(o)`        |
| 归一化分数         | `(value − min) / (max − min)`                           |
| 加权得分           | `Σᵢ wᵢ × normalizedᵢ`                                   |

---

## 15. 常见陷阱与设计取舍

| 陷阱                                | 应对                                                              |
|-------------------------------------|-------------------------------------------------------------------|
| 旧 weights 缺少 `smoothness` 字段   | `setWeights({ ...DEFAULT_WEIGHTS, ...p.weights })` 合并默认值      |
| 受控/非受控切换警告                 | `value={w.value ?? 0}` 提供 fallback                              |
| 蒙特卡洛样本数大导致 OOM            | 结果存 IndexedDB + 20K 警告 + 简化建议                            |
| 90/10 极值主导推荐                  | 默认均匀权重 + 25% 硬上限 + 50% 浮动上限默认                      |
| 单期 vs 月度不一致                  | weekly / fortnightly 折叠成月度 timeline                          |
| extra.frequency 与 mortgage 不同    | 当前 stubbed:沿用 mortgage 频率(spec 6.5 todo)                  |
| 缓存利率路径以提升矩阵性能          | scenario outer / strategy inner 迭代                              |
| 用户希望极端偏好                    | UI 硬 cap 25%,设计上强制多维平衡                                  |

---

## 16. 版本与引用

- 模型版本:`nz-1.1.0`
- 构建:`NEXT_PUBLIC_BUILD_ID` 在 build 时注入
- 测试:`npm test` → 104 passed
- 类型检查:`npm run check` → 0 errors
- Lint:`npm run lint` → clean

---

**文档维护**:本文件位于 `docs/SIMULATION_README.md`,与代码同步更新。当 engine 包的行为改变时,需同步修改对应章节。
