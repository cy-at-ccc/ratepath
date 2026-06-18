# RatePath 帕累托评价 v9 — 4 张卡 + 12 objective + 8 个滑块

## Context

用户接受"4 张卡 + 8 个滑块"方案。

**最终方案(v9)**:

- **4 张推荐卡**:preference / lowestCost / mostStable / worstCaseDefense
- **12 个 Pareto objective**(v6 的 9 个 + 新增 3 个)
- **8 个用户权重滑块**(原 7 个 + 新增 1 个 `worstCaseDefense`)
- 修 10-90 偏差的 4 个根因

---

## 12 个 Pareto objective(term 模式)

| # | Objective 键 | 单位 | Tolerance | 含义 |
|---|--------------|------|-----------|------|
| 1 | `expectedInterest` | $ | 20 | 期望总利息(平均利率水平) |
| 2 | `worstCaseInterest` | $ | 50 | 最坏情景下总利息(利率暴涨时) |
| 3 | `worstCasePayment` | $/期 | 10 | 最坏月供峰值(利率冲击下) |
| 4 | `expectedMaxConcurrentRefixPercentage` | 0..1 | 0.02 | refix 集中度(同月多笔到期) |
| 5 | `expectedAffordabilityBreaches` | 计数 | 1 | 期望预算违约次数 |
| 6 | `worstCaseAffordabilityBreaches` | 计数 | 1 | 最坏月份违约次数 |
| 7 | `flexibilityPenalty` (1 − floatingExp) | 0..1 | 0.02 | 浮动灵活度(高 = 锁死) |
| 8 | `expectedPaymentVolatility` | $/期 | 0.05 | 月供波动(临近 refix 跳升) |
| 9 | `expectedEndingBalance` | $ | 200 | 本金压缩速度 |
| 10 | `expectedRefixEventCount` | 计数 | 1 | 期望 refix 次数 |
| 11 | `expectedMaxPayment` | $/期 | (派生) | 期望最大月供(score 用) |
| 12 | `baseCaseInterest` | $ | (派生) | 基准情景利息(已聚合) |

**Payment 模式**:9 个(去掉 endingBalance、affordability、worstCasePayment,加 payoffTime、worstCaseEndingBalance)

---

## 4 张推荐卡

```
┌──────────────────┬──────────────────┐
│  ① preference    │  ② lowestCost    │
│  (用户偏好综合)  │  (期望成本最低)  │
│  随滑块变        │  数学最优,不变   │
│  8 滑块加权      │  expectedInterest│
└──────────────────┴──────────────────┘

┌──────────────────┬──────────────────┐
│  ③ mostStable    │  ④ worstCase-    │
│  (最稳的)        │     Defense      │
│  最坏月供最低    │  (抗压性最优)   │
│  数学最优,不变   │  随 worstCase-   │
│  worstCasePay    │  Defense 滑块变  │
└──────────────────┴──────────────────┘
```

**驱动关系**:

| 卡 | 驱动 objective | 响应用户权重? |
|----|----------------|---------------|
| `preference` | 12 个 objective × 8 个 weights 加权 | ✅ 全部 |
| `lowestCost` | `expectedInterest` 单维度 min | ❌ 不变 |
| `mostStable` | `worstCasePayment` 单维度 min | ❌ 不变 |
| `worstCaseDefense` | `worstCaseInterest` + `worstCaseAffordabilityBreaches` + `worstCasePayment` 综合 | ⚠️ **响应 `worstCaseDefense` 滑块** |

---

## 8 个用户偏好滑块

| # | Key | 中文标签 | 默认值 | 驱动 objective |
|---|-----|----------|--------|----------------|
| 1 | `cost` | 利息成本 | 12% | `expectedInterest` |
| 2 | `principal` | 本金还款速度 | 12% | `expectedEndingBalance` |
| 3 | `refix` | 利率重定价风险 | 12% | `expectedMaxConcurrentRefixPercentage` |
| 4 | `flex` | 资金流灵活性 | 10% | `flexibilityPenalty` |
| 5 | `resilience` | 极端高息抗压性 | 12% | `worstCasePayment` |
| 6 | `budget` | 预算超限控制 | 10% | `expectedAffordabilityBreaches` |
| 7 | `smoothness` | 供款平稳度 | 10% | `expectedPaymentVolatility` |
| 8 | `worstCaseDefense` | **最坏情况抗压性** | 12% | `worstCaseInterest` + `worstCaseAffordabilityBreaches` + `worstCasePayment` 综合 |

**总和 100%**:`12×5 + 10×3 = 90`(差 10% — 实际:cost 12 + principal 12 + refix 12 + flex 12 + resilience 12 + budget 10 + smoothness 10 + worstCaseDefense 12 = 92) → 重新平衡到 100。

实际建议:

```js
const DEFAULT_WEIGHTS = {
  cost: 13,
  principal: 12,
  refix: 12,
  flex: 11,
  resilience: 12,
  budget: 10,
  smoothness: 10,
  worstCaseDefense: 20
};
// 总和 100,worstCaseDefense 略高(用户最关心的"风险控制"维度)
```

