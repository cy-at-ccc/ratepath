// @ts-nocheck — React UI page; JSDoc strict-mode type checks on dynamic-key
// access (`weights[k]`, `reduce`/`filter` callbacks) are out of scope for
// financial correctness. Financial algorithms live in `packages/*/src/*` and
// are covered by vitest + checkJs on their own files.
"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import Link from "next/link";
import { dbGetAll, dbGet, dbPut, dbDelete } from "../../features/storage.js";
import { nzProfile, nzBetas } from "@mortgage/country-adapters";
import { generateScenarios } from "@mortgage/scenario-engine";
import { generateSplitStrategies } from "@mortgage/strategy-generator";
import { optimizeStrategies } from "@mortgage/optimiser";
import { simulateStrategyScenario } from "@mortgage/simulation-engine";
import SvgChart from "../../components/SvgChart.js";

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
  const { min, max, step, value, onChange, className, ...rest } = props;
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
      onChange={(/** @type {any} */ e) => {
        applySliderFill(e.target);
        onChange?.(e);
      }}
      className={className || "slider-input"}
      {...rest}
    />
  );
}

export default function StrategyLab() {
  const [mortgage, setMortgage] = useState(/** @type {any} */(null));
  const [loading, setLoading] = useState(true);

  // Future Expectation Sliders
  const [shortTermChange, setShortTermChange] = useState(0.0); // -2% to +2%
  const [mediumTermDirection, setMediumTermDirection] = useState(0.0); // -1 to +1
  const [changeSpeed, setChangeSpeed] = useState(0.5); // 0 to 1
  const [uncertainty, setUncertainty] = useState(0.01); // 0 to 2%
  const [scenarioProbabilities, setScenarioProbabilities] = useState({ low: 15, base: 70, high: 15 });
  const [longTermCycleYears, setLongTermCycleYears] = useState(2);
  const [longTermReversalBias, setLongTermReversalBias] = useState(0.7);
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
  const [maxFloatingPercentage, setMaxFloatingPercentage] = useState(10);
  const [maxAffordablePayment, setMaxAffordablePayment] = useState(5000);
  // Allocation-grid step. Default 0.05 (5%) per country-adapter rule.
  // UI in Section 2 lets the user coarsen to 10% or refine to 1%.
  const [percentageStep, setPercentageStep] = useState(0.10);

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
  const DEFAULT_WEIGHTS = {
    cost: 45,
    principal: 25,
    refix: 10,
    flex: 10,
    resilience: 5,
    budget: 5
  };
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [openControlGroups, setOpenControlGroups] = useState({
    trend: false,
    risk: false,
    longTerm: false,
    horizon: false,
    constraints: false,
    preferences: false
  });
  const [showOnlyBestPerMix, setShowOnlyBestPerMix] = useState(true);
  // Filter the exhausted-report table by number of allocations per strategy.
  // `null` means "all split counts"; otherwise the value is the exact count
  // to keep (1, 2, 3, ...). Stacks on top of `showOnlyBestPerMix`.
  const [splitCountFilter, setSplitCountFilter] = useState(/** @type {number|null} */(null));

  const handleWeightChange = (/** @type {string} */ key, /** @type {number} */ newValue) => {
    newValue = Math.max(0, Math.min(100, newValue));
    const keys = ["cost", "principal", "refix", "flex", "resilience", "budget"];
    const otherKeys = keys.filter(k => k !== key);
    const targetOtherSum = 100 - newValue;

    const currentOtherSum = otherKeys.reduce((sum, k) => sum + weights[k], 0);

    const nextWeights = { ...weights };
    nextWeights[key] = newValue;

    if (currentOtherSum > 0) {
      // Distribute targetOtherSum proportionally
      let accumulated = 0;
      otherKeys.forEach((k, idx) => {
        if (idx === otherKeys.length - 1) {
          nextWeights[k] = Math.max(0, targetOtherSum - accumulated);
        } else {
          const share = Math.round((weights[k] / currentOtherSum) * targetOtherSum);
          nextWeights[k] = share;
          accumulated += share;
        }
      });
    } else {
      // Distribute targetOtherSum equally
      let accumulated = 0;
      otherKeys.forEach((k, idx) => {
        if (idx === otherKeys.length - 1) {
          nextWeights[k] = Math.max(0, targetOtherSum - accumulated);
        } else {
          const share = Math.round(targetOtherSum / otherKeys.length);
          nextWeights[k] = share;
          accumulated += share;
        }
      });
    }

    // Double-check the total sum is exactly 100.
    let totalSum = keys.reduce((sum, k) => sum + nextWeights[k], 0);
    if (totalSum !== 100) {
      const diff = 100 - totalSum;
      const adjustKey = otherKeys.find(k => nextWeights[k] + diff >= 0) || otherKeys[0];
      nextWeights[adjustKey] += diff;
    }

    setWeights(nextWeights);
  };

  // True when any weight has been nudged off the default mix. Drives the
  // visibility of the "重置默认" affordance below.
  const isWeightsModified = (() => {
    const keys = /** @type {(keyof typeof DEFAULT_WEIGHTS)[]} */ (Object.keys(DEFAULT_WEIGHTS));
    return keys.some((k) => weights[k] !== DEFAULT_WEIGHTS[k]);
  })();

  const handleResetWeights = () => {
    setWeights({ ...DEFAULT_WEIGHTS });
  };

  const defaultSimDurationYears = useMemo(() => Math.min(5, simMaxYears), [simMaxYears]);

  const toggleControlGroup = (/** @type {"trend"|"risk"|"longTerm"|"horizon"|"constraints"|"preferences"} */ groupKey) => {
    setOpenControlGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
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
    longTermReversalBias !== 0.7;

  const handleResetLongTerm = () => {
    setLongTermCycleYears(2);
    setLongTermReversalBias(0.7);
  };

  const isHorizonModified = simDurationYears !== defaultSimDurationYears;

  const handleResetHorizon = () => {
    setSimDurationYears(defaultSimDurationYears);
  };

  const defaultMaxAffordablePayment = mortgage?.targetPeriodicPayment || 5000;

  const isConstraintsModified = maxSplits !== nzProfile.rules.maxSplits ||
    percentageStep !== 0.10 ||
    maxFloatingPercentage !== 10 ||
    maxAffordablePayment !== defaultMaxAffordablePayment;

  const handleResetConstraints = () => {
    setMaxSplits(nzProfile.rules.maxSplits);
    setPercentageStep(0.10);
    setMaxFloatingPercentage(10);
    setMaxAffordablePayment(defaultMaxAffordablePayment);
    setDiversificationPreset("default");
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
      setPercentageStep(0.10);
      setMaxFloatingPercentage(10);
      setWeights({ ...DEFAULT_WEIGHTS });
    } else if (preset === "diversification") {
      setMaxSplits(4);
      setPercentageStep(0.05);
      setMaxFloatingPercentage(30);
      setWeights({ cost: 25, principal: 25, refix: 25, flex: 15, resilience: 5, budget: 5 });
      setShowExhaustedReport(true);
    } else {
      setMaxSplits(5);
      setPercentageStep(0.05);
      setMaxFloatingPercentage(50);
      setWeights({ cost: 15, principal: 15, refix: 35, flex: 25, resilience: 5, budget: 5 });
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
    default: { maxSplits: 3, percentageStep: 0.10, maxFloatingPercentage: 10 },
    diversification: { maxSplits: 4, percentageStep: 0.05, maxFloatingPercentage: 30 },
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
  const [simResults, setSimResults] = useState(/** @type {any} */(null));
  const [detailResultsByStrategy, setDetailResultsByStrategy] = useState(/** @type {Record<string, any[] | undefined>} */ ({}));
  const [detailLoadingStrategyId, setDetailLoadingStrategyId] = useState(/** @type {string|null} */(null));
  const [optimisedData, setOptimisedData] = useState(/** @type {any} */(null));
  const [selectedStrategy, setSelectedStrategy] = useState(/** @type {any} */(null));
  const [selectedRecType, setSelectedRecType] = useState(/** @type {string|null} */("preference"));
  const [allStrategies, setAllStrategies] = useState(/** @type {any[]} */([]));
  const [showExhaustedReport, setShowExhaustedReport] = useState(false);
  const [showAllRows, setShowAllRows] = useState(false);
  const [recPreference, setRecPreference] = useState(/** @type {any} */(null));
  const [recLowestCost, setRecLowestCost] = useState(/** @type {any} */(null));
  const [recMostStable, setRecMostStable] = useState(/** @type {any} */(null));

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
    setSelectedStrategy(null);
    setSelectedRecType("preference");
    setAllStrategies([]);
    setShowExhaustedReport(false);
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
        // Fallback: old format had strategies/params in resultsData
        const strategiesSource = (paramsData && paramsData.strategies) || (resultsData && resultsData.strategies);
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
          if (p.simDurationYears !== undefined) setSimDurationYears(p.simDurationYears);
          if (p.maxSplits !== undefined) setMaxSplits(p.maxSplits);
          if (p.maxFloatingPercentage !== undefined) setMaxFloatingPercentage(p.maxFloatingPercentage);
          if (p.maxAffordablePayment !== undefined) setMaxAffordablePayment(p.maxAffordablePayment);
          if (p.weights !== undefined) setWeights(p.weights);
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

  const getRepresentativeScenarioByQuantile = (/** @type {any[]} */ activeScenarios, /** @type {number} */ quantile) => {
    const monteCarloScenarios = activeScenarios
      .filter((/** @type {any} */ s) => s.assumptions?.isMonteCarloTail)
      .sort((a, b) => (a.assumptions?.post36AverageRate || 0) - (b.assumptions?.post36AverageRate || 0));

    if (monteCarloScenarios.length === 0) {
      return activeScenarios.find((/** @type {any} */ s) => s.id === "base") || activeScenarios[0] || null;
    }

    let cumulative = 0;
    for (const scenario of monteCarloScenarios) {
      cumulative += scenario.probability || 0;
      if (cumulative >= quantile) return scenario;
    }
    return monteCarloScenarios[monteCarloScenarios.length - 1];
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
    const activeScenarios = generateScenarios({
      initialRate: marketRates.ocr,
      currentProductRates: marketRates,
      betas: nzBetas,
      products: nzProfile.products,
      forecastMonths: simDurationYears * 12,
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
        longTermReversalBias
      }
    });

    setScenarios(activeScenarios);

    const deterministicHorizonMonths = Math.min(simDurationYears * 12, 36);
    const scenarioFamilyPaths = ["low", "base", "high"].map((familyId) => {
      const familyScenario = activeScenarios.find((/** @type {any} */ s) => (s.assumptions?.scenarioFamily || s.id) === familyId);
      return {
        id: familyId,
        name: familyId === "low"
          ? `低利率情景 (${scenarioProbabilities.low}%)`
          : familyId === "base"
            ? `基准情景 (${scenarioProbabilities.base}%)`
            : `高利率情景 (${scenarioProbabilities.high}%)`,
        color: familyId === "low" ? "var(--color-emerald)" : familyId === "base" ? "var(--color-primary)" : "var(--color-rose)",
        points: (familyScenario?.policyRatePath || [])
          .filter((/** @type {any} */ p) => p.month <= deterministicHorizonMonths)
          .map((/** @type {any} */ p) => ({ month: p.month, value: p.rate }))
      };
    });

    const expectedPath = buildExpectedPolicyPath(activeScenarios);
    const optimisticScenario = getRepresentativeScenarioByQuantile(activeScenarios, 0.1);
    const medianScenario = getRepresentativeScenarioByQuantile(activeScenarios, 0.5);
    const stressScenario = getRepresentativeScenarioByQuantile(activeScenarios, 0.9);
    const scenarioPathStats = (/** @type {any} */ scenario) => buildPathTargetStats((scenario?.policyRatePath || []).map((/** @type {any} */ p) => ({ month: p.month, value: p.rate })));
    const expectedPathStats = buildPathTargetStats(expectedPath);
    const longTermOptions = simDurationYears * 12 > 36
      ? [
          {
            id: "expected",
            label: "概率加权期望路径",
            type: "expected",
            color: "#f8fafc",
            strokeDasharray: "6 6",
            description: "按低 / 基准 / 高情景权重加权后的平均 OCR 路径，适合作为默认综合推荐依据。",
            targetStats: expectedPathStats
          },
          {
            id: "optimistic",
            label: "长期乐观路径",
            type: "scenario",
            scenarioId: optimisticScenario?.id,
            color: "#22d3ee",
            strokeDasharray: "2 6",
            description: "长期 OCR 偏低的代表路径，适合查看降息或低利率延续时的 split 表现。",
            targetStats: scenarioPathStats(optimisticScenario)
          },
          {
            id: "median",
            label: "长期中性路径",
            type: "scenario",
            scenarioId: medianScenario?.id,
            color: "#fde68a",
            strokeDasharray: "6 4",
            description: "长期 OCR 处在样本中间位置的代表路径，适合作为中性长期判断。",
            targetStats: scenarioPathStats(medianScenario)
          },
          {
            id: "stress",
            label: "长期压力路径",
            type: "scenario",
            scenarioId: stressScenario?.id,
            color: "var(--color-rose)",
            strokeDasharray: "10 6",
            description: "长期 OCR 偏高的代表路径，适合观察高息压力下的供款峰值和剩余本金。",
            targetStats: scenarioPathStats(stressScenario)
          }
        ]
      : [
          {
            id: "base",
            label: "基准情景",
            type: "scenario",
            scenarioId: "base",
            color: "var(--color-primary)",
            strokeDasharray: undefined,
            description: "36 个月以内使用基准 OCR 情景作为推荐和明细依据。",
            targetStats: scenarioPathStats(activeScenarios.find((/** @type {any} */ s) => s.id === "base"))
          }
        ];

    setDetailScenarioOptions(longTermOptions);
    setSelectedDetailScenario((prev) => longTermOptions.some((opt) => opt.id === prev) ? prev : (simDurationYears * 12 > 36 ? "expected" : "base"));

    const longTermChartPaths = longTermOptions.map((option) => {
      if (option.type === "expected") {
        return {
          id: option.id,
          name: option.label,
          color: option.color,
          points: expectedPath,
          fillArea: false,
          strokeDasharray: option.strokeDasharray
        };
      }

      const scenario = activeScenarios.find((/** @type {any} */ s) => s.id === option.scenarioId);
      return {
        id: option.id,
        name: option.label,
        color: option.color,
        points: (scenario?.policyRatePath || [])
          .filter((/** @type {any} */ p) => p.month >= Math.min(36, simDurationYears * 12))
          .map((/** @type {any} */ p) => ({ month: p.month, value: p.rate })),
        fillArea: false,
        strokeDasharray: option.strokeDasharray
      };
    });

    setChartScenarioPaths([
      ...scenarioFamilyPaths,
      ...longTermChartPaths
    ]);

  }, [shortTermChange, mediumTermDirection, changeSpeed, uncertainty, scenarioProbabilities, longTermCycleYears, longTermReversalBias, simDurationYears, marketRates]);

  // Recalculate optimization recommendations when preference weights or the
  // selected OCR basis changes. The default basis is probability-weighted; when
  // the user selects a specific OCR path, recommendations are ranked on that
  // path only so the cards and detail table describe the same scenario.
  useEffect(() => {
    if (!simResults) return;
    const activeOption = detailScenarioOptions.find((/** @type {any} */ opt) => opt.id === selectedDetailScenario)
      || detailScenarioOptions[0]
      || { id: "expected", label: "概率加权期望路径", type: "expected" };
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

    // rankingKey memo (spec 11.3). Skip the optimiser re-run if neither
    // the simulation results nor the weights have changed since the last
    // successful run. The previous result is reused verbatim.
    const recommendationMinAllocationCount = maxSplits > 1 ? 2 : 1;
    const newRankingKey = stableStringify({
      selectedDetailScenario,
      selectedScenarioId,
      scenarios: activeScenarios,
      weights,
      maxSplits,
      recommendationMinAllocationCount,
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
        r.payoffTime
      ])
    });
    if (newRankingKey === rankingKeyRef.current && optimisedDataRef.current) {
      return;
    }
    // Forward payment-mode toggle (TD-005 + Reviewer H-1) so payment-mode
    // mortgages get payment-mode Pareto objectives (worstCaseEndingBalance,
    // payoffTime) rather than term-mode objectives (worstCaseInterest,
    // worstCasePayment). Falls back to "term" when targetMode is not set.
    // The `diversification` flag tells the optimiser to emit
    // diversification-flavoured pros/cons when the user opted into a richer
    // preset. It does not affect ranking or Pareto classification.
    const opt = optimizeStrategies({
      simulationResults: activeSimulationResults,
      scenarios: activeScenarios,
      weights,
      mode: mortgage?.targetMode === "payment" ? "payment" : "term",
      recommendationMinAllocationCount,
      diversification: diversificationPreset !== "default"
    });
    optimisedDataRef.current = opt;
    rankingKeyRef.current = newRankingKey;
    setOptimisedData(opt);

    if (opt && opt.rankedStrategies.length > 0) {
      // Consume the optimiser's recommendations directly. The optimiser is now
      // the single source of truth for pros/cons (spec 10.4 / P1-E).
      setRecPreference(opt.recommendations.preference || null);
      setRecLowestCost(opt.recommendations.lowestCost || null);
      setRecMostStable(opt.recommendations.mostStable || null);

      if (opt.recommendations.preference) {
        const fullDetails = opt.rankedStrategies.find((/** @type {any} */ s) => s.strategyId === opt.recommendations.preference.strategyId);
        setSelectedStrategy(fullDetails);
        setSelectedRecType("preference");
      }
    }
  }, [weights, simResults, scenarios, detailScenarioOptions, selectedDetailScenario, mortgage?.targetMode, maxSplits]);

  useEffect(() => {
    if (!selectedStrategy || !simResults || !mortgage) return;
    const strategyId = selectedStrategy.strategyId;
    if (detailResultsByStrategy[strategyId] || detailLoadingStrategyId === strategyId) return;

    const strategy = allStrategies.find((/** @type {any} */ s) => s.id === strategyId);
    if (!strategy) return;

    let cancelled = false;
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

      if (cancelled) return;
      setDetailResultsByStrategy((prev) => ({ ...prev, [strategyId]: detailResults }));
      setDetailLoadingStrategyId((prev) => prev === strategyId ? null : prev);
    }).catch((err) => {
      console.error("Failed to build strategy detail timeline", err);
      if (cancelled) return;
      setDetailLoadingStrategyId((prev) => prev === strategyId ? null : prev);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedStrategy, simResults, mortgage, allStrategies, scenarios, marketRates, simDurationYears, maxAffordablePayment, detailResultsByStrategy, detailLoadingStrategyId]);

  // Start Matrix Simulation using Web Worker
  const handleStartSimulation = async () => {
    if (!mortgage) return;
    // Synchronous guard: if a simulation is already in flight, return
    // immediately. The ref is checked before the state setter runs, so the
    // auto-resim useEffect cannot race with the explicit button click.
    if (simulationInFlightRef.current) return;
    simulationInFlightRef.current = true;

    await releaseSimulationArtifacts();
    simulationInFlightRef.current = true;
    setError(null);
    setShowExhaustedReport(false);
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
      setError("当前拆分约束下没有可行方案。请提高最大 split 数、放宽浮动比例上限，或检查贷款总额与最小分包金额。");
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
        setError("模拟运行失败: " + msg.error);
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
    if (!mortgage) return "月供";
    const freq = mortgage.repaymentFrequency;
    if (freq === "weekly") return "周供";
    if (freq === "fortnightly") return "双周供";
    return "月供";
  };

  const getActiveDetailScenarioOption = () =>
    detailScenarioOptions.find((/** @type {any} */ opt) => opt.id === selectedDetailScenario)
    || detailScenarioOptions[0]
    || null;

  const renderSelectedPathExplanation = () => {
    const activeOption = getActiveDetailScenarioOption();
    if (!activeOption) return null;
    const stats = activeOption.targetStats;

    return (
      <div className="recommendation-path-explain">
        <div className="path-explain-copy">
          <span className="path-dot" style={{ background: activeOption.color || "var(--text-secondary)" }} />
          <span>{activeOption.description || "当前推荐和明细表会使用这条 OCR 路径作为计算依据。"}</span>
        </div>
        {stats && (
          <div className="path-target-grid">
            <div>
              <span>最后一年平均 OCR</span>
              <strong>{formatRatePercent(stats.averageRate)}</strong>
            </div>
            <div>
              <span>最后一年预测区间</span>
              <strong>{formatRatePercent(stats.minRate)} - {formatRatePercent(stats.maxRate)}</strong>
            </div>
            <div>
              <span>期末 OCR 目标</span>
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
      label: activeOption?.label || "概率加权期望路径",
      isScenarioSpecific: Boolean(scenarioResult)
    };
  };

  const renderCardMetrics = (/** @type {string} */ strategyId) => {
    const metrics = getStrategyDisplayMetrics(strategyId);
    if (!metrics) return null;
    const freqLabel = getRepaymentFrequencyLabel();
    const metricLabelPrefix = metrics.isScenarioSpecific ? metrics.label : "期望";

    return (
      <div className="rec-metrics">
        <div className="rec-metric stat-tile">
          <span className="stat-tile-lbl">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
            {metricLabelPrefix}总利息
          </span>
          <span className="stat-tile-val">${Math.round(metrics.interest).toLocaleString()}</span>
        </div>
        <div className="rec-metric stat-tile">
          <span className="stat-tile-lbl">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2v20" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
            {metricLabelPrefix}最高{freqLabel}
          </span>
          <span className="stat-tile-val text-rose">${Math.round(metrics.maxPayment).toLocaleString()}</span>
        </div>
        <div className="rec-metric stat-tile">
          <span className="stat-tile-lbl">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>
            {metricLabelPrefix}已还本金
          </span>
          <span className="stat-tile-val text-emerald">${Math.round(metrics.principalRepaid).toLocaleString()}</span>
        </div>
        <div className="rec-metric stat-tile">
          <span className="stat-tile-lbl">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>
            {metricLabelPrefix}剩余本金
          </span>
          <span className="stat-tile-val">${Math.round(metrics.endingBalance).toLocaleString()}</span>
        </div>
      </div>
    );
  };

  const getComparisonData = () => {
    if (!selectedStrategy || !optimisedData || !simResults) return [];
    const currentCost = selectedStrategy.expectedInterest;

    return optimisedData.rankedStrategies
      .filter((/** @type {any} */ s) => {
        const strat = allStrategies.find((x) => x.id === s.strategyId);
        return strat && strat.allocations.length === 1;
      })
      .map((/** @type {any} */ s) => {
        const strat = allStrategies.find((x) => x.id === s.strategyId);
        const allocation = strat.allocations[0];
        const productCode = allocation.productCode;
        const prod = nzProfile.products.find((/** @type {any} */ p) => p.code === productCode);
        const displayName = prod ? prod.displayName : productCode;
        const diff = s.expectedInterest - currentCost;
        return {
          displayName,
          productCode,
          expectedInterest: s.expectedInterest,
          diff: Math.round(diff * 100) / 100
        };
      })
      .sort((/** @type {any} */ a, /** @type {any} */ b) => b.diff - a.diff);
  };

  const buildDetailTimelineData = () => {
    if (!selectedStrategy || !simResults) return null;

    const detailResult = getDetailResultForStrategy(selectedStrategy.strategyId);
    if (!detailResult || !detailResult.timeline) return null;

    const strategy = allStrategies.find((/** @type {any} */ s) => s.id === selectedStrategy.strategyId);
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

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "80vh" }}>
        <div>加载中...</div>
      </div>
    );
  }

  return (
    <div className="lab-container">
      <header className="lab-header">
        <div className="header-copy">
          <h1 className="title">策略仿真实验室</h1>
          <p className="subtitle">模拟不同未来利率情景，智能优化您的贷款拆分方案。</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            onClick={handleClearSimulationOutput}
            className="btn btn-secondary top-reset-btn"
            disabled={simulationRunning || (!simResults && !optimisedData && allStrategies.length === 0)}
            title="只清空仿真输出、缓存结果和推荐，不重置左侧输入参数"
          >
            清空仿真结果
          </button>
        </div>
      </header>
      <div className="lab-grid">
        <div className="left-controls-col">
          <section className="glass-panel control-section">
            <h2 className="section-title">
              <span>1. 参数分组</span>
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
                    <span className="control-group-title">短中期 OCR 走势</span>
                    <span className="control-group-subtitle">影响未来 1-36 个月的确定性路径骨架</span>
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
                      重置默认
                    </span>
                  )}
                  <span className="control-group-toggle">{openControlGroups.trend ? "收起 ▴" : "展开 ▾"}</span>
                </span>
              </div>
              {openControlGroups.trend && (
                <div className="control-group-body">
                  <div className="form-group">
                    <div className="slider-label-row">
                      <span className="form-label">未来 12 个月利率变化 (Short Term)</span>
                      <span className="slider-value">{(shortTermChange * 100).toFixed(2)}%</span>
                    </div>
                    <Slider min={-0.02} max={0.02} step={0.0025} value={shortTermChange} onChange={(e) => setShortTermChange(parseFloat(e.target.value))} />
                    <div className="slider-range-desc">
                      <span>快速降息 (-2.00%)</span>
                      <span>不调整</span>
                      <span>重新加息 (+2.00%)</span>
                    </div>
                    <div className="param-explanation">
                      新西兰央行（RBNZ）在未来 12 个月内对 OCR 官方贴现率的预测累计变化幅度。第 1 至 12 个月将平滑递变（如考虑了第 6 个月的过渡变化）。
                      <div className="param-example">👉 例子：若当前 OCR 为 2.25%，设置为 -2.00%，代表第 12 个月时 OCR 将跌至 0.25%；在第 6 个月时则约跌至 1.25%。</div>
                      <div className="param-example">说明：1 年固定、2 年固定等固定期限产品不会在锁定期内逐月跟随此滑杆变化，而是在到期续约（refix）时，按续约当月 OCR 相对当前 OCR 的变化重新定价。</div>
                    </div>
                  </div>

                  <div className="form-group">
                    <div className="slider-label-row">
                      <span className="form-label">中期利率走向趋势 (Medium Term)</span>
                      <span className="slider-value">
                        {mediumTermDirection < -0.1 ? "继续大幅降息" : mediumTermDirection > 0.1 ? "重定价趋升" : "走势平稳"}
                      </span>
                    </div>
                    <Slider min={-1.0} max={1.0} step={0.1} value={mediumTermDirection} onChange={(e) => setMediumTermDirection(parseFloat(e.target.value))} />
                    <div className="slider-range-desc">
                      <span>继续降息 (-1.0)</span>
                      <span>走平</span>
                      <span>明显回升 (+1.0)</span>
                    </div>
                    <div className="param-explanation">
                      第 13 至第 {Math.min(simDurationYears * 12, 36)} 个月之间，政策利率按该滑杆设定的中期趋势变化。1.0 个单位的变动代表利率每年变化 0.50%。
                      <div className="param-example">👉 例子：若设置为 -1.0，代表从第 13 个月起到第 36 个月止，利率每年以 -0.50% 的速度下降；设置为 0.0 则从第 13 个月起保持平稳。</div>
                    </div>
                  </div>

                  <div className="form-group">
                    <div className="slider-label-row">
                      <span className="form-label">政策调整速度 (Speed)</span>
                      <span className="slider-value">{(changeSpeed * 100).toFixed(0)}%</span>
                    </div>
                    <Slider min={0.0} max={1.0} step={0.05} value={changeSpeed} onChange={(e) => setChangeSpeed(parseFloat(e.target.value))} />
                    <div className="slider-range-desc">
                      <span>缓慢延迟 (0.0)</span>
                      <span>均衡</span>
                      <span>瞬时调整 (1.0)</span>
                    </div>
                    <div className="param-explanation">
                      利率变动在未来 12 个月内发生的时间分布曲线（即变动的发生速度分布）。
                      <div className="param-example">👉 例子：100% 代表变动瞬间集中在第 1 个月发生；50% 代表 12 个月内线性递变；0% 代表前期缓慢、在临近第 12 个月时才加速。</div>
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
                    <span className="control-group-title">情景分布与风险幅度</span>
                    <span className="control-group-subtitle">影响低 / 基准 / 高三条中期情景及其权重</span>
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
                      重置默认
                    </span>
                  )}
                  <span className="control-group-toggle">{openControlGroups.risk ? "收起 ▴" : "展开 ▾"}</span>
                </span>
              </div>
              {openControlGroups.risk && (
                <div className="control-group-body">
                  <div className="form-group">
                    <div className="slider-label-row">
                      <span className="form-label">预测路径不确定性 (Uncertainty)</span>
                      <span className="slider-value">+/- {(uncertainty * 100).toFixed(2)}%</span>
                    </div>
                    <Slider min={0.0} max={0.02} step={0.001} value={uncertainty} onChange={(e) => setUncertainty(parseFloat(e.target.value))} />
                    <div className="slider-range-desc">
                      <span>较低 (0.0%)</span>
                      <span>标准</span>
                      <span>较高 (+/- 2.0%)</span>
                    </div>
                    <div className="param-explanation">
                      未来利率预测路径的发散广度。不确定性随时间推移逐渐扩大（第 3 个月生效 25%，第 6 个月生效 50%，第 12 个月后生效 100%）。
                      <div className="param-example">👉 例子：若设置为 +/- 1.00%，代表在第 12 个月及以后，“高利率情景”会在基准路径基础上上浮 1.00%，“低利率情景”则下浮 1.00%。</div>
                    </div>
                  </div>

                  <div className="form-group">
                    <div className="slider-label-row">
                      <span className="form-label">情景概率权重 (Scenario Weights)</span>
                      <span className="slider-value">{scenarioProbabilities.low}% / {scenarioProbabilities.base}% / {scenarioProbabilities.high}%</span>
                    </div>
                    {[
                      { key: "low", label: "低利率情景权重" },
                      { key: "base", label: "基准情景权重" },
                      { key: "high", label: "高利率情景权重" }
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
                        />
                      </div>
                    ))}
                    <div className="slider-range-desc">
                      <span>总和自动保持 100%</span>
                      <span>默认 15 / 70 / 15</span>
                    </div>
                    <div className="param-explanation">
                      这三项不是利率涨跌幅，也不会直接改变低 / 基准 / 高三条 OCR 曲线的形状。它们是在模型汇总结果时使用的概率权重：系统会先分别模拟每条 OCR 路径，再按这里的比例计算“期望总利息”“期望最高供款”“期望剩余本金”等指标，并影响默认的概率加权推荐。
                      <div className="param-example">👉 计算例子：某个 split 在低 / 基准 / 高情景下总利息分别为 $140,000 / $160,000 / $190,000，默认权重 15% / 70% / 15% 时，期望总利息 = 140,000 × 15% + 160,000 × 70% + 190,000 × 15% = $161,500。</div>
                      <div className="param-example">👉 调整例子：若您更担心高息，把高利率权重调高，推荐会更重视高息情景下的供款压力和剩余本金；若您更相信降息，把低利率权重调高，推荐会更偏向低息环境下成本更低的方案。</div>
                      <div className="param-example">说明：三项总和会自动保持 100%。默认设置为低 15% / 基准 70% / 高 15%。</div>
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
                    <span className="control-group-title">长期 Monte Carlo</span>
                    <span className="control-group-subtitle">影响 36 个月之后的长期波动方向与周期</span>
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
                      重置默认
                    </span>
                  )}
                  <span className="control-group-toggle">{openControlGroups.longTerm ? "收起 ▴" : "展开 ▾"}</span>
                </span>
              </div>
              {openControlGroups.longTerm && (
                <div className="control-group-body">
                  <div className="form-group">
                    <div className="slider-label-row">
                      <span className="form-label">长期波动周期 (Long-Term Cycle)</span>
                      <span className="slider-value">{longTermCycleYears} 年</span>
                    </div>
                    <Slider min={1} max={3} step={1} value={longTermCycleYears} onChange={(e) => setLongTermCycleYears(parseInt(e.target.value, 10))} />
                    <div className="slider-range-desc">
                      <span>1 年</span>
                      <span>2 年</span>
                      <span>3 年</span>
                    </div>
                    <div className="param-explanation">
                      该参数决定第 36 个月之后长期蒙特卡洛路径的主导波动周期。以 2 年周期为例，若 13-36 个月总体向上，则 37-60 个月大概率先转为下行，61-84 个月再大概率切回上行。
                    </div>
                  </div>

                  <div className="form-group">
                    <div className="slider-label-row">
                      <span className="form-label">长期反转概率 (Reversal Bias)</span>
                      <span className="slider-value">{Math.round(longTermReversalBias * 100)}%</span>
                    </div>
                    <Slider min={0.6} max={0.8} step={0.1} value={longTermReversalBias} onChange={(e) => setLongTermReversalBias(parseFloat(e.target.value))} />
                    <div className="slider-range-desc">
                      <span>60%</span>
                      <span>70%</span>
                      <span>80%</span>
                    </div>
                    <div className="param-explanation">
                      若 13-36 个月的中期趋势向上，则长期第一个周期会以该概率优先转为下行；若中期趋势向下，则长期第一个周期会以同样概率优先转为上行。其余概率下，模型保留同向波动的可能性。
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
                    <span className="control-group-title">模拟范围</span>
                    <span className="control-group-subtitle">控制本次分析覆盖的未来时长</span>
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
                      重置默认
                    </span>
                  )}
                  <span className="control-group-toggle">{openControlGroups.horizon ? "收起 ▴" : "展开 ▾"}</span>
                </span>
              </div>
              {openControlGroups.horizon && (
                <div className="control-group-body">
                  <div className="form-group">
                    <div className="slider-label-row">
                      <span className="form-label" style={{ fontWeight: "600", color: "var(--text-primary)" }}>模拟期限选择 (Simulation Horizon)</span>
                      <span className="slider-value" style={{ color: "#60a5fa" }}>{simDurationYears} 年 ({simDurationYears * 12} 个月)</span>
                    </div>
                    <Slider
                      min={1}
                      max={simMaxYears}
                      step={1}
                      value={simDurationYears}
                      onChange={(/** @type {any} */ e) => setSimDurationYears(parseInt(e.target.value, 10))}
                      className="slider-input"
                      aria-label="模拟期限（年）"
                      aria-valuemin={1}
                      aria-valuemax={simMaxYears}
                      aria-valuenow={simDurationYears}
                    />
                    <div className="slider-range-desc">
                      <span>1 年</span>
                      <span>{Math.max(1, Math.round(simMaxYears / 2))} 年</span>
                      <span>最长 {simMaxYears} 年</span>
                    </div>
                    <div className="param-explanation" style={{ marginTop: "10px" }}>
                      设定房贷策略情景模拟覆盖的未来期数范围。利率变化和还款折算将完全适配此周期。
                      {simCappedByMortgage ? (
                        <div className="param-example">
                          👉 您在房贷配置中设定的期望还清期限为约 {simTargetYears.toFixed(1)} 年（{mortgage?.originalTermMonths} 个月），系统已自动将拖拽上限锁定到 {simMaxYears} 年（覆盖到目标年年末）。如需调整，可返回【房贷配置】修改。
                        </div>
                      ) : (
                        <div className="param-example">👉 例子：若拖到 3 年，则只分析未来 36 个月内的还款表现，并计算第 36 个月末的期望剩余本金。</div>
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
                    <span className="control-group-title">拆分与预算约束</span>
                    <span className="control-group-subtitle">控制候选策略空间与风险边界</span>
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
                      重置默认
                    </span>
                  )}
                  <span className="control-group-toggle">{openControlGroups.constraints ? "收起 ▴" : "展开 ▾"}</span>
                </span>
              </div>
              {openControlGroups.constraints && (
                <div className="control-group-body">
                  <div className="form-group">
                    <div className="slider-label-row">
                      <span className="form-label">分散化预设 (Diversification Preset)</span>
                      <span className="slider-value">{diversificationPreset === "default" ? "默认" : diversificationPreset === "diversification" ? "分散化" : "最大分散化"}</span>
                    </div>
                    <div className="segmented-control" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                      {[
                        { value: "default", label: "默认 (3 拆 / 10%)", tip: "保守推荐：3 拆 10% 步长 10% 浮动上限，候选方案 ~58 个" },
                        { value: "diversification", label: "分散化 (4 拆 / 5%)", tip: "暴露更多 60/20/20 跨期分散方案，候选方案 ~500 个，自动展开穷举报告" },
                        { value: "max", label: "最大分散化 (5 拆 / 5%)", tip: "允许 50% 浮动和 5 拆，候选方案 ~2000 个，自动展开穷举报告" }
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
                      一键切换方案搜索范围。"默认"模式保持当前推荐行为；"分散化"和"最大分散化"会放宽浮动上限和步长，自动展开穷举评估报告，并调整评分权重使跨期分散方案能赢得推荐卡片。手动修改下方任一参数会自动退出预设回到自定义状态。
                      <div className="param-example">👉 例子：想看 60% 固定-2y + 20% 固定-1y + 20% 浮动这种跨期分散方案？切到"分散化"即可。</div>
                    </div>
                  </div>

                  <div className="form-group">
                    <div className="slider-label-row">
                      <span className="form-label">最大 Split / Tranche 数</span>
                      <span className="slider-value">{maxSplits} 个</span>
                    </div>
                    <div className="segmented-control">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} type="button" className={`segmented-btn ${maxSplits === n ? "active" : ""}`} onClick={() => setMaxSplits(n)}>
                          {n}
                        </button>
                      ))}
                    </div>
                    <div className="param-explanation">
                      限制您的贷款最多可以被拆分成几笔不同期限和额度的子贷款分包。设置为 1 时等同于不进行任何拆分，仅比较单一期限锁定方案。
                      <div className="param-example">👉 例子：设置为 3，表示系统将在“不拆分（1笔）”、“拆分为2笔”和“拆分为3笔”的所有合法方案中寻找最优策略。</div>
                    </div>
                  </div>

                  <div className="form-group">
                    <div className="slider-label-row">
                      <span className="form-label">组合网格步长</span>
                      <span className="slider-value">{(percentageStep * 100).toFixed(0)}%</span>
                    </div>
                    <div className="segmented-control" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                      {[
                        { value: 0.15, label: "15% (粗)", tip: "最少组合,模拟最快" },
                        { value: 0.10, label: "10% (适中)", tip: "组合适中,推荐日常使用" },
                        { value: 0.05, label: "5% (细)", tip: "组合丰富,模拟较慢" }
                      ].map((opt) => (
                        <button key={opt.value} type="button" title={opt.tip} className={`segmented-btn ${percentageStep === opt.value ? "active" : ""}`} onClick={() => setPercentageStep(opt.value)}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <div className="param-explanation">
                      贷款额度在不同期限之间的分配步长。步长越粗，组合数越少，模拟越快。默认 10% 在组合丰富度和性能之间取得平衡。
                      <div className="param-example">👉 例子：步长 10% 时，1 笔分配可选 10%/20%/30%/.../100%（共 10 档）。</div>
                    </div>
                  </div>

                  <div className="form-group">
                    <div className="slider-label-row">
                      <span className="form-label">浮动/Offset 最高占比</span>
                      <span className="slider-value">{maxFloatingPercentage}%</span>
                    </div>
                    <Slider min={0} max={80} step={10} value={maxFloatingPercentage} onChange={(e) => setMaxFloatingPercentage(parseInt(e.target.value, 10))} />
                    <div className="slider-range-desc">
                      <span>全固定</span>
                      <span>保守浮动</span>
                      <span>高灵活性</span>
                    </div>
                    <div className="param-explanation">
                      限制贷款中浮动利率（Floating/Offset/Revolving）部分的最高额度占比。系统会同时保证最低固定比例为 {100 - maxFloatingPercentage}%（即 1 - 浮动比例），并由策略生成器内部派生该约束。
                      <div className="param-example">👉 例子：若拉到 10%，代表贷款中最多只能有 10% 采用浮动利率，其余 90% 必须锁定在固定期限上。</div>
                    </div>
                  </div>

                  <div className="form-group">
                    <div className="slider-label-row">
                      <span className="form-label">每期供款预算上限</span>
                      <span className="slider-value">${maxAffordablePayment.toLocaleString()}</span>
                    </div>
                    <input
                      type="number"
                      min="0"
                      step="100"
                      value={maxAffordablePayment}
                      onChange={(e) => setMaxAffordablePayment(Math.max(0, parseInt(e.target.value || "0", 10)))}
                      className="number-input"
                    />
                    <div className="param-explanation">
                      您每期可承受的最大还款金额上限。用于统计极端高利息情景下的“预算超限次数”，并参与综合评分。
                      <div className="param-example">👉 例子：若设定为 5000 且还款频率为双周，在某高息周期下若双周供款达到 5200，系统会记录 1 次超限。</div>
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
                    <span className="control-group-title">个人还款偏好</span>
                    <span className="control-group-subtitle">只影响推荐打分，不改变利率路径本身</span>
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
                      重置默认
                    </span>
                  )}
                  <span className="control-group-toggle">{openControlGroups.preferences ? "收起 ▴" : "展开 ▾"}</span>
                </span>
              </div>
              {openControlGroups.preferences && (
                <div className="control-group-body">
                  <p className="text-muted" style={{ fontSize: "11px", lineHeight: "1.5", margin: "0 0 14px" }}>
                    自定义以下 6 项指标的权重比。<strong>所有权重之和锁定为 100%</strong>。当您拖动任意滑块增加其比例时，其他滑块将按比例自动减少，反之亦然。
                  </p>
                  {[
                    {
                      key: "cost",
                      label: "利息成本 (Interest Cost)",
                      value: weights.cost,
                      minText: "成本低优先",
                      maxText: "忽略成本",
                      explanation: `在综合评分中，提高此项权重会让系统优先选择“期望总利息支出”更低的拆分方案。`,
                      example: `👉 例子：拉到 70% 时，系统会优先压低期望总利息，即使这意味着还款波动或到期集中度有所上升。`
                    },
                    {
                      key: "principal",
                      label: "本金还款速度 (Principal Paydown)",
                      value: weights.principal,
                      minText: "慢速还本",
                      maxText: "快速还本优先",
                      explanation: `在综合评分中，提高此项权重会让系统优先选择“模拟期末剩余本金”更低的方案。`,
                      example: `👉 例子：拉到 60% 时，会更倾向于在 ${simDurationYears} 年窗口内更快压低本金余额。`
                    },
                    {
                      key: "refix",
                      label: "利率重定价风险 (Refix Risk)",
                      value: weights.refix,
                      minText: "忽略风险",
                      maxText: "分散到期优先",
                      explanation: `在综合评分中，提高此项权重会让系统优先选择“单月最大同时到期余额比例”更低的方案。`,
                      example: `👉 例子：拉到 50% 时，会更倾向于分散不同 tranche 的到期月份。`
                    },
                    {
                      key: "flex",
                      label: "资金流灵活性 (Floating Flex)",
                      value: weights.flex,
                      minText: "不重要",
                      maxText: "高比例浮动优先",
                      explanation: `在综合评分中，提高此项权重会让系统优先选择“浮动/Offset 占比”更高的方案。`,
                      example: `👉 例子：拉到 40% 时，会把上方“拆分与预算约束”中设定的浮动占比上限尽量用满。`
                    },
                    {
                      key: "resilience",
                      label: "极端高息抗压性 (Stress Resistance)",
                      value: weights.resilience,
                      minText: "不考虑极端",
                      maxText: "低最高供款优先",
                      explanation: `在综合评分中，提高此项权重会让系统优先选择“高利率情景下的峰值供款”更低的方案。`,
                      example: `👉 例子：拉到 50% 时，会更偏向锁更长的固定期限来压制最坏情景下的供款峰值。`
                    },
                    {
                      key: "budget",
                      label: "预算超限控制 (Budget Safety)",
                      value: weights.budget,
                      minText: "不考虑预算",
                      maxText: "少超预算优先",
                      explanation: `在综合评分中，提高此项权重会让系统优先选择“模拟期内每期供款超过您设定预算”的次数更少的方案。`,
                      example: `👉 例子：若预算设为 $5000，拉到 30% 时，会尽量减少各情景下超限次数。`
                    }
                  ].map((w) => (
                    <div key={w.key} className="form-group" style={{ marginBottom: "14px" }}>
                      <div className="slider-label-row">
                        <span className="form-label" style={{ fontSize: "12px", fontWeight: "600" }}>{w.label}</span>
                        <span className="slider-value" style={{ color: "#60a5fa", fontSize: "13px" }}>权重: {w.value}%</span>
                      </div>
                      <Slider min={0} max={100} step={1} value={w.value} onChange={(e) => handleWeightChange(w.key, parseInt(e.target.value, 10))} />
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
          </section>

          {/* Scenario Rates Chart */}
          <section className="glass-panel chart-section accent-cyan">
            <h2 className="section-title"><span className="step-num">7</span>OCR 预测情景曲线</h2>
            <div style={{ marginTop: "16px" }}>
              <SvgChart data={chartScenarioPaths} yAxisType="rate" height={220} />
            </div>
            <div className="chart-explain-box">
              <div className="chart-explain-title">如何读这张图</div>
              <div className="chart-explain-copy">
                这张图会随着左侧 input 实时变化，不需要先运行策略仿真。前 36 个月显示低 / 基准 / 高三条确定性 OCR 情景线，反映您对中期利率走势的主观判断。第 37 个月开始，系统不再只延长单一路径，而是按您设置的长期周期与反转概率生成长期 Monte Carlo 样本，用来表达长期不确定性。
              </div>

              <div className="chart-explain-title" style={{ marginTop: "12px" }}>术语解释</div>
              <div className="chart-glossary-grid">
                <div className="chart-glossary-item">
                  <strong>OCR</strong>
                  <span>新西兰官方现金利率。它不是房贷利率本身，但会影响浮动利率和固定利率续约定价。</span>
                </div>
                <div className="chart-glossary-item">
                  <strong>概率加权期望路径</strong>
                  <span>白色虚线。把低 / 基准 / 高情景按您设定的权重逐月加权后的平均路径，用于期望利息和期望余额计算。</span>
                </div>
                <div className="chart-glossary-item">
                  <strong>长期乐观路径</strong>
                  <span>利率偏低的长期代表路径。专业上接近 P10 概念，也就是样本里偏乐观的一侧。</span>
                </div>
                <div className="chart-glossary-item">
                  <strong>长期中性路径</strong>
                  <span>利率处在中间位置的长期代表路径。专业上接近 P50，也就是中位样本。</span>
                </div>
                <div className="chart-glossary-item">
                  <strong>长期压力路径</strong>
                  <span>利率偏高的长期代表路径。专业上接近 P90，用来观察压力测试下的供款和余额。</span>
                </div>
                <div className="chart-glossary-item">
                  <strong>Monte Carlo</strong>
                  <span>不是再猜一条唯一未来线，而是生成多条可能路径，再从中提取代表样本和统计结果。</span>
                </div>
              </div>

              <div className="chart-explain-title" style={{ marginTop: "12px" }}>例子</div>
              <div className="chart-example-list">
                <div className="chart-example-item">
                  如果权重是低 50% / 基准 30% / 高 20%，那么白色虚线会更靠近低利率路径，因为它代表的是三条中期情景的加权平均，而不是单独某一条情景。
                </div>
                <div className="chart-example-item">
                  如果 13-36 个月整体向上，且长期反转概率设为 70%，那么第 37 个月后的第一段长期样本更大概率先向下波动，但不会变成死板直线，仍会保留上下扰动。
                </div>
                <div className="chart-example-item">
                  长期乐观 / 中性 / 压力不是固定涨跌幅，也不是用户设置的概率权重，而是从长期样本里挑出来的三类代表路径。
                </div>
                <div className="chart-example-item">
                  如果第 36 个月低利率情景停在较低位置，但长期乐观路径从更高位置开始，看起来会有“跳空”。这是因为它是长期样本中的代表路径，不一定是低利率绿线本身的直接延长。
                </div>
                <div className="chart-example-item">
                  下方细节表与图是一一对应的。切换到“长期中性路径”时，表格里的利息、最高供款和剩余本金都会改成这条路径对应的结果。
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Right Column: Results & Recommendations */}
        <div className="right-results-col">

          {/* Run Button & Progress panel */}
          <section className="glass-panel run-section accent-emerald">
            <h2 className="section-title"><span className="step-num">8</span>策略仿真模拟</h2>
            <p className="text-muted" style={{ fontSize: "12px", margin: "8px 0 16px" }}>
              系统将按最多 {maxSplits} 个 split、最高 {maxFloatingPercentage}% 浮动/Offset 占比生成合法方案，并在三个未来预测利率路径情景下进行 {simDurationYears * 12} 个月的还款流分析。
            </p>

            {error && <div className="error-banner">{error}</div>}

            {simulationRunning ? (
              <div className="progress-panel">
                <div className="progress-bar-container">
                  <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
                </div>
                <div className="progress-text-row">
                  <span>仿真模拟中... {Math.round(progress)}%</span>
                  <span>已完成 {completedSims.toLocaleString()} / 共 {totalSims.toLocaleString()} 次模拟</span>
                </div>
                {currentSimulationInfo && (
                  <div className="simulation-current-grid">
                    <div>
                      <span>当前组合</span>
                      <strong>{currentSimulationInfo.combination}</strong>
                    </div>
                    <div>
                      <span>Fix 年限构成</span>
                      <strong>{currentSimulationInfo.fixTerms}</strong>
                    </div>
                    <div>
                      <span>OCR 情景路线</span>
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
                  取消仿真
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleStartSimulation}
                className="btn-cta-run"
                style={{ width: "100%", marginTop: "12px" }}
                disabled={!mortgage}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4.5 16.5c-1.5 1.26-2.5 3.19-2.5 5.5s1 4.24 2.5 5.5" /><path d="M12 2v20" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                {simResults ? "重新仿真" : "开始仿真模拟"}
              </button>
            )}
          </section>

          {/* Recommendations Cards */}
          {optimisedData && (
            <section className="recommendations-section accent-amber">
              <h2 className="section-title"><span className="step-num">9</span>三大推荐拆分方案对比</h2>
              <p className="text-muted" style={{ fontSize: "12px", marginBottom: "16px", lineHeight: "1.6" }}>
                系统基于当前选择的 OCR 路径、最大 split 数、浮动占比、预算上限和还款偏好，筛选出当前最优贷款 split。默认使用“概率加权期望路径”；切换到乐观 / 中性 / 压力路径后，推荐卡和下方明细表会统一到同一条路径。{maxSplits > 1 ? "推荐卡默认只从 2 笔及以上的真实拆分方案中选择；100% 单一产品会保留在下方表格和传统对照里，作为 benchmark 参考。" : "当前设置为 1 个 split，因此只比较单一期限锁定方案。"}<strong>点击下方推荐卡片可快速将其设为当前对比策略。</strong>
              </p>

              {detailScenarioOptions.length > 1 && (
                <div className="recommendation-basis-panel">
                  <div className="recommendation-basis-label">推荐依据</div>
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
                        setSelectedStrategy(fullDetails);
                        setSelectedRecType("preference");
                      }
                    }}
                  >
                    <div className="badge badge-indigo">偏好匹配推荐</div>
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px", lineHeight: "1.4" }}>
                      按您设置的权重打分排序（响应偏好权重）
                    </div>
                    <h3 className="rec-title" style={{ fontSize: "14px", lineHeight: "1.5" }}>
                      {renderStrategySplit(recPreference.strategyId)}
                    </h3>
                    <p className="rec-desc">根据您当前设置的约束参数和偏好权重，系统算出的综合得分最高的个性化贷款 split。</p>

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
                  </div>
                )}

                {/* 2. Lowest Cost Card */}
                {recLowestCost && (
                  <div
                    className={`rec-card glass-panel clickable-card accent-emerald ${selectedRecType === "lowestCost" ? "selected-rec-card" : ""}`}
                    onClick={() => {
                      const fullDetails = optimisedData.rankedStrategies.find((/** @type {any} */ s) => s.strategyId === recLowestCost.strategyId);
                      if (fullDetails) {
                        setSelectedStrategy(fullDetails);
                        setSelectedRecType("lowestCost");
                      }
                    }}
                  >
                    <div className="badge badge-emerald">最低期望成本</div>
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px", lineHeight: "1.4" }}>
                      期望总利息最小的方案（与权重无关）
                    </div>
                    <h3 className="rec-title" style={{ fontSize: "14px", lineHeight: "1.5" }}>
                      {renderStrategySplit(recLowestCost.strategyId)}
                    </h3>
                    <p className="rec-desc">在所有未来走势情景下，数学期望总利息支出最低的拆分组合（降息通道下偏向短期，但伴随重定价波动风险）。</p>

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
                  </div>
                )}

                {/* 3. Most Stable Card */}
                {recMostStable && (
                  <div
                    className={`rec-card glass-panel clickable-card accent-amber ${selectedRecType === "mostStable" ? "selected-rec-card" : ""}`}
                    onClick={() => {
                      const fullDetails = optimisedData.rankedStrategies.find((/** @type {any} */ s) => s.strategyId === recMostStable.strategyId);
                      if (fullDetails) {
                        setSelectedStrategy(fullDetails);
                        setSelectedRecType("mostStable");
                      }
                    }}
                  >
                    <div className="badge badge-amber">最稳妥供款</div>
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px", lineHeight: "1.4" }}>
                      单月最坏供款最小的方案（与权重无关）
                    </div>
                    <h3 className="rec-title" style={{ fontSize: "14px", lineHeight: "1.5" }}>
                      {renderStrategySplit(recMostStable.strategyId)}
                    </h3>
                    <p className="rec-desc">还款流波动率与极端高息情景下峰值供款最小的组合（偏向长期锁死固定利率，最抗利息飙升风险，但可能损失降息红利）。</p>

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
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Selected Strategy Timeline Details */}
          {selectedStrategy && (
            <section className="glass-panel detail-timeline-section" style={{ marginTop: "24px" }}>
              <h2 className="section-title" style={{ marginBottom: "16px" }}>选定策略 {simulatedMonths} 个月细节汇总: {renderStrategySplit(selectedStrategy.strategyId)}</h2>

              {detailLoadingStrategyId === selectedStrategy.strategyId && !detailResultsByStrategy[selectedStrategy.strategyId] && (
                <div className="detail-loading-note">
                  正在按当前选定策略即时生成详细 timeline。为避免内存峰值，系统不会再为所有策略预先保存整包明细。
                </div>
              )}

              {(() => {
                const detailResult = getDetailResultForStrategy(selectedStrategy.strategyId);
                const detailInterest = detailResult ? detailResult.totalInterest : selectedStrategy.expectedInterest;
                const detailMaxPayment = detailResult ? detailResult.maximumPayment : selectedStrategy.expectedMaxPayment;
                const detailEndingBalance = detailResult ? detailResult.endingBalance : selectedStrategy.expectedEndingBalance;
                const detailPrincipalRepaid = getTotalBalance() - detailEndingBalance;
                const freqLabel = getRepaymentFrequencyLabel();
                const detailLabel = detailResult?.detailLabel || "期望路径";

                return (
                  <div className="glass-panel" style={{ background: "rgba(255,255,255,0.01)", padding: "16px", borderRadius: "8px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "16px", marginBottom: "20px" }}>
                    <div>
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>{detailLabel}总利息</div>
                      <div style={{ fontSize: "18px", fontWeight: "600", color: "var(--color-primary-light, #60a5fa)" }}>${Math.round(detailInterest).toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>{detailLabel}最高{freqLabel}</div>
                      <div style={{ fontSize: "18px", fontWeight: "600", color: "var(--color-rose)" }}>${Math.round(detailMaxPayment).toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>{detailLabel}已还本金</div>
                      <div style={{ fontSize: "18px", fontWeight: "600", color: "var(--color-emerald)" }}>${Math.round(detailPrincipalRepaid).toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>{detailLabel}剩余本金</div>
                      <div style={{ fontSize: "18px", fontWeight: "600", color: "var(--text-primary)" }}>${Math.round(detailEndingBalance).toLocaleString()}</div>
                    </div>
                  </div>
                );
              })()}

              <div style={{ marginTop: "12px" }}>
                <SvgChart
                  data={(() => {
                    const detailResult = getDetailResultForStrategy(selectedStrategy.strategyId);
                    if (!detailResult?.timeline) return [];
                    return [{
                      id: "balance-path",
                      name: `${detailResult.detailLabel}本金总余额`,
                      color: "var(--color-primary)",
                      points: detailResult.timeline.map((/** @type {any} */ t) => ({ month: t.monthIndex, value: t.closingBalance })),
                      fillArea: false
                    }];
                  })()}
                  yAxisType="currency"
                  height={200}
                />
              </div>

              {/* Detailed per-tranche timeline table */}
              {(() => {
                const detailData = buildDetailTimelineData();
                if (!detailData || detailData.tranches.length === 0) return null;

                const { snapshotMonths, tranches } = detailData;
                const totalAllocated = tranches.reduce((/** @type {number} */ sum, /** @type {any} */ t) => sum + t.initialBalance, 0) || 1;

                const formatMonthLabel = (/** @type {number} */ m) => {
                  const y = Math.floor(m / 12);
                  const mo = m % 12;
                  if (mo === 0) return `Y${y}m0`;
                  return `Y${y}m${mo}`;
                };

                const formatMoney = (/** @type {number} */ v) => `$${Math.round(v).toLocaleString()}`;

                const allPaidOff = (/** @type {any} */ t) =>
                  t.snapshots.every((/** @type {any} */ s) => s.balance <= 0);

                const accentPalette = ["primary", "cyan", "emerald", "amber", "rose"];
                const badgeForAccent = { primary: "indigo", cyan: "cyan", emerald: "emerald", amber: "amber", rose: "rose" };

                return (
                  <div className="detail-timeline-stack">
                    <div className="detail-timeline-intro">
                      <h3 className="detail-timeline-title">{simulatedMonths}个月逐笔分片明细时间线</h3>
                      <p className="detail-timeline-desc">
                        下表以每6个月为间隔，展示每笔贷款分片（Tranche）在该6个月窗口内的利率、续约事件、利息支出、本金偿还和剩余本金。利率为窗口末点的即时利率；利息与本金为该窗口内的累计值。
                      </p>
                      <p className="detail-timeline-desc">
                        其中固定利率分片在锁定期内保持原利率不变，只有到期续约时才会反映 OCR 情景变化；例如 `1 Year Fixed` 会按续约当月 OCR 相对当前 OCR 的变化重新定价，因此当短期滑杆设为 `+1.00%` 且第 12 个月 OCR 比当前高 `1.00%` 时，续约利率会在当前利率基础上相应上调 `1.00%`。
                      </p>
                    </div>

                    <section className="dt-card" aria-label="分片明细与合计">
                      <div className="dt-card-scroll">
                        <table className="dt-inner-table">
                          <caption className="sr-only">{simulatedMonths}个月内各分片的利率、续约事件、利息支出、本金偿还、剩余本金，以及所有分片合计</caption>
                          <thead>
                            <tr>
                              <th scope="col" className="dt-row-label-head">明细项</th>
                              {snapshotMonths.map((/** @type {number} */ m) => (
                                <th key={m} scope="col" className="dt-col-head">{formatMonthLabel(m)}</th>
                              ))}
                              <th scope="col" className="dt-accum-head">期末/累积总计</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tranches.flatMap((/** @type {any} */ tranche, /** @type {number} */ tIdx) => {
                              if (allPaidOff(tranche)) return [];
                              const pct = Math.max(1, Math.round((tranche.initialBalance / totalAllocated) * 100));
                              const accent = accentPalette[tIdx % accentPalette.length];

                              const rows = [
                                { label: "利率", key: "rate", tone: "info", render: (/** @type {any} */ s) => s.rate > 0 ? `${(s.rate * 100).toFixed(2)}%` : "—" },
                                { label: "续约事件", key: "events", tone: "warn", render: (/** @type {any} */ s) => s.events.length > 0 ? s.events.join("；") : "—" },
                                { label: "已付利息", key: "interestPaid", tone: "rose", render: (/** @type {any} */ s) => formatMoney(s.interestPaid) },
                                { label: "已还本金", key: "principalRepaid", tone: "emerald", render: (/** @type {any} */ s) => formatMoney(s.principalRepaid) },
                                { label: "本金余额", key: "balance", tone: "primary", render: (/** @type {any} */ s) => formatMoney(s.balance) }
                              ];

                              const trancheHeader = (
                                <tr key={`${tranche.trancheId}-th`} className={`dt-tranche-header dt-tranche-header--${accent}`}>
                                  <td colSpan={snapshotMonths.length + 2}>
                                    <div className="dt-tranche-header-inner">
                                      <span className="dt-tranche-bar" aria-hidden="true" />
                                      <span className="dt-tranche-name">{tranche.displayName}</span>
                                      <span className="dt-tranche-amount">${tranche.initialBalance.toLocaleString()}</span>
                                      <span className={`dt-tranche-pct badge badge-${badgeForAccent[accent]}`}>{pct}%</span>
                                    </div>
                                  </td>
                                </tr>
                              );

                              const dataRows = rows.map((row) => (
                                <tr key={`${tranche.trancheId}-${row.key}`} className={`dt-row dt-row--${row.tone}`}>
                                  <th scope="row" className="dt-row-label">
                                    <span className="dt-row-icon" aria-hidden="true" />
                                    {row.label}
                                  </th>
                                  {tranche.snapshots.map((/** @type {any} */ s) => (
                                    <td key={s.month} className="dt-val">{row.render(s)}</td>
                                  ))}
                                  <td className="dt-accum">
                                    {(() => {
                                      if (row.key === "rate" || row.key === "events") return "—";
                                      if (row.key === "interestPaid") {
                                        return formatMoney(tranche.snapshots.reduce((acc, s) => acc + s.interestPaid, 0));
                                      }
                                      if (row.key === "principalRepaid") {
                                        return formatMoney(tranche.snapshots.reduce((acc, s) => acc + s.principalRepaid, 0));
                                      }
                                      if (row.key === "balance") {
                                        return formatMoney(tranche.snapshots[tranche.snapshots.length - 1].balance);
                                      }
                                      return "—";
                                    })()}
                                  </td>
                                </tr>
                              ));

                              return [trancheHeader, ...dataRows];
                            })}

                            {(() => {
                              const totals = snapshotMonths.map((/** @type {number} */ m, /** @type {number} */ mi) => {
                                const totalInterest = tranches.reduce((/** @type {number} */ sum, /** @type {any} */ t) => sum + t.snapshots[mi].interestPaid, 0);
                                const totalRepayments = tranches.reduce((/** @type {number} */ sum, /** @type {any} */ t) => sum + t.snapshots[mi].interestPaid + t.snapshots[mi].principalRepaid, 0);
                                const totalBalance = tranches.reduce((/** @type {number} */ sum, /** @type {any} */ t) => sum + t.snapshots[mi].balance, 0);
                                const weightedRateSum = tranches.reduce((/** @type {number} */ sum, /** @type {any} */ t) => sum + t.snapshots[mi].rate * t.snapshots[mi].balance, 0);
                                const avgRate = totalBalance > 0 ? weightedRateSum / totalBalance : 0;
                                return { totalInterest, totalRepayments, totalBalance, avgRate };
                              });

                              // Calculate accumulated totals across all snapshots
                              const accumInterest = totals.reduce((sum, t) => sum + t.totalInterest, 0);
                              const accumRepayments = totals.reduce((sum, t) => sum + t.totalRepayments, 0);
                              const finalBalance = totals[totals.length - 1].totalBalance;
                              const finalAvgRate = totals[totals.length - 1].avgRate;

                              const footRows = [
                                { label: "加权平均利率", render: (/** @type {any} */ t) => t.avgRate > 0 ? `${(t.avgRate * 100).toFixed(2)}%` : "—", accumValue: finalAvgRate > 0 ? `${(finalAvgRate * 100).toFixed(2)}%` : "—" },
                                { label: "总还款", render: (/** @type {any} */ t) => formatMoney(t.totalRepayments), accumValue: formatMoney(accumRepayments) },
                                { label: "总利息", render: (/** @type {any} */ t) => formatMoney(t.totalInterest), accumValue: formatMoney(accumInterest) },
                                { label: "总本金余额", render: (/** @type {any} */ t) => formatMoney(t.totalBalance), accumValue: formatMoney(finalBalance) }
                              ];

                              const totalsHeader = (
                                <tr key="totals-th" className="dt-tranche-header dt-tranche-header--totals">
                                  <td colSpan={snapshotMonths.length + 2}>
                                    <div className="dt-tranche-header-inner">
                                      <span className="dt-tranche-bar" aria-hidden="true" />
                                      <span className="dt-tranche-name">所有分片合计</span>
                                    </div>
                                  </td>
                                </tr>
                              );

                              const totalsDataRows = footRows.map((fr, ri) => (
                                <tr key={`foot-${ri}`} className="dt-row dt-row--strong">
                                  <th scope="row" className="dt-row-label dt-row-label--strong">{fr.label}</th>
                                  {totals.map((t, i) => (
                                    <td key={i} className="dt-val dt-val--strong">{fr.render(t)}</td>
                                  ))}
                                  <td className="dt-accum dt-accum--strong">{fr.accumValue}</td>
                                </tr>
                              ));

                              return [totalsHeader, ...totalsDataRows];
                            })()}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </div>
                );
              })()}

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
              <span>{showExhaustedReport ? "收起可行拆分组合穷举评估报告 ▴" : "打开完整可行拆分组合穷举评估报告 ▾"}</span>
              <span className="badge badge-emerald">{optimisedData.rankedStrategies.length} 组组合</span>
            </button>
          )}

          {/* Collapsible Report Details */}
          {optimisedData && showExhaustedReport && (
            <div className="report-collapsible-content">

              {/* Professional Split Advice & Logic */}
              <div className="glass-panel pro-advice-section" style={{ marginTop: "24px" }}>
                <h2 className="section-title" style={{ marginBottom: "16px" }}>📖 专业拆分策略建议与原理分析</h2>
                <div className="pro-advice-grid">
                  <div className="advice-column">
                    <h3>为什么要对贷款进行拆分（Split）？</h3>
                    <ul>
                      <li>
                        <strong>防范重定价风险 (Rate Shock Protection)</strong>
                        <p>若将贷款全部绑定在单一固定期限，到期时一旦遭遇高息周期，全部贷款额度将被动承受高额利息压力。拆分后，不同Tranche在不同年份分批到期，能有效分散和分摊利率波动冲击。</p>
                      </li>
                      <li>
                        <strong>平滑现金流与资金灵活性</strong>
                        <p>短固定期（如6个月、1年）能让您随时享受降息周期的利息下调红利；长固定期（如3年、5年）则为您锁死未来月供上限，提供高度确定性；而浮动利率（Floating）部分则方便您随时进行大额提前还款或利用 Offset 账户抵消利息，资金流转更加自如。</p>
                      </li>
                    </ul>
                  </div>
                  <div className="advice-column">
                    <h3>如何选择最适合您的最优拆分策略？</h3>
                    <ul>
                      <li>
                        <strong>优先在“帕累托最优”中筛选</strong>
                        <p>下方穷举列表中标记为<strong>“首选”</strong>的均是数学上的**帕累托最优组合（Pareto Optimal）**。这意味着在相同的利息开销下，这些组合的还款波动性最低；或者在相同的波动指标下，利息总开销最低。被支配方案通常在同等指标下存在更好的选择，不建议优先考虑。</p>
                      </li>
                      <li>
                        <strong>构建期限阶梯 (Tranche Laddering)</strong>
                        <p>在新西兰市场，通常建议采用“梯队式锁定”法（例如：30% 锁 1 年，50% 锁 2 年，20% 浮动/对冲）。这不仅能合理利用中短期利率折价，还能让您每隔 12 个月都有机会视市场变化灵活展期或清偿本金。</p>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Single-Term Lock Savings Comparison */}
              {selectedStrategy && (
                <div className="glass-panel savings-comparison-section" style={{ marginTop: "24px" }}>
                  <h2 className="section-title" style={{ marginBottom: "12px" }}>💰 期望利息开销对比分析</h2>
                  <p className="text-muted" style={{ fontSize: "12px", marginBottom: "16px" }}>
                    以下是当前选定策略（{renderStrategySplit(selectedStrategy.strategyId)}）与传统**不拆分（100%全额锁定单一固定期限）**方案在 {simulatedMonths} 个月模拟周期内的期望总利息对比：
                  </p>
                  <div className="comparison-grid">
                    {(() => {
                      const allDiffs = getComparisonData();
                      const maxAbs = Math.max(1, ...allDiffs.map((d) => Math.abs(d.diff)));
                      return allDiffs.map((/** @type {any} */ item) => {
                        const isSaving = item.diff > 0;
                        const isCost = item.diff < 0;
                        const widthPct = Math.max(6, (Math.abs(item.diff) / maxAbs) * 100);
                        return (
                          <div key={item.productCode} className="comparison-item-card">
                            <div className="comp-term-name">{item.displayName} (100% 锁定)</div>
                            <div className="comp-term-cost">期望总利息: ${Math.round(item.expectedInterest).toLocaleString()}</div>
                            <div className={`comp-term-diff ${isSaving ? "text-emerald" : isCost ? "text-rose" : "text-secondary"}`}>
                              {isSaving ? `比其节省利息: +$${Math.round(item.diff).toLocaleString()}` : isCost ? `比其多付利息: -$${Math.round(Math.abs(item.diff)).toLocaleString()}` : "利息成本持平"}
                            </div>
                            {(isSaving || isCost) && (
                              <div className="comp-term-bar">
                                <div
                                  className={`comp-term-bar-fill ${isSaving ? "saving" : "cost"}`}
                                  style={{ width: `${widthPct}%` }}
                                />
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}

              {/* Full Exhausted Strategies Table */}
              <section className="glass-panel exhausted-list-section" style={{ marginTop: "24px" }}>
                <h2 className="section-title" style={{ marginBottom: "8px" }}>所有可行拆分组合评估报告</h2>
                <p className="text-muted" style={{ fontSize: "12px", marginBottom: "16px", lineHeight: "1.6" }}>
                  <strong>综合评分</strong>：系统根据您设定的偏好权重对每个方案进行归一化加权评分，分数越低表示综合表现越优。
                  <strong>帕累托最优</strong>：在同等利息成本下还款波动最小、或在同等波动下利息最低的方案，标记为 <strong className="text-emerald">首选</strong>。
                  <strong>被支配方案</strong>：存在另一个方案在各项指标上都不差于它、且至少有一项严格优于它。
                </p>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "12px" }}>
                  <p className="text-muted" style={{ fontSize: "12px", margin: 0, maxWidth: "60%" }}>
                    {showOnlyBestPerMix
                      ? `系统已将所有符合规则的 ${optimisedData.rankedStrategies.length} 组穷举方案，按“不同期限组合 (Split Product Mix)”聚合去重，筛选出各组合中的最优方案（共 ${getBestStrategiesPerMix().length} 组）。`
                      : `下表列出了系统穷举出的所有满足规则配比的房贷拆包组合（共 ${optimisedData.rankedStrategies.length} 组）。`
                    }
                  </p>
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
                      每个组合仅看最优
                    </button>
                    <button
                      type="button"
                      className={`segmented-btn ${!showOnlyBestPerMix ? "active" : ""}`}
                      style={{ padding: "6px 14px", borderRadius: "0 8px 8px 0", fontSize: "11px", height: "32px", display: "flex", alignItems: "center" }}
                      onClick={() => setShowOnlyBestPerMix(false)}
                    >
                      查看全部穷举
                    </button>
                  </div>
                </div>

                {/* Split-count filter pills — stacks on top of the per-mix toggle. */}
                {(() => {
                  const counts = getAvailableSplitCounts();
                  if (counts.length <= 1) return null;
                  return (
                    <div className="count-filter-pills" role="group" aria-label="按拆分笔数过滤">
                      <span className="count-filter-label">拆分笔数</span>
                      <button
                        type="button"
                        className={`count-pill ${splitCountFilter === null ? "active" : ""}`}
                        onClick={() => { setSplitCountFilter(null); setShowAllRows(false); }}
                        aria-pressed={splitCountFilter === null}
                      >
                        全部
                      </button>
                      {counts.map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={`count-pill ${splitCountFilter === n ? "active" : ""}`}
                          onClick={() => { setSplitCountFilter(n); setShowAllRows(false); }}
                          aria-pressed={splitCountFilter === n}
                        >
                          {n} 拆分
                        </button>
                      ))}
                    </div>
                  );
                })()}

                <div className="table-responsive">
                  <table className="exhausted-table">
                    <thead>
                      <tr>
                        <th>排序</th>
                        <th>重新拆分方案结构 (额度与锁定时间)</th>
                        <th>拆分笔数</th>
                        <th>期望总利息</th>
                        <th>期望最高{getRepaymentFrequencyLabel()}</th>
                        <th>期望已还本金</th>
                        <th>期望剩余本金</th>
                        <th>还款波动</th>
                        <th>帕累托前沿?</th>
                        <th>综合评分</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const baseList = showOnlyBestPerMix ? getBestStrategiesPerMix() : optimisedData.rankedStrategies;
                        const displayedList = splitCountFilter === null
                          ? baseList
                          : baseList.filter((/** @type {any} */ s) => getSplitCountForRanked(s) === splitCountFilter);
                        const slicedList = showAllRows ? displayedList : displayedList.slice(0, 10);
                        if (displayedList.length === 0) {
                          return (
                            <tr>
                              <td colSpan={10} className="text-muted" style={{ textAlign: "center", padding: "24px 8px", fontSize: "12px" }}>
                                当前筛选条件下没有匹配的拆分组合,请尝试其它拆分笔数。
                              </td>
                            </tr>
                          );
                        }
                        return slicedList.map((/** @type {any} */ s, /** @type {number} */ idx) => {
                          const isSelected = selectedStrategy?.strategyId === s.strategyId;
                          const principalRepaid = getTotalBalance() - s.expectedEndingBalance;
                          return (
                            <tr
                              key={s.strategyId}
                              className={`table-row ${isSelected ? "selected-row" : ""}`}
                              onClick={() => { setSelectedStrategy(s); setSelectedRecType(null); }}
                              style={{ cursor: "pointer" }}
                            >
                              <td className="font-semibold">{idx + 1}</td>
                              <td className="strategy-structure-cell">
                                {renderStrategySplit(s.strategyId)}
                                {s.isParetoOptimal && (
                                  <span className="pareto-mini-badge">首选</span>
                                )}
                              </td>
                              <td className="font-semibold text-center">{getSplitCountForRanked(s)}</td>
                              <td className="text-emerald">${Math.round(s.expectedInterest).toLocaleString()}</td>
                              <td>${Math.round(s.expectedMaxPayment).toLocaleString()}</td>
                              <td className="text-emerald">${Math.round(principalRepaid).toLocaleString()}</td>
                              <td>${Math.round(s.expectedEndingBalance).toLocaleString()}</td>
                              <td className="text-secondary">±${Math.round(s.expectedPaymentVolatility).toLocaleString()}</td>
                              <td>
                                {s.isParetoOptimal ? (
                                  <span className="badge badge-emerald">帕累托最优</span>
                                ) : (
                                  <span className="text-muted" style={{ fontSize: "11px" }}>被支配方案</span>
                                )}
                              </td>
                              <td className="font-semibold text-primary">{s.score.toFixed(3)}</td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>

                {(() => {
                  const baseList = showOnlyBestPerMix ? getBestStrategiesPerMix() : optimisedData.rankedStrategies;
                  const displayedList = splitCountFilter === null
                    ? baseList
                    : baseList.filter((/** @type {any} */ s) => getSplitCountForRanked(s) === splitCountFilter);
                  if (displayedList.length > 10) {
                    return (
                      <div style={{ textAlign: "center", marginTop: "20px" }}>
                        <button
                          type="button"
                          onClick={() => setShowAllRows(!showAllRows)}
                          className="btn btn-secondary"
                          style={{ padding: "8px 24px", fontSize: "13px" }}
                        >
                          {showAllRows ? "收起，只显示前 10 组组合 ▴" : `展开全部 ${displayedList.length} 组组合 ▾`}
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

        .lab-grid {
          display: grid;
          grid-template-columns: 360px minmax(0, 1fr);
          gap: 24px;
          align-items: start;
        }

        .left-controls-col {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .right-results-col {
          height: auto;
          display: flex;
          flex-direction: column;
          gap: 24px;
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
          align-items: center;
          justify-content: space-between;
          gap: 12px;
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
          gap: 10px;
          flex-shrink: 0;
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
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 20px;
        }

        .rec-card {
          display: flex;
          flex-direction: column;
          gap: 14px;
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
          gap: 8px;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          padding-bottom: 14px;
        }

        .rec-metric.stat-tile {
          padding: 10px 12px;
          gap: 6px;
        }

        .pros-cons {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .pro-con-item {
          font-size: 12px;
          line-height: 1.45;
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 6px 0;
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
          margin-bottom: 4px;
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
          font-size: 9.5px;
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
          gap: 8px;
          padding-top: 8px;
          margin-top: 0;
          border-top: 1px solid rgba(255,255,255,0.05);
        }

        .path-explain-copy {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          color: var(--text-muted);
          font-size: 8.5px;
          line-height: 1.45;
          letter-spacing: 0.005em;
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
          column-gap: 18px;
          row-gap: 3px;
        }

        .path-target-grid div {
          padding: 3px 0;
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
          font-size: 8.5px;
          line-height: 1.4;
          letter-spacing: 0.01em;
          margin: 0;
          min-width: 0;
          padding-bottom: 1px;
          border-bottom: 1px dotted rgba(148, 163, 184, 0.18);
          height: 1em;
          align-self: end;
        }

        .path-target-grid strong {
          color: #f1f5f9;
          font-size: 9.5px;
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
            font-size: 8.5px;
          }
          .path-target-grid strong {
            font-size: 9.5px;
          }
          .recommendation-basis-label {
            font-size: 9.5px;
          }
          .path-explain-copy {
            font-size: 9px;
            line-height: 1.45;
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
