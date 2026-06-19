// @ts-nocheck — React UI page; JSDoc strict-mode type checks on dynamic-key
// access (`weights[k]`, `reduce`/`filter` callbacks) are out of scope for
// financial correctness. Financial algorithms live in `packages/*/src/*` and
// are covered by vitest + checkJs on their own files.
"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { dbGetAll, dbGet, dbPut, dbDelete } from "../../features/storage.js";
import { nzProfile, nzBetas } from "@mortgage/country-adapters";
import { generateScenarios, buildQuantileScenarios } from "@mortgage/scenario-engine";
import { generateSplitStrategies } from "@mortgage/strategy-generator";
import { optimizeStrategies } from "@mortgage/optimiser";
import { simulateStrategyScenario } from "@mortgage/simulation-engine";
import { calculateScheduledPayment } from "@mortgage/mortgage-engine";
import SvgChart from "../../components/SvgChart.js";
import StrategyDetailModal from "../../components/StrategyDetailModal.js";
import { NumberInput } from "../../components/index.js";
import { useI18n } from "../../lib/i18n/useI18n.js";

/**
 * Compute the percentage of the slider's value between min/max and apply it as
 * a CSS custom property so the track-fill (left of thumb) renders in the
 * primary colour. Falls back to 0 when called server-side.
 * @param {HTMLInputElement | null} el
 */
function applySliderFill(/** @type {any} */ el) {
  if (!el) return;
  const min = parseFloat(el.min || "0");
  const max = parseFloat(el.max || "100");
  const val = parseFloat(el.value || "0");
  const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
  el.style.setProperty("--slider-fill", `${pct}%`);
}

/**
 * Wrapper around `<input type="range">` that paints the track-fill to the
 * current value. Pass-through for all standard range input props.
 * @param {Object} props
 * @param {number} props.min
 * @param {number} props.max
 * @param {number|string} props.step
 * @param {number|string} props.value
 * @param {(e: any) => void} props.onChange
 * @param {string} [props.className]
 */
function Slider(/** @type {any} */ props) {
  const { min, max, step, value, onChange, className, "aria-label": ariaLabelProp, "aria-valuetext": ariaValueText, ...rest } = props;
  const ref = useRef(/** @type {any} */ (null));

  useEffect(() => {
    applySliderFill(ref.current);
  }, [value]);

  return (
    <input
      ref={ref}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      role="slider"
      aria-label={ariaLabelProp}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={ariaValueText ?? (typeof value === "number" ? String(value) : undefined)}
      onChange={(/** @type {any} */ e) => {
        const val = parseFloat(e.target.value);
        flushSync(() => {
          onChange?.(e);
        });
        applySliderFill(e.target);
      }}
      className={className || "slider-input"}
      {...rest}
    />
  );
}