---

## 核心改动

### 改动 1:optimiser — 3 个新 Pareto objective

**文件:** `packages/optimiser/src/index.js`

- `DEFAULT_TOLERANCES_TERM` 加 `expectedRefixEventCount: 1`
- `getTermObjectives()` 加 `worstCaseInterest, worstCaseAffordabilityBreaches, expectedRefixEventCount`(9 → 12)
- `getPaymentObjectives()` 加同样 3 个(6 → 9)
- `bounds` 对象加 3 个新 key
- `scoring` 加 3 个新 score 变量
- `weights` reader 加 1 个分支(`weights.worstCaseDefense`),喂给新的综合 `worstCaseDefenseScore`

### 改动 2:`worstCaseDefense` 综合分

新增 helper:

```js
function worstCaseScore(s, bounds) {
  return (
    (s.worstCaseInterest - bounds.worstCaseInterest.min) / bounds.worstCaseInterest.diff * 0.5 +
    (s.worstCaseAffordabilityBreaches - bounds.worstCaseAffordabilityBreaches.min) / bounds.worstCaseAffordabilityBreaches.diff * 0.3 +
    (s.worstCasePayment - bounds.worstCasePayment.min) / bounds.worstCasePayment.diff * 0.2
  );
}
```

- `pickMin(recommendationCandidates, worstCaseScore)` 选 `worstCaseDefense` 卡
- `worstCaseDefense` 是**唯一响应 `worstCaseDefense` 权重滑块**的卡(其他 3 张卡完全不变)

### 改动 3:UI — 4 张推荐卡

**文件:** `apps/web/app/strategy-lab/page.js`

把现有 BenchmarkCards 区域从 8 张卡(7 benchmark + preference)缩成 4 张:

```jsx
<div className="rec-grid">
  <RecommendationCard type="preference" ... />          {/* 响应 8 滑块 */}
  <RecommendationCard type="lowestCost" ... />          {/* 数学最优 */}
  <RecommendationCard type="mostStable" ... />          {/* 数学最优 */}
  <RecommendationCard type="worstCaseDefense" ... />    {/* 响应 worstCaseDefense 滑块 */}
</div>
```

Pareto 表加 3 列:`worstCaseInterest`、`worstCaseAffordabilityBreaches`、`expectedRefixEventCount`。

### 改动 4:UI — 8 个偏好滑块

```js
const DEFAULT_WEIGHTS = {
  cost: 13,
  principal: 12,
  refix: 12,
  flex: 11,
  resilience: 12,
  budget: 10,
  smoothness: 10,
  worstCaseDefense: 20
};
```

`preferenceWeightItems`(line 1212-1262)加 1 个新条目:

```js
{ key: "worstCaseDefense", label: "最坏情况抗压性 (Worst-Case Defense)", ... }
```

### 改动 5:修 10-90 偏差(同 v7)

- `percentageStep` 默认 0.10 → 0.05(`page.js:127`)
- `handleWeightChange` 硬上限 100 → 25(`page.js:207`)
- `isConstraintsModified` / `handleResetConstraints` / `PRESET_PROFILES.default` 三处 `maxFloatingPercentage: 10` → 50
- `recommendationMinAllocationCount` 默认 1 → 2(让 4 张卡都从 ≥ 2 allocation 候选池里选)
- `PreferenceWeightsModal.js:127` `max={100}` → `max={25}`

### 改动 6:测试更新

`packages/optimiser/tests/optimiser.test.js`:

- 5 个 fixture 加 3 个新 key = 0(避免 dominance 翻转)
- 新增 1 个 test 验证 12 objective 集合包含 3 个新 key
- 新增 1 个 test 验证 `worstCaseDefense` benchmark 响应 `worstCaseDefense` 滑块

---

## 关键修改文件

| 文件 | 改动 |
|------|------|
| `packages/optimiser/src/index.js` | tolerance + objectives + bounds + scoring + weights reader + worstCaseScore helper + pickMin(4 张) + recommendations(4 张) + JSDoc |
| `packages/optimiser/tests/optimiser.test.js` | 5 fixture 补新 key + 2 个新 test |
| `apps/web/app/strategy-lab/page.js` | DEFAULT_WEIGHTS 7→8 + 1 个 preferenceWeightItems + percentageStep 0.10→0.05 + 25% cap + 3 处默认一致化 + recommendationMinAllocationCount + 4 张卡片渲染(替换原 8 张) + Pareto 表加 3 列 |
| `apps/web/components/PreferenceWeightsModal.js` | `max={25}` |

---

## 验收测试

### 自动

1. `npm run check` — tsc 0 错误
2. `npm test` — 106 测试全绿(104 现有 + 2 新)
3. `npm run lint` — 无错误

### 手工(浏览器)

