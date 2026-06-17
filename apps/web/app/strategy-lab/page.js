// @ts-nocheck — React UI page; JSDoc strict-mode type checks on dynamic-key
// access (`weights[k]`, `reduce`/`filter` callbacks) are out of scope for
// financial correctness. Financial algorithms live in `packages/*/src/*` and
// are covered by vitest + checkJs on their own files.
"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import Link from "next/link";
import { dbGetAll, dbGet, dbPut } from "../../features/storage.js";
import { nzProfile, nzBetas } from "@mortgage/country-adapters";
import { generateScenarios } from "@mortgage/scenario-engine";
import { generateSplitStrategies } from "@mortgage/strategy-generator";
import { optimizeStrategies } from "@mortgage/optimiser";
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
  const [simDurationYears, setSimDurationYears] = useState(3); // default 3 years (36 months)

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

  // Preference Weights (User Customisable)
  const [weights, setWeights] = useState({
    cost: 45,
    principal: 25,
    refix: 10,
    flex: 10,
    resilience: 5,
    budget: 5
  });
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [showOnlyBestPerMix, setShowOnlyBestPerMix] = useState(true);

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

  // Generated Scenarios
  const [scenarios, setScenarios] = useState(/** @type {any[]} */([]));
  const [chartScenarioPaths, setChartScenarioPaths] = useState(/** @type {any[]} */([]));

  // Simulation Status
  const [simulationRunning, setSimulationRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalSims, setTotalSims] = useState(0);
  const [simResults, setSimResults] = useState(/** @type {any} */(null));
  const [optimisedData, setOptimisedData] = useState(/** @type {any} */(null));
  const [selectedStrategy, setSelectedStrategy] = useState(/** @type {any} */(null));
  const [selectedRecType, setSelectedRecType] = useState(/** @type {string|null} */("preference"));
  const [allStrategies, setAllStrategies] = useState(/** @type {any[]} */([]));
  const [showExhaustedReport, setShowExhaustedReport] = useState(false);
  const [showAllRows, setShowAllRows] = useState(false);
  const [recPreference, setRecPreference] = useState(/** @type {any} */(null));
  const [recLowestCost, setRecLowestCost] = useState(/** @type {any} */(null));
  const [recMostStable, setRecMostStable] = useState(/** @type {any} */(null));

  const simulatedMonths = simResults?.[0]?.timeline?.length || (simDurationYears * 12);

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
        const parsed = await dbGet("savedResults", "last_simulation");
        if (parsed && parsed.results && parsed.strategies) {
          setSimResults(parsed.results);
          setAllStrategies(parsed.strategies);

          if (parsed.params) {
            const p = parsed.params;
            if (p.shortTermChange !== undefined) setShortTermChange(p.shortTermChange);
            if (p.mediumTermDirection !== undefined) setMediumTermDirection(p.mediumTermDirection);
            if (p.changeSpeed !== undefined) setChangeSpeed(p.changeSpeed);
            if (p.uncertainty !== undefined) setUncertainty(p.uncertainty);
            if (p.simDurationYears !== undefined) setSimDurationYears(p.simDurationYears);
            if (p.maxSplits !== undefined) setMaxSplits(p.maxSplits);
            if (p.maxFloatingPercentage !== undefined) setMaxFloatingPercentage(p.maxFloatingPercentage);
            if (p.maxAffordablePayment !== undefined) setMaxAffordablePayment(p.maxAffordablePayment);
            if (p.weights !== undefined) setWeights(p.weights);
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
        uncertainty
      }
    });

    setScenarios(activeScenarios);

    // Prepare scenario paths for SVG chart
    const lowPath = activeScenarios.find((/** @type {any} */ s) => s.id === "low")?.policyRatePath || [];
    const basePath = activeScenarios.find((/** @type {any} */ s) => s.id === "base")?.policyRatePath || [];
    const highPath = activeScenarios.find((/** @type {any} */ s) => s.id === "high")?.policyRatePath || [];

    setChartScenarioPaths([
      { id: "low", name: "低利率情景 (20%)", color: "var(--color-emerald)", points: lowPath.map(p => ({ month: p.month, value: p.rate })) },
      { id: "base", name: "基准情景 (60%)", color: "var(--color-primary)", points: basePath.map(p => ({ month: p.month, value: p.rate })) },
      { id: "high", name: "高利率情景 (20%)", color: "var(--color-rose)", points: highPath.map(p => ({ month: p.month, value: p.rate })) }
    ]);

  }, [shortTermChange, mediumTermDirection, changeSpeed, uncertainty, simDurationYears, marketRates]);

  // Recalculate optimization recommendations when preference weights sliders change (instant recalculation)
  useEffect(() => {
    if (!simResults) return;
    // rankingKey memo (spec 11.3). Skip the optimiser re-run if neither
    // the simulation results nor the weights have changed since the last
    // successful run. The previous result is reused verbatim.
    const newRankingKey = stableStringify({
      scenarios,
      weights,
      simResults: (simResults || []).map((r) => [
        r.strategyId,
        r.scenarioId,
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
    const opt = optimizeStrategies({
      simulationResults: simResults,
      scenarios,
      weights,
      mode: mortgage?.targetMode === "payment" ? "payment" : "term"
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
  }, [weights, simResults]);

  // Start Matrix Simulation using Web Worker
  const handleStartSimulation = () => {
    if (!mortgage) return;

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
        percentageStep: nzProfile.rules.percentageStep,
        minTrancheAmount: nzProfile.rules.minTrancheAmount,
        maxFloatingPercentage: maxFloatingPercentage / 100,
        minFixedPercentage: (100 - maxFloatingPercentage) / 100
      },
      refixRule: { type: "same-term" }
    });

    if (strategies.length === 0) {
      setSimulationRunning(false);
      setError("当前拆分约束下没有可行方案。请提高最大 split 数、放宽浮动比例上限，或检查贷款总额与最小分包金额。");
      return;
    }

    setTotalSims(strategies.length * scenarios.length);
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

    // Setup Web Worker
    if (workerRef.current) {
      workerRef.current.terminate();
    }

    setSimulationRunning(true);
    setProgress(0);

    workerRef.current = new Worker(
      new URL("../../workers/simulation.worker.js", import.meta.url),
      { type: "module" }
    );

    workerRef.current.onmessage = (/** @type {any} */ e) => {
      const msg = e.data;
      if (msg.type === "progress") {
        setProgress(Math.round((msg.completed / msg.total) * 100));
      } else if (msg.type === "success" || msg.type === "cached") {
        if (msg.key) {
          simulationKeyRef.current = msg.key;
        }
        setSimResults(msg.results);
        setSimulationRunning(false);
        // Save simulation results and parameters to IndexedDB "savedResults"
        dbPut("savedResults", {
          id: "last_simulation",
          results: msg.results,
          strategies,
          params: {
            shortTermChange,
            mediumTermDirection,
            changeSpeed,
            uncertainty,
            simDurationYears,
            maxSplits,
            maxFloatingPercentage,
            maxAffordablePayment,
            weights
          }
        }).catch(err => {
          console.error("Failed to save simulation results to IndexedDB", err);
        });
      } else if (msg.type === "error") {
        console.error("Worker error:", msg.error);
        setError("模拟运行失败: " + msg.error);
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
    }
    setSimulationRunning(false);
    setProgress(0);
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

  const renderCardMetrics = (/** @type {string} */ strategyId) => {
    const s = optimisedData?.rankedStrategies.find((/** @type {any} */ x) => x.strategyId === strategyId);
    if (!s) return null;
    const freqLabel = getRepaymentFrequencyLabel();
    const totalBal = getTotalBalance();
    const principalRepaid = totalBal - s.expectedEndingBalance;

    return (
      <div className="rec-metrics">
        <div className="rec-metric stat-tile">
          <span className="stat-tile-lbl">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
            期望利息
          </span>
          <span className="stat-tile-val">${Math.round(s.expectedInterest).toLocaleString()}</span>
        </div>
        <div className="rec-metric stat-tile">
          <span className="stat-tile-lbl">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2v20" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
            最高{freqLabel}
          </span>
          <span className="stat-tile-val text-rose">${Math.round(s.expectedMaxPayment).toLocaleString()}</span>
        </div>
        <div className="rec-metric stat-tile">
          <span className="stat-tile-lbl">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>
            已还本金
          </span>
          <span className="stat-tile-val text-emerald">${Math.round(principalRepaid).toLocaleString()}</span>
        </div>
        <div className="rec-metric stat-tile">
          <span className="stat-tile-lbl">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>
            剩余本金
          </span>
          <span className="stat-tile-val">${Math.round(s.expectedEndingBalance).toLocaleString()}</span>
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

    const baseResult = simResults.find((/** @type {any} */ r) => r.strategyId === selectedStrategy.strategyId && r.scenarioId === "base");
    if (!baseResult || !baseResult.timeline) return null;

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

    const refixEvents = baseResult.refixEvents || [];

    const tranches = strategy.allocations.map((/** @type {any} */ alloc, /** @type {number} */ idx) => {
      const trancheId = `tranche-${idx}-${alloc.productCode}`;
      const prod = nzProfile.products.find((/** @type {any} */ p) => p.code === alloc.productCode);
      const displayName = prod ? prod.displayName : alloc.productCode;
      const initialBalance = alloc.amount;

      let prevBalance = initialBalance;

      const snapshots = snapshotMonths.map((snapshotMonth) => {
        const prevSnapshot = snapshotMonths[snapshotMonths.indexOf(snapshotMonth) - 1] || 0;

        const windowMonths = baseResult.timeline.filter(
          (/** @type {any} */ t) => t.monthIndex > prevSnapshot && t.monthIndex <= snapshotMonth
        );

        const snapshotMonthData = baseResult.timeline.find((/** @type {any} */ t) => t.monthIndex === snapshotMonth)
          || baseResult.timeline[baseResult.timeline.length - 1];
        const trancheAtSnapshot = snapshotMonthData?.tranches?.find((/** @type {any} */ t) => t.id === trancheId);

        const rate = trancheAtSnapshot?.rate ?? 0;
        const balance = trancheAtSnapshot?.closingBalance ?? prevBalance;

        const interestPaid = windowMonths.reduce((/** @type {number} */ sum, /** @type {any} */ mt) => {
          const td = mt.tranches?.find((/** @type {any} */ t) => t.id === trancheId);
          return sum + (td ? td.interest : 0);
        }, 0);

        const scheduledPaid = windowMonths.reduce((/** @type {number} */ sum, /** @type {any} */ mt) => {
          const td = mt.tranches?.find((/** @type {any} */ t) => t.id === trancheId);
          return sum + (td ? td.scheduledPayment : 0);
        }, 0);

        const principalRepaid = scheduledPaid - interestPaid;

        const windowEvents = refixEvents.filter((/** @type {any} */ e) => {
          if (e.trancheId !== trancheId) return false;
          const em = getEventMonth(e.periodIndex);
          return em > prevSnapshot && em <= snapshotMonth;
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
        <h1 className="title">策略仿真实验室</h1>
        <p className="subtitle">模拟不同未来利率情景，智能优化您的贷款拆分方案。</p>
      </header>
      <div className="lab-grid">
        <div className="left-controls-col">
          <section className="glass-panel control-section">
            <h2 className="section-title">1. 未来情景预测参数</h2>
            <div className="form-group">
              <div className="slider-label-row">
                <span className="form-label">未来 12 个月利率变化 (Short Term)</span>
                <span className="slider-value">{(shortTermChange * 100).toFixed(2)}%</span>
              </div>
              <Slider
                min={-0.02}
                max={0.02}
                step={0.0025}
                value={shortTermChange}
                onChange={(e) => setShortTermChange(parseFloat(e.target.value))}
              />
              <div className="slider-range-desc">
                <span>快速降息 (-2.00%)</span>
                <span>不调整</span>
                <span>重新加息 (+2.00%)</span>
              </div>
              <div className="param-explanation">
                新西兰央行（RBNZ）在未来 12 个月内对 OCR 官方贴现率的预测累计变化幅度。第 1 至 12 个月将平滑递变（如考虑了第 6 个月的过渡变化）。
                <div className="param-example">👉 例子：若当前 OCR 为 2.25%，设置为 -2.00%，代表第 12 个月时 OCR 将跌至 0.25%；在第 6 个月时则约跌至 1.25%。</div>
              </div>
            </div>

            <div className="form-group">
              <div className="slider-label-row">
                <span className="form-label">中期利率走向趋势 (Medium Term)</span>
                <span className="slider-value">
                  {mediumTermDirection < -0.1 ? "继续大幅降息" : mediumTermDirection > 0.1 ? "重定价趋升" : "走势平稳"}
                </span>
              </div>
              <Slider
                min={-1.0}
                max={1.0}
                step={0.1}
                value={mediumTermDirection}
                onChange={(e) => setMediumTermDirection(parseFloat(e.target.value))}
              />
              <div className="slider-range-desc">
                <span>继续降息 (-1.0)</span>
                <span>走平</span>
                <span>明显回升 (+1.0)</span>
              </div>
              <div className="param-explanation">
                第 13 至 {simDurationYears * 12} 个月之间，政策利率在宏观周期中的中长期年度走向趋势斜率。1.0 个单位的变动代表利率每年变化 0.50%。
                <div className="param-example">👉 例子：若设置为 -1.0，代表从第 13 个月起，利率每年以 -0.50% 的速度持续下降；设置为 0.0 则保持平稳。</div>
              </div>
            </div>

            <div className="form-group">
              <div className="slider-label-row">
                <span className="form-label">政策调整速度 (Speed)</span>
                <span className="slider-value">{(changeSpeed * 100).toFixed(0)}%</span>
              </div>
              <Slider
                min={0.0}
                max={1.0}
                step={0.05}
                value={changeSpeed}
                onChange={(e) => setChangeSpeed(parseFloat(e.target.value))}
              />
              <div className="slider-range-desc">
                <span>缓慢延迟 (0.0)</span>
                <span>均衡</span>
                <span>瞬时调整 (1.0)</span>
              </div>
              <div className="param-explanation">
                利率变动在未来 12 个月内发生的时间分布曲线（即变动的发生速度分布）。
                <div className="param-example">👉 例子：100% 代表变动瞬间集中在第 1 个月发生（极快发生）；50% 代表 12 个月内线性均匀递变；0% 代表前期变动缓慢、在临近第 12 个月时才加速发生。</div>
              </div>
            </div>

            <div className="form-group">
              <div className="slider-label-row">
                <span className="form-label">预测路径不确定性 (Uncertainty)</span>
                <span className="slider-value">+/- {(uncertainty * 100).toFixed(2)}%</span>
              </div>
              <Slider
                min={0.0}
                max={0.02}
                step={0.001}
                value={uncertainty}
                onChange={(e) => setUncertainty(parseFloat(e.target.value))}
              />
              <div className="slider-range-desc">
                <span>较低 (0.0%)</span>
                <span>标准</span>
                <span>较高 (+/- 2.0%)</span>
              </div>
              <div className="param-explanation">
                未来利率预测路径的发散发散广度。不确定性随时间推移逐渐发散增加（第 3 个月生效 25%，第 6 个月生效 50%，第 12 个月后生效 100%）。
                <div className="param-example">👉 例子：若设置为 +/- 1.00%，代表在第 12 个月及以后，“高利率情景”会在基准路径基础上上浮 1.00%，“低利率情景”则下浮 1.00%，用于概率加权承压测试。</div>
              </div>
            </div>

            <div className="form-group" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "16px", marginTop: "16px" }}>
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
          </section>

          {/* Split Constraints */}
          <section className="glass-panel control-section">
            <h2 className="section-title">2. 拆分约束参数</h2>

            <div className="form-group">
              <div className="slider-label-row">
                <span className="form-label">最大 Split / Tranche 数</span>
                <span className="slider-value">{maxSplits} 个</span>
              </div>
              <div className="segmented-control">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`segmented-btn ${maxSplits === n ? "active" : ""}`}
                    onClick={() => setMaxSplits(n)}
                  >
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
                <span className="form-label">浮动/Offset 最高占比</span>
                <span className="slider-value">{maxFloatingPercentage}%</span>
              </div>
              <Slider
                min={0}
                max={80}
                step={10}
                value={maxFloatingPercentage}
                onChange={(e) => setMaxFloatingPercentage(parseInt(e.target.value))}
              />
              <div className="slider-range-desc">
                <span>全固定</span>
                <span>保守浮动</span>
                <span>高灵活性</span>
              </div>
              <div className="param-explanation">
                限制贷款中浮动利率（Floating/Offset/Revolving）部分的最高额度占比。该参数会同时约束最低固定比例为 {100 - maxFloatingPercentage}%。
                <div className="param-example">👉 例子：若拉到 10%（系统默认），代表贷款中最多只能有 10% 采用浮动利率，其余 90% 必须锁死在固定期限上。设为 0% 则代表 100% 全固定。</div>
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
                您每期可承受的最大还款金额上限。用于统计极端高利息情景下的“预算超限次数”，并参与帕累托防风险筛选。
                <div className="param-example">👉 例子：若设定为 5000 且还款频率为双周，在某高息周期下若双周供款达到 5200，系统会记录 1 次超限，并在“综合评分”中予以扣分惩罚。</div>
              </div>
            </div>
          </section>

          {/* Scenario Rates Chart */}
          <section className="glass-panel chart-section accent-cyan">
            <h2 className="section-title"><span className="step-num">3</span>OCR 预测情景曲线</h2>
            <div style={{ marginTop: "16px" }}>
              <SvgChart data={chartScenarioPaths} yAxisType="rate" height={220} />
            </div>
          </section>
        </div>

        {/* Right Column: Results & Recommendations */}
        <div className="right-results-col">

          {/* Run Button & Progress panel */}
          <section className="glass-panel run-section accent-emerald">
            <h2 className="section-title"><span className="step-num">4</span>策略仿真模拟</h2>
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
                  <span></span>
                </div>
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
              <>
                {!simulationRunning && (
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

                {/* Advanced Settings (Weight Preferences Sliders) */}
                <section className="glass-panel advanced-settings-section" style={{ padding: "0", overflow: "hidden", marginTop: "24px" }}>
                  <button
                    type="button"
                    onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                    className="advanced-toggle-header"
                    style={{
                      width: "100%",
                      background: "none",
                      border: "none",
                      padding: "16px 20px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      color: "#fff",
                      cursor: "pointer",
                      fontFamily: "var(--font-heading)",
                      fontSize: "14px",
                      fontWeight: "700",
                      textAlign: "left"
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      ⚙️ 高级设置 (个人还款偏好微调)
                    </span>
                    <span style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                      {showAdvancedSettings ? "收起 ▴" : "展开 ▾"}
                    </span>
                  </button>

                  {showAdvancedSettings && (
                    <div className="advanced-content" style={{ padding: "0 20px 20px", borderTop: "1px solid rgba(255, 255, 255, 0.05)" }}>
                      <p className="text-muted" style={{ fontSize: "11px", margin: "12px 0 16px", lineHeight: "1.5" }}>
                        自定义以下 6 项指标的权重比。<strong>所有权重之和锁定为 100%</strong>。当您拖动任意滑块增加其比例时，其他滑块将等比例自动减少，反之亦然。
                      </p>

                      {[
                        {
                          key: "cost",
                          label: "利息成本 (Interest Cost)",
                          value: weights.cost,
                          minText: "成本低优先",
                          maxText: "忽略成本",
                          explanation: `在综合评分中，提高此项权重会让系统优先选择“期望总利息支出”更低的拆分方案（短期锁定或浮动占比更高的方案在降息通道下通常利息更低）。`,
                          example: `👉 例子：拉到 70% 时，系统会在三个情景的期望利息加权后，极力压制总利息偏离最优值，即使这意味着还款波动或到期集中度有所上升。`
                        },
                        {
                          key: "principal",
                          label: "本金还款速度 (Principal Paydown)",
                          value: weights.principal,
                          minText: "慢速还本",
                          maxText: "快速还本优先",
                          explanation: `在综合评分中，提高此项权重会让系统优先选择“模拟期末剩余本金”更低的方案，即在 ${simDurationYears} 年（${simDurationYears * 12} 个月）模拟窗口内消减最多本金。`,
                          example: `👉 例子：拉到 60% 时，会倾向于将资金分配给本息比更高的较短期固定或浮动部分（每月摊还本金更多），以加速本金回收。`
                        },
                        {
                          key: "refix",
                          label: "利率重定价风险 (Refix Risk)",
                          value: weights.refix,
                          minText: "忽略风险",
                          maxText: "分散到期优先",
                          explanation: `在综合评分中，提高此项权重会让系统优先选择“单月最大同时到期余额比例”更低的方案，即错开各 Tranche 的到期月份，避免多笔贷款集中在同一个月重定价而被同一波高利率冲击。`,
                          example: `👉 例子：拉到 50% 时，会更倾向于分散成 1 年 / 2 年 / 3 年混合锁定，而非把 90% 贷款压在同一固定期限上。`
                        },
                        {
                          key: "flex",
                          label: "资金流灵活性 (Floating Flex)",
                          value: weights.flex,
                          minText: "不重要",
                          maxText: "高比例浮动优先",
                          explanation: `在综合评分中，提高此项权重会让系统优先选择“浮动/Offset 占比”更高的方案，便于您随时进行大额提前还款或利用 Offset 账户抵消利息。`,
                          example: `👉 例子：拉到 40% 时，会把上方“拆分约束参数”中设定的浮动占比上限尽量用满，在该范围内寻找其它指标仍较优的方案。`
                        },
                        {
                          key: "resilience",
                          label: "极端高息抗压性 (Stress Resistance)",
                          value: weights.resilience,
                          minText: "不考虑极端",
                          maxText: "低最高供款优先",
                          explanation: `在综合评分中，提高此项权重会让系统优先选择“高利率情景下的峰值供款”更低的方案，即在最坏情况下也保持${getRepaymentFrequencyLabel()}可控。`,
                          example: `👉 例子：拉到 50% 时，会优先把大部分贷款锁在长期固定（3-5 年）上，即使期望利息可能略高，但能压制极端情景下的供款峰值。`
                        },
                        {
                          key: "budget",
                          label: "预算超限控制 (Budget Safety)",
                          value: weights.budget,
                          minText: "不考虑预算",
                          maxText: "少超预算优先",
                          explanation: `在综合评分中，提高此项权重会让系统优先选择“模拟期内每期供款超过您设定预算”的次数更少的方案（每期预算上限在“2. 拆分约束参数”中设置）。`,
                          example: `👉 例子：若预算设为 $5000，拉到 30% 时，会尽量让所有情景下的每期还款都贴近该上限，宁可牺牲一些其它指标也要减少超限次数。`
                        }
                      ].map((w) => {
                        return (
                          <div key={w.key} className="form-group" style={{ marginBottom: "14px" }}>
                            <div className="slider-label-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span className="form-label" style={{ fontSize: "12px", fontWeight: "600" }}>{w.label}</span>
                              <span className="slider-value font-semibold" style={{ color: "#60a5fa", fontSize: "13px" }}>权重: {w.value}%</span>
                            </div>
                            <Slider
                              min={0}
                              max={100}
                              step={1}
                              value={w.value}
                              onChange={(e) => handleWeightChange(w.key, parseInt(e.target.value, 10))}
                              style={{ width: "100%", marginTop: "4px" }}
                            />
                            <div className="slider-range-desc" style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--text-muted)", marginTop: "2px" }}>
                              <span>{w.minText}</span>
                              <span>{w.maxText}</span>
                            </div>
                            <div className="param-explanation">
                              {w.explanation}
                              <div className="param-example">{w.example}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </>
            )}
          </section>

          {/* Recommendations Cards */}
          {optimisedData && (
            <section className="recommendations-section accent-amber">
              <h2 className="section-title"><span className="step-num">5</span>三大推荐拆分方案对比</h2>
              <p className="text-muted" style={{ fontSize: "12px", marginBottom: "16px", lineHeight: "1.6" }}>
                系统基于您设置的最大 split 数、浮动占比、预算上限、未来情景预测和还款偏好，筛选出当前最优贷款 split。{maxSplits > 1 ? "推荐会优先展示真正拆分为多笔 tranche 的方案。" : "当前设置为 1 个 split，因此只比较单一期限锁定方案。"}<strong>点击下方推荐卡片可快速将其设为当前对比策略。</strong>
              </p>

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

              {(() => {
                const baseResult = simResults?.find((r) => r.strategyId === selectedStrategy.strategyId && r.scenarioId === "base");
                const baseInterest = baseResult ? baseResult.totalInterest : selectedStrategy.expectedInterest;
                const baseMaxPayment = baseResult ? baseResult.maximumPayment : selectedStrategy.expectedMaxPayment;
                const baseEndingBalance = baseResult ? baseResult.endingBalance : selectedStrategy.expectedEndingBalance;
                const basePrincipalRepaid = getTotalBalance() - baseEndingBalance;
                const freqLabel = getRepaymentFrequencyLabel();

                return (
                  <div className="glass-panel" style={{ background: "rgba(255,255,255,0.01)", padding: "16px", borderRadius: "8px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "16px", marginBottom: "20px" }}>
                    <div>
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>基准总利息</div>
                      <div style={{ fontSize: "18px", fontWeight: "600", color: "var(--color-primary-light, #60a5fa)" }}>${Math.round(baseInterest).toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>基准最高{freqLabel}</div>
                      <div style={{ fontSize: "18px", fontWeight: "600", color: "var(--color-rose)" }}>${Math.round(baseMaxPayment).toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>基准已还本金</div>
                      <div style={{ fontSize: "18px", fontWeight: "600", color: "var(--color-emerald)" }}>${Math.round(basePrincipalRepaid).toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>基准剩余本金</div>
                      <div style={{ fontSize: "18px", fontWeight: "600", color: "var(--text-primary)" }}>${Math.round(baseEndingBalance).toLocaleString()}</div>
                    </div>
                  </div>
                );
              })()}

              <div style={{ marginTop: "12px" }}>
                <SvgChart
                  data={[
                    {
                      id: "balance-path",
                      name: "基准本金总余额",
                      color: "var(--color-primary)",
                      points: simResults
                        .filter((/** @type {any} */ r) => r.strategyId === selectedStrategy.strategyId && r.scenarioId === "base")
                        .flatMap((/** @type {any} */ r) => r.timeline.map((/** @type {any} */ t) => ({ month: t.monthIndex, value: t.closingBalance })))
                    }
                  ]}
                  yAxisType="currency"
                  height={200}
                />
              </div>

              {/* Detailed per-tranche timeline table */}
              {(() => {
                const detailData = buildDetailTimelineData();
                if (!detailData || detailData.tranches.length === 0) return null;

                const { snapshotMonths, tranches } = detailData;

                const formatMonthLabel = (/** @type {number} */ m) => {
                  const y = Math.floor(m / 12);
                  const mo = m % 12;
                  if (mo === 0) return `Y${y}m0`;
                  return `Y${y}m${mo}`;
                };

                const formatMoney = (/** @type {number} */ v) => `$${Math.round(v).toLocaleString()}`;

                const allPaidOff = (/** @type {any} */ t) =>
                  t.snapshots.every((/** @type {any} */ s) => s.balance <= 0);

                return (
                  <div style={{ marginTop: "24px", overflowX: "auto" }}>
                    <h3 style={{ fontSize: "14px", fontWeight: "700", color: "#fff", marginBottom: "12px" }}>
                      {simulatedMonths}个月逐笔分片明细时间线
                    </h3>
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "12px", lineHeight: "1.5" }}>
                      下表以每6个月为间隔，展示每笔贷款分片（Tranche）在该6个月窗口内的利率、续约事件、利息支出、本金偿还和剩余本金。利率为窗口末点的即时利率；利息与本金为该窗口内的累计值。
                    </div>

                    <table className="detail-timeline-table">
                      <thead>
                        <tr>
                          <th className="dtl-loan-header">贷款分片</th>
                          <th className="dtl-item-header">明细项</th>
                          {snapshotMonths.map((/** @type {number} */ m) => (
                            <th key={m} className="dtl-col-header">{formatMonthLabel(m)}</th>
                          ))}
                          <th className="dtl-col-header" style={{ color: "#34d399", fontWeight: "700" }}>期末/累积总计</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tranches.map((/** @type {any} */ tranche) => {
                          if (allPaidOff(tranche)) return null;
                          const rows = [
                            { label: "利率", key: "rate", render: (/** @type {any} */ s) => s.rate > 0 ? `${(s.rate * 100).toFixed(2)}%` : "—" },
                            { label: "续约事件", key: "events", render: (/** @type {any} */ s) => s.events.length > 0 ? s.events.join("；") : "—" },
                            { label: "已付利息", key: "interestPaid", render: (/** @type {any} */ s) => formatMoney(s.interestPaid) },
                            { label: "已还本金", key: "principalRepaid", render: (/** @type {any} */ s) => formatMoney(s.principalRepaid) },
                            { label: "本金余额", key: "balance", render: (/** @type {any} */ s) => formatMoney(s.balance) }
                          ];
                          return rows.map((row, ri) => (
                            <tr key={`${tranche.trancheId}-${row.key}`} className={ri === 0 ? "dtl-first-row" : ""}>
                              {ri === 0 && (
                                <td className="dtl-loan-cell" rowSpan={rows.length}>
                                  <div style={{ fontWeight: "600", color: "#fff" }}>{tranche.displayName}</div>
                                  <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>${tranche.initialBalance.toLocaleString()}</div>
                                </td>
                              )}
                              <td className="dtl-item-cell">{row.label}</td>
                              {tranche.snapshots.map((/** @type {any} */ s) => (
                                <td key={s.month} className="dtl-val-cell">{row.render(s)}</td>
                              ))}
                              {/* Accumulated Cell */}
                              <td className="dtl-val-cell" style={{ fontWeight: "600", color: "#34d399" }}>
                                {(() => {
                                  if (row.key === "rate" || row.key === "events") return "—";
                                  if (row.key === "interestPaid") {
                                    const sum = tranche.snapshots.reduce((acc, s) => acc + s.interestPaid, 0);
                                    return formatMoney(sum);
                                  }
                                  if (row.key === "principalRepaid") {
                                    const sum = tranche.snapshots.reduce((acc, s) => acc + s.principalRepaid, 0);
                                    return formatMoney(sum);
                                  }
                                  if (row.key === "balance") {
                                    const lastBal = tranche.snapshots[tranche.snapshots.length - 1].balance;
                                    return formatMoney(lastBal);
                                  }
                                  return "—";
                                })()}
                              </td>
                            </tr>
                          ));
                        })}
                      </tbody>
                      <tfoot>
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

                          return footRows.map((fr, ri) => (
                            <tr key={`foot-${ri}`} className="dtl-foot-row">
                              {ri === 0 ? (
                                <td className="dtl-loan-cell" rowSpan={footRows.length} style={{ fontWeight: "700", color: "#fff" }}>所有分片合计</td>
                              ) : null}
                              <td className="dtl-item-cell" style={{ fontWeight: "600" }}>{fr.label}</td>
                              {totals.map((t, i) => (
                                <td key={i} className="dtl-val-cell" style={{ fontWeight: "700", color: "var(--color-primary)" }}>{fr.render(t)}</td>
                              ))}
                              <td className="dtl-val-cell" style={{ fontWeight: "800", color: "#34d399" }}>{fr.accumValue}</td>
                            </tr>
                          ));
                        })()}
                      </tfoot>
                    </table>
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
                <h2 className="section-title" style={{ marginBottom: "16px" }}>所有可行拆分组合评估报告</h2>

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

                <div className="table-responsive">
                  <table className="exhausted-table">
                    <thead>
                      <tr>
                        <th>排序</th>
                        <th>重新拆分方案结构 (额度与锁定时间)</th>
                        <th>期望总利息</th>
                        <th>最高{getRepaymentFrequencyLabel()}</th>
                        <th>已还本金</th>
                        <th>剩余本金</th>
                        <th>还款波动</th>
                        <th>帕累托前沿?</th>
                        <th>综合评分</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const displayedList = showOnlyBestPerMix ? getBestStrategiesPerMix() : optimisedData.rankedStrategies;
                        const slicedList = showAllRows ? displayedList : displayedList.slice(0, 10);
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
                  const displayedList = showOnlyBestPerMix ? getBestStrategiesPerMix() : optimisedData.rankedStrategies;
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
          font-size: 12px;
          color: var(--text-secondary);
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

        @media (max-width: 992px) {
          .lab-grid {
            grid-template-columns: minmax(0, 1fr);
          }
          .pro-advice-grid {
            grid-template-columns: 1fr;
            gap: 16px;
          }
        }

        @media (max-width: 768px) {
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
        }
      `}</style>
    </div>
  );
}