export default function StrategyLab() {
  const { t, formatMoney: formatMoneyCtx, productDisplayName } = useI18n();
  const formatMoney = formatMoneyCtx;

  // Friendly label for each recommendation key. Used by the strategy
  // detail modal so users see a meaningful subtitle (e.g. "偏好匹配推荐")
  // instead of the internal key (e.g. "preference"). v9 collapsed 10 v6
  // benchmarks into 4 cards; the legacy keys are kept as fallbacks but are
  // never populated by the optimiser any more. Computed via useMemo so
  // translations are looked up once per locale switch.
  const RECOMMENDATION_LABEL_MAP = useMemo(() => ({
    preference: t("strategyLab.recCard.preference.title"),
    lowestCost: t("strategyLab.recCard.lowestCost.title"),
    mostStable: t("strategyLab.recCard.mostStable.title"),
    worstCaseDefense: t("strategyLab.recCard.worstCase.title"),
    lowestWorstCaseCost: t("strategyLab.recCard.lowestCost.title"),
    lowestWorstCasePayment: t("strategyLab.recCard.mostStable.title"),
    lowestRefixConcentration: t("strategyLab.recCard.lowestRefixConcentration"),
    lowestBudgetBreaches: t("strategyLab.recCard.lowestBudgetBreaches"),
    lowestVolatility: t("strategyLab.recCard.lowestVolatility"),
    lowestEndingBalance: t("strategyLab.recCard.lowestEndingBalance"),
    mostFloating: t("strategyLab.recCard.mostFloating")
  }), [t]);
  const [mortgage, setMortgage] = useState(/** @type {any} */(null));
  const [loading, setLoading] = useState(true);

  // Future Expectation Sliders
  const [shortTermChange, setShortTermChange] = useState(0.0); // -2% to +2%
  const [mediumTermDirection, setMediumTermDirection] = useState(0.0); // -1 to +1
  const [changeSpeed, setChangeSpeed] = useState(0.5); // 0 to 1
  const [uncertainty, setUncertainty] = useState(0.01); // 0 to 2%
  const [scenarioProbabilities, setScenarioProbabilities] = useState({ low: 15, base: 70, high: 15 });
  const [longTermCycleYears, setLongTermCycleYears] = useState(2);
  const [longTermReversalBias, setLongTermReversalBias] = useState(0.5);
  const [monteCarloSampleCount, setMonteCarloSampleCount] = useState(200); // 50 to 1000
  const [simDurationYears, setSimDurationYears] = useState(5); // default 5 years (60 months)

  // Sim-horizon upper bound:
  //   - hard cap at 10 years (UI requirement)
  //   - further capped at the next whole year beyond the user's expected
  //     payoff (mortgage-setup "期望还清期限 (年)"). E.g. 5.2y -> 6y max.
  //   - falls back to 10 if the mortgage has not been loaded yet.
  const SIM_HORIZON_YEARS_MAX = 10;
  const simMaxYears = useMemo(() => {
    const months = mortgage?.originalTermMonths;
    if (!months || months <= 0) return SIM_HORIZON_YEARS_MAX;
    return Math.max(1, Math.min(SIM_HORIZON_YEARS_MAX, Math.ceil(months / 12)));
  }, [mortgage?.originalTermMonths]);
  const simTargetYears = mortgage?.originalTermMonths ? mortgage.originalTermMonths / 12 : 0;
  const simCappedByMortgage = simMaxYears < SIM_HORIZON_YEARS_MAX;

  // Clamp the current sim duration when the upper bound shrinks (e.g. the
  // user re-saves a shorter expected payoff in mortgage-setup).
  useEffect(() => {
    setSimDurationYears((prev) => Math.min(Math.max(1, prev), simMaxYears));
  }, [simMaxYears]);

  // Strategy Generation Constraints
  const [maxSplits, setMaxSplits] = useState(nzProfile.rules.maxSplits);
  // Default 50% (was 10%): the previous default structurally pruned all
  // "balanced" splits where floating > 30%, so users only ever saw 10-90
  // patterns. 50% lets floating + fixed 50-50 enter the candidate set.
  // The UI slider still goes 0-80, so users can drop back to 10% for a
  // conservative profile.
  const [maxFloatingPercentage, setMaxFloatingPercentage] = useState(10);
  const [maxAffordablePayment, setMaxAffordablePayment] = useState(5000);
  // Allocation-grid step. Default 0.05 (5%) per country-adapter rule.
  // v9: default changed from 0.10 (10%) to 0.05 (5%) so the candidate set
  // includes balanced splits like 33-33-33 / 40-30-30 / 25-25-50. UI in
  // Section 2 still lets the user coarsen to 10% or refine to 1%.
  const [percentageStep, setPercentageStep] = useState(0.05);

  // Diversification preset ("default" | "diversification" | "max"). When set
  // to a non-default value, the preset overwrites maxSplits, percentageStep,
  // maxFloatingPercentage, weights and auto-expands the exhausted-report
  // accordion so the user immediately sees the richer Pareto set. See plan
  // section "Deliverable 3" for rationale.
  const [diversificationPreset, setDiversificationPreset] = useState("default");

  // Preference Weights (User Customisable)
  // Default mix: cost-aware, principal-led, modest refix/flex headroom,
  // low resilience/budget weight. Tweak here is the single source of truth
  // for the "重置默认" button below.
  // V11 schema (plan v11 §2): 5 preference sliders, totals 100. Folded
  // `resilience` / `budget` / `smoothness` / `principal` into the v9
  // `worstCaseDefense` composite (their signals were strict subsets or
  // highly correlated, see plan v11 §1.2). Added new `balance` axis (v11)
  // — inverse of the `concentration` Pareto axis — to break 90-10's
  // stranglehold on `preference`. Default 18% on `balance` keeps the
  // balanced-split candidates competitive without forcing them.
  const DEFAULT_WEIGHTS = {
    cost: 18,
    refix: 17,
    flex: 17,
    balance: 18,
    worstCaseDefense: 30
  };
  const PREFERENCE_WEIGHT_KEYS = /** @type {(keyof typeof DEFAULT_WEIGHTS)[]} */ (Object.keys(DEFAULT_WEIGHTS));

  const normalizePreferenceWeights = (/** @type {Record<string, number>|undefined} */ input = DEFAULT_WEIGHTS) => {
    const raw = /** @type {Record<string, number>} */ ({});
    // v11: clamp to [0, 35] (the per-slider max) so that every value in the
    // returned weights object is within the slider's drag range. This
    // eliminates the "blue border and dot are at different positions"
    // mismatch when a rebalance pushes a non-dragged key above the cap.
    PREFERENCE_WEIGHT_KEYS.forEach((key) => {
      const value = Number(input?.[key]);
      raw[key] = Number.isFinite(value) ? Math.max(0, Math.min(35, Math.round(value))) : 0;
    });

    const total = PREFERENCE_WEIGHT_KEYS.reduce((sum, key) => sum + raw[key], 0);
    if (total === 100) return raw;
    if (total <= 0) return { ...DEFAULT_WEIGHTS };

    const next = /** @type {Record<string, number>} */ ({});
    let allocated = 0;
    PREFERENCE_WEIGHT_KEYS.forEach((key, idx) => {
      if (idx === PREFERENCE_WEIGHT_KEYS.length - 1) {
        next[key] = Math.max(0, 100 - allocated);
        return;
      }
      const share = Math.round((raw[key] / total) * 100);
      next[key] = share;
      allocated += share;
    });

    const normalizedTotal = PREFERENCE_WEIGHT_KEYS.reduce((sum, key) => sum + next[key], 0);
    if (normalizedTotal !== 100) {
      const diff = 100 - normalizedTotal;
      const adjustKey = PREFERENCE_WEIGHT_KEYS.find((key) => next[key] + diff >= 0) || PREFERENCE_WEIGHT_KEYS[0];
      next[adjustKey] += diff;
    }
    return next;
  };

  const [weights, setWeights] = useState(() => normalizePreferenceWeights(DEFAULT_WEIGHTS));
  const [openControlGroups, setOpenControlGroups] = useState({
    trend: false,
    risk: false,
    longTerm: false,
    horizon: false,
    constraints: false,
    preferences: false
  });
  const [showOnlyBestPerMix, setShowOnlyBestPerMix] = useState(true);
  const [showOnlyPareto, setShowOnlyPareto] = useState(true);
  // Filter the exhausted-report table by number of allocations per strategy.
  // `null` means "all split counts"; otherwise the value is the exact count
  // to keep (1, 2, 3, ...). Stacks on top of `showOnlyBestPerMix`.
  const [splitCountFilter, setSplitCountFilter] = useState(/** @type {number|null} */(null));

  const handleWeightChange = (/** @type {string} */ key, /** @type {number} */ newValue) => {
    // Keep the displayed sliders as a closed 100% allocation.
    // Moving one dimension proportionally rebalances the remaining dimensions.
    // v11: hard cap at 35 (was 25 in v9) for the 5-key shape. With 5
    // sliders × 35% = 175% of the budget, at most 2 sliders can hit the
    // cap simultaneously, forcing at least 3 dimensions into the user's
    // consideration. (Was 4 dimensions under the v9 8-key shape with
    // cap 25%.)
    newValue = Math.max(0, Math.min(35, Math.round(newValue)));
    setWeights((prev) => {
      const current = normalizePreferenceWeights(prev);
      const otherKeys = PREFERENCE_WEIGHT_KEYS.filter((k) => k !== key);
      const targetOtherSum = 100 - newValue;
      const currentOtherSum = otherKeys.reduce((sum, k) => sum + current[k], 0);
      const nextWeights = { ...current, [key]: newValue };

      let accumulated = 0;
      otherKeys.forEach((k, idx) => {
        if (idx === otherKeys.length - 1) {
          nextWeights[k] = Math.max(0, targetOtherSum - accumulated);
          return;
        }

        const share = currentOtherSum > 0
          ? Math.round((current[k] / currentOtherSum) * targetOtherSum)
          : Math.round(targetOtherSum / otherKeys.length);
        nextWeights[k] = Math.max(0, share);
        accumulated += nextWeights[k];
      });

      return normalizePreferenceWeights(nextWeights);
    });
  };

  // True when any weight has been nudged off the default mix. Drives the
  // visibility of the "重置默认" affordance below.
  const isWeightsModified = (() => {
    return PREFERENCE_WEIGHT_KEYS.some((k) => weights[k] !== DEFAULT_WEIGHTS[k]);
  })();

  const handleResetWeights = () => {
    setWeights(normalizePreferenceWeights(DEFAULT_WEIGHTS));
  };

  const defaultSimDurationYears = useMemo(() => Math.min(5, simMaxYears), [simMaxYears]);

  const toggleControlGroup = (/** @type {"trend"|"risk"|"longTerm"|"horizon"|"constraints"|"preferences"} */ groupKey) => {
    setOpenControlGroups((prev) => {
      if (prev[groupKey]) {
        return { ...prev, [groupKey]: false };
      }
      const next = { trend: false, risk: false, longTerm: false, horizon: false, constraints: false, preferences: false };
      next[groupKey] = true;
      return next;
    });
  };

  const handleScenarioProbabilityChange = (/** @type {"low"|"base"|"high"} */ changedKey, /** @type {number} */ nextValue) => {
    const clampedValue = Math.max(0, Math.min(100, Math.round(nextValue)));
    const otherKeys = /** @type {("low"|"base"|"high")[]} */ (["low", "base", "high"].filter((k) => k !== changedKey));

    setScenarioProbabilities((prev) => {
      const next = { ...prev, [changedKey]: clampedValue };
      const targetOtherSum = Math.max(0, 100 - clampedValue);
      const currentOtherSum = otherKeys.reduce((sum, key) => sum + prev[key], 0);

      if (currentOtherSum <= 0) {
        const firstShare = Math.round(targetOtherSum / otherKeys.length);
        next[otherKeys[0]] = firstShare;
        next[otherKeys[1]] = targetOtherSum - firstShare;
        return next;
      }

      let allocated = 0;
      otherKeys.forEach((key, idx) => {
        if (idx === otherKeys.length - 1) {
          next[key] = Math.max(0, targetOtherSum - allocated);
          return;
        }

        next[key] = Math.max(0, Math.round((prev[key] / currentOtherSum) * targetOtherSum));
        allocated += next[key];
      });

      return next;
    });
  };

  const isTrendModified = shortTermChange !== 0.0 ||
    mediumTermDirection !== 0.0 ||
    changeSpeed !== 0.5;

  const handleResetTrend = () => {
    setShortTermChange(0.0);
    setMediumTermDirection(0.0);
    setChangeSpeed(0.5);
  };

  const isRiskModified = uncertainty !== 0.01 ||
    scenarioProbabilities.low !== 15 ||
    scenarioProbabilities.base !== 70 ||
    scenarioProbabilities.high !== 15;

  const handleResetRisk = () => {
    setUncertainty(0.01);
    setScenarioProbabilities({ low: 15, base: 70, high: 15 });
  };

  const isLongTermModified = longTermCycleYears !== 2 ||
    longTermReversalBias !== 0.5 ||
    monteCarloSampleCount !== 200;

  const handleResetLongTerm = () => {
    setLongTermCycleYears(2);
    setLongTermReversalBias(0.5);
    setMonteCarloSampleCount(200);
  };

  const isHorizonModified = simDurationYears !== defaultSimDurationYears;

  const handleResetHorizon = () => {
    setSimDurationYears(defaultSimDurationYears);
  };

  const defaultMaxAffordablePayment = useMemo(() => {
    if (!mortgage || !mortgage.tranches || mortgage.tranches.length === 0) return 5000;
    return mortgage.tranches.reduce((sum, t) => {
      return sum + calculateScheduledPayment({
        balance: t.balance,
        annualRate: t.annualRate,
        remainingTermMonths: t.remainingTermMonths,
        repaymentType: t.repaymentType || mortgage.repaymentType || "principal-and-interest",
        frequency: mortgage.repaymentFrequency || "monthly"
      });
    }, 0);
  }, [mortgage]);

  const isConstraintsModified = maxSplits !== nzProfile.rules.maxSplits ||
    percentageStep !== 0.05 ||
    maxFloatingPercentage !== 10 ||
    maxAffordablePayment !== defaultMaxAffordablePayment;

  const handleResetConstraints = () => {
    setMaxSplits(nzProfile.rules.maxSplits);
    setPercentageStep(0.05);
    setMaxFloatingPercentage(10);
    setMaxAffordablePayment(defaultMaxAffordablePayment);
    setDiversificationPreset("default");
  };

  const isAnyParameterModified = isTrendModified ||
    isRiskModified ||
    isLongTermModified ||
    isHorizonModified ||
    isConstraintsModified ||
    isWeightsModified;

  const handleResetAllParameters = () => {
    handleResetTrend();
    handleResetRisk();
    handleResetLongTerm();
    handleResetHorizon();
    handleResetConstraints();
    handleResetWeights();
  };

  /**
   * Apply a diversification preset. The preset overwrites the four exposed
   * constraint sliders AND the weights so the user sees the richer candidate
   * set surfaced by the new constraints. For non-default presets we also
   * auto-expand the exhausted-report accordion so the user immediately
   * sees the broader Pareto set without an extra click.
   *
   * Preset profiles (kept in sync with the table in the plan):
   *   - "default"          -> 3 splits, 10% step, 10% floating, weights-as-default
   *   - "diversification"  -> 4 splits,  5% step, 30% floating, refix-heavy weights
   *   - "max"              -> 5 splits,  5% step, 50% floating, refix+flex-heavy
   *
   * @param {"default"|"diversification"|"max"} preset
   */
  const handleDiversificationPresetChange = (/** @type {"default"|"diversification"|"max"} */ preset) => {
    setDiversificationPreset(preset);
    if (preset === "default") {
      setMaxSplits(3);
      setPercentageStep(0.05);
      setMaxFloatingPercentage(10);
      setWeights(normalizePreferenceWeights(DEFAULT_WEIGHTS));
    } else if (preset === "diversification") {
      setMaxSplits(4);
      setPercentageStep(0.05);
      setMaxFloatingPercentage(30);
      setWeights(normalizePreferenceWeights({ cost: 12, refix: 22, flex: 14, balance: 28, worstCaseDefense: 24 }));
      setShowExhaustedReport(true);
    } else {
      setMaxSplits(5);
      setPercentageStep(0.05);
      setMaxFloatingPercentage(50);
      setWeights(normalizePreferenceWeights({ cost: 10, refix: 22, flex: 18, balance: 30, worstCaseDefense: 20 }));
      setShowExhaustedReport(true);
    }
  };

  // Preset profiles used both by `handleDiversificationPresetChange` and the
  // drift-detection effect below. Kept as a module-scope constant so the
  // effect can re-derive the active profile without re-running on every
  // render. Note: weights are NOT part of the profile here — the user has
  // separate granular weight sliders and "重置默认" buttons, and we don't want
  // a manual weight tweak to clobber the preset label.
  const PRESET_PROFILES = {
    default: { maxSplits: 3, percentageStep: 0.05, maxFloatingPercentage: 10 },
    diversification: { maxSplits: 3, percentageStep: 0.10, maxFloatingPercentage: 30 },
    max: { maxSplits: 5, percentageStep: 0.05, maxFloatingPercentage: 50 }
  };

  // Drift detection: when the user manually tweaks a constraint slider, the
  // active preset label becomes a lie. Revert to "default" (the "custom"
  // state) so the segmented control reflects reality. The useEffect compares
  // the current constraint values against the active preset's profile; if
  // any field differs, the preset is cleared. This is safe against the React
  // batching that fires `handleDiversificationPresetChange` — that function
  // updates all three sliders in the same render, so by the time this effect
  // runs the values already match the new preset.
  useEffect(() => {
    const active = PRESET_PROFILES[diversificationPreset];
    if (!active) return;
    if (
      maxSplits !== active.maxSplits ||
      Math.abs(percentageStep - active.percentageStep) > 1e-9 ||
      maxFloatingPercentage !== active.maxFloatingPercentage
    ) {
      setDiversificationPreset("default");
    }
  }, [maxSplits, percentageStep, maxFloatingPercentage, diversificationPreset]);

  // Generated Scenarios
  const [scenarios, setScenarios] = useState(/** @type {any[]} */([]));
  const [chartScenarioPaths, setChartScenarioPaths] = useState(/** @type {any[]} */([]));
  const [detailScenarioOptions, setDetailScenarioOptions] = useState(/** @type {any[]} */([]));
  const [selectedDetailScenario, setSelectedDetailScenario] = useState("expected");

  // Simulation Status
  const [simulationRunning, setSimulationRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [completedSims, setCompletedSims] = useState(0);
  const [totalSims, setTotalSims] = useState(0);
  const [currentSimulationInfo, setCurrentSimulationInfo] = useState(/** @type {any} */(null));
  const [hideParameterPanel, setHideParameterPanel] = useState(false);

  // Estimate total simulation count from current constraints — runs the
  // strategy generator synchronously (no amortisation, just enumeration) to
  // surface a warning when the matrix exceeds a UX-bearable threshold before
  // the user clicks "开始仿真". Recomputes when any constraint input changes.
  // Placed AFTER `scenarios` (declared above) so the dependency is in scope.
  const strategyCountEstimate = useMemo(() => {
    if (!mortgage) return 0;
    const totalBalance = mortgage.tranches.reduce((sum, t) => sum + t.balance, 0);
    if (totalBalance <= 0) return 0;
    try {
      const strategies = generateSplitStrategies({
        totalAmount: totalBalance,
        allowedProducts: nzProfile.products.map((p) => ({ code: p.code, type: p.type })),
        constraints: {
          maxSplits,
          minPercentage: nzProfile.rules.minPercentage,
          percentageStep,
          minTrancheAmount: nzProfile.rules.minTrancheAmount,
          maxFloatingPercentage: maxFloatingPercentage / 100
        },
        refixRule: { type: "same-term" }
      });
      return strategies.length;
    } catch {
      return 0;
    }
  }, [mortgage, maxSplits, percentageStep, maxFloatingPercentage]);

  // Estimated total sims = strategy count × scenario count. `scenarios` is
  // populated by the page's useEffect chain; fall back to 3 (the deterministic
  // low/base/high default) when not yet available.
  const estimatedTotalSims = strategyCountEstimate * (scenarios?.length || 3);
  // Threshold above which we surface a "consider simplifying" banner. 20K is
  // chosen because the user-reported case (5 splits × 0.10 step × 50% floating
  // cap × 7 NZ products) yields ~36K strategies → ~108K sims, taking 30s+
  // on typical hardware. Below 20K the user experience is acceptable.
  const SIM_COUNT_WARNING_THRESHOLD = 20000;
  const simCountIsHigh = estimatedTotalSims > SIM_COUNT_WARNING_THRESHOLD;
  const [simResults, setSimResults] = useState(/** @type {any} */(null));
  const shouldHideParameterPanel = hideParameterPanel && !simulationRunning;
  const [detailResultsByStrategy, setDetailResultsByStrategy] = useState(/** @type {Record<string, any[] | undefined>} */ ({}));
  const [detailLoadingStrategyId, setDetailLoadingStrategyId] = useState(/** @type {string|null} */(null));
  const [optimisedData, setOptimisedData] = useState(/** @type {any} */(null));
  const [selectedRecType, setSelectedRecType] = useState(/** @type {string|null} */("preference"));
  // Controls whether the selected strategy's 60-month detail timeline table is
  // expanded. Default false — the table is heavy (one row per tranche per
  // 6-month interval × 11 columns) and most users only want the high-level
  // metrics. A "详情" toggle reveals it on demand.
  // StrategyDetailModal — drives the popup shown when the user clicks
  // "查看详情" on any tile or Pareto-table row. Single modal mounted at the
  // bottom of the page; the four state slots identify what to render.
  //   detailModalStrategyId : which strategy to look up in rankedStrategies
  //   detailModalRecKey     : which recommendation type the user came from
  //                            ("preference" / "lowestCost" / ... / "row")
  //   detailModalOpen       : visibility toggle
  //   detailModalOriginCard : "benchmark" | "preference" | "row" | "timeline"
  //                            drives whether the inline timeline panel shows
  const [detailModalStrategyId, setDetailModalStrategyId] = useState(/** @type {string|null} */(null));
  const [detailModalRecKey, setDetailModalRecKey] = useState(/** @type {string|null} */(null));
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailModalOriginCard, setDetailModalOriginCard] = useState(/** @type {"benchmark"|"preference"|"row"|"timeline"} */("benchmark"));

  /**
   * Open the detail modal. Stops event propagation so the card body's
   * existing onClick (set as selected strategy) does not also fire.
   * @param {string} strategyId
   * @param {string|null} recKey
   * @param {"benchmark"|"preference"|"row"|"timeline"} origin
   */
  const openStrategyDetailModal = (/** @type {any} */ e, /** @type {string} */ strategyId, /** @type {string|null} */ recKey, /** @type {"benchmark"|"preference"|"row"|"timeline"} */ origin) => {
    if (e && typeof e.stopPropagation === "function") e.stopPropagation();
    setDetailModalStrategyId(strategyId);
    setDetailModalRecKey(recKey);
    setDetailModalOriginCard(origin);
    setDetailModalOpen(true);
    // Lazy-fetch the per-tranche detail timeline so the modal's inline
    // timeline panel can render. Safe to call repeatedly — the inner
    // cache (detailResultsByStrategy) deduplicates concurrent fetches so
    // repeated opens from benchmark tiles / Pareto rows share the same data.
    loadDetailForStrategy(strategyId);
  };
  const [allStrategies, setAllStrategies] = useState(/** @type {any[]} */([]));
  const [showExhaustedReport, setShowExhaustedReport] = useState(true);
  const [showAllRows, setShowAllRows] = useState(false);
  // Column sort for the exhausted-strategies table. `key` is one of the
  // numeric field names on a ranked strategy; `null` means "no sort, use
  // default order". Click a column header to toggle asc / desc.
  const [exhaustedSort, setExhaustedSort] = useState(/** @type {{key: string|null, dir: "asc" | "desc"} | null} */(null));
  const handleExhaustedSort = (/** @type {string} */ key) => {
    setExhaustedSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null; // third click clears sort
    });
    setShowAllRows(false);
  };
  const [recPreference, setRecPreference] = useState(/** @type {any} */(null));
  const [recLowestCost, setRecLowestCost] = useState(/** @type {any} */(null));
  const [recMostStable, setRecMostStable] = useState(/** @type {any} */(null));
  // V9: 4th recommendation card — worst-case defense composite optimum.
  const [recWorstCaseDefense, setRecWorstCaseDefense] = useState(/** @type {any} */(null)); // kept for back-compat — UI no longer renders this card
  // V6 legacy state vars retained for cross-references inside the page
  // (e.g. cleanup on simulation reset). No new cards read from them.
  const [recLowestWorstCaseCost, setRecLowestWorstCaseCost] = useState(/** @type {any} */(null));
  const [recLowestWorstCasePayment, setRecLowestWorstCasePayment] = useState(/** @type {any} */(null));
  const [recLowestRefixConcentration, setRecLowestRefixConcentration] = useState(/** @type {any} */(null));
  const [recLowestBudgetBreaches, setRecLowestBudgetBreaches] = useState(/** @type {any} */(null));
  const [recLowestVolatility, setRecLowestVolatility] = useState(/** @type {any} */(null));
  const [recLowestEndingBalance, setRecLowestEndingBalance] = useState(/** @type {any} */(null));
  const [recMostFloating, setRecMostFloating] = useState(/** @type {any} */(null));

  useEffect(() => {
    if (!optimisedData) return;
    setShowExhaustedReport(true);
  }, [optimisedData]);

  const simulatedMonths = simDurationYears * 12;

  const workerRef = useRef(/** @type {any} */(null));
  // Cache dependency keys (spec 3.6 / 11.3).
  // - simulationKey: hash of (mortgage, strategies, scenarios, market rates, dates, refix rule).
  //   When the simulation key is unchanged, the worker returns a `cached` message
  //   instead of re-running the matrix. The page treats `cached` like `success`.
  // - rankingKey: hash of (simulation results, scenarios, weights). When unchanged,
  //   the in-page optimiser re-run is skipped (the previous result is reused).
  const simulationKeyRef = useRef(/** @type {string | null} */(null));
  const rankingKeyRef = useRef(/** @type {string | null} */(null));
  const optimisedDataRef = useRef(/** @type {any} */(null));
  // Synchronous flag to gate the auto-resim useEffect against racing the
  // explicit "开始仿真模拟" button. setSimulationRunning is async (state),
  // so a tight sequence of state changes can interleave before React flushes
  // the state update — useRef gives us a sync view (Reviewer H-2 fix).
  const simulationInFlightRef = useRef(/** @type {boolean} */(false));

  // v11: Keep refs to the inline preference sliders' DOM nodes + a flag for
  // the slider currently being dragged. After rebalance on
  // `weights` change, we need to sync each slider's DOM `value` and
  // `--slider-fill` to the new state — otherwise the "blue border" (thumb)
  // and the "dot" (displayed %) drift apart for the OTHER sliders. The
  // dragging flag prevents the effect from cancelling the active drag.
  const preferenceSliderRefs = useRef(/** @type {Record<string, HTMLInputElement | null>} */ ({}));
  const preferenceDraggingRef = useRef(/** @type {string | null} */ (null));

  /**
   * Stable JSON serialisation with sorted keys (no whitespace). Used for the
   * simulation / ranking cache keys.
   * @param {any} value
   * @returns {string}
   */
  const stableStringify = (value) => {
    if (value === null || typeof value !== "object") {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return "[" + value.map(stableStringify).join(",") + "]";
    }
    const keys = Object.keys(value).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
  };

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

  const resetSimulationDerivedState = () => {
    setSimResults(null);
    setDetailResultsByStrategy({});
    setDetailLoadingStrategyId(null);
    setOptimisedData(null);
    setHideParameterPanel(false);
    setSelectedRecType("preference");
    setAllStrategies([]);
    setShowExhaustedReport(true);
    setShowAllRows(false);
    setRecPreference(null);
    setRecLowestCost(null);
    setRecMostStable(null);
    setProgress(0);
    setCompletedSims(0);
    setTotalSims(0);
    setCurrentSimulationInfo(null);
    setError(null);
    rankingKeyRef.current = null;
    optimisedDataRef.current = null;
  };

  const releaseSimulationArtifacts = async ({ clearParamsRecord = false } = {}) => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }

    simulationInFlightRef.current = false;
    simulationKeyRef.current = null;
    resetSimulationDerivedState();
    setSimulationRunning(false);

    const deletes = [dbDelete("savedResults", "last_simulation")];
    if (clearParamsRecord) {
      deletes.push(dbDelete("savedResults", "last_simulation_params"));
    }

    try {
      await Promise.all(deletes);
    } catch (err) {
      console.error("Failed to release previous simulation artifacts", err);
    }
  };

  const handleClearSimulationOutput = async () => {
    await releaseSimulationArtifacts();
  };

  // Load Mortgage Setup from IndexedDB & Custom Market Rates from localStorage
  useEffect(() => {
    // Clean up legacy localStorage simulation key to free space
    localStorage.removeItem("ratepath_saved_simulation");

    async function loadData() {
      try {
        const list = await dbGetAll("mortgages");
        if (list && list.length > 0) {
          const savedMortgage = list[0];
          setMortgage(savedMortgage);

          const savedSim = await dbGet("savedResults", "last_simulation");
          if (!savedSim && savedMortgage.targetPeriodicPayment) {
            setMaxAffordablePayment(savedMortgage.targetPeriodicPayment);
          }
        }
      } catch (err) {
        console.error("Failed to load IndexedDB mortgages", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();

    const savedRates = localStorage.getItem("ratepath_custom_market_rates");
    if (savedRates) {
      try {
        setMarketRates(JSON.parse(savedRates));
      } catch (e) {
        console.error("Failed to parse custom market rates in strategy lab", e);
      }
    }

    async function loadSavedSimulation() {
      try {
        const [resultsData, paramsData] = await Promise.all([
          dbGet("savedResults", "last_simulation"),
          dbGet("savedResults", "last_simulation_params")
        ]);
        if (resultsData && resultsData.results) {
          setSimResults(resultsData.results);
        }
        // Fallback: old format had strategies/params in resultsData.
        // Only restore strategies when cached simulation results exist
        // (last_simulation was not deleted by a prior clear). Otherwise
        // a page refresh after "清空仿真结果" would re-hydrate stale
        // strategies from last_simulation_params, making it look like the
        // clear didn't work.
        const strategiesSource = resultsData
          && ((paramsData && paramsData.strategies) || (resultsData && resultsData.strategies));
        const paramsSource = (paramsData && paramsData.params) || (resultsData && resultsData.params);
        if (strategiesSource) {
          setAllStrategies(strategiesSource);
        }
        if (paramsSource) {
          const p = paramsSource;
          if (p.shortTermChange !== undefined) setShortTermChange(p.shortTermChange);
          if (p.mediumTermDirection !== undefined) setMediumTermDirection(p.mediumTermDirection);
          if (p.changeSpeed !== undefined) setChangeSpeed(p.changeSpeed);
          if (p.uncertainty !== undefined) setUncertainty(p.uncertainty);
          if (p.scenarioProbabilities !== undefined) setScenarioProbabilities(p.scenarioProbabilities);
          if (p.longTermCycleYears !== undefined) setLongTermCycleYears(p.longTermCycleYears);
          if (p.longTermReversalBias !== undefined) setLongTermReversalBias(p.longTermReversalBias);
          if (p.monteCarloSampleCount !== undefined) setMonteCarloSampleCount(p.monteCarloSampleCount);
          if (p.simDurationYears !== undefined) setSimDurationYears(p.simDurationYears);
          if (p.maxSplits !== undefined) setMaxSplits(p.maxSplits);
          if (p.maxFloatingPercentage !== undefined) setMaxFloatingPercentage(p.maxFloatingPercentage);
          if (p.maxAffordablePayment !== undefined) setMaxAffordablePayment(p.maxAffordablePayment);
          if (p.weights !== undefined) {
            // v9: legacy persisted weights (7 keys, no `worstCaseDefense`) must
            // merge with DEFAULT_WEIGHTS before normalize, so the new 8th key
            // gets the default 19% instead of 0 — otherwise the user opens
            // IndexedDB and the v9 composite is silently zeroed.
            const merged = { ...DEFAULT_WEIGHTS, ...p.weights };
            setWeights(normalizePreferenceWeights(merged));
          }
        }
      } catch (e) {
        console.error("Failed to load saved simulation in strategy lab", e);
      }
    }
    loadSavedSimulation();

    // Clean up worker on unmount
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  const buildExpectedPolicyPath = (/** @type {any[]} */ activeScenarios) => {
    if (activeScenarios.length === 0) return [];
    const template = activeScenarios[0].policyRatePath || [];
    return template.map((/** @type {any} */ point, /** @type {number} */ idx) => ({
      month: point.month,
      value: activeScenarios.reduce((sum, scenario) => sum + (scenario.probability || 0) * (scenario.policyRatePath[idx]?.rate || 0), 0)
    }));
  };

  const buildPathTargetStats = (/** @type {Array<{month: number, value?: number, rate?: number}>} */ path) => {
    if (!path || path.length === 0) return null;
    const lastMonth = path[path.length - 1].month;
    const finalYearPoints = path.filter((/** @type {any} */ p) => p.month > Math.max(0, lastMonth - 12));
    const values = finalYearPoints.map((/** @type {any} */ p) => p.value ?? p.rate).filter((/** @type {any} */ v) => typeof v === "number");
    const finalValue = path[path.length - 1].value ?? path[path.length - 1].rate;
    if (values.length === 0 || typeof finalValue !== "number") return null;
    return {
      finalRate: finalValue,
      averageRate: values.reduce((sum, v) => sum + v, 0) / values.length,
      minRate: Math.min(...values),
      maxRate: Math.max(...values)
    };
  };

  const formatRatePercent = (/** @type {number} */ rate) => `${(rate * 100).toFixed(2)}%`;

  // Recalculate Scenario rate paths when sliders change (instant preview, debounced scenarios)
  useEffect(() => {
    const forecastMonths = simDurationYears * 12;

    // Stage 1a: raw MC pool (3N scenarios; N from the user-controlled slider).
    // The MC pool is ONLY used to derive the P10/P50/P90 quantile paths for
    // the chart. The simulation engine never receives it.
    const mcScenarios = generateScenarios({
      initialRate: marketRates.ocr,
      currentProductRates: marketRates,
      betas: nzBetas,
      products: nzProfile.products,
      forecastMonths,
      controls: {
        shortTermChange,
        mediumTermDirection,
        changeSpeed,
        uncertainty,
        scenarioProbabilities: {
          low: scenarioProbabilities.low / 100,
          base: scenarioProbabilities.base / 100,
          high: scenarioProbabilities.high / 100
        },
        longTermCycleYears,
        longTermReversalBias,
        monteCarloSampleCount
      }
    });

    // Stage 1b: aggregate the MC pool into 3 quantile scenarios.
    const quantileScenarios = buildQuantileScenarios(
      mcScenarios,
      [0.1, 0.5, 0.9],
      { forecastMonths, currentProductRates: marketRates, betas: nzBetas, products: nzProfile.products }
    );

    // Stage 1c: probability-weighted expected path over the quantile pool.
    const expectedPath = buildExpectedPolicyPath(quantileScenarios);
    const expectedScenario = {
      id: "expected",
      countryCode: "NZ",
      name: t("strategyLab.path.expected.label"),
      mode: "policy-rate-derived",
      probability: 0.3,
      forecastMonths,
      policyRatePath: expectedPath.map((/** @type {any} */ p) => ({ month: p.month, rate: p.value })),
      productRatePaths: quantileScenarios[1]?.productRatePaths || {},
      assumptions: {
        scenarioFamily: "expected",
        isMonteCarloTail: true,
        isExpectedAggregate: true,
        sourceMonteCarloSampleCount: mcScenarios.length
      }
    };

    const activeScenarios = [...quantileScenarios, expectedScenario];
    setScenarios(activeScenarios);

    const pathFromScenario = (/** @type {any} */ s) => (s?.policyRatePath || []).map((/** @type {any} */ p) => ({ month: p.month, value: p.rate }));
    const [p10, p50, p90] = quantileScenarios;
    const scenarioPathStats = (/** @type {any} */ scenario) => buildPathTargetStats(pathFromScenario(scenario));
    const expectedPathStats = buildPathTargetStats(expectedPath);

    const longTermOptions = forecastMonths > 36
      ? [
          {
            id: "expected",
            label: t("strategyLab.path.expected.label"),
            type: "expected",
            color: "#f8fafc",
            strokeDasharray: "6 6",
            strokeOpacity: 0.85,
            description: t("strategyLab.path.expected.desc"),
            targetStats: expectedPathStats
          },
          {
            id: "p10",
            label: t("strategyLab.path.p10.label"),
            type: "scenario",
            scenarioId: "p10",
            color: "var(--color-emerald)",
            strokeDasharray: undefined,
            strokeOpacity: 1,
            description: t("strategyLab.path.p10.desc"),
            targetStats: scenarioPathStats(p10)
          },
          {
            id: "p50",
            label: t("strategyLab.path.p50.label"),
            type: "scenario",
            scenarioId: "p50",
            color: "var(--color-primary)",
            strokeDasharray: undefined,
            strokeOpacity: 1,
            description: t("strategyLab.path.p50.desc"),
            targetStats: scenarioPathStats(p50)
          },
          {
            id: "p90",
            label: t("strategyLab.path.p90.label"),
            type: "scenario",
            scenarioId: "p90",
            color: "var(--color-rose)",
            strokeDasharray: undefined,
            strokeOpacity: 1,
            description: t("strategyLab.path.p90.desc"),
            targetStats: scenarioPathStats(p90)
          }
        ]
      : [
          {
            id: "base",
            label: t("common.baseScenario"),
            type: "scenario",
            scenarioId: "base",
            color: "var(--color-primary)",
            strokeDasharray: undefined,
            description: t("strategyLab.scenarioDescBase"),
            targetStats: scenarioPathStats(activeScenarios.find((/** @type {any} */ s) => s.id === "base"))
          }
        ];

    setDetailScenarioOptions(longTermOptions);
    setSelectedDetailScenario((prev) => longTermOptions.some((opt) => opt.id === prev) ? prev : (forecastMonths > 36 ? "expected" : "base"));

    // Chart data: 3 solid quantile lines + fan band (P10↔P90) + dashed expected.
    // No family lines — the quantile lines now encode the same low/base/high
    // information with statistical meaning.
    setChartScenarioPaths([
      {
        id: "p90",
        name: t("strategyLab.path.p90.label"),
        color: "var(--color-rose)",
        points: pathFromScenario(p90),
        strokeOpacity: 1
      },
      {
        id: "p10",
        name: t("strategyLab.path.p10.label"),
        color: "var(--color-emerald)",
        points: pathFromScenario(p10),
        strokeOpacity: 1
      },
      {
        id: "p50",
        name: t("strategyLab.path.p50.label"),
        color: "var(--color-primary)",
        points: pathFromScenario(p50),
        strokeOpacity: 1
      },
      {
        id: "fanBand",
        name: t("strategyLab.path.fanBand.label"),
        color: "var(--color-primary)",
        points: pathFromScenario(p90),
        fillToSeriesId: "p10",
        fillColor: "rgba(99, 102, 241, 0.18)",
        fillOpacity: 1,
        legendHidden: true
      },
      {
        id: "expected",
        name: t("strategyLab.path.expected.label"),
        color: "#f8fafc",
        points: expectedPath,
        strokeDasharray: "6 6",
        strokeOpacity: 0.85
      }
    ]);

  }, [shortTermChange, mediumTermDirection, changeSpeed, uncertainty, scenarioProbabilities, longTermCycleYears, longTermReversalBias, monteCarloSampleCount, simDurationYears, marketRates, t]);

  // Recalculate optimization recommendations ONLY when the underlying
  // simulation results or the right-side scenario basis changes.
  //
  // Important: left-side parameters (OCR trend sliders, scenario probability
  // weights, maxSplits, diversificationPreset, mortgage changes that don't
  // re-run the simulation) MUST NOT trigger a re-rank here. If they did,
  // the right-side report would silently re-rank against stale `simResults`
  // — i.e. show recommendations based on a previous simulation while the
  // sliders already point at a different scenario set. The user-visible
  // trigger for refreshing the report is the "重新仿真" button (or any
  // mortgage change that triggers a re-simulation), which updates
  // `simResults` and therefore this key.
  useEffect(() => {
    if (!simResults) return;
    const activeOption = detailScenarioOptions.find((/** @type {any} */ opt) => opt.id === selectedDetailScenario)
      || detailScenarioOptions[0]
      || { id: "expected", label: t("common.expected"), type: "expected" };
    const selectedScenarioId = activeOption.type === "scenario" ? activeOption.scenarioId : null;
    const activeSimulationResults = selectedScenarioId
      ? simResults.filter((/** @type {any} */ r) => r.scenarioId === selectedScenarioId)
      : simResults;
    const activeScenarios = selectedScenarioId
      ? scenarios
          .filter((/** @type {any} */ s) => s.id === selectedScenarioId)
          .map((/** @type {any} */ s) => ({ ...s, probability: 1 }))
      : scenarios;

    if (activeSimulationResults.length === 0 || activeScenarios.length === 0) return;

    const recommendationMinAllocationCount = maxSplits > 1 ? 2 : 1;
    // v10: include a compact projection of `allStrategies` so the ranking
    // cache invalidates when the allocation shape changes (a 90/10 vs
    // 80/20 has different concentration and must re-rank). Projected form:
    //   "id:pct-pct|..." — small enough to fold into stableStringify cheaply.
    const strategiesProjection = (allStrategies || []).map((/** @type {any} */ s) =>
      `${s.id}:${(s.allocations || []).map((/** @type {any} */ a) => a.percentage).join("-")}`
    ).join("|");
    // Key intentionally scoped to simResults + the right-side scenario
    // selector. Left-side inputs (weights, maxSplits, scenarios array,
    // diversificationPreset, recommendationMinAllocationCount) are frozen
    // at the value they had when simResults was last computed.
    const newRankingKey = stableStringify({
      selectedDetailScenario,
      selectedScenarioId,
      strategiesProjection,
      simResults: (activeSimulationResults || []).map((r) => [
        r.strategyId,
        r.scenarioId,
        r.allocationCount,
        r.totalInterest,
        r.maximumPayment,
        r.endingBalance,
        r.maximumConcurrentRefixPercentage,
        r.floatingExposure,
        r.affordabilityBreaches,
        r.isInfeasible,
        r.payoffTime,
        r.paymentVolatility
      ])
    });
    if (newRankingKey === rankingKeyRef.current && optimisedDataRef.current) {
      return;
    }

    const timer = setTimeout(() => {
      const opt = optimizeStrategies({
        simulationResults: activeSimulationResults,
        scenarios: activeScenarios,
        strategies: allStrategies,
        weights,
        mode: mortgage?.targetMode === "payment" ? "payment" : "term",
        recommendationMinAllocationCount,
        diversification: diversificationPreset !== "default",
        t
      });
      optimisedDataRef.current = opt;
      rankingKeyRef.current = newRankingKey;
      setOptimisedData(opt);

      if (opt && opt.rankedStrategies.length > 0) {
        setRecPreference(opt.recommendations.preference || null);
        setRecLowestCost(opt.recommendations.lowestCost || null);
        setRecMostStable(opt.recommendations.mostStable || null);
        // worstCaseDefense still computed by the optimiser (drives the
        // preference card's worst-case composite contribution) but no
        // longer surfaced as a 4th baseline card.
        // Legacy V6 state slots kept around for the Pareto table's "what
        // benchmark picked this row" tag map. They still read from the
        // (now empty) V6 slots, so the tag map just shows nothing — which
        // is the correct v9 behaviour (the 4 cards have their own tags).
        setRecLowestWorstCaseCost(opt.recommendations.lowestWorstCaseCost || null);
        setRecLowestWorstCasePayment(opt.recommendations.lowestWorstCasePayment || null);
        setRecLowestRefixConcentration(opt.recommendations.lowestRefixConcentration || null);
        setRecLowestBudgetBreaches(opt.recommendations.lowestBudgetBreaches || null);
        setRecLowestVolatility(opt.recommendations.lowestVolatility || null);
        setRecLowestEndingBalance(opt.recommendations.lowestEndingBalance || null);
        setRecMostFloating(opt.recommendations.mostFloating || null);

        if (opt.recommendations.preference) {
          setSelectedRecType("preference");
        }
      }
    }, 150);

    return () => clearTimeout(timer);
    // Dep array trimmed to the inputs that actually influence `newRankingKey`:
    // - simResults: changes only when the simulation re-runs (via the
    //   "重新仿真" button or a mortgage change that triggers a re-simulation)
    // - scenarios: changes when slider-derived state updates; the key check
    //   below ensures the optimizer is NOT re-invoked in that case
    // - detailScenarioOptions / selectedDetailScenario: right-side scenario
    //   basis selector (changing it legitimately re-filters simResults)
    // Removed: weights, mortgage?.targetMode, maxSplits — these are
    // left-side inputs that should NOT cause a re-rank here. They take
    // effect on the next "重新仿真" click.
  }, [simResults, scenarios, detailScenarioOptions, selectedDetailScenario, t]);

  // Lazy-fetch the per-tranche 60-month detail timeline for any strategy.
// Shared by the selected-strategy effect and the modal opener — clicking
// "查看详情" on a benchmark tile or Pareto row triggers the same pipeline
// so the modal always has fresh data for whichever strategy is open.
  const loadDetailForStrategy = (/** @type {string} */ strategyId) => {
    if (!strategyId || !simResults || !mortgage) return;
    if (detailResultsByStrategy[strategyId] || detailLoadingStrategyId === strategyId) return;

    const strategy = allStrategies.find((/** @type {any} */ s) => s.id === strategyId);
    if (!strategy) return;

    setDetailLoadingStrategyId(strategyId);

    Promise.resolve().then(() => {
      const detailResults = scenarios.map((/** @type {any} */ scenario) => simulateStrategyScenario({
        mortgage,
        strategy,
        scenario,
        products: nzProfile.products,
        currentProductRates: marketRates,
        startDate: new Date().toISOString().split("T")[0],
        forecastMonths: simDurationYears * 12,
        maxAffordablePayment,
        includeTimeline: true,
        includeRefixEvents: true
      }));
      setDetailResultsByStrategy((prev) => ({ ...prev, [strategyId]: detailResults }));
      setDetailLoadingStrategyId((prev) => (prev === strategyId ? null : prev));
    }).catch((err) => {
      console.error("Failed to build strategy detail timeline", err);
      setDetailLoadingStrategyId((prev) => (prev === strategyId ? null : prev));
    });
  };

  // Detail fetch is now lazy: only triggered when the user opens a modal.
// See `loadDetailForStrategy` calls in `openStrategyDetailModal`.

  // Start Matrix Simulation using Web Worker
  const handleStartSimulation = async () => {
    if (!mortgage) return;
    if (simulationInFlightRef.current) return;
    simulationInFlightRef.current = true;

    try {
    await releaseSimulationArtifacts();
    simulationInFlightRef.current = true;
    setError(null);
    setShowExhaustedReport(true);
    setShowAllRows(false);

    const totalBalance = mortgage.tranches.reduce((/** @type {number} */ sum, /** @type {any} */ t) => sum + t.balance, 0);

    // Generate Split Strategies
    const strategies = generateSplitStrategies({
      totalAmount: totalBalance,
      allowedProducts: nzProfile.products.map(p => ({ code: p.code, type: p.type })),
      constraints: {
        maxSplits,
        minPercentage: nzProfile.rules.minPercentage,
        percentageStep,
        minTrancheAmount: nzProfile.rules.minTrancheAmount,
        maxFloatingPercentage: maxFloatingPercentage / 100
        // `minFixedPercentage` is intentionally not passed: the strategy
        // generator derives it as `1 - maxFloatingPercentage` internally (see
        // packages/strategy-generator/src/index.js). Centralising the
        // derivation removes a duplicated computation that previously lived
        // here and could drift out of sync.
      },
      refixRule: { type: "same-term" }
    });

    if (strategies.length === 0) {
      simulationInFlightRef.current = false;
      setSimulationRunning(false);
      setError(t("strategyLab.noResults"));
      return;
    }

    setTotalSims(strategies.length * scenarios.length);
    setCompletedSims(0);
    setCurrentSimulationInfo(null);
    setAllStrategies(strategies);

    // simulationKey (spec 11.3): hash the inputs that affect the simulation
    // matrix. If the key is unchanged and the worker has a cached result, the
    // page can short-circuit and not even post a message.
    const newSimulationKey = stableStringify({
      mortgage,
      strategies,
      scenarios,
      products: nzProfile.products,
      currentProductRates: marketRates,
      startDate: new Date().toISOString().split("T")[0],
      forecastMonths: simDurationYears * 12,
      maxAffordablePayment
    });
    const forceRecompute = newSimulationKey !== simulationKeyRef.current;

    // Lazily create the worker once and reuse it across runs. The worker's
    // in-process LRU cache (size 1) survives between runs, so identical
    // inputs return `type: "cached"` without re-running the matrix.
    // (Reviewer H-1 fix.) We only terminate the worker on unmount.
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL("../../workers/simulation.worker.js", import.meta.url),
        { type: "module" }
      );
    }

    setSimulationRunning(true);
    setProgress(0);
    setCompletedSims(0);
    setCurrentSimulationInfo(null);

    workerRef.current.onmessage = (/** @type {any} */ e) => {
      const msg = e.data;
      if (msg.type === "progress") {
        setProgress(Math.round((msg.completed / msg.total) * 100));
        setCompletedSims(msg.completed);
        setTotalSims(msg.total);
        setCurrentSimulationInfo(msg.current || null);
      } else if (msg.type === "success" || msg.type === "cached") {
        if (msg.key) {
          simulationKeyRef.current = msg.key;
        }
        setSimResults(msg.results || []);
        setHideParameterPanel(true);
        simulationInFlightRef.current = false;
        setSimulationRunning(false);
        // Save strategies and params to IndexedDB
        dbPut("savedResults", {
          id: "last_simulation_params",
          strategies,
          params: {
            shortTermChange,
            mediumTermDirection,
            changeSpeed,
            uncertainty,
            scenarioProbabilities,
            longTermCycleYears,
            longTermReversalBias,
            monteCarloSampleCount,
            simDurationYears,
            maxSplits,
            maxFloatingPercentage,
            maxAffordablePayment,
            weights
          }
        }).catch(err => {
          console.error("Failed to save simulation params to IndexedDB", err);
        });
      } else if (msg.type === "error") {
        console.error("Worker error:", msg.error);
        setError(t("common.workerError", { message: msg.error }));
        simulationInFlightRef.current = false;
        setSimulationRunning(false);
      }
    };

    // Send data to worker
    workerRef.current.postMessage({
      mortgage,
      strategies,
      scenarios,
      products: nzProfile.products,
      currentProductRates: marketRates,
      startDate: new Date().toISOString().split("T")[0],
      forecastMonths: simDurationYears * 12,
      maxAffordablePayment,
      forceRecompute
    });
    } catch (err) {
      console.error("Simulation failed:", err);
      setError(t("common.workerError", { message: err instanceof Error ? err.message : String(err) }));
      simulationInFlightRef.current = false;
      setSimulationRunning(false);
    }
  };

  const handleCancelSimulation = () => {
    if (workerRef.current) {
      workerRef.current.terminate();
      // Terminate drops the worker reference; clear it so the next run
      // re-creates a fresh worker. This intentionally busts the LRU cache
      // (the user cancelled, so a stale cached result is not desirable).
      workerRef.current = null;
    }
    simulationInFlightRef.current = false;
    setSimulationRunning(false);
    setProgress(0);
    setCompletedSims(0);
    setCurrentSimulationInfo(null);
  };

  const renderStrategySplit = (/** @type {string} */ strategyId) => {
    const strat = allStrategies.find(s => s.id === strategyId);
    if (!strat) return strategyId;
    return strat.allocations
      .map((/** @type {any} */ a) => {
        const prod = nzProfile.products.find((/** @type {any} */ p) => p.code === a.productCode);
        const name = prod ? prod.displayName : a.productCode;
        return `${name}: $${a.amount.toLocaleString()} (${(a.percentage * 100).toFixed(0)}%)`;
      })
      .join(" + ");
  };

  const getTotalBalance = () => {
    if (!mortgage || !mortgage.tranches) return 0;
    return mortgage.tranches.reduce((/** @type {number} */ sum, /** @type {any} */ t) => sum + t.balance, 0);
  };

  const getRepaymentFrequencyLabel = () => {
    if (!mortgage) return t("common.monthly");
    const freq = mortgage.repaymentFrequency;
    if (freq === "weekly") return t("common.weekly");
    if (freq === "fortnightly") return t("common.fortnightly");
    return t("common.monthly");
  };

  const getActiveDetailScenarioOption = () =>
    detailScenarioOptions.find((/** @type {any} */ opt) => opt.id === selectedDetailScenario)
    || detailScenarioOptions[0]
    || null;

  /**
   * Render the "查看详情 →" footer CTA placed at the bottom-right of every
   * benchmark / preference tile. Click stops propagation so the card body's
   * own setSelectedRecType handler (which highlights the tile) does NOT also
   * fire — the modal opens instead.
   * @param {string|null} strategyId
   * @param {string} recKey - which recommendation this tile represents
   * @param {"benchmark"|"preference"} origin
   */
  const renderTileFooter = (/** @type {string|null} */ strategyId, /** @type {string} */ recKey, /** @type {"benchmark"|"preference"} */ origin) => {
    if (!strategyId) return null;
    return (
      <div className="rec-card-footer">
        <span className="rec-card-footer-spacer" />
        <button
          type="button"
          className="btn btn-secondary rec-card-cta"
          onClick={(e) => openStrategyDetailModal(e, strategyId, recKey, origin)}
          aria-label={t("common.splitBadgeAria", { rec: recKey, split: renderStrategySplit(strategyId) })}
        >
          {t("common.viewDetails")}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>
    );
  };

  const preferenceWeightItems = [
    {
      key: "cost",
      label: t("strategyLab.weightKeys.cost"),
      minText: t("strategyLab.weightKeys.costMin"),
      maxText: t("strategyLab.weightKeys.costMax"),
      explanation: t("strategyLab.weightKeys.costExplain"),
    },
    {
      key: "refix",
      label: t("strategyLab.weightKeys.refix"),
      minText: t("strategyLab.weightKeys.refixMin"),
      maxText: t("strategyLab.weightKeys.refixMax"),
      explanation: t("strategyLab.weightKeys.refixExplain"),
    },
    {
      key: "flex",
      label: t("strategyLab.weightKeys.flex"),
      minText: t("strategyLab.weightKeys.flexMin"),
      maxText: t("strategyLab.weightKeys.flexMax"),
      explanation: t("strategyLab.weightKeys.flexExplain"),
    },
    {
      key: "balance",
      label: t("strategyLab.weightKeys.balance"),
      minText: t("strategyLab.weightKeys.balanceMin"),
      maxText: t("strategyLab.weightKeys.balanceMax"),
      explanation: t("strategyLab.weightKeys.balanceExplain"),
    },
    {
      key: "worstCaseDefense",
      label: t("strategyLab.weightKeys.worstCaseDefense"),
      minText: t("strategyLab.weightKeys.worstCaseDefenseMin"),
      maxText: t("strategyLab.weightKeys.worstCaseDefenseMax"),
      explanation: t("strategyLab.weightKeys.worstCaseDefenseExplain"),
    }
  ];

  // v11: after every `weights` change, sync each inline preference slider's
  // DOM `value` + `--slider-fill` to the new state. The inline sliders are
  // uncontrolled (`defaultValue` only sets the initial render), so without
  // this the OTHER sliders' thumbs stay at their old positions while the
  // displayed % (next to the slider, from `weights`) updates — visual
  // mismatch between "blue border" (thumb position) and "dot" (displayed %).
  // Skip the slider currently being dragged (its DOM value is the source of
  // truth mid-drag; re-setting it would cancel the drag).
  useEffect(() => {
    preferenceWeightItems.forEach((item) => {
      if (preferenceDraggingRef.current === item.key) return;
      const slider = preferenceSliderRefs.current[item.key];
      if (!slider) return;
      const next = String(weights[item.key] ?? 0);
      if (slider.value !== next) {
        slider.value = next;
      }
      applySliderFill(slider);
    });
  }, [weights]);

  const preferenceSummaryItems = [...preferenceWeightItems]
    .sort((a, b) => (weights[b.key] ?? 0) - (weights[a.key] ?? 0))
    .slice(0, 3);

  const renderSelectedPathExplanation = () => {
    const activeOption = getActiveDetailScenarioOption();
    if (!activeOption) return null;
    const stats = activeOption.targetStats;
    const pathLabel = activeOption.label || t("common.expected");

    return (
      <div className="recommendation-path-explain">
        <div className="path-explain-copy">
          <span className="path-dot" style={{ background: activeOption.color || "var(--text-secondary)" }} />
          <span>{t("strategyLab.pathExplain.current", { path: pathLabel })}</span>
        </div>
        {stats && (
          <div className="path-target-grid">
            <div>
              <span>{t("strategyLab.pathExplain.avg")}</span>
              <strong>{formatRatePercent(stats.averageRate)}</strong>
            </div>
            <div>
              <span>{t("strategyLab.pathExplain.range")}</span>
              <strong>{formatRatePercent(stats.minRate)} - {formatRatePercent(stats.maxRate)}</strong>
            </div>
            <div>
              <span>{t("strategyLab.pathExplain.final")}</span>
              <strong>{formatRatePercent(stats.finalRate)}</strong>
            </div>
          </div>
        )}
      </div>
    );
  };

  const getDetailResultForStrategy = (/** @type {string} */ strategyId) => {
    if (!simResults) return null;
    const strategyDetailResults = detailResultsByStrategy[strategyId];
    if (!strategyDetailResults || strategyDetailResults.length === 0) return null;
    const activeOption = getActiveDetailScenarioOption();
    if (!activeOption) return null;

    if (activeOption.type === "scenario") {
      const scenarioResult = strategyDetailResults.find((/** @type {any} */ r) => r.strategyId === strategyId && r.scenarioId === activeOption.scenarioId);
      return scenarioResult ? { ...scenarioResult, detailLabel: activeOption.label, isExpectedAggregate: false } : null;
    }

    const strategySummary = optimisedData?.rankedStrategies.find((/** @type {any} */ s) => s.strategyId === strategyId);
    const probabilityMap = new Map(scenarios.map((/** @type {any} */ s) => [s.id, s.probability || 0]));
    const relevantResults = strategyDetailResults
      .filter((/** @type {any} */ r) => r.strategyId === strategyId && Array.isArray(r.timeline) && r.timeline.length > 0)
      .map((/** @type {any} */ r) => ({ result: r, probability: probabilityMap.get(r.scenarioId) || 0 }))
      .filter((/** @type {any} */ entry) => entry.probability > 0);

    if (relevantResults.length === 0) return null;

    const aggregatedTimeline = Array.from({ length: relevantResults[0].result.timeline.length }, (_, idx) => {
      const templateMonth = relevantResults[0].result.timeline[idx];
      const templateTranches = templateMonth?.tranches || [];
      return {
        monthIndex: templateMonth?.monthIndex ?? idx,
        closingBalance: relevantResults.reduce((sum, entry) => sum + entry.probability * (entry.result.timeline[idx]?.closingBalance || 0), 0),
        scheduledPayment: relevantResults.reduce((sum, entry) => sum + entry.probability * (entry.result.timeline[idx]?.scheduledPayment || 0), 0),
        tranches: templateTranches.map((/** @type {any} */ tranche) => ({
          id: tranche.id,
          rate: relevantResults.reduce((sum, entry) => sum + entry.probability * (entry.result.timeline[idx]?.tranches?.find((/** @type {any} */ t) => t.id === tranche.id)?.rate || 0), 0),
          interest: relevantResults.reduce((sum, entry) => sum + entry.probability * (entry.result.timeline[idx]?.tranches?.find((/** @type {any} */ t) => t.id === tranche.id)?.interest || 0), 0),
          closingBalance: relevantResults.reduce((sum, entry) => sum + entry.probability * (entry.result.timeline[idx]?.tranches?.find((/** @type {any} */ t) => t.id === tranche.id)?.closingBalance || 0), 0)
        }))
      };
    });

    return {
      scenarioId: "expected",
      totalInterest: strategySummary?.expectedInterest ?? relevantResults.reduce((sum, entry) => sum + entry.probability * entry.result.totalInterest, 0),
      maximumPayment: strategySummary?.expectedMaxPayment ?? relevantResults.reduce((sum, entry) => sum + entry.probability * entry.result.maximumPayment, 0),
      endingBalance: strategySummary?.expectedEndingBalance ?? relevantResults.reduce((sum, entry) => sum + entry.probability * entry.result.endingBalance, 0),
      timeline: aggregatedTimeline,
      refixEvents: [],
      detailLabel: activeOption.label,
      isExpectedAggregate: true
    };
  };

  const getStrategyDisplayMetrics = (/** @type {string} */ strategyId) => {
    const strategySummary = optimisedData?.rankedStrategies.find((/** @type {any} */ x) => x.strategyId === strategyId);
    if (!strategySummary) return null;
    const activeOption = getActiveDetailScenarioOption();
    const scenarioId = activeOption?.type === "scenario" ? activeOption.scenarioId : null;
    const scenarioResult = scenarioId
      ? simResults?.find((/** @type {any} */ r) => r.strategyId === strategyId && r.scenarioId === scenarioId)
      : null;

    const endingBalance = scenarioResult ? scenarioResult.endingBalance : strategySummary.expectedEndingBalance;

    return {
      interest: scenarioResult ? scenarioResult.totalInterest : strategySummary.expectedInterest,
      maxPayment: scenarioResult ? scenarioResult.maximumPayment : strategySummary.expectedMaxPayment,
      endingBalance,
      principalRepaid: getTotalBalance() - endingBalance,
      label: activeOption?.label || t("common.expected"),
      isScenarioSpecific: Boolean(scenarioResult)
    };
  };

  const renderCardMetrics = (/** @type {string} */ strategyId) => {
    const metrics = getStrategyDisplayMetrics(strategyId);
    if (!metrics) return null;
    const freqLabel = getRepaymentFrequencyLabel();
    // For the default aggregate ("Expected" / "概率加权期望") view, the
    // metric keys already include the "Expected" / "期望" prefix; prepending
    // it again produced "ExpectedExpected Total interest". Only prepend the
    // scenario label when showing a scenario-specific view.
    const metricLabelPrefix = metrics.isScenarioSpecific ? `${metrics.label} ` : "";

    return (
      <div className="rec-metrics">
        <div className="rec-metric stat-tile">
          <span className="stat-tile-lbl">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
            {metricLabelPrefix}{t("strategyLab.rec.metric.expectedTotalInterest")}
          </span>
          <span className="stat-tile-val">${Math.round(metrics.interest).toLocaleString()}</span>
        </div>
        <div className="rec-metric stat-tile">
          <span className="stat-tile-lbl">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2v20" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
            {metricLabelPrefix}{t("strategyLab.rec.metric.expectedMaxPayment", { freq: freqLabel })}
          </span>
          <span className="stat-tile-val text-rose">${Math.round(metrics.maxPayment).toLocaleString()}</span>
        </div>
        <div className="rec-metric stat-tile">
          <span className="stat-tile-lbl">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>
            {metricLabelPrefix}{t("strategyLab.rec.metric.principalRepaid")}
          </span>
          <span className="stat-tile-val text-emerald">${Math.round(metrics.principalRepaid).toLocaleString()}</span>
        </div>
        <div className="rec-metric stat-tile">
          <span className="stat-tile-lbl">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>
            {metricLabelPrefix}{t("strategyLab.rec.metric.endingBalance")}
          </span>
          <span className="stat-tile-val">${Math.round(metrics.endingBalance).toLocaleString()}</span>
        </div>
      </div>
    );
  };

  const buildDetailTimelineData = (/** @type {string|null} */ strategyIdArg) => {
    // Resolve which strategy to build the timeline for. The caller always
    // passes a strategyId explicitly (either the modal's open strategy or
    // the parameter passed in by the page-level render).
    const targetId = strategyIdArg;
    if (!targetId || !simResults) return null;

    const detailResult = getDetailResultForStrategy(targetId);
    if (!detailResult || !detailResult.timeline) return null;

    const strategy = allStrategies.find((/** @type {any} */ s) => s.id === targetId);
    if (!strategy) return null;

    const frequency = mortgage?.repaymentFrequency || "monthly";
    const forecastMonths = simulatedMonths;
    const interval = 6;
    /** @type {number[]} */
    const snapshotMonths = [];
    for (let m = interval; m <= forecastMonths; m += interval) {
      snapshotMonths.push(m);
    }
    if (snapshotMonths.length === 0) return null;

    const getEventMonth = (/** @type {number} */ periodIndex) => {
      if (frequency === "monthly") return periodIndex;
      if (frequency === "fortnightly") return Math.floor(periodIndex * 12 / 26);
      return Math.floor(periodIndex * 12 / 52);
    };

    const refixEvents = detailResult.refixEvents || [];

    const tranches = strategy.allocations.map((/** @type {any} */ alloc, /** @type {number} */ idx) => {
      const trancheId = `tranche-${idx}-${alloc.productCode}`;
      const prod = nzProfile.products.find((/** @type {any} */ p) => p.code === alloc.productCode);
      const displayName = prod ? prod.displayName : alloc.productCode;
      const initialBalance = alloc.amount;

      let prevBalance = initialBalance;

      const snapshots = snapshotMonths.map((snapshotMonth) => {
        const prevSnapshot = snapshotMonths[snapshotMonths.indexOf(snapshotMonth) - 1] || 0;

        const windowMonths = detailResult.timeline.filter(
          (/** @type {any} */ t) => t.monthIndex >= prevSnapshot && t.monthIndex < snapshotMonth
        );

        const snapshotMonthData = detailResult.timeline.find((/** @type {any} */ t) => t.monthIndex === snapshotMonth - 1)
          || detailResult.timeline[detailResult.timeline.length - 1];
        const trancheAtSnapshot = snapshotMonthData?.tranches?.find((/** @type {any} */ t) => t.id === trancheId);

        const rate = trancheAtSnapshot?.rate ?? 0;
        const balance = trancheAtSnapshot?.closingBalance ?? prevBalance;

        const interestPaid = windowMonths.reduce((/** @type {number} */ sum, /** @type {any} */ mt) => {
          const td = mt.tranches?.find((/** @type {any} */ t) => t.id === trancheId);
          return sum + (td ? td.interest : 0);
        }, 0);

        const principalRepaid = prevBalance - balance;

        const windowEvents = refixEvents.filter((/** @type {any} */ e) => {
          if (e.trancheId !== trancheId) return false;
          const em = getEventMonth(e.periodIndex);
          return em >= prevSnapshot && em < snapshotMonth;
        }).map((/** @type {any} */ e) => {
          const newProd = nzProfile.products.find((/** @type {any} */ p) => p.code === e.newProduct);
          const newProdName = newProd ? newProd.displayName : e.newProduct;
          return `${newProdName}: ${(e.newRate * 100).toFixed(2)}%`;
        });

        prevBalance = balance;

        return {
          month: snapshotMonth,
          rate,
          interestPaid,
          principalRepaid,
          totalPayment: interestPaid + principalRepaid,
          balance,
          events: windowEvents
        };
      });

      return { trancheId, displayName, productCode: alloc.productCode, initialBalance, snapshots };
    });

    return { snapshotMonths, tranches, frequency };
  };

  const getProductMixKey = (/** @type {any} */ strategy) => {
    const sortedAllocations = [...strategy.allocations].sort((a, b) => {
      const aDef = nzProfile.products.find(p => p.code === a.productCode);
      const bDef = nzProfile.products.find(p => p.code === b.productCode);
      const aType = aDef ? aDef.type : "";
      const bType = bDef ? bDef.type : "";
      if (aType === "floating" && bType !== "floating") return -1;
      if (aType !== "floating" && bType === "floating") return 1;
      const aMonths = aDef?.fixedMonths || 0;
      const bMonths = bDef?.fixedMonths || 0;
      return aMonths - bMonths;
    });
    return sortedAllocations.map(a => a.productCode).join(" + ");
  };

  const getBestStrategiesPerMix = () => {
    if (!optimisedData || !optimisedData.rankedStrategies) return [];

    /** @type {Record<string, any[]>} */
    const mixGroups = {};
    optimisedData.rankedStrategies.forEach(s => {
      const strat = allStrategies.find(x => x.id === s.strategyId);
      if (!strat) return;
      const key = getProductMixKey(strat);
      if (!mixGroups[key]) {
        mixGroups[key] = [];
      }
      mixGroups[key].push(s);
    });

    const bestPerMix = Object.keys(mixGroups).map(key => {
      return mixGroups[key][0];
    });

    bestPerMix.sort((a, b) => a.score - b.score);
    return bestPerMix;
  };

  /**
   * Return the number of allocations (split count) for a ranked strategy by
   * looking it up in `allStrategies`. Falls back to 1 when the strategy is
   * missing (matches the existing inline rendering at the table cell).
   * @param {any} rankedStrategy
   * @returns {number}
   */
  const getSplitCountForRanked = (/** @type {any} */ rankedStrategy) => {
    const strat = allStrategies.find(x => x.id === rankedStrategy?.strategyId);
    return strat?.allocations?.length || 1;
  };

  /**
   * Available split-count buckets for the filter pills. Only counts that
   * actually appear in the *currently visible* strategies are rendered, so
   * the chips always reflect data the user can switch to.
   * @returns {number[]}
   */
  const getAvailableSplitCounts = () => {
    if (!optimisedData || !optimisedData.rankedStrategies) return [];
    const counts = new Set();
    optimisedData.rankedStrategies.forEach((/** @type {any} */ s) => {
      counts.add(getSplitCountForRanked(s));
    });
    return Array.from(counts).sort((a, b) => a - b);
  };

  const [error, setError] = useState(/** @type {string|null} */(null));

  /**
   * Render a sortable numeric column header. Shows the current sort arrow
   * (▲ / ▼) for the active column, dim arrow for inactive ones, and cycles
   * asc → desc → cleared on repeated clicks.
   * @param {string} sortKey - one of the numeric field names on a ranked strategy
   * @param {string} label
   * @param {{key: string|null, dir: "asc"|"desc"}|null} sortState
   * @param {(key: string) => void} onClick
   * @returns {any}
   */
  const renderSortHeader = (sortKey, label, sortState, onClick) => {
    const isActive = sortState && sortState.key === sortKey;
    const arrow = isActive ? (sortState.dir === "asc" ? "▲" : "▼") : "↕";
    // Inline-style belt-and-braces: Chrome's user-agent stylesheet gives
    // <button> a grey background, 1px border, and inset shadow that
    // styled-jsx scoping sometimes doesn't fully cancel. The `!important`
    // on the .th-sort-btn class is the primary fix; this inline style is
    // a guaranteed override in case the class rule gets dropped.
    return (
      <button
        type="button"
        className={`th-sort-btn ${isActive ? "active" : ""}`}
        onClick={() => onClick(sortKey)}
        aria-label={t("common.sortBy", { label })}
        style={{
          background: "transparent",
          border: "none",
          padding: 0,
          color: "inherit",
          fontWeight: 600
        }}
      >
        <span>{label}</span>
        <span className="th-sort-arrow" aria-hidden="true">{arrow}</span>
      </button>
    );
  };

  /**
   * Resolve the numeric value used for sorting a ranked strategy on a given
   * column key. The `principalRepaid` column is derived in the row from
   * `totalBalance - expectedEndingBalance`; mirror that here so sorting by
   * "Expected principal repaid" matches the displayed values.
   * @param {any} s
   * @param {string} key
   * @returns {number|null}
   */
  const resolveSortValue = (/** @type {any} */ s, /** @type {string} */ key) => {
    if (!s) return null;
    if (key === "splitCount") return getSplitCountForRanked(s);
    if (key === "principalRepaid") {
      if (typeof s.expectedEndingBalance !== "number") return null;
      return getTotalBalance() - s.expectedEndingBalance;
    }
    const v = s[key];
    return typeof v === "number" ? v : null;
  };

  /**
   * Build the 4-section `intro` payload that StrategyDetailModal renders
   * above its metrics grid. v9: every detail popup now opens with a
   * personalised "why this card picked this strategy" block, anchored to
   * the card the user clicked (`originCard`). When called from a Pareto
   * row (`originCard === "row"`), it falls back to `preference` semantics.
   *
   * Sections:
   *   - whyThisOne: short Chinese narrative explaining the pick
   *   - tradeOff: per-axis mark-up (Top 20% / Bottom 20%)
   *   - suitableFor: trait tags ("高浮动", "短锁定", ...)
   *   - comparison: 2 nearest strategies by score with delta metrics
   *
   * @param {any} strategy
   * @param {Object} ctx
   * @param {"preference"|"lowestCost"|"mostStable"|"worstCaseDefense"|"row"} ctx.originCard
   * @param {any[]} ctx.allStrategies
   * @param {Record<string, number>} ctx.weights
   * @returns {{whyThisOne: string, tradeOff: Array<{label:string, status:string}>, suitableFor: string[], comparison: Array<{label:string, interestDelta:number, stabilityDelta:number}>}}
   */
  const buildStrategyIntro = (/** @type {any} */ strategy, /** @type {any} */ ctx) => {
    const originCard = ctx?.originCard || "row";
    const allStrategies = Array.isArray(ctx?.allStrategies) ? ctx.allStrategies : [];
    if (!strategy) {
      return { whyThisOne: "", tradeOff: [], suitableFor: [], comparison: [] };
    }

    // Per-axis trade-off marker. Scans 12 metrics against the bounds for the
    // current Pareto set and marks each as "优异" (top 20%) or "较弱" (bottom
    // 20%). The exact axis label is in `label` and rendered in the modal.
    const tradeOffAxes = [
      { key: "expectedInterest", label: t("strategyDetail.axis.interest"), direction: "min" },
      { key: "worstCaseInterest", label: t("strategyDetail.axis.worstCaseInterest"), direction: "min" },
      { key: "worstCasePayment", label: t("strategyDetail.axis.worstCasePayment"), direction: "min" },
      { key: "expectedMaxPayment", label: t("strategyLab.rec.metric.expectedMaxPayment", { freq: getRepaymentFrequencyLabel() }), direction: "min" },
      { key: "expectedMaxConcurrentRefixPercentage", label: t("strategyDetail.axis.refix"), direction: "min" },
      { key: "expectedAffordabilityBreaches", label: t("strategyDetail.axis.budget"), direction: "min" },
      { key: "worstCaseAffordabilityBreaches", label: t("strategyDetail.axis.worstCaseBreaches"), direction: "min" },
      { key: "expectedRefixEventCount", label: t("strategyDetail.axis.refixEventCount"), direction: "min" },
      { key: "expectedPaymentVolatility", label: t("strategyDetail.axis.volatility"), direction: "min" },
      { key: "expectedEndingBalance", label: t("strategyDetail.axis.endingPrincipal"), direction: "min" },
      { key: "expectedFloatingExposure", label: t("strategyDetail.axis.floating"), direction: "max" },
      { key: "flexibilityPenalty", label: t("strategyDetail.axis.flexibilityPenalty"), direction: "min" },
      { key: "concentration", label: t("strategyDetail.axis.concentration"), direction: "min" }
    ];
    const boundsFor = (key) => {
      const values = allStrategies.map((s) => s[key]).filter((v) => typeof v === "number");
      if (values.length === 0) return { min: 0, max: 0, diff: 1 };
      const min = Math.min(...values);
      const max = Math.max(...values);
      return { min, max, diff: (max - min) || 1 };
    };
    const tradeOff = tradeOffAxes.map((axis) => {
      const b = boundsFor(axis.key);
      const v = strategy[axis.key];
      if (typeof v !== "number") {
        return { label: axis.label, status: t("strategyLab.intro.statusMid") };
      }
      const normalized = (v - b.min) / b.diff;
      if (axis.direction === "max") {
        if (normalized >= 0.8) return { label: axis.label, status: t("strategyLab.intro.statusTop") };
        if (normalized <= 0.2) return { label: axis.label, status: t("strategyLab.intro.statusBottom") };
        return { label: axis.label, status: t("strategyLab.intro.statusMid") };
      }
      if (normalized <= 0.2) return { label: axis.label, status: t("strategyLab.intro.statusTop") };
      if (normalized >= 0.8) return { label: axis.label, status: t("strategyLab.intro.statusBottom") };
      return { label: axis.label, status: t("strategyLab.intro.statusMid") };
    });

    // whyThisOne: short narrative per card type. Falls back to a generic
    // rank-based note for row clicks.
    let whyThisOne = "";
    const recIds = ctx?.recIds || {};
    if (originCard === "preference") {
      whyThisOne = t("strategyLab.intro.whyThisOnePersonal", { rank: 1 });
    } else if (originCard === "lowestCost") {
      whyThisOne = t("strategyLab.intro.whyThisOneCost");
      if (recIds.preference && recIds.preference !== strategy.strategyId) {
        whyThisOne += " " + t("strategyLab.intro.whyThisOneAvoid", { other: t("strategyLab.recCard.preference.title"), focus: "lowest-cost" });
      }
    } else if (originCard === "mostStable") {
      whyThisOne = t("strategyLab.intro.whyThisOneStable");
      if (recIds.preference && recIds.lowestCost && strategy.strategyId !== recIds.preference && strategy.strategyId !== recIds.lowestCost) {
        whyThisOne += " " + t("strategyLab.intro.whyThisOneAvoidTwo", { a: t("strategyLab.recCard.preference.title"), b: t("strategyLab.recCard.lowestCost.title"), focus: "stable payment" });
      }
    } else if (originCard === "worstCaseDefense") {
      whyThisOne = t("strategyLab.intro.whyThisOneWorst");
      if (recIds.preference && recIds.lowestCost && recIds.mostStable &&
          strategy.strategyId !== recIds.preference &&
          strategy.strategyId !== recIds.lowestCost &&
          strategy.strategyId !== recIds.mostStable) {
        whyThisOne += " " + t("strategyLab.intro.whyThisOneAvoidThree", { a: t("strategyLab.recCard.preference.title"), b: t("strategyLab.recCard.lowestCost.title"), c: t("strategyLab.recCard.mostStable.title"), focus: "worst-case" });
      }
    } else {
      whyThisOne = t("strategyLab.intro.whyThisOneRow") + ` #${(strategy.score ?? 0).toFixed(2)}.`;
    }

    // suitableFor: scan the strategy's allocation shape for trait tags.
    /** @type {string[]} */
    const suitableFor = [];
    const floatingExposure = strategy.expectedFloatingExposure || 0;
    const refixCount = strategy.expectedRefixEventCount || 0;
    const breaches = strategy.expectedAffordabilityBreaches || 0;
    if (floatingExposure >= 0.6) suitableFor.push(t("strategyLab.intro.suitable.flexHeavy"));
    if (floatingExposure <= 0.1) suitableFor.push(t("strategyLab.intro.suitable.fixedHeavy"));
    if (refixCount === 0) suitableFor.push(t("strategyLab.intro.suitable.refixAverse"));
    if (breaches === 0) suitableFor.push(t("strategyLab.intro.suitable.budgetConstrained"));
    if ((strategy.expectedEndingBalance || 0) <= boundsFor("expectedEndingBalance").min) suitableFor.push(t("strategyLab.intro.suitable.fastPayoff"));
    if ((strategy.worstCasePayment || 0) <= boundsFor("worstCasePayment").min) suitableFor.push(t("strategyLab.intro.suitable.stablePayment"));
    if (suitableFor.length === 0) suitableFor.push(t("strategyDetail.balancedMix"));

    // comparison: find 2 nearest strategies by score distance and show
    // interest / stability deltas so the user sees what they gain/lose.
    /** @type {Array<{label:string, interestDelta:number, stabilityDelta:number}>} */
    const comparison = [];
    const myScore = strategy.score ?? 0;
    const myInterest = strategy.expectedInterest || 0;
    const myWorstPay = strategy.worstCasePayment || 0;
    const sortedByDist = allStrategies
      .filter((s) => s.strategyId !== strategy.strategyId)
      .map((s) => ({ s, dist: Math.abs((s.score ?? 0) - myScore) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 2);
    sortedByDist.forEach(({ s }, idx) => {
      const label = idx === 0 ? t("strategyLab.intro.nearNeighbor1") : t("strategyLab.intro.nearNeighbor2");
      comparison.push({
        label,
        interestDelta: Math.round(((s.expectedInterest || 0) - myInterest)),
        stabilityDelta: Math.round(((s.worstCasePayment || 0) - myWorstPay))
      });
    });

    return { whyThisOne, tradeOff, suitableFor, comparison };
  };

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "80vh" }}>
        <div>{t("common.loading")}</div>
      </div>
    );
  }

  return (
    <div className="lab-container">
      <header className="lab-header">
        <div className="header-copy">
          <h1 className="title">{t("strategyLab.title")}</h1>
          <p className="subtitle">{t("strategyLab.subtitle")}</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            onClick={() => setHideParameterPanel((prev) => !prev)}
            className="btn btn-secondary top-reset-btn"
            disabled={simulationRunning}
            title={shouldHideParameterPanel ? t("strategyLab.showInputTitle") : t("strategyLab.hideInputTitle")}
          >
            {shouldHideParameterPanel ? t("strategyLab.showInputBtn") : t("strategyLab.hideInputBtn")}
          </button>
          <button
            type="button"
            onClick={handleClearSimulationOutput}
            className="btn btn-secondary top-reset-btn"
            disabled={simulationRunning || (!simResults && !optimisedData && allStrategies.length === 0)}
            title={t("strategyLab.clearResultsTitle")}
          >
            {t("strategyLab.clearResultsBtn")}
          </button>
        </div>
      </header>
      <div className={`lab-grid ${shouldHideParameterPanel ? "inputs-hidden" : ""}`}>
        {!shouldHideParameterPanel && (
        <div className="left-controls-col">
          <section className="glass-panel control-section">
            <h2 className="section-title parameter-section-title">
              <span>1. {t("strategyLab.parameters")}</span>
              <button
                type="button"
                className="weights-reset-btn parameter-reset-all-btn"
                onClick={handleResetAllParameters}
                disabled={!isAnyParameterModified}
                title={t("strategyLab.resetAllTitle")}
              >
                {t("strategyLab.resetAll")}
              </button>
            </h2>

            <div className="control-group">
              <div
                className="control-group-header"
                role="button"
                tabIndex={0}
                onClick={() => toggleControlGroup("trend")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleControlGroup("trend");
                  }
                }}
              >
                <span className="control-group-title-wrap">
                  <span className="step-num">1</span>
                  <span>
                    <span className="control-group-title">{t("strategyLab.group1.title")}</span>
                    <span className="control-group-subtitle">{t("strategyLab.group1.subtitle")}</span>
                  </span>
                </span>
                <span className="control-group-actions">
                  {isTrendModified && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleResetTrend();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          handleResetTrend();
                        }
                      }}
                      className="weights-reset-btn"
                    >
                      {t("strategyLab.resetDefault")}
                    </span>
                  )}
                  <span className="control-group-toggle">{openControlGroups.trend ? t("strategyLab.collapse") + " ▴" : t("strategyLab.expand") + " ▾"}</span>
                </span>
              </div>
              {openControlGroups.trend && (
                <div className="control-group-body">
                  <div className="form-group">
                    <div className="slider-label-row">
                      <span className="form-label">{t("strategyLab.shortTermChange.label")}</span>
                      <span className="slider-value">{(shortTermChange * 100).toFixed(2)}%</span>
                    </div>
                    <Slider min={-0.02} max={0.02} step={0.0025} value={shortTermChange} onChange={(e) => setShortTermChange(parseFloat(e.target.value))} aria-label={t("strategyLab.shortTermChange.label")} aria-valuetext={`${(shortTermChange * 100).toFixed(2)}%`} />
                    <div className="slider-range-desc">
                      <span>{t("strategyLab.shortTermChange.range0")}</span>
                      <span>{t("strategyLab.shortTermChange.range1")}</span>
                      <span>{t("strategyLab.shortTermChange.range2")}</span>
                    </div>
                    <div className="param-explanation">
                      {t("strategyLab.shortTermChange.explanation")}
                      <div className="param-example">{t("strategyLab.shortTermChange.example1")}</div>
                      <div className="param-example">{t("strategyLab.shortTermChange.example2")}</div>
                    </div>
                  </div>

                  <div className="form-group">
                    <div className="slider-label-row">
                      <span className="form-label">{t("strategyLab.mediumTermDirection.label")}</span>
                      <span className="slider-value">
                        {mediumTermDirection < -0.1 ? t("strategyLab.mediumTermDirection.textNeg") : mediumTermDirection > 0.1 ? t("strategyLab.mediumTermDirection.textPos") : t("strategyLab.mediumTermDirection.textMid")}
                      </span>
                    </div>
                    <Slider min={-1.0} max={1.0} step={0.1} value={mediumTermDirection} onChange={(e) => setMediumTermDirection(parseFloat(e.target.value))} aria-label={t("strategyLab.mediumTermDirection.label")} aria-valuetext={mediumTermDirection < -0.1 ? t("strategyLab.mediumTermDirection.textNeg") : mediumTermDirection > 0.1 ? t("strategyLab.mediumTermDirection.textPos") : t("strategyLab.mediumTermDirection.textMid")} />
                    <div className="slider-range-desc">
                      <span>{t("strategyLab.mediumTermDirection.range0")}</span>
                      <span>{t("strategyLab.mediumTermDirection.range1")}</span>
                      <span>{t("strategyLab.mediumTermDirection.range2")}</span>
                    </div>
                    <div className="param-explanation">
                      {t("strategyLab.mediumTermDirection.explanation", { n: Math.min(simDurationYears * 12, 36) })}
                      <div className="param-example">{t("strategyLab.mediumTermDirection.example")}</div>
                    </div>
                  </div>

                  <div className="form-group">
                    <div className="slider-label-row">
                      <span className="form-label">{t("strategyLab.changeSpeed.label")}</span>
                      <span className="slider-value">{(changeSpeed * 100).toFixed(0)}%</span>
                    </div>
                    <Slider min={0.0} max={1.0} step={0.05} value={changeSpeed} onChange={(e) => setChangeSpeed(parseFloat(e.target.value))} aria-label={t("strategyLab.changeSpeed.label")} aria-valuetext={`${(changeSpeed * 100).toFixed(0)}%`} />
                    <div className="slider-range-desc">
                      <span>{t("strategyLab.changeSpeed.range0")}</span>
                      <span>{t("strategyLab.changeSpeed.range1")}</span>
                      <span>{t("strategyLab.changeSpeed.range2")}</span>
                    </div>
                    <div className="param-explanation">
                      {t("strategyLab.changeSpeed.explanation")}
                      <div className="param-example">{t("strategyLab.changeSpeed.example")}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="control-group">
              <div
                className="control-group-header"
                role="button"
                tabIndex={0}
                onClick={() => toggleControlGroup("risk")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleControlGroup("risk");
                  }
                }}
              >
                <span className="control-group-title-wrap">
                  <span className="step-num">2</span>
                  <span>
                    <span className="control-group-title">{t("strategyLab.group2.title")}</span>
                    <span className="control-group-subtitle">{t("strategyLab.group2.subtitle")}</span>
                  </span>
                </span>
                <span className="control-group-actions">
                  {isRiskModified && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleResetRisk();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          handleResetRisk();
                        }
                      }}
                      className="weights-reset-btn"
                    >
                      {t("strategyLab.resetDefault")}
                    </span>
                  )}
                  <span className="control-group-toggle">{openControlGroups.risk ? t("strategyLab.collapse") + " ▴" : t("strategyLab.expand") + " ▾"}</span>
                </span>
              </div>
              {openControlGroups.risk && (
                <div className="control-group-body">
                  <div className="form-group">
                    <div className="slider-label-row">
                      <span className="form-label">{t("strategyLab.uncertainty.label")}</span>
                      <span className="slider-value">+/- {(uncertainty * 100).toFixed(2)}%</span>
                    </div>
                    <Slider min={0.0} max={0.02} step={0.001} value={uncertainty} onChange={(e) => setUncertainty(parseFloat(e.target.value))} aria-label={t("strategyLab.uncertainty.label")} aria-valuetext={`+/- ${(uncertainty * 100).toFixed(2)}%`} />
                    <div className="slider-range-desc">
                      <span>{t("strategyLab.uncertainty.range0")}</span>
                      <span>{t("strategyLab.uncertainty.range1")}</span>
                      <span>{t("strategyLab.uncertainty.range2")}</span>
                    </div>
                    <div className="param-explanation">
                      {t("strategyLab.uncertainty.explanation")}
                      <div className="param-example">{t("strategyLab.uncertainty.example")}</div>
                    </div>
                  </div>

                  <div className="form-group">
                    <div className="slider-label-row">
                      <span className="form-label">{t("strategyLab.scenarioProb.label")}</span>
                      <span className="slider-value">{scenarioProbabilities.low}% / {scenarioProbabilities.base}% / {scenarioProbabilities.high}%</span>
                    </div>
                    {[
                      { key: "low", label: t("strategyLab.scenarioProb.lowLabel") },
                      { key: "base", label: t("strategyLab.scenarioProb.baseLabel") },
                      { key: "high", label: t("strategyLab.scenarioProb.highLabel") }
                    ].map((item) => (
                      <div key={item.key} style={{ marginTop: item.key === "low" ? "8px" : "14px" }}>
                        <div className="slider-label-row">
                          <span className="form-label" style={{ fontSize: "13px" }}>{item.label}</span>
                          <span className="slider-value">{scenarioProbabilities[item.key]}%</span>
                        </div>
                        <Slider
                          min={0}
                          max={100}
                          step={1}
                          value={scenarioProbabilities[item.key]}
                          onChange={(e) => handleScenarioProbabilityChange(/** @type {"low"|"base"|"high"} */ (item.key), parseInt(e.target.value, 10))}
                          aria-label={`${item.label}${t("strategyLab.weight.weight")}`}
                          aria-valuetext={`${scenarioProbabilities[item.key]}%`}
                        />
                      </div>
                    ))}
                    <div className="slider-range-desc">
                      <span>{t("strategyLab.probability.totalAutoKept")}</span>
                      <span>{t("strategyLab.probability.defaultHint")}</span>
                    </div>
                    <div className="param-explanation">
                      {t("strategyLab.probability.explanation")}
                      <div className="param-example">{t("strategyLab.probability.exampleWorked")}</div>
                      <div className="param-example">{t("strategyLab.probability.exampleAdjustment")}</div>
                      <div className="param-example">{t("strategyLab.probability.exampleNote")}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="control-group">
              <div
                className="control-group-header"
                role="button"
                tabIndex={0}
                onClick={() => toggleControlGroup("longTerm")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleControlGroup("longTerm");
                  }
                }}
              >
                <span className="control-group-title-wrap">
                  <span className="step-num">3</span>
                  <span>
                    <span className="control-group-title">{t("strategyLab.group3.title")}</span>
                    <span className="control-group-subtitle">{t("strategyLab.group3.subtitle")}</span>
                  </span>
                </span>
                <span className="control-group-actions">
                  {isLongTermModified && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleResetLongTerm();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          handleResetLongTerm();
                        }
                      }}
                      className="weights-reset-btn"
                    >
                      {t("strategyLab.resetDefault")}
                    </span>
                  )}
                  <span className="control-group-toggle">{openControlGroups.longTerm ? t("strategyLab.collapse") + " ▴" : t("strategyLab.expand") + " ▾"}</span>
                </span>
              </div>
              {openControlGroups.longTerm && (
                <div className="control-group-body">
                  <div className="form-group">
                    <div className="slider-label-row">
                      <span className="form-label">{t("strategyLab.longTerm.cycleLabel")}</span>
                      <span className="slider-value">{longTermCycleYears} {t("strategyLab.longTerm.cycleUnitYr")}</span>
                    </div>
                    <Slider min={1} max={3} step={1} value={longTermCycleYears} onChange={(e) => setLongTermCycleYears(parseInt(e.target.value, 10))} aria-label={t("strategyLab.longTerm.cycleAriaLabel")} aria-valuetext={`${longTermCycleYears} ${t("strategyLab.longTerm.cycleUnitYr")}`} />
                    <div className="slider-range-desc">
                      <span>{t("strategyLab.longTerm.cycleRange1")}</span>
                      <span>{t("strategyLab.longTerm.cycleRange2")}</span>
                      <span>{t("strategyLab.longTerm.cycleRange3")}</span>
                    </div>
                    <div className="param-explanation">
                      {t("strategyLab.longTerm.cycleExplain")}
                    </div>
                  </div>

                  <div className="form-group">
                    <div className="slider-label-row">
                      <span className="form-label">{t("strategyLab.longTerm.reversalLabel")}</span>
                      <span className="slider-value">{Math.round(longTermReversalBias * 100)}%</span>
                    </div>
                    <Slider min={0.2} max={1.0} step={0.1} value={longTermReversalBias} onChange={(e) => setLongTermReversalBias(parseFloat(e.target.value))} aria-label={t("strategyLab.longTerm.reversalAriaLabel")} aria-valuetext={`${Math.round(longTermReversalBias * 100)}%`} />
                    <div className="slider-range-desc">
                      <span>{t("strategyLab.longTerm.reversalRange20")}</span>
                      <span>{t("strategyLab.longTerm.reversalRange60")}</span>
                      <span>{t("strategyLab.longTerm.reversalRange100")}</span>
                    </div>
                    <div className="param-explanation">
                      {t("strategyLab.longTerm.reversalExplain")}
                    </div>
                  </div>

                  <div className="form-group">
                    <div className="slider-label-row">
                      <span className="form-label">{t("strategyLab.monteCarloSampleCount.label")}</span>
                      <span className="slider-value">{monteCarloSampleCount}</span>
                    </div>
                    <Slider
                      min={50}
                      max={1000}
                      step={50}
                      value={monteCarloSampleCount}
                      onChange={(e) => setMonteCarloSampleCount(parseInt(e.target.value, 10))}
                      aria-label={t("strategyLab.monteCarloSampleCount.label")}
                      aria-valuetext={`${monteCarloSampleCount}`}
                    />
                    <div className="slider-range-desc">
                      <span>50</span>
                      <span>500</span>
                      <span>1000</span>
                    </div>
                    <div className="param-explanation">
                      {t("strategyLab.monteCarloSampleCount.explanation")}
                      <div className="param-example">{t("strategyLab.monteCarloSampleCount.example")}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="control-group">
              <div
                className="control-group-header"
                role="button"
                tabIndex={0}
                onClick={() => toggleControlGroup("horizon")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleControlGroup("horizon");
                  }
                }}
              >
                <span className="control-group-title-wrap">
                  <span className="step-num">4</span>
                  <span>
                    <span className="control-group-title">{t("strategyLab.group4.title")}</span>
                    <span className="control-group-subtitle">{t("strategyLab.group4.subtitle")}</span>
                  </span>
                </span>
                <span className="control-group-actions">
                  {isHorizonModified && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleResetHorizon();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          handleResetHorizon();
                        }
                      }}
                      className="weights-reset-btn"
                    >
                      {t("strategyLab.resetDefault")}
                    </span>
                  )}
                  <span className="control-group-toggle">{openControlGroups.horizon ? `${t("strategyLab.collapse")} ▴` : `${t("strategyLab.expand")} ▾`}</span>
                </span>
              </div>
              {openControlGroups.horizon && (
                <div className="control-group-body">
                  <div className="form-group">
                    <div className="slider-label-row">
                      <span className="form-label" style={{ fontWeight: "600", color: "var(--text-primary)" }}>{t("strategyLab.horizon.horizonLabel")}</span>
                      <span className="slider-value" style={{ color: "var(--chart-info)" }}>{simDurationYears} {t("strategyLab.horizon.horizonUnit")} ({simDurationYears * 12} {t("strategyLab.horizon.horizonMonthsUnit")})</span>
                    </div>
                    <Slider
                      min={1}
                      max={simMaxYears}
                      step={1}
                      value={simDurationYears}
                      onChange={(/** @type {any} */ e) => setSimDurationYears(parseInt(e.target.value, 10))}
                      className="slider-input"
                      aria-label={t("strategyLab.horizon.horizonAriaLabel")}
                      aria-valuemin={1}
                      aria-valuemax={simMaxYears}
                      aria-valuenow={simDurationYears}
                      aria-valuetext={`${simDurationYears} ${t("strategyLab.horizon.horizonUnit")} (${simDurationYears * 12} ${t("strategyLab.horizon.horizonMonthsUnit")})`}
                    />
                    <div className="slider-range-desc">
                      <span>{t("strategyLab.horizon.range1yr")}</span>
                      <span>{Math.max(1, Math.round(simMaxYears / 2))} {t("strategyLab.horizon.horizonUnit")}</span>
                      <span>{t("strategyLab.horizon.rangeMaxLabel", { max: simMaxYears })}</span>
                    </div>
                    <div className="param-explanation" style={{ marginTop: "10px" }}>
                      {t("strategyLab.horizon.horizonExplain")}
                      {simCappedByMortgage ? (
                        <div className="param-example">
                          {t("strategyLab.horizon.horizonCappedExample", { target: simTargetYears.toFixed(1), months: mortgage?.originalTermMonths, max: simMaxYears })}
                        </div>
                      ) : (
                        <div className="param-example">{t("strategyLab.horizon.horizonExample")}</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="control-group">
              <div
                className="control-group-header"
                role="button"
                tabIndex={0}
                onClick={() => toggleControlGroup("constraints")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleControlGroup("constraints");
                  }
                }}
              >
                <span className="control-group-title-wrap">
                  <span className="step-num">5</span>
                  <span>
                    <span className="control-group-title">{t("strategyLab.group5.title")}</span>
                    <span className="control-group-subtitle">{t("strategyLab.group5.subtitle")}</span>
                  </span>
                </span>
                <span className="control-group-actions">
                  {isConstraintsModified && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleResetConstraints();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          handleResetConstraints();
                        }
                      }}
                      className="weights-reset-btn"
                    >
                      {t("strategyLab.resetDefault")}
                    </span>
                  )}
                  <span className="control-group-toggle">{openControlGroups.constraints ? `${t("strategyLab.collapse")} ▴` : `${t("strategyLab.expand")} ▾`}</span>
                </span>
              </div>
              {openControlGroups.constraints && (
                <div className="control-group-body">
                  <div className="form-group">
                    <div className="slider-label-row">
                      <span className="form-label">{t("strategyLab.constraints.diversificationPreset")}</span>
                      <span className="slider-value">{diversificationPreset === "default" ? t("strategyLab.constraints.diversificationDefault") : diversificationPreset === "diversification" ? t("strategyLab.constraints.diversificationDiversification") : t("strategyLab.constraints.diversificationMax")}</span>
                    </div>
                    <div className="segmented-control" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                      {[
                        { value: "default", label: t("strategyLab.constraints.presetDefaultLabel"), tip: t("strategyLab.constraints.presetDefaultTip") },
                        { value: "diversification", label: t("strategyLab.constraints.presetDiversificationLabel"), tip: t("strategyLab.constraints.presetDiversificationTip") },
                        { value: "max", label: t("strategyLab.constraints.presetMaxLabel"), tip: t("strategyLab.constraints.presetMaxTip") }
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          title={opt.tip}
                          className={`segmented-btn ${diversificationPreset === opt.value ? "active" : ""}`}
                          onClick={() => handleDiversificationPresetChange(opt.value)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <div className="param-explanation">
                      {t("strategyLab.constraints.presetExplain")}
                      <div className="param-example">{t("strategyLab.constraints.presetExample")}</div>
                    </div>
                  </div>

                  <div className="form-group">
                    <div className="slider-label-row">
                      <span className="form-label">{t("strategyLab.constraints.maxSplitsLabel")}</span>
                      <span className="slider-value">{maxSplits}</span>
                    </div>
                    <div className="segmented-control">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} type="button" className={`segmented-btn ${maxSplits === n ? "active" : ""}`} onClick={() => setMaxSplits(n)}>
                          {n}
                        </button>
                      ))}
                    </div>
                    <div className="param-explanation">
                      {t("strategyLab.constraints.maxSplitsExplain")}
                      <div className="param-example">{t("strategyLab.constraints.maxSplitsExample")}</div>
                    </div>
                  </div>

                  <div className="form-group">
                    <div className="slider-label-row">
                      <span className="form-label">{t("strategyLab.constraints.gridStepLabel")}</span>
                      <span className="slider-value">{(percentageStep * 100).toFixed(0)}%</span>
                    </div>
                    <div className="segmented-control" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                      {[
                        { value: 0.15, label: t("strategyLab.constraints.stepCoarseLabel"), tip: t("strategyLab.constraints.stepCoarseTip") },
                        { value: 0.10, label: t("strategyLab.constraints.stepDefaultLabel"), tip: t("strategyLab.constraints.stepDefaultTip") },
                        { value: 0.05, label: t("strategyLab.constraints.stepFineLabel"), tip: t("strategyLab.constraints.stepFineTip") }
                      ].map((opt) => (
                        <button key={opt.value} type="button" title={opt.tip} className={`segmented-btn ${percentageStep === opt.value ? "active" : ""}`} onClick={() => setPercentageStep(opt.value)}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <div className="param-explanation">
                      {t("strategyLab.constraints.gridStepExplain")}
                      <div className="param-example">{t("strategyLab.constraints.gridStepExample")}</div>
                    </div>
                  </div>

                  <div className="form-group">
                    <div className="slider-label-row">
                      <span className="form-label">{t("strategyLab.constraints.maxFloatingLabel")}</span>
                      <span className="slider-value">{maxFloatingPercentage}%</span>
                    </div>
                    <Slider min={0} max={80} step={10} value={maxFloatingPercentage} onChange={(e) => setMaxFloatingPercentage(parseInt(e.target.value, 10))} aria-label={t("strategyLab.constraints.maxFloatingLabel")} aria-valuetext={`${maxFloatingPercentage}%`} />
                    <div className="slider-range-desc">
                      <span>{t("strategyLab.maxFloatingPct.range0")}</span>
                      <span>{t("strategyLab.maxFloatingPct.range1")}</span>
                      <span>{t("strategyLab.maxFloatingPct.range2")}</span>
                    </div>
                    <div className="param-explanation">
                      {t("strategyLab.constraints.maxFloatingExplain", { fixedPct: 100 - maxFloatingPercentage })}
                      <div className="param-example">{t("strategyLab.constraints.maxFloatingExample")}</div>
                    </div>
                  </div>

                  <div className="form-group">
                    <div className="slider-label-row">
                      <span className="form-label">{t("strategyLab.constraints.budgetCapLabel")}</span>
                      <span className="slider-value">${maxAffordablePayment.toLocaleString()}</span>
                    </div>
                    <NumberInput
                      ariaLabel={t("strategyLab.constraints.budgetCapAriaLabel")}
                      min={0}
                      step={100}
                      prefix="$"
                      size="md"
                      value={maxAffordablePayment}
                      onChange={(/** @type {any} */e) => setMaxAffordablePayment(Math.max(0, parseInt(e.target.value || "0", 10)))}
                    />
                    <div className="param-explanation">
                      {t("strategyLab.constraints.budgetCapExplain")}
                      <div className="param-example">{t("strategyLab.constraints.budgetCapExample")}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="control-group">
              <div
                className="control-group-header"
                role="button"
                tabIndex={0}
                onClick={() => toggleControlGroup("preferences")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleControlGroup("preferences");
                  }
                }}
              >
                <span className="control-group-title-wrap">
                  <span className="step-num">6</span>
                  <span>
                    <span className="control-group-title">{t("strategyLab.group6.title")}</span>
                    <span className="control-group-subtitle">{t("strategyLab.group6.subtitle")}</span>
                  </span>
                </span>
                <span className="control-group-actions">
                  {isWeightsModified && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleResetWeights();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          handleResetWeights();
                        }
                      }}
                      className="weights-reset-btn"
                    >
                      {t("strategyLab.resetDefault")}
                    </span>
                  )}
                  <span className="control-group-toggle">{openControlGroups.preferences ? t("strategyLab.collapse") + " ▴" : t("strategyLab.expand") + " ▾"}</span>
                </span>
              </div>
              {openControlGroups.preferences && (
                <div className="control-group-body">
                  <div className="param-explanation" style={{ marginTop: 0, marginBottom: "var(--sp-3)" }}>
                    {t("strategyLab.preferencesIntro", { n: preferenceWeightItems.length })}
                  </div>

                  {preferenceWeightItems.map((item) => (
                    <div key={item.key} className="preference-inline-row">
                      <div className="slider-label-row">
                        <span className="form-label">{item.label}</span>
                        <span className="slider-value">{weights[item.key] ?? 0}%</span>
                      </div>
                      <input
                        type="range"
                        className="slider-input preference-inline-slider"
                        min={0}
                        max={35}
                        step={1}
                        defaultValue={weights[item.key] ?? 0}
                        ref={(el) => { preferenceSliderRefs.current[item.key] = el; }}
                        aria-label={`${item.label}${t("strategyLab.weight.weight")}`}
                        aria-valuemin={0}
                        aria-valuemax={35}
                        onInput={(e) => {
                          // Live preview: imperatively update the % display
                          // without triggering React state per drag tick.
                          applySliderFill(e.currentTarget);
                          const display = e.currentTarget.parentElement?.querySelector(".slider-value");
                          if (display) display.textContent = `${e.currentTarget.value}%`;
                        }}
                        onPointerDown={() => {
                          // v11: mark this slider as "being dragged" so the
                          // sync effect on `weights` change skips it (would
                          // otherwise snap the thumb back mid-drag).
                          preferenceDraggingRef.current = item.key;
                        }}
                        onPointerUp={(e) => {
                          preferenceDraggingRef.current = null;
                          const v = parseInt(e.currentTarget.value, 10);
                          if (Number.isFinite(v)) handleWeightChange(item.key, v);
                        }}
                        onPointerCancel={() => {
                          preferenceDraggingRef.current = null;
                        }}
                        onKeyUp={(e) => {
                          if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End","PageUp","PageDown"].includes(e.key)) {
                            const v = parseInt(e.currentTarget.value, 10);
                            if (Number.isFinite(v)) handleWeightChange(item.key, v);
                          }
                        }}
                      />
                      <div className="slider-range-desc">
                        <span>{item.minText}</span>
                        <span>{item.maxText}</span>
                      </div>
                      <p className="param-explanation">{item.explanation}</p>
                    </div>
                  ))}

                  {/* Live hint — same recipe as PreferenceWeightsModal */}
                  {(() => {
                    const TOTAL_KEYS = PREFERENCE_WEIGHT_KEYS.length;
                    const itemKeys = preferenceWeightItems.map((it) => it.key);
                    const knownKeys = new Set(itemKeys);
                    const allKeys = [...knownKeys];
                    const total = allKeys.reduce((sum, k) => sum + (weights[k] || 0), 0);
                    const activeKeys = allKeys.filter((k) => (weights[k] || 0) > 0).length;
                    const zeroKeys = TOTAL_KEYS - activeKeys;
                    return (
                      <div
                        className="preference-inline-live-hint"
                        role="status"
                        aria-live="polite"
                      >
                        {t("common.allocate", { total, active: activeKeys, totalKeys: TOTAL_KEYS, zero: zeroKeys })}
                      </div>
                    );
                  })()}

                  {isWeightsModified && (
                    <div className="preference-inline-actions">
                      <button
                        type="button"
                        className="weights-reset-btn preference-action-btn"
                        onClick={handleResetWeights}
                      >
                        {t("strategyLab.resetWeights")}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            {/*
                <span className="control-group-title-wrap">
                  <span>
                    <span className="control-group-title">Personal repayment preferences</span>
                    <span className="control-group-subtitle">Affects recommendation scoring only; rate paths are unchanged</span>
                  </span>
                </span>
                <span className="control-group-actions">
                  {isWeightsModified && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleResetWeights();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          handleResetWeights();
                        }
                      }}
                      className="weights-reset-btn"
                    >
                      {t("strategyLab.resetDefault")}
                    </span>
                  )}
                  <span className="control-group-toggle">{openControlGroups.preferences ? t("strategyLab.collapse") + " ▴" : t("strategyLab.expand") + " ▾"}</span>
                </span>
              </div>
              {openControlGroups.preferences && (
                <div className="control-group-body">
                  <p className="text-muted" style={{ fontSize: "11px", lineHeight: "1.5", margin: "0 0 14px" }}>
                    Customise the weight mix across these 5 metrics. <strong>All weights sum to 100%</strong>. When you raise any slider, the others rescale proportionally.
                  </p>
                  {[
                    {
                      key: "cost",
                      label: t("strategyLab.weightKeys.cost"),
                      value: weights.cost,
                      minText: t("strategyLab.weightKeys.costMin"),
                      maxText: t("strategyLab.weightKeys.costMax"),
                      explanation: t("strategyLab.weightKeys.costExplain"),
                      example: t("strategyLab.weightKeys.costExample")
                    },
                    {
                      key: "refix",
                      label: t("strategyLab.weightKeys.refix"),
                      value: weights.refix,
                      minText: t("strategyLab.weightKeys.refixMin"),
                      maxText: t("strategyLab.weightKeys.refixMax"),
                      explanation: t("strategyLab.weightKeys.refixExplain"),
                      example: t("strategyLab.weightKeys.refixExample")
                    },
                    {
                      key: "flex",
                      label: t("strategyLab.weightKeys.flex"),
                      value: weights.flex,
                      minText: t("strategyLab.weightKeys.flexMin"),
                      maxText: t("strategyLab.weightKeys.flexMax"),
                      explanation: t("strategyLab.weightKeys.flexExplain"),
                      example: t("strategyLab.weightKeys.flexExample")
                    },
                    {
                      key: "balance",
                      label: t("strategyLab.weightKeys.balance"),
                      value: weights.balance,
                      minText: t("strategyLab.weightKeys.balanceMin"),
                      maxText: t("strategyLab.weightKeys.balanceMax"),
                      explanation: t("strategyLab.weightKeys.balanceExplain"),
                      example: t("strategyLab.weightKeys.balanceExample")
                    },
                    {
                      key: "worstCaseDefense",
                      label: t("strategyLab.weightKeys.worstCaseDefense"),
                      value: weights.worstCaseDefense,
                      minText: t("strategyLab.weightKeys.worstCaseDefenseMin"),
                      maxText: t("strategyLab.weightKeys.worstCaseDefenseMax"),
                      explanation: t("strategyLab.weightKeys.worstCaseDefenseExplain"),
                      example: t("strategyLab.weightKeys.worstCaseDefenseExample")
                    }
                  ].map((w) => (
                    <div key={w.key} className="form-group" style={{ marginBottom: "14px" }}>
                      <div className="slider-label-row">
                        <span className="form-label" style={{ fontSize: "12px", fontWeight: "600" }}>{w.label}</span>
                        <span className="slider-value" style={{ color: "var(--chart-info)", fontSize: "13px" }}>Weight: {w.value}%</span>
                      </div>
                      <Slider min={0} max={25} step={1} value={w.value ?? 0} onChange={(e) => handleWeightChange(w.key, parseInt(e.target.value, 10))} aria-label={`${w.label} weight`} aria-valuetext={`${w.value}%`} />
                      <div className="slider-range-desc" style={{ marginTop: "2px" }}>
                        <span>{w.minText}</span>
                        <span>{w.maxText}</span>
                      </div>
                      <div className="param-explanation">
                        {w.explanation}
                        <div className="param-example">{w.example}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            */}
          </section>
        </div>
        )}
        {/* Right Column: Scenario Rates Chart, Run Button, Results & Recommendations */}
        <div className="right-results-col">

          {/* Scenario Rates Chart */}
          <section className="glass-panel chart-section accent-cyan">
            <h2 className="section-title"><span className="step-num">7</span>{t("strategyLab.step7.title")}</h2>
            <div style={{ marginTop: "16px" }}>
              <SvgChart data={chartScenarioPaths} yAxisType="rate" height={220} />
            </div>
            <div className="chart-explain-box">
              <div className="chart-explain-title">{t("strategyLab.step7.howToReadTitle")}</div>
              <div className="chart-explain-copy">
                {t("strategyLab.step7.howToReadBody1")}
              </div>
              <div className="chart-explain-copy" style={{ marginTop: "10px" }}>
                {t("strategyLab.step7.howToReadBody2")}
              </div>

              <div className="chart-explain-title" style={{ marginTop: "12px" }}>{t("strategyLab.step7.termsTitle")}</div>
              <div className="chart-glossary-grid">
                <div className="chart-glossary-item">
                  <strong>{t("strategyLab.step7.term.ocr.label")}</strong>
                  <span>{t("strategyLab.step7.term.ocr.body")}</span>
                </div>
                <div className="chart-glossary-item">
                  <strong>{t("strategyLab.step7.term.weighted.label")}</strong>
                  <span>{t("strategyLab.step7.term.weighted.body")}</span>
                </div>
                <div className="chart-glossary-item">
                  <strong>{t("strategyLab.step7.term.optimistic.label")}</strong>
                  <span>{t("strategyLab.step7.term.optimistic.body")}</span>
                </div>
                <div className="chart-glossary-item">
                  <strong>{t("strategyLab.step7.term.median.label")}</strong>
                  <span>{t("strategyLab.step7.term.median.body")}</span>
                </div>
                <div className="chart-glossary-item">
                  <strong>{t("strategyLab.step7.term.stress.label")}</strong>
                  <span>{t("strategyLab.step7.term.stress.body")}</span>
                </div>
                <div className="chart-glossary-item">
                  <strong>{t("strategyLab.step7.term.monteCarlo.label")}</strong>
                  <span>{t("strategyLab.step7.term.monteCarlo.body")}</span>
                </div>
              </div>

              <div className="chart-explain-title" style={{ marginTop: "12px" }}>{t("strategyLab.step7.examplesTitle")}</div>
              <div className="chart-example-list">
                <div className="chart-example-item">
                  {t("strategyLab.step7.example1")}
                </div>
                <div className="chart-example-item">
                  {t("strategyLab.step7.example2")}
                </div>
                <div className="chart-example-item">
                  {t("strategyLab.step7.example3")}
                </div>
                <div className="chart-example-item">
                  {t("strategyLab.step7.example4")}
                </div>
                <div className="chart-example-item">
                  {t("strategyLab.step7.example5")}
                </div>
              </div>
            </div>
          </section>

          {/* Run Button & Progress panel */}
          <section className="glass-panel run-section accent-emerald">
            <h2 className="section-title"><span className="step-num">8</span>{t("strategyLab.step8.title")}</h2>
            <p className="text-muted" style={{ fontSize: "12px", margin: "8px 0 16px" }}>
              {t("strategyLab.step8.body", { maxSplits, maxFloatingPercentage, months: simDurationYears * 12 })}
            </p>

            {error && <div className="error-banner">{error}</div>}

            {/* High-simulation-count warning. Surfaces BEFORE the user clicks
                "开始仿真" — shows the estimated matrix size and offers concrete
                simplification levers (maxSplits / percentageStep / simDuration /
                maxFloating) the user can adjust to bring the count down. */}
            {simCountIsHigh && !simulationRunning && (
              <div
                className="warning-banner"
                style={{
                  background: "rgba(245, 158, 11, 0.12)",
                  border: "1px solid rgba(245, 158, 11, 0.45)",
                  borderRadius: "8px",
                  padding: "12px 14px",
                  margin: "8px 0 14px",
                  color: "var(--chart-amber)"
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: "6px", fontSize: "13px" }}>
                  {t("strategyLab.warnings.highSimTitle", { count: estimatedTotalSims.toLocaleString(), strategies: strategyCountEstimate.toLocaleString(), scenarios: (scenarios?.length || 3) })}
                </div>
                <div style={{ fontSize: "11.5px", color: "var(--text-muted)", marginBottom: "6px", lineHeight: "1.5" }}>
                  {t("strategyLab.warnings.highSimBody", { seconds: Math.round(estimatedTotalSims / 1000) })}
                </div>
                <ul style={{ fontSize: "11.5px", color: "var(--text-muted)", margin: "0 0 0 18px", padding: 0, lineHeight: "1.6" }}>
                  {maxSplits > 3 && (
                    <li>{t("strategyLab.warnings.tipMaxSplits", { current: maxSplits, pct: Math.round((1 - 3 / maxSplits) * 100) })}</li>
                  )}
                  {percentageStep < 0.15 && (
                    <li>{t("strategyLab.warnings.tipStep", { current: (percentageStep * 100).toFixed(0), pct: Math.round((1 - percentageStep / 0.15) * 100) })}</li>
                  )}
                  {simDurationYears > 5 && (
                    <li>{t("strategyLab.warnings.tipHorizon", { current: simDurationYears })}</li>
                  )}
                  {maxFloatingPercentage > 30 && (
                    <li>{t("strategyLab.warnings.tipFloating", { current: maxFloatingPercentage, pct: Math.round((maxFloatingPercentage - 30) / maxFloatingPercentage * 100) })}</li>
                  )}
                  {(maxSplits <= 3 && percentageStep >= 0.15 && simDurationYears <= 5 && maxFloatingPercentage <= 30) && (
                    <li style={{ listStyle: "none", marginLeft: "-18px" }}>
                      {t("strategyLab.warnings.constraintsTight", { seconds: Math.round(estimatedTotalSims / 1000) })}
                    </li>
                  )}
                </ul>
              </div>
            )}

            {simulationRunning ? (
              <div className="progress-panel">
                {simCountIsHigh && (
                  <div
                    className="warning-banner"
                    style={{
                      background: "rgba(245, 158, 11, 0.10)",
                      border: "1px solid rgba(245, 158, 11, 0.35)",
                      borderRadius: "8px",
                      padding: "10px 12px",
                      marginBottom: "12px",
                      color: "var(--chart-amber)"
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: "4px", fontSize: "12.5px" }}>
                      {t("strategyLab.warnings.inProgressTitle", { count: totalSims.toLocaleString() })}
                    </div>
                    <div style={{ fontSize: "11.5px", color: "var(--text-muted)", lineHeight: "1.5" }}>
                      {t("strategyLab.warnings.inProgressBody", { threshold: SIM_COUNT_WARNING_THRESHOLD.toLocaleString() })}
                    </div>
                  </div>
                )}
                <div className="progress-bar-container">
                  <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
                </div>
                <div className="progress-text-row">
                  <span>{t("strategyLab.progress.simulating", { pct: Math.round(progress) })}</span>
                  <span>
                    {t("strategyLab.progress.completed", { done: completedSims.toLocaleString(), total: totalSims.toLocaleString() })}
                    {currentSimulationInfo?.scenarioTotal > 1 &&
                      t("strategyLab.progress.currentScenario", { idx: (currentSimulationInfo?.scenarioIndex ?? 0) + 1, total: currentSimulationInfo.scenarioTotal })}
                  </span>
                </div>
                {currentSimulationInfo && (
                  <div className="simulation-current-grid">
                    <div>
                      <span>{t("strategyLab.progress.currentCombination")}</span>
                      <strong>{currentSimulationInfo.combination}</strong>
                    </div>
                    <div>
                      <span>{t("strategyLab.progress.currentFixTerms")}</span>
                      <strong>{currentSimulationInfo.fixTerms}</strong>
                    </div>
                    <div>
                      <span>{t("strategyLab.progress.currentScenario")}</span>
                      <strong>{currentSimulationInfo.scenarioPath}</strong>
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleCancelSimulation}
                  className="btn btn-secondary"
                  style={{ marginTop: "12px", width: "100%" }}
                >
                  {t("common.cancelSimulation")}
                </button>
              </div>
            ) : !mortgage ? (
              <div className="no-mortgage-prompt">
                <div className="no-mortgage-prompt-title">{t("strategyLab.noMortgage.title")}</div>
                <div className="no-mortgage-prompt-body">{t("strategyLab.noMortgage.body")}</div>
                <Link href="/" className="btn-cta-run" style={{ display: "inline-flex", alignItems: "center", gap: "8px", marginTop: "12px", textDecoration: "none" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="M12 5l7 7-7 7" /></svg>
                  {t("strategyLab.noMortgage.cta")}
                </Link>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleStartSimulation}
                className="btn-cta-run"
                style={{ width: "100%", marginTop: "12px" }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4.5 16.5c-1.5 1.26-2.5 3.19-2.5 5.5s1 4.24 2.5 5.5" /><path d="M12 2v20" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                {simResults ? t("common.rerunCta") : t("common.runCta")}
              </button>
            )}
          </section>

          {/* Recommendations Cards */}
          {optimisedData && (
            <section className="recommendations-section accent-amber">
              <h2 className="section-title"><span className="step-num">9</span>{t("strategyLab.step9.title")}</h2>
              <p className="text-muted" style={{ fontSize: "12px", marginBottom: "16px", lineHeight: "1.6" }}>
                {t("strategyLab.step9.intro")}{" "}
                <strong>{t("strategyLab.step9.preferenceCardStrong")}</strong>{" "}
                {t("strategyLab.step9.preferenceCardTail", { n: 8 })}{" "}
                {maxSplits > 1 ? t("strategyLab.step9.recommendMulti") : t("strategyLab.step9.recommendSingle")}{" "}
                <strong>{t("strategyLab.step9.clickCta")}</strong>
              </p>

              {detailScenarioOptions.length > 1 && (
                <div className="recommendation-basis-panel">
                  <div className="recommendation-basis-label">{t("strategyLab.recommendBasis")}</div>
                  <div className="recommendation-basis-chips">
                    {detailScenarioOptions.map((/** @type {any} */ option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`chip-btn ${selectedDetailScenario === option.id ? "selected-chip" : ""}`}
                        onClick={() => setSelectedDetailScenario(option.id)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {renderSelectedPathExplanation()}
                </div>
              )}

              <div className="rec-cards-grid">
                {/* 1. Preference Card */}
                {recPreference && (
                  <div
                    className={`rec-card glass-panel clickable-card accent-primary ${selectedRecType === "preference" ? "selected-rec-card" : ""}`}
                    onClick={() => {
                      const fullDetails = optimisedData.rankedStrategies.find((/** @type {any} */ s) => s.strategyId === recPreference.strategyId);
                      if (fullDetails) {
                        setSelectedRecType("preference");
                      }
                    }}
                  >
                    <div className="badge badge-indigo">{t("strategyLab.rec.preference.badge")}</div>
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px", lineHeight: "1.4" }}>
                      {t("strategyLab.rec.preference.subtitle")}
                    </div>
                    <h3 className="rec-title" style={{ fontSize: "14px", lineHeight: "1.5" }}>
                      {renderStrategySplit(recPreference.strategyId)}
                    </h3>
                    <p className="rec-desc">{t("strategyLab.rec.preference.desc")}</p>
                    {/* v10: no mutex suffix on the preference card itself —
                        this is the anchor that the other 3 cards exclude. */}

                    {renderCardMetrics(recPreference.strategyId)}

                    <div className="pros-cons">
                      <div className="pro-list">
                        {recPreference.pros.map((/** @type {any} */ p, /** @type {number} */ i) => (
                          <div key={i} className="pro-con-item pro-text">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
                            <span>{p}</span>
                          </div>
                        ))}
                      </div>
                      <div className="con-list">
                        {recPreference.cons.map((/** @type {any} */ c, /** @type {number} */ i) => (
                          <div key={i} className="pro-con-item con-text">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                            <span>{c}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {renderTileFooter(recPreference.strategyId, "preference", "preference")}
                  </div>
                )}

                {/* 2. Lowest Cost Card */}
                {recLowestCost && (
                  <div
                    className={`rec-card glass-panel clickable-card accent-emerald ${selectedRecType === "lowestCost" ? "selected-rec-card" : ""}`}
                    onClick={() => {
                      const fullDetails = optimisedData.rankedStrategies.find((/** @type {any} */ s) => s.strategyId === recLowestCost.strategyId);
                      if (fullDetails) {
                        setSelectedRecType("lowestCost");
                      }
                    }}
                  >
                    <div className="badge badge-emerald">{t("strategyLab.rec.lowestCost.badge")}</div>
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px", lineHeight: "1.4" }}>
                      {t("strategyLab.rec.lowestCost.subtitle")}
                    </div>
                    <h3 className="rec-title" style={{ fontSize: "14px", lineHeight: "1.5" }}>
                      {renderStrategySplit(recLowestCost.strategyId)}
                    </h3>
                    <p className="rec-desc">
                      {t("strategyLab.rec.lowestCost.desc")}
                      {recPreference && (
                        <span style={{ color: "var(--text-muted)", marginLeft: "4px" }}>
                          {t("strategyLab.rec.lowestCost.mutexSuffix", { strategy: renderStrategySplit(recPreference.strategyId) })}
                        </span>
                      )}
                    </p>

                    {renderCardMetrics(recLowestCost.strategyId)}

                    <div className="pros-cons">
                      <div className="pro-list">
                        {recLowestCost.pros.map((/** @type {any} */ p, /** @type {number} */ i) => (
                          <div key={i} className="pro-con-item pro-text">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
                            <span>{p}</span>
                          </div>
                        ))}
                      </div>
                      <div className="con-list">
                        {recLowestCost.cons.map((/** @type {any} */ c, /** @type {number} */ i) => (
                          <div key={i} className="pro-con-item con-text">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                            <span>{c}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {renderTileFooter(recLowestCost.strategyId, "lowestCost", "benchmark")}
                  </div>
                )}

                {/* 3. Most Stable Card */}
                {recMostStable && (
                  <div
                    className={`rec-card glass-panel clickable-card accent-amber ${selectedRecType === "mostStable" ? "selected-rec-card" : ""}`}
                    onClick={() => {
                      const fullDetails = optimisedData.rankedStrategies.find((/** @type {any} */ s) => s.strategyId === recMostStable.strategyId);
                      if (fullDetails) {
                        setSelectedRecType("mostStable");
                      }
                    }}
                  >
                    <div className="badge badge-amber">{t("strategyLab.rec.mostStable.badge")}</div>
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px", lineHeight: "1.4" }}>
                      {t("strategyLab.rec.mostStable.subtitle")}
                    </div>
                    <h3 className="rec-title" style={{ fontSize: "14px", lineHeight: "1.5" }}>
                      {renderStrategySplit(recMostStable.strategyId)}
                    </h3>
                    <p className="rec-desc">
                      {t("strategyLab.rec.mostStable.desc")}
                      {recPreference && recLowestCost && (
                        <span style={{ color: "var(--text-muted)", marginLeft: "4px" }}>
                          {t("strategyLab.rec.mostStable.mutexSuffix", {
                            pref: renderStrategySplit(recPreference.strategyId),
                            cost: renderStrategySplit(recLowestCost.strategyId)
                          })}
                        </span>
                      )}
                    </p>

                    {renderCardMetrics(recMostStable.strategyId)}

                    <div className="pros-cons">
                      <div className="pro-list">
                        {recMostStable.pros.map((/** @type {any} */ p, /** @type {number} */ i) => (
                          <div key={i} className="pro-con-item pro-text">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
                            <span>{p}</span>
                          </div>
                        ))}
                      </div>
                      <div className="con-list">
                        {recMostStable.cons.map((/** @type {any} */ c, /** @type {number} */ i) => (
                          <div key={i} className="pro-con-item con-text">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                            <span>{c}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {renderTileFooter(recMostStable.strategyId, "mostStable", "benchmark")}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Permutations Report Toggle Accordion */}
          {optimisedData && (
            <button
              type="button"
              onClick={() => {
                setShowExhaustedReport(!showExhaustedReport);
                // Reset table slicing when closing accordion
                if (showExhaustedReport) {
                  setShowAllRows(false);
                }
              }}
              className="accordion-toggle-btn"
            >
              <span>{showExhaustedReport ? `${t("strategyLab.report.close")} ▴` : `${t("strategyLab.report.open")} ▾`}</span>
              <span className="badge badge-emerald">{t("common.benchmarksCount", { n: optimisedData.rankedStrategies.length })}</span>
            </button>
          )}

          {/* Collapsible Report Details */}
          {optimisedData && showExhaustedReport && (
            <div className="report-collapsible-content">

              {/* Professional Split Advice & Logic */}
              <div className="glass-panel pro-advice-section" style={{ marginTop: "24px" }}>
                <h2 className="section-title" style={{ marginBottom: "16px" }}>{t("strategyLab.proAdvice.title")}</h2>
                <div className="pro-advice-grid">
                  <div className="advice-column">
                    <h3>{t("strategyLab.proAdvice.q1")}</h3>
                    <ul>
                      <li>
                        <strong>{t("strategyLab.proAdvice.q1.l1.title")}</strong>
                        <p dangerouslySetInnerHTML={{ __html: t("strategyLab.proAdvice.q1.l1.body") }} />
                      </li>
                      <li>
                        <strong>{t("strategyLab.proAdvice.q1.l2.title")}</strong>
                        <p dangerouslySetInnerHTML={{ __html: t("strategyLab.proAdvice.q1.l2.body") }} />
                      </li>
                    </ul>
                  </div>
                  <div className="advice-column">
                    <h3>{t("strategyLab.proAdvice.q2")}</h3>
                    <ul>
                      <li>
                        <strong>{t("strategyLab.proAdvice.q2.l1.title")}</strong>
                        <p dangerouslySetInnerHTML={{ __html: t("strategyLab.proAdvice.q2.l1.body") }} />
                      </li>
                      <li>
                        <strong>{t("strategyLab.proAdvice.q2.l2.title")}</strong>
                        <p dangerouslySetInnerHTML={{ __html: t("strategyLab.proAdvice.q2.l2.body") }} />
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Full Exhausted Strategies Table */}
              <section className="glass-panel exhausted-list-section" style={{ marginTop: "24px" }}>
                <h2 className="section-title" style={{ marginBottom: "8px" }}>{t("strategyLab.report.title")}</h2>
                <p
                  className="text-muted"
                  style={{ fontSize: "12px", marginBottom: "16px", lineHeight: "1.6" }}
                  dangerouslySetInnerHTML={{ __html: t("strategyLab.report.intro") }}
                />

                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", marginBottom: "16px", gap: "12px" }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", justifyContent: "flex-end" }}>
                    <div className="segmented-control" style={{ width: "auto", display: "inline-flex", marginTop: 0 }}>
                      <button
                        type="button"
                        className={`segmented-btn ${showOnlyBestPerMix ? "active" : ""}`}
                        style={{ padding: "6px 14px", borderRadius: "8px 0 0 8px", fontSize: "11px", height: "32px", display: "flex", alignItems: "center" }}
                        onClick={() => {
                          setShowOnlyBestPerMix(true);
                          setShowAllRows(false);
                        }}
                      >
                        {t("strategyLab.segment.bestPerMix")}
                      </button>
                      <button
                        type="button"
                        className={`segmented-btn ${!showOnlyBestPerMix ? "active" : ""}`}
                        style={{ padding: "6px 14px", borderRadius: "0 8px 8px 0", fontSize: "11px", height: "32px", display: "flex", alignItems: "center" }}
                        onClick={() => setShowOnlyBestPerMix(false)}
                      >
                        {t("strategyLab.segment.allCombos")}
                      </button>
                    </div>
                    <button
                      type="button"
                      className={`segmented-btn ${showOnlyPareto ? "active" : ""}`}
                      style={{ padding: "6px 14px", borderRadius: "8px", fontSize: "11px", height: "32px", display: "flex", alignItems: "center", whiteSpace: "nowrap" }}
                      onClick={() => { setShowOnlyPareto(!showOnlyPareto); setShowAllRows(false); }}
                      title={t("strategyLab.toggle.paretoOnlyTitle")}
                    >
                      {showOnlyPareto ? t("strategyLab.toggle.paretoOnlyActive") : t("strategyLab.toggle.paretoOnly")}
                    </button>
                  </div>
                  <p className="text-muted" style={{ fontSize: "12px", margin: 0, textAlign: "right", whiteSpace: "nowrap" }}>
                    {showOnlyBestPerMix
                      ? t("strategyLab.report.summaryBestPerMix", { total: optimisedData.rankedStrategies.length, n: getBestStrategiesPerMix().length })
                      : t("strategyLab.report.summaryAll", { total: optimisedData.rankedStrategies.length })
                    }
                  </p>
                </div>

                {/* Split-count filter pills — stacks on top of the per-mix toggle. */}
                {(() => {
                  const counts = getAvailableSplitCounts();
                  if (counts.length <= 1) return null;
                  return (
                    <div className="count-filter-pills" role="group" aria-label={t("common.tabsFilters")}>
                      <span className="count-filter-label">{t("strategyLab.filter.splitCount")}</span>
                      <button
                        type="button"
                        className={`count-pill ${splitCountFilter === null ? "active" : ""}`}
                        onClick={() => { setSplitCountFilter(null); setShowAllRows(false); }}
                        aria-pressed={splitCountFilter === null}
                      >
                        {t("strategyLab.filter.all")}
                      </button>
                      {counts.map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={`count-pill ${splitCountFilter === n ? "active" : ""}`}
                          onClick={() => { setSplitCountFilter(n); setShowAllRows(false); }}
                          aria-pressed={splitCountFilter === n}
                        >
                          {t("common.splitCountN", { n })}
                        </button>
                      ))}
                    </div>
                  );
                })()}

                <div className="table-responsive">
                  <table className="exhausted-table">
                    <thead>
                      <tr>
                        <th>{t("strategyLab.table.rank")}</th>
                        <th>{t("strategyLab.table.splitStructure")}</th>
                        <th>
                          {renderSortHeader("splitCount", t("strategyLab.table.splitCount"), exhaustedSort, handleExhaustedSort)}
                        </th>
                        <th>
                          {renderSortHeader("expectedInterest", t("strategyLab.table.expectedInterest"), exhaustedSort, handleExhaustedSort)}
                        </th>
                        <th>
                          {renderSortHeader("expectedMaxPayment", t("strategyLab.table.expectedMaxPayment", { freq: getRepaymentFrequencyLabel() }), exhaustedSort, handleExhaustedSort)}
                        </th>
                        <th>
                          {renderSortHeader("principalRepaid", t("strategyLab.table.expectedPrincipalRepaid"), exhaustedSort, handleExhaustedSort)}
                        </th>
                        <th>
                          {renderSortHeader("expectedEndingBalance", t("strategyLab.table.expectedEndingBalance"), exhaustedSort, handleExhaustedSort)}
                        </th>
                        <th>
                          {renderSortHeader("expectedPaymentVolatility", t("strategyLab.table.paymentVolatility"), exhaustedSort, handleExhaustedSort)}
                        </th>
                        <th>
                          {renderSortHeader("worstCaseInterest", t("strategyLab.table.worstInterest"), exhaustedSort, handleExhaustedSort)}
                        </th>
                        <th>
                          {renderSortHeader("worstCaseAffordabilityBreaches", t("strategyLab.table.worstBreaches"), exhaustedSort, handleExhaustedSort)}
                        </th>
                        <th title={t("strategyLab.table.diversificationTitle")}>
                          {renderSortHeader("concentration", t("strategyLab.table.diversification"), exhaustedSort, handleExhaustedSort)}
                        </th>
                        <th>
                          {renderSortHeader("expectedRefixEventCount", t("strategyLab.table.refixCount"), exhaustedSort, handleExhaustedSort)}
                        </th>
                        <th>{t("strategyLab.table.paretoFrontier")}</th>
                        <th>
                          {renderSortHeader("score", t("strategyLab.table.compositeScore"), exhaustedSort, handleExhaustedSort)}
                        </th>
                        <th>{t("strategyLab.table.detail")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const baseList = showOnlyBestPerMix ? getBestStrategiesPerMix() : optimisedData.rankedStrategies;
                        const paretoFiltered = showOnlyPareto ? baseList.filter((/** @type {any} */ s) => s.isParetoOptimal) : baseList;
                        const filteredList = splitCountFilter === null
                          ? paretoFiltered
                          : paretoFiltered.filter((/** @type {any} */ s) => getSplitCountForRanked(s) === splitCountFilter);
                        // Apply user-selected column sort. Numeric fields are
                        // resolved via a small map; missing values sort last
                        // regardless of direction (Infinity / -Infinity).
                        const sortedList = exhaustedSort
                          ? [...filteredList].sort((/** @type {any} */ a, /** @type {any} */ b) => {
                              const va = resolveSortValue(a, exhaustedSort.key);
                              const vb = resolveSortValue(b, exhaustedSort.key);
                              const missing = (v) => v === null || Number.isNaN(v);
                              if (missing(va) && missing(vb)) return 0;
                              if (missing(va)) return 1;
                              if (missing(vb)) return -1;
                              return exhaustedSort.dir === "asc" ? va - vb : vb - va;
                            })
                          : filteredList;
                        const displayedList = sortedList;
                        const slicedList = showAllRows ? displayedList : displayedList.slice(0, 10);
                        // V6: Build a set of strategyIds picked by ANY benchmark card
                        // so the row can show "this row is the X-optimal pick".
                        const benchmarkPicks = new Set();
                        const recMap = optimisedData.recommendations || {};
                        Object.keys(recMap).forEach((k) => {
                          if (k === "preference") return;
                          const r = recMap[k];
                          if (r && r.strategyId) benchmarkPicks.add(`${r.strategyId}|${k}`);
                        });
                        if (displayedList.length === 0) {
                          return (
                            <tr>
                              <td colSpan={15} className="text-muted" style={{ textAlign: "center", padding: "24px 8px", fontSize: "12px" }}>
                                {t("strategyLab.table.noResults")}
                              </td>
                            </tr>
                          );
                        }
                        return slicedList.map((/** @type {any} */ s, /** @type {number} */ idx) => {
                          const principalRepaid = getTotalBalance() - s.expectedEndingBalance;
                          return (
                            <tr
                              key={s.strategyId}
                              className="table-row"
                              onClick={(e) => {
                                // Avoid hijacking clicks on the inline "查看"
                                // button (it stops propagation). Row clicks
                                // just open the modal — there is no
                                // selected-strategy concept anymore.
                                const target = /** @type {any} */ (e.target);
                            if (target && typeof target.closest === "function" && target.closest("button")) return;
                                openStrategyDetailModal(e, s.strategyId, "row", "row");
                              }}
                              style={{ cursor: "pointer" }}
                            >
                              <td className="font-semibold">{idx + 1}</td>
                              <td className="strategy-structure-cell">
                                {renderStrategySplit(s.strategyId)}
                                {s.isParetoOptimal && (
                                  <span className="pareto-mini-badge">{t("strategyLab.table.paretoMini")}</span>
                                )}
                              </td>
                              <td className="font-semibold text-center">{getSplitCountForRanked(s)}</td>
                              <td className="text-emerald">${Math.round(s.expectedInterest).toLocaleString()}</td>
                              <td>${Math.round(s.expectedMaxPayment).toLocaleString()}</td>
                              <td className="text-emerald">${Math.round(principalRepaid).toLocaleString()}</td>
                              <td>${Math.round(s.expectedEndingBalance).toLocaleString()}</td>
                              <td className="text-secondary">±${Math.round(s.expectedPaymentVolatility).toLocaleString()}</td>
                              <td className="text-rose">${Math.round(s.worstCaseInterest || 0).toLocaleString()}</td>
                              <td className="text-secondary">{Math.round(s.worstCaseAffordabilityBreaches || 0)}</td>
                              <td className="text-secondary">{Math.round((s.concentration || 0) * 100)}%</td>
                              <td className="text-secondary">{Math.round(s.expectedRefixEventCount || 0)}</td>
                              <td>
                                {s.isParetoOptimal ? (
                                  <span className="badge badge-emerald">{t("strategyLab.table.paretoBadge")}</span>
                                ) : (
                                  <span className="text-muted" style={{ fontSize: "11px" }}>{t("common.paretoNo")}</span>
                                )}
                                {/* V6: Show which benchmark card(s) picked this row.
                                    Helps users see the role of each strategy on the
                                    Pareto front — e.g. "this row is the cost-optimal
                                    pick AND the lowest-volatility pick". */}
                                {Array.from(benchmarkPicks)
                                  .filter((/** @type {any} */ tag) => typeof tag === "string" && tag.startsWith(`${s.strategyId}|`))
                                  .map((/** @type {any} */ tag) => {
                                    const benchmarkKey = String(tag).split("|")[1];
                                    const shortLabels = {
                                      preference: t("common.shortPref"),
                                      lowestCost: t("common.shortCost"),
                                      worstCaseDefense: t("common.shortWorstCase"),
                                      mostStable: t("common.shortWorst")
                                    };
                                    return (
                                      <span
                                        key={benchmarkKey}
                                        className="benchmark-pick-tag"
                                        title={t("common.benchPicked", { label: shortLabels[benchmarkKey] || benchmarkKey })}
                                        style={{
                                          display: "inline-block",
                                          marginLeft: "4px",
                                          marginTop: "2px",
                                          padding: "1px 6px",
                                          borderRadius: "8px",
                                          background: "rgba(99, 102, 241, 0.15)",
                                          color: "var(--chart-soft)",
                                          fontSize: "10px",
                                          fontWeight: "500"
                                        }}
                                      >
                                        ★ {shortLabels[benchmarkKey] || benchmarkKey}
                                      </span>
                                    );
                                  })}
                              </td>
                              <td className="font-semibold text-primary">{s.score.toFixed(3)}</td>
                              <td>
                                <button
                                  type="button"
                                  className="btn btn-secondary exhausted-row-cta"
                                  onClick={(e) => openStrategyDetailModal(e, s.strategyId, "row", "row")}
                                  aria-label={t("common.rowAriaView", { split: renderStrategySplit(s.strategyId) })}
                                >
                                  {t("common.view")}
                                </button>
                              </td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>

                {(() => {
                  const baseList = showOnlyBestPerMix ? getBestStrategiesPerMix() : optimisedData.rankedStrategies;
                  const paretoFiltered = showOnlyPareto ? baseList.filter((/** @type {any} */ s) => s.isParetoOptimal) : baseList;
                  const displayedList = splitCountFilter === null
                    ? paretoFiltered
                    : paretoFiltered.filter((/** @type {any} */ s) => getSplitCountForRanked(s) === splitCountFilter);
                  if (displayedList.length > 10) {
                    return (
                      <div style={{ textAlign: "center", marginTop: "20px" }}>
                        <button
                          type="button"
                          onClick={() => setShowAllRows(!showAllRows)}
                          className="btn btn-secondary"
                          style={{ padding: "8px 24px", fontSize: "13px" }}
                        >
                          {showAllRows ? `${t("common.seeLessFirstN")} ▴` : `${t("common.seeAllN", { n: displayedList.length })} ▾`}
                        </button>
                      </div>
                    );
                  }
                  return null;
                })()}
              </section>

            </div>
          )}

        </div>

        {/* StrategyDetailModal — single instance mounted at the end of the
            right-results-col. Triggered by "查看详情" on any tile, Pareto row,
            or the selected-strategy header. Renders null when isOpen=false. */}

        <StrategyDetailModal
          isOpen={detailModalOpen}
          onClose={() => setDetailModalOpen(false)}
          strategy={(() => {
            const id = detailModalStrategyId;
            if (!id) return null;
            const rec = detailModalRecKey && detailModalRecKey !== "row" && optimisedData?.recommendations?.[detailModalRecKey];
            const ranked = optimisedData?.rankedStrategies.find((/** @type {any} */ s) => s.strategyId === id);
            if (!ranked) return null;
            // Enrich with allocation details (displayName / percentage / amount /
            // isFloating / fixedMonths) so the modal can render a portfolio
            // composition title + ratio bar + per-tranche chips instead of a
            // bare strategyId.
            const fullStrat = allStrategies.find((/** @type {any} */ s) => s.id === id);
            const enrichedAllocations = Array.isArray(fullStrat?.allocations)
              ? fullStrat.allocations.map((/** @type {any} */ a) => {
                  const prod = nzProfile.products.find((/** @type {any} */ p) => p.code === a.productCode);
                  const displayName = prod ? prod.displayName : a.productCode;
                  const isFloating = a.productCode === "floating";
                  const fixedMonths = prod?.fixedMonths ?? null;
                  return {
                    productCode: a.productCode,
                    displayName,
                    amount: a.amount,
                    percentage: a.percentage,
                    isFloating,
                    fixedMonths
                  };
                })
              : [];
            const merged = rec ? { ...ranked, ...rec } : ranked;
            return { ...merged, allocations: enrichedAllocations };
          })()}
          recommendation={detailModalRecKey && detailModalRecKey !== "row"
            ? { type: detailModalRecKey, label: RECOMMENDATION_LABEL_MAP[detailModalRecKey] || null }
            : null}
          showInlineTimeline={true}
          detailTimelineData={buildDetailTimelineData(detailModalStrategyId)}
          detailScenarioLabel={getActiveDetailScenarioOption()?.label || null}
          isDetailLoading={detailLoadingStrategyId === detailModalStrategyId && !detailResultsByStrategy[detailModalStrategyId]}
          formatMoney={(/** @type {number} */ n) => `$${Math.round(n).toLocaleString()}`}
          intro={(() => {
            const id = detailModalStrategyId;
            if (!id || !optimisedData) return null;
            const ranked = optimisedData.rankedStrategies.find((/** @type {any} */ s) => s.strategyId === id);
            if (!ranked) return null;
            const originKey = detailModalRecKey && detailModalRecKey !== "row" ? detailModalRecKey : "row";
            return buildStrategyIntro(ranked, {
              originCard: originKey,
              allStrategies: optimisedData.rankedStrategies,
              weights,
              // v10: pass the other rec-card strategyIds so the intro can
              // suffix the mutex-aware narrative ("避开 X 卡选中的方案").
              recIds: {
                preference: optimisedData.recommendations.preference?.strategyId,
                lowestCost: optimisedData.recommendations.lowestCost?.strategyId,
                mostStable: optimisedData.recommendations.mostStable?.strategyId,
                worstCaseDefense: optimisedData.recommendations.worstCaseDefense?.strategyId
              }
            });
          })()}
        />

      </div>


      <style jsx>{`
        .lab-container {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .lab-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }

        .header-copy {
          min-width: 0;
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }

        .subtitle {
          font-size: 14px;
          color: var(--text-secondary);
          margin-top: 4px;
        }

        .top-reset-btn {
          min-height: 38px;
          white-space: nowrap;
        }

        .setup-prompt-box {
          text-align: center;
          padding: 48px;
        }

        .setup-prompt-box h3 {
          font-size: 18px;
          color: #fff;
        }

        .setup-prompt-box p {
          font-size: 14px;
          color: var(--text-secondary);
          max-width: 380px;
          margin: 8px auto 0;
          line-height: 1.6;
        }

        .no-mortgage-prompt {
          text-align: center;
          padding: 20px 16px;
          margin-top: 8px;
        }

        .no-mortgage-prompt-title {
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary, #fff);
          margin-bottom: 8px;
        }

        .no-mortgage-prompt-body {
          font-size: 13px;
          color: var(--text-secondary);
          line-height: 1.6;
          max-width: 360px;
          margin: 0 auto;
        }

        .lab-grid {
          display: grid;
          grid-template-columns: 360px minmax(0, 1fr);
          gap: 16px;
          align-items: start;
        }

        .lab-grid.inputs-hidden {
          grid-template-columns: minmax(0, 1fr);
        }

        .left-controls-col {
          display: flex;
          flex-direction: column;
          gap: 16px;
          grid-column: 1;
        }

        .right-results-col {
          height: auto;
          display: flex;
          flex-direction: column;
          gap: 16px;
          grid-column: 2;
        }

        .chart-section {
        }

        .lab-grid.inputs-hidden .right-results-col {
          grid-column: 1;
        }

        .control-section {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .control-group {
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 14px;
          background: rgba(255,255,255,0.02);
          overflow: hidden;
        }

        .control-group-header {
          width: 100%;
          border: none;
          background: transparent;
          color: inherit;
          padding: 14px 16px;
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 10px;
          cursor: pointer;
          text-align: left;
        }

        .control-group-header:hover {
          background: rgba(255,255,255,0.025);
        }

        .control-group-header:focus-visible {
          outline: none;
          box-shadow: inset 0 0 0 1px rgba(99, 102, 241, 0.55);
        }

        .control-group-title-wrap {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }

        .control-group-title-wrap :global(.step-num) {
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
          box-shadow: inset 0 0 8px rgba(99, 102, 241, 0.2);
          flex-shrink: 0;
        }

        .control-group-title {
          display: block;
          color: #fff;
          font-family: var(--font-heading);
          font-size: 14px;
          font-weight: 700;
        }

        .control-group-subtitle {
          display: block;
          color: var(--text-muted);
          font-size: 11px;
          line-height: 1.5;
          margin-top: 3px;
        }

        .control-group-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          flex-shrink: 0;
          padding-top: 6px;
          border-top: 1px solid rgba(255, 255, 255, 0.04);
        }

        .control-group-toggle {
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 600;
          white-space: nowrap;
        }

        .control-group-body {
          border-top: 1px solid rgba(255,255,255,0.06);
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .section-title {
          font-size: 16px;
          font-weight: 700;
          color: #fff;
          letter-spacing: -0.01em;
          margin-bottom: 14px;
          padding-bottom: 12px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .parameter-section-title {
          justify-content: space-between;
        }

        .parameter-reset-all-btn {
          border-radius: 8px;
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
          box-shadow: inset 0 0 8px rgba(99, 102, 241, 0.2);
          flex-shrink: 0;
        }

        .slider-label-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .slider-value {
          font-family: var(--font-heading);
          font-size: 13px;
          font-weight: 600;
          color: var(--color-primary);
        }

        .slider-range-desc {
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          color: var(--text-muted);
        }

        .segmented-control {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 6px;
          margin-top: 8px;
        }

        .segmented-btn {
          border: 1px solid var(--border-glass);
          background: rgba(255, 255, 255, 0.03);
          color: var(--text-secondary);
          border-radius: 8px;
          padding: 8px 0;
          font-family: var(--font-heading);
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: var(--transition-smooth);
        }

        .segmented-btn:hover {
          border-color: rgba(255, 255, 255, 0.22);
          color: var(--text-primary);
        }

        .segmented-btn.active {
          background: rgba(99, 102, 241, 0.16);
          border-color: var(--color-primary);
          color: #fff;
        }

        .count-filter-pills {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          margin-bottom: 14px;
          padding: 10px 12px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid var(--border-glass);
          border-radius: 10px;
        }

        .count-filter-label {
          font-family: var(--font-heading);
          font-size: 11px;
          font-weight: 600;
          color: var(--text-secondary);
          letter-spacing: 0.02em;
          margin-right: 2px;
        }

        .count-pill {
          min-height: 28px;
          padding: 4px 12px;
          border: 1px solid var(--border-glass);
          background: rgba(255, 255, 255, 0.03);
          color: var(--text-secondary);
          border-radius: 999px;
          font-family: var(--font-heading);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: var(--transition-smooth);
          white-space: nowrap;
        }

        .count-pill:hover {
          border-color: rgba(255, 255, 255, 0.22);
          color: var(--text-primary);
        }

        .count-pill:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.45);
        }

        .count-pill.active {
          background: rgba(99, 102, 241, 0.18);
          border-color: var(--color-primary);
          color: #fff;
          box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.25);
        }

        .number-input {
          width: 100%;
          margin-top: 8px;
          border: 1px solid var(--border-glass);
          background: rgba(255, 255, 255, 0.04);
          color: var(--text-primary);
          border-radius: 8px;
          padding: 10px 12px;
          font-size: 14px;
          outline: none;
        }

        .number-input:focus {
          border-color: var(--color-primary);
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.14);
        }

        .error-banner {
          background: rgba(244, 63, 94, 0.1);
          border: 1px solid var(--color-rose);
          color: var(--color-rose);
          border-radius: 8px;
          padding: 12px;
          font-size: 13px;
          margin-bottom: 12px;
        }

        .progress-panel {
          background: rgba(255,255,255,0.02);
          border: 1px solid var(--border-glass);
          border-radius: 8px;
          padding: 16px;
        }

        .progress-bar-container {
          height: 6px;
          background: rgba(255,255,255,0.1);
          border-radius: 3px;
          overflow: hidden;
          margin-bottom: 8px;
        }

        .progress-bar-fill {
          height: 100%;
          background: var(--color-primary);
          transition: var(--transition-smooth);
        }

        .progress-text-row {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          font-size: 12px;
          color: var(--text-secondary);
        }

        .simulation-current-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
          margin-top: 12px;
        }

        .simulation-current-grid div {
          min-width: 0;
          padding: 10px 12px;
          border-radius: 8px;
          background: rgba(255,255,255,0.025);
          border: 1px solid rgba(255,255,255,0.05);
        }

        .simulation-current-grid span {
          display: block;
          color: var(--text-muted);
          font-size: 10px;
          line-height: 1.4;
          margin-bottom: 4px;
        }

        .simulation-current-grid strong {
          display: block;
          color: #fff;
          font-size: 12px;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }

        .results-wrapper {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .weights-section {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .weights-reset-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          font-family: var(--font-heading);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.02em;
          color: var(--text-secondary);
          background: rgba(99, 102, 241, 0.08);
          border: 1px solid rgba(99, 102, 241, 0.25);
          border-radius: 8px;
          cursor: pointer;
          transition: var(--transition-smooth);
          white-space: nowrap;
          flex-shrink: 0;
        }

        .control-group-actions .weights-reset-btn {
          padding: 5px 10px;
        }

        .weights-reset-btn:hover {
          color: #fff;
          background: rgba(99, 102, 241, 0.18);
          border-color: rgba(99, 102, 241, 0.55);
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
          transform: translateY(-1px);
        }

        .weights-reset-btn:disabled {
          cursor: default;
          opacity: 0.45;
          transform: none;
          box-shadow: none;
        }

        .weights-reset-btn:disabled:hover {
          color: var(--text-secondary);
          background: rgba(99, 102, 241, 0.08);
          border-color: rgba(99, 102, 241, 0.25);
          box-shadow: none;
          transform: none;
        }

        .weights-reset-btn:active {
          transform: translateY(0);
        }

        .weights-reset-btn:focus-visible {
          outline: none;
          border-color: var(--color-primary);
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.35);
        }

        .weights-reset-btn svg {
          color: var(--color-primary);
        }

        .rec-cards-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
          gap: 16px;
        }

        .rec-card {
          display: flex;
          flex-direction: column;
          gap: 10px;
          position: relative;
        }

        .clickable-card {
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
        }

        .clickable-card.accent-primary:hover {
          transform: translateY(-3px);
          box-shadow: 0 12px 32px rgba(99, 102, 241, 0.28), var(--glow-primary);
          border-color: rgba(99, 102, 241, 0.5);
        }

        .clickable-card.accent-emerald:hover {
          transform: translateY(-3px);
          box-shadow: 0 12px 32px rgba(16, 185, 129, 0.28), var(--glow-emerald);
          border-color: rgba(16, 185, 129, 0.5);
        }

        .clickable-card.accent-amber:hover {
          transform: translateY(-3px);
          box-shadow: 0 12px 32px rgba(245, 158, 11, 0.28), var(--glow-amber);
          border-color: rgba(245, 158, 11, 0.5);
        }

        .selected-rec-card {
          border-color: var(--color-primary) !important;
          box-shadow: var(--glow-primary), 0 0 0 1px rgba(99, 102, 241, 0.5) inset !important;
        }

        .border-indigo {
          border-color: rgba(99, 102, 241, 0.4);
          box-shadow: 0 4px 20px rgba(99, 102, 241, 0.15);
        }

        .badge-indigo {
          background: rgba(99, 102, 241, 0.18);
          color: var(--color-primary);
          border: 1px solid rgba(99, 102, 241, 0.35);
        }

        .rec-title {
          font-size: 16px;
          color: #fff;
          font-weight: 700;
          line-height: 1.45;
          letter-spacing: -0.01em;
        }

        .rec-metrics {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          padding-bottom: 10px;
        }

        .rec-metric.stat-tile {
          padding: 8px 10px;
          gap: 4px;
        }

        .rec-metric .stat-tile-val {
          font-size: 15px;
          font-weight: 700;
        }

        .pros-cons {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .pro-con-item {
          font-size: 12px;
          line-height: 1.45;
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 3px 0;
        }

        .pro-con-item :global(svg) {
          flex-shrink: 0;
          margin-top: 3px;
        }

        .pro-text {
          color: var(--color-emerald);
        }

        .pro-text :global(svg) {
          color: var(--color-emerald);
          filter: drop-shadow(0 0 4px rgba(16, 185, 129, 0.45));
        }

        .con-text {
          color: var(--color-rose);
        }

        .con-text :global(svg) {
          color: var(--color-rose);
          filter: drop-shadow(0 0 4px rgba(244, 63, 94, 0.45));
        }

        .pro-list, .con-list {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .rec-card-footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          margin-top: 10px;
          padding-top: 8px;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
        }

        .rec-card-footer-spacer {
          flex: 1;
        }

        .rec-card-cta {
          font-size: 12px;
          padding: 6px 12px;
          min-height: 36px;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-weight: 500;
        }

        .rec-card-cta :global(svg) {
          margin-left: 2px;
        }

        .preference-summary-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .preference-summary-panel {
          margin-top: 12px;
          padding: 10px 12px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid var(--border-glass);
          border-radius: 10px;
        }

        .preference-summary-chip {
          display: inline-flex;
          align-items: center;
          min-height: 28px;
          padding: 0 10px;
          border-radius: 999px;
          background: rgba(255,255,255,0.08);
          color: #dbe7ff;
          font-size: 11px;
          font-weight: 600;
          white-space: nowrap;
        }

        /* Each preference slider row — flat, same density as the other
           sliders in the page (no card wrapper). Use a subtle top divider
           instead of a card to keep visual rhythm consistent with the
           other control-groups. */
        .preference-inline-row {
          padding-top: var(--sp-3);
          padding-bottom: var(--sp-3);
          border-top: 1px solid var(--border-glass);
        }

        .preference-inline-row:first-of-type {
          padding-top: var(--sp-2);
          border-top: none;
        }

        .preference-inline-row .slider-input.preference-inline-slider {
          margin-top: 2px;
          margin-bottom: 4px;
        }

        .preference-inline-row .param-explanation {
          margin-top: 4px;
          margin-bottom: 0;
        }

        /* Live hint — same visual recipe as PreferenceWeightsModal */
        .preference-inline-live-hint {
          margin-top: var(--sp-3);
          padding: 8px var(--sp-3);
          border-radius: var(--radius-md);
          background: var(--accent-soft-indigo);
          border: 1px solid rgba(99, 102, 241, 0.30);
          color: var(--color-primary);
          font-size: var(--fs-sm);
          line-height: 1.5;
        }

        .preference-inline-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: var(--sp-3);
        }

        .preference-actions-consistent {
          justify-content: flex-start;
          padding-top: 2px;
        }

        .preference-action-btn {
          min-height: 34px;
        }

        .exhausted-row-cta {
          font-size: 11px;
          padding: 4px 10px;
          min-height: 28px;
          white-space: nowrap;
        }

        .slider-tip {
          font-size: 11px;
          color: var(--text-muted);
          line-height: 1.4;
          margin-top: 4px;
          margin-bottom: 0;
        }

        .param-explanation {
          font-size: 11px;
          color: var(--text-secondary);
          opacity: 0.75;
          line-height: 1.5;
          margin-top: 6px;
        }

        .param-example {
          font-size: 11px;
          color: var(--text-secondary);
          opacity: 0.65;
          margin-top: 4px;
        }

        .rec-desc {
          font-size: 11px;
          color: var(--text-secondary);
          line-height: 1.4;
          margin-top: 4px;
          margin-bottom: 2px;
        }

        .table-responsive {
          width: 100%;
          max-width: 100%;
          overflow-x: auto;
          margin-top: 12px;
          -webkit-overflow-scrolling: touch;
        }

        .exhausted-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
          font-size: 13px;
        }

        .exhausted-table th {
          border-bottom: 2px solid rgba(255, 255, 255, 0.08);
          padding: 12px 8px;
          color: #fff;
          font-weight: 600;
          position: sticky;
          top: 0;
          z-index: 10;
          background: #0b0f19;
        }

        .th-sort-btn {
          appearance: none;
          -webkit-appearance: none;
          background: transparent !important;
          background-color: transparent !important;
          background-image: none !important;
          border: 0 !important;
          border-color: transparent !important;
          box-shadow: none !important;
          color: #fff !important;
          font: inherit;
          font-weight: 600;
          margin: 0;
          padding: 0;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          white-space: normal;
          text-align: left;
          line-height: 1.3;
        }

        .th-sort-btn:hover {
          color: var(--color-primary);
        }

        .th-sort-btn.active {
          color: var(--color-primary);
        }

        .th-sort-arrow {
          font-size: 9px;
          opacity: 0.45;
          flex-shrink: 0;
        }

        .th-sort-btn:hover .th-sort-arrow,
        .th-sort-btn.active .th-sort-arrow {
          opacity: 1;
        }

        .exhausted-table td {
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          padding: 12px 8px;
          vertical-align: middle;
        }

        .table-row {
          transition: var(--transition-smooth);
        }

        .table-row:hover {
          background: rgba(255, 255, 255, 0.02);
        }

        .selected-row {
          background: rgba(99, 102, 241, 0.08) !important;
          border-left: 3px solid var(--color-primary);
        }

        .strategy-structure-cell {
          font-family: var(--font-heading);
          color: #fff;
          max-width: 350px;
          line-height: 1.4;
        }

        .pareto-mini-badge {
          font-size: 10px;
          padding: 2px 6px;
          background: rgba(16, 185, 129, 0.15);
          color: var(--color-emerald);
          border-radius: 4px;
          margin-left: 8px;
          display: inline-block;
          font-weight: 600;
          vertical-align: middle;
          white-space: nowrap;
        }

        /* Accordion Toggle Card Button */
        .accordion-toggle-btn {
          width: 100%;
          background: var(--bg-glass);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px dashed var(--color-primary);
          border-radius: 12px;
          color: #fff;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 24px;
          font-family: var(--font-heading);
          font-size: 14px;
          font-weight: 600;
          transition: var(--transition-smooth);
          margin-top: 24px;
        }

        .accordion-toggle-btn:hover {
          border-color: #fff;
          box-shadow: 0 0 16px rgba(99, 102, 241, 0.2);
          background: rgba(99, 102, 241, 0.05);
        }

        /* Professional advice section layout */
        .pro-advice-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 24px;
          margin-top: 12px;
        }

        .advice-column h3 {
          font-size: 14px;
          font-weight: 700;
          color: #fff;
          margin-bottom: 12px;
          border-left: 3px solid var(--color-primary);
          padding-left: 8px;
        }

        .advice-column ul {
          list-style: none;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .advice-column li strong {
          color: #fff;
          font-size: 13px;
          display: block;
          margin-bottom: 4px;
        }

        .advice-column li p {
          font-size: 12px;
          color: var(--text-secondary);
          line-height: 1.6;
        }

        /* Cost comparison box styling */
        .comparison-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 14px;
          margin-top: 12px;
        }

        .comparison-item-card {
          background: rgba(255, 255, 255, 0.025);
          border: 1px solid var(--border-glass);
          border-radius: var(--radius-md);
          padding: 14px 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          transition: var(--transition-smooth);
          position: relative;
          overflow: hidden;
        }

        .comparison-item-card:hover {
          border-color: var(--border-strong);
          transform: translateY(-2px);
        }

        .comp-term-name {
          font-family: var(--font-heading);
          font-size: 13px;
          font-weight: 700;
          color: #fff;
          letter-spacing: -0.01em;
        }

        .comp-term-cost {
          font-size: 11px;
          color: var(--text-muted);
        }

        .comp-term-diff {
          font-size: 12px;
          font-weight: 700;
          font-family: var(--font-num);
        }

        .comp-term-bar {
          height: 6px;
          background: rgba(255, 255, 255, 0.04);
          border-radius: 3px;
          overflow: hidden;
          margin-top: 2px;
        }

        .comp-term-bar-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 0.4s ease;
        }

        .comp-term-bar-fill.saving {
          background: linear-gradient(90deg, #10b981, #14b8a6);
          box-shadow: 0 0 6px rgba(16,185,129,0.4);
        }

        .comp-term-bar-fill.cost {
          background: linear-gradient(90deg, #f43f5e, #ec4899);
          box-shadow: 0 0 6px rgba(244,63,94,0.4);
        }

        .chip-btn {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: var(--text-secondary);
          border-radius: 9999px;
          padding: 6px 11px;
          font-size: 11.5px;
          font-weight: 600;
          white-space: nowrap;
          flex-shrink: 0;
          cursor: pointer;
          transition: var(--transition-smooth);
        }

        .chip-btn:hover {
          border-color: rgba(96, 165, 250, 0.45);
          color: #fff;
        }

        .selected-chip {
          background: rgba(96, 165, 250, 0.14);
          border-color: rgba(96, 165, 250, 0.55);
          color: #fff;
          box-shadow: 0 0 0 1px rgba(96, 165, 250, 0.18) inset;
        }

        .recommendation-basis-panel {
          display: grid;
          grid-template-columns: 1fr;
          grid-template-rows: auto auto auto;
          align-items: start;
          column-gap: 0;
          row-gap: 8px;
          padding: 10px 14px 12px;
          margin-bottom: 16px;
          border: 1px solid rgba(255,255,255,0.05);
          border-radius: 10px;
          background: rgba(255,255,255,0.015);
        }

        .recommendation-basis-label {
          color: var(--text-muted);
          font-size: 8.5px;
          font-weight: 500;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          white-space: nowrap;
          font-family: var(--font-heading);
        }

        .recommendation-basis-chips {
          display: flex;
          justify-content: flex-end;
          gap: 6px;
          flex-wrap: wrap;
          min-width: 0;
        }

        .recommendation-basis-chips::-webkit-scrollbar {
          height: 4px;
        }

        .recommendation-basis-chips::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.12);
          border-radius: 2px;
        }

        .recommendation-path-explain {
          grid-column: 1 / -1;
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding-top: 6px;
          margin-top: 0;
          border-top: 1px solid rgba(255,255,255,0.05);
        }

        .path-explain-copy {
          display: flex;
          align-items: flex-start;
          gap: 7px;
          color: var(--text-secondary);
          font-size: 10px;
          line-height: 1.45;
          letter-spacing: 0.01em;
        }

        .path-explain-copy strong {
          color: #e5e7eb;
          font-weight: 600;
        }

        .path-dot {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          margin-top: 6px;
          flex-shrink: 0;
          box-shadow: 0 0 8px currentColor;
        }

        /* Target metric rows: flat list with dotted leader lines between
           label and value. grid-template-columns: 1fr auto pushes the two
           to opposite ends; the dotted border-bottom on the label paints
           a leader across the empty middle space — same trick accounting
           statements use. Avoids the label/value looking like a single
           block of continuous text. */
        .path-target-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          column-gap: 14px;
          row-gap: 2px;
        }

        .path-target-grid div {
          padding: 2px 0;
          background: transparent;
          border: none;
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: end;
          column-gap: 8px;
          min-width: 0;
        }

        .path-target-grid span {
          display: block;
          color: var(--text-muted);
          font-size: 9.5px;
          line-height: 1.35;
          letter-spacing: 0.01em;
          margin: 0;
          min-width: 0;
          padding-bottom: 2px;
          border-bottom: 1px dotted rgba(148, 163, 184, 0.18);
          align-self: end;
        }

        .path-target-grid strong {
          color: #e2e8f0;
          font-size: 10.5px;
          font-weight: 600;
          font-family: var(--font-heading);
          letter-spacing: 0;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          text-align: right;
        }

        .detail-loading-note {
          border: 1px solid rgba(96, 165, 250, 0.28);
          background: rgba(96, 165, 250, 0.08);
          color: #dbeafe;
          border-radius: 10px;
          padding: 12px 14px;
          font-size: 12px;
          line-height: 1.6;
          margin-bottom: 16px;
        }

        .chart-explain-box {
          margin-top: 12px;
          padding: 14px;
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 12px;
          background: rgba(255,255,255,0.02);
        }

        .chart-explain-title {
          font-size: 12px;
          font-weight: 700;
          color: #fff;
          margin-bottom: 6px;
        }

        .chart-explain-copy {
          font-size: 12px;
          line-height: 1.7;
          color: var(--text-secondary);
        }

        .chart-glossary-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-top: 8px;
        }

        .chart-glossary-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 10px 12px;
          border-radius: 10px;
          background: rgba(255,255,255,0.025);
          border: 1px solid rgba(255,255,255,0.05);
          color: var(--text-secondary);
          font-size: 11px;
          line-height: 1.6;
        }

        .chart-glossary-item strong {
          color: #fff;
          font-size: 12px;
        }

        .chart-example-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 8px;
        }

        .chart-example-item {
          font-size: 11px;
          line-height: 1.7;
          color: var(--text-secondary);
          padding: 10px 12px;
          border-left: 2px solid rgba(96, 165, 250, 0.45);
          background: rgba(96, 165, 250, 0.05);
          border-radius: 0 10px 10px 0;
        }

        /* Detail timeline table */
        .detail-timeline-table {
          width: 100%;
          border-collapse: collapse;
          text-align: center;
          font-size: 12px;
        }

        .detail-timeline-table th {
          border-bottom: 2px solid rgba(255, 255, 255, 0.08);
          padding: 10px 8px;
          white-space: nowrap;
        }

        .detail-timeline-table td {
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          padding: 8px;
          vertical-align: middle;
        }

        .dtl-loan-header {
          color: #fff;
          font-weight: 700;
          background: linear-gradient(180deg, rgba(99,102,241,0.12), rgba(99,102,241,0.04));
          position: sticky;
          left: 0;
          z-index: 2;
          width: 120px;
          min-width: 120px;
          max-width: 120px;
          border-bottom: 1px solid rgba(99, 102, 241, 0.25);
        }

        .dtl-item-header {
          color: var(--text-secondary);
          font-weight: 600;
          background: linear-gradient(180deg, rgba(99,102,241,0.08), rgba(99,102,241,0.02));
          position: sticky;
          left: 118px;
          z-index: 2;
          width: 100px;
          min-width: 100px;
          max-width: 100px;
          border-bottom: 1px solid rgba(99, 102, 241, 0.18);
        }

        .dtl-col-header {
          color: var(--color-primary);
          font-weight: 700;
          font-family: var(--font-heading);
          font-size: 11px;
          background: linear-gradient(180deg, rgba(99,102,241,0.08), rgba(99,102,241,0.02));
          border-bottom: 1px solid rgba(99, 102, 241, 0.18);
        }

        .dtl-loan-cell {
          text-align: left;
          background: rgba(15, 26, 46, 0.7);
          position: sticky;
          left: 0;
          z-index: 1;
          width: 120px;
          min-width: 120px;
          max-width: 120px;
          border-right: 1px solid rgba(255, 255, 255, 0.08);
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .dtl-item-cell {
          color: var(--text-secondary);
          font-size: 11px;
          text-align: left;
          position: sticky;
          left: 118px;
          z-index: 1;
          background: rgba(15, 26, 46, 0.7);
          border-right: 1px solid rgba(255, 255, 255, 0.08);
          width: 100px;
          min-width: 100px;
          max-width: 100px;
        }

        .dtl-val-cell {
          color: #fff;
          font-weight: 500;
          font-family: var(--font-num);
          white-space: nowrap;
          min-width: 90px;
        }

        .detail-timeline-table tbody tr:nth-child(even) td {
          background: rgba(255, 255, 255, 0.018);
        }

        .dtl-first-row td {
          border-top: 1px solid rgba(255, 255, 255, 0.08);
        }

        .dtl-foot-row td {
          border-top: 2px solid rgba(99, 102, 241, 0.3);
          background: rgba(99, 102, 241, 0.06);
          padding: 10px 8px;
        }

        .dtl-foot-row td.dtl-loan-cell,
        .dtl-foot-row td.dtl-item-cell {
          background: rgba(22, 35, 59, 0.95) !important;
        }

        /* Per-tranche detail timeline — card-per-tranche layout */
        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }

        .detail-timeline-stack {
          margin-top: 24px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .detail-timeline-intro {
          padding: 0 4px;
        }

        .detail-timeline-title {
          font-size: 14px;
          font-weight: 700;
          color: #fff;
          margin: 0 0 12px;
          font-family: var(--font-heading);
        }

        .detail-timeline-desc {
          font-size: 11px;
          color: var(--text-muted);
          line-height: 1.5;
          margin: 0 0 8px;
        }

        .detail-timeline-desc:last-child {
          margin-bottom: 0;
        }

        .dt-card {
          background: var(--surface-1);
          border: 1px solid var(--border-glass);
          border-radius: var(--radius-md);
          position: relative;
          overflow: hidden;
          transition: var(--transition-smooth);
        }

        .dt-card:hover {
          border-color: var(--border-strong);
        }

        .dt-card-scroll {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          scroll-behavior: smooth;
        }

        .dt-inner-table {
          width: 100%;
          border-collapse: collapse;
          text-align: center;
          font-size: 12px;
          font-family: var(--font-body);
          min-width: 560px;
        }

        .dt-inner-table th,
        .dt-inner-table td {
          padding: 8px 10px;
          white-space: nowrap;
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        }

        .dt-inner-table thead th {
          position: sticky;
          top: 0;
          background: var(--surface-2);
          z-index: 2;
          font-family: var(--font-heading);
          font-size: 11px;
          color: var(--text-secondary);
          letter-spacing: 0.04em;
          text-transform: uppercase;
          font-weight: 600;
          border-bottom: 1px solid var(--border-glass);
        }

        .dt-row-label-head {
          text-align: left !important;
          position: sticky;
          left: 0;
          z-index: 3;
          background: var(--surface-2) !important;
          width: 120px;
          min-width: 120px;
          border-right: 1px solid var(--border-glass);
        }

        .dt-col-head {
          color: var(--color-primary);
          font-weight: 700;
          font-family: var(--font-heading);
          font-size: 11px;
          text-transform: none;
          letter-spacing: 0;
        }

        .dt-accum-head {
          color: var(--color-emerald);
          font-weight: 700;
        }

        .dt-row-label {
          position: sticky;
          left: 0;
          z-index: 1;
          background: var(--surface-1);
          text-align: left;
          font-weight: 500;
          color: var(--text-primary);
          font-size: 12px;
          padding-left: 16px;
          border-right: 1px solid var(--border-glass);
          width: 120px;
          min-width: 120px;
          vertical-align: middle;
        }

        .dt-row-icon {
          display: inline-block;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          margin-right: 10px;
          background: var(--text-muted);
          vertical-align: middle;
        }

        .dt-row--info .dt-row-icon    { background: var(--accent-cyan); }
        .dt-row--warn .dt-row-icon    { background: var(--color-amber); }
        .dt-row--rose .dt-row-icon    { background: var(--color-rose); }
        .dt-row--emerald .dt-row-icon { background: var(--color-emerald); }
        .dt-row--primary .dt-row-icon { background: var(--color-primary); }

        .dt-row-label--strong {
          font-weight: 700;
          color: #fff;
          background: rgba(99, 102, 241, 0.06) !important;
        }

        .dt-val {
          color: #fff;
          font-family: var(--font-num);
          font-feature-settings: "tnum";
          font-weight: 500;
        }

        .dt-val--strong {
          color: var(--color-primary);
          font-weight: 700;
        }

        .dt-accum {
          font-family: var(--font-num);
          font-feature-settings: "tnum";
          color: var(--color-emerald);
          font-weight: 600;
          background: rgba(16, 185, 129, 0.05);
        }

        .dt-accum--strong {
          color: var(--color-emerald);
          font-weight: 800;
          background: rgba(16, 185, 129, 0.1);
        }

        .dt-row:nth-child(even) .dt-val,
        .dt-row:nth-child(even) .dt-accum {
          background: rgba(255, 255, 255, 0.018);
        }

        .dt-row--strong .dt-row-label,
        .dt-row--strong .dt-val--strong,
        .dt-row--strong .dt-accum--strong {
          background: rgba(99, 102, 241, 0.08);
        }

        /* Section divider rows — span all columns and introduce a tranche or totals group */
        .dt-tranche-header td {
          padding: 0 !important;
          border-bottom: 1px solid var(--border-glass) !important;
        }

        .dt-tranche-header-inner {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          background: rgba(255, 255, 255, 0.018);
          flex-wrap: wrap;
          position: relative;
        }

        .dt-tranche-bar {
          display: inline-block;
          width: 3px;
          height: 18px;
          border-radius: 2px;
          background: var(--color-primary);
          flex-shrink: 0;
        }

        .dt-tranche-name {
          font-family: var(--font-heading);
          font-size: 13px;
          font-weight: 700;
          color: #fff;
        }

        .dt-tranche-amount {
          font-family: var(--font-num);
          font-size: 12px;
          color: var(--text-secondary);
          font-feature-settings: "tnum";
        }

        .dt-tranche-pct {
          font-size: 11px;
        }

        .dt-tranche-header--primary .dt-tranche-bar { background: var(--color-primary); }
        .dt-tranche-header--cyan    .dt-tranche-bar { background: var(--accent-cyan); }
        .dt-tranche-header--emerald .dt-tranche-bar { background: var(--color-emerald); }
        .dt-tranche-header--amber   .dt-tranche-bar { background: var(--color-amber); }
        .dt-tranche-header--rose    .dt-tranche-bar { background: var(--color-rose); }

        .dt-tranche-header--primary .dt-tranche-header-inner { background: rgba(99, 102, 241, 0.08); }
        .dt-tranche-header--cyan    .dt-tranche-header-inner { background: rgba(6, 182, 212, 0.08); }
        .dt-tranche-header--emerald .dt-tranche-header-inner { background: rgba(16, 185, 129, 0.08); }
        .dt-tranche-header--amber   .dt-tranche-header-inner { background: rgba(245, 158, 11, 0.08); }
        .dt-tranche-header--rose    .dt-tranche-header-inner { background: rgba(244, 63, 94, 0.08); }

        .dt-tranche-header--totals .dt-tranche-header-inner {
          background: linear-gradient(180deg, rgba(99, 102, 241, 0.12), rgba(99, 102, 241, 0.04));
          border-top: 2px solid rgba(99, 102, 241, 0.35);
        }

        .dt-tranche-header--totals .dt-tranche-bar {
          background: linear-gradient(180deg, var(--color-primary), var(--accent-purple));
          width: 4px;
        }

        @media (max-width: 768px) {
          .dt-tranche-header-inner {
            padding: 10px 12px;
            gap: 8px;
          }
          .dt-tranche-name {
            font-size: 12px;
          }
          .dt-tranche-amount {
            font-size: 11px;
          }
          .dt-inner-table {
            min-width: 480px;
          }
          .dt-row-label,
          .dt-row-label-head {
            width: 96px;
            min-width: 96px;
            padding-left: 12px;
            font-size: 11px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .dt-card-scroll {
            scroll-behavior: auto;
          }
        }

        @media (max-width: 992px) {
          .lab-grid {
            grid-template-columns: minmax(0, 1fr);
          }
          .left-controls-col,
          .right-results-col {
            grid-column: 1;
          }
          .lab-header {
            align-items: stretch;
          }
          .header-actions {
            width: 100%;
          }
          .top-reset-btn {
            width: 100%;
          }
          .pro-advice-grid {
            grid-template-columns: 1fr;
            gap: 16px;
          }
        }

        @media (max-width: 768px) {
          .chart-glossary-grid {
            grid-template-columns: 1fr;
          }
          .recommendation-basis-panel {
            grid-template-columns: 1fr;
            padding: 10px 12px 12px;
          }
          .recommendation-basis-chips {
            justify-content: flex-start;
            flex-wrap: wrap;
            overflow-x: visible;
          }
          .recommendation-basis-chips .chip-btn {
            font-size: 11px;
            padding: 5px 9px;
          }
          .path-target-grid {
            grid-template-columns: 1fr;
            row-gap: 2px;
          }
          .path-target-grid div {
            padding: 4px 0;
          }
          .path-target-grid span {
            font-size: 10px;
          }
          .path-target-grid strong {
            font-size: 11px;
          }
          .recommendation-basis-label {
            font-size: 8.5px;
          }
          .path-explain-copy {
            font-size: 10.5px;
            line-height: 1.5;
          }
          .progress-text-row {
            flex-direction: column;
            gap: 4px;
          }
          .simulation-current-grid {
            grid-template-columns: 1fr;
          }
          .exhausted-table th:nth-child(1),
          .exhausted-table td:nth-child(1),
          .exhausted-table th:nth-child(5),
          .exhausted-table td:nth-child(5),
          .exhausted-table th:nth-child(6),
          .exhausted-table td:nth-child(6),
          .exhausted-table th:nth-child(7),
          .exhausted-table td:nth-child(7),
          .exhausted-table th:nth-child(8),
          .exhausted-table td:nth-child(8) {
            display: none;
          }
          .exhausted-table {
            font-size: 12px;
          }
          .exhausted-table th,
          .exhausted-table td {
            padding: 8px 6px;
          }
          .strategy-structure-cell {
            max-width: 200px;
          }
          .comparison-grid {
            grid-template-columns: 1fr;
            gap: 10px;
          }
          .count-filter-pills {
            padding: 10px;
            gap: 6px;
          }
          .count-pill {
            min-height: 36px;
            padding: 6px 14px;
            font-size: 12px;
          }
          .count-filter-label {
            width: 100%;
            margin-bottom: 2px;
          }
        }
      `}</style>
    </div>
  );
}