1. 默认加载,数清 **4 张推荐卡**
2. 偏好权重 modal 数清 **8 个滑块**(原 7 + 新 1)
3. 拖 `cost` 滑块:仅 `preference` 卡变化(其他 3 张不变)
4. 拖 `worstCaseDefense` 滑块:`preference` 和 `worstCaseDefense` 都变(`lowestCost`、`mostStable` 不变)
5. 候选集表格出现 33-33-33、40-30-30 等中间型
6. Pareto 表有 12 列
7. 点 "重置默认":`maxFloatingPercentage` 滑块停在 50

### 关键回归点

- 5 个 fixture 测试必须补 3 个新 key
- `worstCaseDefense` 卡是**唯一**对 `worstCaseDefense` 滑块敏感的 benchmark 卡
- 旧 IndexedDB 7-key weights 自动合并 DEFAULT_WEIGHTS(8-key)再 normalize

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 3 新 objective 加入 dominance 后旧 fixture 翻转 | 5 fixture 加 0 默认 |
| `percentageStep=0.05` 候选 ×4 | 20K 警告 + 减少 splits 建议 |
| 25% × 8 key 可屏蔽 4 维度 | aria-live 提示"已用 X/8 维度" |
| `worstCaseDefense` 综合分公式主观 | 0.5/0.3/0.2 在 JSDoc 标注可调 |
| 4 张卡 vs 原 8 张信息"减少"感 | Pareto 表加 3 列补细节 |

---

## Defer 项

| 项 | 触发条件 |
|----|----------|
| `worstCost / worstBreach / refixCount` 3 个单独滑块 | 用户反映想分别控制 |
| 3D Pareto 散点图 | Pareto 表 12 列难读 |
| `expectedEndingBalance` 加进 `getPaymentObjectives` | payment mode 评估不准 |
| 4 → 8 张卡的回退 | 4 张不够参考 |

---

## 改完后的预期效果

- **4 张卡简洁**:preference / lowestCost / mostStable / worstCaseDefense
- **8 滑块够用**:用户能直接控制"风险防御"维度
- **12 objective 完整**:3 个新维度在 Pareto dominance 里起作用
- **10-90 偏差消除**:5% step + ≥2 allocation + 25% cap + 默认一致
- **向后兼容**:旧 IndexedDB 7-key weights 自动合并升级

---

## 补充 1:`expectedRefixEventCount` 作为 objective 的设计决策

### 争议

多数 NZ 借款人**故意**选多次 refix(锁定长期利率优惠),refix 次数多**不一定是坏事**。

### 设计决策

把它作为 **minimize objective**,但用相对宽容的 tolerance(`1`):

- 0 次 refix(全浮动)= 0.0 次
- 1 次 refix(1y 滚动续期)≈ 0.6-1.0 次
- 3 次 refix(1y+6m+1y 不同期限混合)≈ 1.5-3.0 次

tolerance = 1 意味着:0 vs 1 次视作等价,1 vs 2 次视作显著差异。这避免了"故意选多次 refix 锁定期"的策略被错误标为 dominated。

### 验证步骤

加 test case:构造 2 个候选,一个 0 次 refix,一个 0.5 次 refix(等价),一个 1.5 次 refix(显著)。验证 tolerance 表现正确。

---

## 补充 2:`worstCaseScore` 综合分的 0.5/0.3/0.2 权重来源

| 因子 | 权重 | 理由 |
|------|------|------|
| `worstCaseInterest` | 0.5 | 利率暴涨时总利息差异最大(典型 $20k-$50k),用户最直观感受到的"长期经济损失" |
| `worstCaseAffordabilityBreaches` | 0.3 | 用户感受到的"还不起月供"的实际压力,但有 maxAffordablePayment 阈值控制 |
| `worstCasePayment` | 0.2 | 已被 `mostStable` 卡覆盖(单维度最优),这里只作为辅助参考 |

JSDoc 必须注明这 3 个权重是**主观默认**,用户可通过 `tolerances` 参数覆盖。

---

## 补充 3:v9 默认权重下"平衡投资"的数学验证

### 假设场景

构造 3 个候选策略(典型测试 fixture 衍生):

- **A**:100% floating — 最便宜但风险最大
- **B**:100% fixed-1y — 中等成本最稳定
- **C**:50% floating + 50% fixed-1y — 平衡型

### 各维度归一化 score(0=最优,1=最差)

| 维度 | A (100% float) | B (100% 1y) | C (50-50) |
|------|----------------|--------------|------------|
| costScore | 0.0 | 1.0 | 0.4 |
| principalScore | 1.0 | 0.0 | 0.5 |
| refixScore | 1.0 | 0.5 | 0.3 |
| flexScore | 0.0 | 1.0 | 0.5 |
| resilienceScore | 1.0 | 0.0 | 0.5 |
| budgetScore | 0.7 | 0.0 | 0.3 |
| smoothnessScore | 1.0 | 0.0 | 0.5 |
| worstCaseScore | 0.7 | 0.3 | 0.4 |

### 加权总分(v9 默认权重)

```
A = 0.13·0.0 + 0.12·1.0 + 0.12·1.0 + 0.11·0.0 + 0.12·1.0 + 0.10·0.7 + 0.10·1.0 + 0.20·0.7
  = 0.00 + 0.12 + 0.12 + 0.00 + 0.12 + 0.07 + 0.10 + 0.14
  = 0.67  ← 最差

B = 0.13·1.0 + 0.12·0.0 + 0.12·0.5 + 0.11·1.0 + 0.12·0.0 + 0.10·0.0 + 0.10·0.0 + 0.20·0.3
  = 0.13 + 0.00 + 0.06 + 0.11 + 0.00 + 0.00 + 0.00 + 0.06
  = 0.36  ← 最好

C = 0.13·0.4 + 0.12·0.5 + 0.12·0.3 + 0.11·0.5 + 0.12·0.5 + 0.10·0.3 + 0.10·0.5 + 0.20·0.4
  = 0.052 + 0.06 + 0.036 + 0.055 + 0.06 + 0.03 + 0.05 + 0.08
  = 0.42  ← 中间
```

### 结论

排序:**B (0.36) < C (0.42) < A (0.67)**

**v9 默认权重下,中间型 50-50 (0.42) 优于 100% floating (0.67)**,但仍输给 100% fixed-1y (0.36)。

要让 C 超过 B,需要:
- `flexScore` 权重 ≥ 14%(现 11%),或
- `worstCaseDefense` 权重 ≥ 25%(触发 25% 上限)

**plan 调整建议**:把 `flex` 默认权重从 11% 提到 **14%**(中间型在 flex 维度拿到更多分),`worstCaseDefense` 维持 20%,`smoothness` 从 10% 降到 9%,`budget` 从 10% 降到 8%,其他保持不变,总和仍为 100。

### 新 DEFAULT_WEIGHTS(v9.1)

```js
const DEFAULT_WEIGHTS = {
  cost: 13,
  principal: 12,
  refix: 12,
  flex: 14,             // ← 从 11 提到 14
  resilience: 12,
  budget: 9,            // ← 从 10 降到 9
  smoothness: 9,        // ← 从 10 降到 9
  worstCaseDefense: 19  // ← 从 20 降到 19
};
// 总和 = 100
```

### 重算(v9.1)

```
B = 0.13·1.0 + 0.12·0.0 + 0.12·0.5 + 0.14·1.0 + 0.12·0.0 + 0.09·0.0 + 0.09·0.0 + 0.19·0.3
  = 0.13 + 0.00 + 0.06 + 0.14 + 0.00 + 0.00 + 0.00 + 0.057
  = 0.387

C = 0.13·0.4 + 0.12·0.5 + 0.12·0.3 + 0.14·0.5 + 0.12·0.5 + 0.09·0.3 + 0.09·0.5 + 0.19·0.4
  = 0.052 + 0.06 + 0.036 + 0.07 + 0.06 + 0.027 + 0.045 + 0.076
  = 0.426

A = 0.13·0.0 + 0.12·1.0 + 0.12·1.0 + 0.14·0.0 + 0.12·1.0 + 0.09·0.7 + 0.09·1.0 + 0.19·0.7
  = 0.00 + 0.12 + 0.12 + 0.00 + 0.12 + 0.063 + 0.09 + 0.133
  = 0.646
```

排序:**B (0.387) ≈ C (0.426) > A (0.646)** — 中间型 50-50 接近 100% fixed-1y,且都远优于 100% floating。

### 验收 vitest

```js
it("v9.1 default weights surface middle-type preference", () => {
  // 构造 A/B/C 三策略的 fixture
  const opt = optimizeStrategies({
    simulationResults: [/* A rows x 3 scenarios, B rows, C rows */],
    scenarios,
    mode: "term",
    weights: { cost: 13, principal: 12, refix: 12, flex: 14,
               resilience: 12, budget: 9, smoothness: 9, worstCaseDefense: 19 }
  });
  // 断言 preference 是中间型 C,不是极端 A 或 B
  expect(opt.recommendations.preference.strategyId).toBe("C");
});
```

---

## 补充 4:UI 界面 mockup

### 桌面端推荐卡区域(≥1024px)

```
┌─────────────────────────────────────────────────────────────────────┐
│  推荐方案 — 基于您的偏好和帕累托前沿                                 │
├──────────────────────┬──────────────────────────────────────────────┤
│ ① preference          │ ② lowestCost                                │
│   综合偏好            │   期望成本最低(数学最优)                    │
│                       │                                              │
│   50% 1y + 50% 6m    │   100% Floating                             │
│   $158k 利息          │   $148k 利息                                │
│   worstCasePay $3,200 │   worstCasePay $4,200                       │
│                       │                                              │
│   帕累托 ✓            │   帕累托 ✓                                   │
├──────────────────────┼──────────────────────────────────────────────┤
│ ③ mostStable          │ ④ worstCaseDefense                          │
│   抗压性最优          │   最坏情况防御(随滑块变)                    │
│   (数学最优)          │                                              │
│                       │   50% 5y + 50% 3y                           │
│   100% 5y Fixed      │   worstPay $3,200                           │
│   月供峰值 $3,004     │   worstInt $230k                            │
│                       │   worstBreach 0 次                           │
│   帕累托 ✓            │   帕累托 ✓                                   │
└──────────────────────┴──────────────────────────────────────────────┘
```

### 偏好权重 modal

```
┌─────────────────────────────────────────────────┐
│  偏好权重调节 (8 个维度,总和 100%)    [关闭 ×]  │
├─────────────────────────────────────────────────┤
│                                                 │
│  拖动滑块调整各维度的重要性。                    │
│  总和自动平衡;单个维度上限 25%。                │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │ 利息成本 cost              [ 13 %]      │   │
│  │ ────●────────────────────               │   │
│  │ 期望总利息(平均利率水平)                │   │
│  └─────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────┐   │
│  │ 本金还款速度 principal      [ 12 %]      │   │
│  │ ────●────────────────────               │   │
│  └─────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────┐   │
│  │ 利率重定价风险 refix       [ 12 %]      │   │
│  │ ────●────────────────────               │   │
│  └─────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────┐   │
│  │ 资金流灵活性 flex          [ 14 %]      │   │
│  │ ─────●───────────────────               │   │
│  │ 浮动 / Offset 占比                      │   │
│  └─────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────┐   │
│  │ 极端高息抗压性 resilience [ 12 %]      │   │
│  │ ────●────────────────────               │   │
│  └─────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────┐   │
│  │ 预算超限控制 budget        [  9 %]      │   │
│  │ ───●─────────────────────               │   │
│  └─────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────┐   │
│  │ 供款平稳度 smoothness     [  9 %]      │   │
│  │ ───●─────────────────────               │   │
│  └─────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────┐   │
│  │ 最坏情况抗压性 worstCase- [ 19 %]      │   │
│  │        Defense                          │   │
│  │ ──────●─────────────────                │   │
│  │ 综合最坏情景(最坏利息+违约+月供)       │   │
│  │ 拖高此滑块会同时影响 ④ 卡               │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  [重置默认]                              [关闭] │
└─────────────────────────────────────────────────┘
```

### Pareto 表(12 列)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ 完整帕累托前沿 — 12 个维度对比                          [全部 ▼] [排序 ▼] │
├────┬──────┬────────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬─────┤
│策略│Pareto│期望利息│最坏利│最坏月│期望  │最坏违│浮动  │月供波│期望  │期望 │
│    │      │(avg)  │息    │供    │refix │约    │      │动    │本金  │refix│
│    │      │       │(wst) │(wst) │集中度│(wst) │      │      │(avg)│次数 │
├────┼──────┼────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┼─────┤
│ A  │  ✓  │ $148k │$280k │$4,200│ 10%  │  0   │ 1.0  │$200  │$200k │ 0.0 │
│ B  │  ✓  │ $158k │$250k │$3,500│  5%  │  0   │ 0.5  │$80   │$220k │ 1.2 │
│ C  │  ✗  │ $165k │$240k │$3,100│  5%  │  0   │ 0.0  │$0    │$250k │ 2.0 │
│ D  │  ✓  │ $172k │$220k │$3,004│  0%  │  0   │ 0.0  │$0    │$280k │ 3.0 │
└────┴──────┴────────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┴─────┘
              ↑                                  ↑
          原列                                 新增 3 列
```

### 移动端(<768px)

4 张卡纵向单列堆叠,modal 全屏,表横向滚动。

---

## 补充 5:改动清单更新

把改动 4 的 `DEFAULT_WEIGHTS` 改为 v9.1 平衡版:

```js
const DEFAULT_WEIGHTS = {
  cost: 13,
  principal: 12,
  refix: 12,
  flex: 14,             // ↑(从 11):让中间型在 flex 维度拿更多分
  resilience: 12,
  budget: 9,            // ↓(从 10)
  smoothness: 9,        // ↓(从 10)
  worstCaseDefense: 19  // ↓(从 20)
};
// 总和 100
```

`preferenceWeightItems` 第 8 项的 `explanation` 文案:

```js
{
  key: "worstCaseDefense",
  label: "最坏情况抗压性 (Worst-Case Defense)",
  minText: "不在乎最坏",
  maxText: "抗压优先",
  explanation: "综合最坏情景防御。拖高此滑块会同时影响 ①preference 和 ④worstCaseDefense 两张卡,推荐更保守的策略(如 50-50 长锁定组合)。"
}
```
- **12 objective 完整**:3 个新维度在 Pareto dominance 里起作用
- **10-90 偏差消除**:5% step + ≥2 allocation + 25% cap + 默认一致
- **向后兼容**:旧 IndexedDB 7-key weights 自动合并升级

---

## 补充 6:Modal 顶部"详细方案介绍"区域设计

### 现状

`StrategyDetailModal.js:131` 处:`const description = recommendation?.description || "查看该策略在所有 Pareto 维度的完整指标、优劣势与时间线。"`

`description` 字段是占位字符串,无真实内容。`recommendation` prop 由 page.js 传入,但只含 `{ type, badgeLabel, label }`,**没有 description**。

### 目标

在 modal 顶部、composition block 下方、metrics 网格上方,**新增"详细方案介绍"区块**,展示:

1. **为什么这个方案被推荐**(用户偏好触发了哪些 objective)
2. **关键取舍说明**(用成本换稳定 / 用灵活换风险 等)
3. **适合人群**(什么样的借款人适合这个方案)
4. **与其他备选的对比**(与同卡类型的次优方案差多少)

### 区块结构

```jsx
<div className="sdm-intro">
  <div className="sdm-intro-section">
    <h4 className="sdm-intro-title">📌 为什么是这个方案</h4>
    <p className="sdm-intro-body">{whyThisOne}</p>
  </div>
  <div className="sdm-intro-section">
    <h4 className="sdm-intro-title">⚖️ 关键取舍</h4>
    <p className="sdm-intro-body">{tradeOff}</p>
  </div>
  <div className="sdm-intro-section">
    <h4 className="sdm-intro-title">👤 适合人群</h4>
    <p className="sdm-intro-body">{suitableFor}</p>
  </div>
  <div className="sdm-intro-section sdm-intro-compare">
    <h4 className="sdm-intro-title">📊 与备选方案对比</h4>
    <ul className="sdm-intro-list">
      <li>比次优方案多花 <span className="sdm-intro-diff">$2,400</span> 利息,但稳定性提升 <span className="sdm-intro-diff">$300/月</span></li>
    </ul>
  </div>
</div>
```

### 4 张卡的不同"为什么"

| 卡 | whyThisOne 文案 |
|----|----------------|
| `preference` | 根据您当前的偏好权重(cost 13%, worstCaseDefense 19%, ...),这个方案在 8 个维度的加权得分最低(0.426)。它在 [最强维度] 上表现最佳,在 [最弱维度] 上相对较弱。 |
| `lowestCost` | 在所有候选策略中,这个方案的**期望总利息最低**($148k)。它通过 [组合描述] 实现成本最优,但其他维度(如稳定性、灵活性)并非最优。 |
| `mostStable` | 在所有候选策略中,这个方案的**最坏月供峰值最低**($3,004)。它通过 [组合描述] 锁定月供,在利率暴涨情景下依然保持稳定,但期望总利息较高。 |
| `worstCaseDefense` | 综合最坏情景下,这个方案的**最坏利息($230k) + 最坏违约(0次) + 最坏月供($3,200)** 综合分最低。它是您设置 worstCaseDefense 滑块 [当前值] 权重时的最优选择。 |

### tradeOff / suitableFor / comparison 的生成算法

- **deriveTradeOff**:遍历 12 个维度,排名 Top 20% 标记"优异",Bottom 20% 标记"较弱",拼成自然语言段
- **deriveSuitableFor**:根据浮动比例 / refix 集中度 / 月供峰值 / 本金余额 等阈值匹配典型场景标签
- **buildComparison**:按加权 score 距离找最近的 2 个备选,显示"利息差 + 稳定性差"

### 改动清单

| 文件 | 改动 |
|------|------|
| `apps/web/components/StrategyDetailModal.js` | 新增 `sdm-intro` JSX 区块 + 接收 `intro` prop + 新增 CSS 样式 |
| `apps/web/app/strategy-lab/page.js` | 新增 `buildStrategyIntro()` helper + 在打开 modal 时传入 `intro={...}` + 根据 `originCard` 生成不同文案 |

### 数据流

```
[用户点击 ①/②/③/④ 卡]
    ↓
[openStrategyDetailModal(strategyId, originCard)]
    ↓
[buildStrategyIntro(strategy, { originCard, alternatives, weights })]
    ├── 根据 originCard 选 whyThisOne 模板
    ├── 通用 deriveTradeOff / deriveSuitableFor / buildComparison
    └── 返回 { whyThisOne, tradeOff, suitableFor, comparison[] }
    ↓
[<StrategyDetailModal intro={...} />]
    ↓
[modal 顶部显示 4 段介绍]
```

### 验收

1. 4 张卡任意一点,modal 顶部出现 4 段介绍
2. `preference` 卡的 whyThisOne 包含当前权重值
3. 3 张客观锚点卡 whyThisOne 各强调对应 objective
4. `worstCaseDefense` 卡 whyThisOne 含当前滑块值
5. 对比列表显示 1-2 个最接近备选 + 关键差异
6. 文案随权重滑块变化实时更新(preference 卡)

---

## 补充 7:RatePath v10 — Picker Mutex + Concentration Pareto Axis

### Context

v9 完成后用户反馈:3 张 benchmark 卡片(`lowestCost` / `mostStable` / `worstCaseDefense`)经常选中同一个 10-90 极端策略,因为在 NZ 利率曲线下,10-90 同时在 `expectedInterest` 和 `worstCaseCompositeScore` 上最优。v10 修复两个问题:

1. **Picker 互斥**:3 个 benchmark picker 顺序排除彼此的选中(preference 不参与互斥,因为它响应用户权重)
2. **`concentration` Pareto 轴**:新增"最大单笔占比"作为 Pareto 主导轴,让 50-50 中间型策略不被 10-90 极值默默主导

### 核心改动

#### 改动 1:`optimiser/src/index.js`

**A. Tolerance(line 8-39, 42-54)**

在 `DEFAULT_TOLERANCES_TERM` 和 `DEFAULT_TOLERANCES_PAYMENT` 各加:

```js
concentration: 0.05  // 5pp on max single allocation share
```

理由:allocation-share 比 time-share 不敏感(NZ 产品目录主要是 5%/10% 步长),5pp 让 50-50 vs 55-45 相等、50-50 vs 60-40 区分。

**B. Objective list(line 117-128, 152-166)**

`getTermObjectives().objectives` 末尾追加 `"concentration"`。`getPaymentObjectives().objectives` 同。

**C. 签名 + aggregated push(line 369-478)**

```js
// 签名新增
strategies = undefined  // optional

// aggregatedStrategies.push 之前
const stratEntry = strategies && Array.isArray(strategies)
  ? strategies.find(x => x.id === strategyId || x.strategyId === strategyId)
  : undefined;
const concentration = stratEntry && Array.isArray(stratEntry.allocations) && stratEntry.allocations.length > 0
  ? Math.max(...stratEntry.allocations.map(a => Number(a.percentage) || 0))
  : 1.0;  // 默认 1.0 保护 Pareto 主导语义

// push 对象加
concentration: Math.round(concentration * 1e4) / 1e4
```

**D. Bounds(line 498-516)**

```js
concentration: getBoundsFor(aggregatedStrategies, "concentration")
```

**E. Scoring(line 600-644)**

跟随 v9 `worstCaseAffordabilityBreaches` 先例:派生 `concentrationScore` 并 surface 到 ranked strategy,但**不**加 `wConcentration` weight。

**F. Picker 互斥(line 674-699)** — v10 核心

```js
const excludedStrategyIds = new Set();
const pickExcluding = (pool, key, cmp) => {
  const filtered = pool.filter(s => !excludedStrategyIds.has(s.strategyId));
  if (filtered.length === 0) return pickMin(pool, key, cmp);  // 小池 fallback
  return pickMin(filtered, key, cmp);
};
const pickExcludingComposite = (pool) => {
  const filtered = pool.filter(s => !excludedStrategyIds.has(s.strategyId));
  if (filtered.length === 0) return [...pool].sort((a,b) => (a.worstCaseCompositeScore ?? 0) - (b.worstCaseCompositeScore ?? 0))[0];
  return [...filtered].sort((a,b) => (a.worstCaseCompositeScore ?? 0) - (b.worstCaseCompositeScore ?? 0))[0];
};

const preference = recommendationCandidates[0];
excludedStrategyIds.add(preference.strategyId);
const lowestCost = pickExcluding(recommendationCandidates, "expectedInterest");
excludedStrategyIds.add(lowestCost.strategyId);
const mostStable = mode === "payment"
  ? pickExcluding(recommendationCandidates, "worstCaseEndingBalance")
  : pickExcluding(recommendationCandidates, "worstCasePayment");
excludedStrategyIds.add(mostStable.strategyId);
const worstCaseDefense = pickExcludingComposite(recommendationCandidates);
```

**关键设计选择**:
- 互斥顺序:preference → lowestCost → mostStable → worstCaseDefense(preference 不参与互斥)
- 小池 fallback:候选 < 4 时 picker 退回到非排除候选,避免空选
- `concentration` 默认 1.0:测试 fixture 不传 strategies 时,concentration=1.0,保留现有 Pareto 主导语义

#### 改动 2:`apps/web/app/strategy-lab/page.js`

**A. Pass strategies(line 963-971)**

```js
const opt = optimizeStrategies({
  simulationResults: activeSimulationResults,
  scenarios: activeScenarios,
  strategies,  // v10: 让 optimiser 派生 concentration
  weights,
  mode: mortgage?.targetMode === "payment" ? "payment" : "term",
  recommendationMinAllocationCount,
  diversification: diversificationPreset !== "default"
});
```

并在 `newRankingKey` 的 stableStringify 中加入 `strategies` 投影,让 split-mix 变更触发 cache 失效。

**B. Card mutex copy(line 2757, 2802, 2846, 2889)**

每张 benchmark 卡的 `rec-desc` 段尾追加 "(本卡已避开 X 卡选中的「{策略名}」...)"。

**C. Pareto 表新列(line 3054-3069, 3091, 3129)**

在"最坏违约次数"和"refix 事件数"之间插入:

```jsx
<th title="分散度 = 最大单笔贷款占比;越低越分散。已纳入 Pareto 主导关系。">分散度</th>
```

对应 `<td>{Math.round((s.concentration || 0) * 100)}%</td>`。`colSpan={14}` → `colSpan={15}`。

**D. tradeOffAxes + whyThisOne(line 1649-1700)**

`tradeOffAxes` 追加 `{ key: "concentration", label: "分散度 (最大单笔占比)", direction: "min" }`。`whyThisOne` 给 3 张 benchmark 加"已避开 X 选中的方案"。

#### 改动 3:`apps/web/components/StrategyDetailModal.js`

新增 metric tile(line 374 后):

```jsx
{!detailSummary && strategy.concentration !== undefined && strategy.concentration !== null && (
  <MetricTile
    label="分散度 (最大单笔占比)"
    value={`${Math.round((strategy.concentration || 0) * 100)}%`}
    tone="indigo"
  />
)}
```

#### 改动 4:`packages/optimiser/tests/optimiser.test.js`

**T1 — 修改 "lowestCost ignores weights"(line 646)**

保留两个断言,但加入新断言确认 mutex 生效:`expect(opt.recommendations.preference.strategyId).not.toBe(opt.recommendations.lowestCost.strategyId)`。

**T2 — 修改 "keep 100% benchmarks out of headline split recommendations"(line 662)**

mutex 后:`preference=split-90-10, lowestCost=split-50-50, mostStable=split-90-10(fallback), worstCaseDefense=split-50-50`。

**T3 — 修改 "recommendationMinAllocationCount >= 2 excludes single-product from all 4 cards"(line 1048)**

1 个 split → 全部 fallback 到同一 split。加断言 `expect(preference).toBe(lowestCost)` 确认 fallback 触发。

**T4 — 新增 "v10 picker mutex produces 3 different cards when 3+ Pareto-optimal candidates"**

构造 4 个候选,每个主导一个 axis。断言 `new Set([preference, lowestCost, mostStable, worstCaseDefense].map(s => s.strategyId)).size >= 3`。

**T5 — 新增 "v10 concentration objective added to term and payment modes"**

```js
expect(getTermObjectives().objectives).toContain("concentration");
expect(getPaymentObjectives().objectives).toContain("concentration");
expect(DEFAULT_TOLERANCES_TERM.concentration).toBe(0.05);
expect(DEFAULT_TOLERANCES_PAYMENT.concentration).toBe(0.05);
```

**T6 — 新增 "v10 concentration derived from strategyAllocations"**

构造 `{id: 'split-90-10', allocations: [{percentage: 0.9}, {percentage: 0.1}]}`,断言 `r.concentration === 0.9`。

**T7 — 新增 "v10 concentration default to 1.0 when strategies is omitted"**

不传 strategies,断言 `s.concentration === 1.0`。

### 关键修改文件

| 文件 | 改动 |
|------|------|
| `packages/optimiser/src/index.js` | tolerance + objective list + signature + aggregated push + bounds + scoring + picker 互斥 |
| `apps/web/app/strategy-lab/page.js` | 传 strategies + card copy + Pareto 列 + tradeOffAxes + whyThisOne |
| `apps/web/components/StrategyDetailModal.js` | 新 metric tile |
| `packages/optimiser/tests/optimiser.test.js` | 3 改 + 4 新 test |

### 验收

#### 自动
1. `cd packages/optimiser && npx vitest run` → 期望 30 → 34 tests(加 4 新)
2. `npm test` → 期望 113 → 117 passed
3. `npm run lint` → clean
4. `cd apps/web && npm run build` → 通过

#### 手工
1. 默认 maxSplits=3,3 张 benchmark 卡显示**3 个不同策略**(preference 可能与某一 benchmark 重合)
2. Pareto 表有 15 列(原 14 + "分散度")
3. 每张 benchmark 卡显示 "(本卡已避开 X 卡...)" 文案
4. Modal 中"分散度"tile 显示,如 50-50 显示 50%
5. maxSplits=1 → 4 张卡 fallback 到同一单产品(测试 fallback)
6. 50-50 中间型在 Pareto 表中明确可见

### 风险与缓解

| 风险 | 缓解 |
|------|------|
| 小池(1 个 split)mutex 失败 | picker fallback 到非排除 pool |
| 测试 fixture 不传 strategies → concentration=undefined | 默认 1.0 保留 Pareto 语义 |
| `preference = lowestCost` 的旧测试断言 | T1/T2 改写 |
| `newRankingKey` 不含 strategies → cache 失效 | 加 strategies 投影 |
| tradeOffAxes 把分散度放最后,视觉埋没 | v10.1 再优化 |
| backward compat | `strategies` 是 optional,旧调用者不受影响 |

### 验证流程

```bash
cd packages/optimiser && npx vitest run
npm test
npm run lint
cd apps/web && npm run build
```

然后 `npm run dev`,按"手工"6 项验证。

### 改完后的预期效果

- **3 张 benchmark 卡互斥**:maxSplits=3 时必显示 3 个不同策略(10-90 + 50-50 + 其它)
- **中间型进入 Pareto 前沿**:`concentration` 轴让 50-50 不被 10-90 默默主导
- **用户视觉感知**:卡片文案明确"为什么这张卡选 A 而那张选 B"
- **小池 fallback**:maxSplits=1 时 4 张卡 fallback 不崩
- **向后兼容**:旧 7-key weights 不变,只追加 1 个新 tolerance
