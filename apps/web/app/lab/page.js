// @ts-nocheck — React UI page; see apps/web/app/strategy-lab/page.js for the
// @ts-nocheck rationale (JSDoc strict mode is too strict for dynamic-key access
// patterns this page uses; financial correctness is owned by packages/*/src/*).
"use client";

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { nzProfile, nzBetas } from "@mortgage/country-adapters";
import { generateScenarios } from "@mortgage/scenario-engine";
import { generateSplitStrategies } from "@mortgage/strategy-generator";
import { optimizeStrategies } from "@mortgage/optimiser";
import { simulateStrategyScenario } from "@mortgage/simulation-engine";
import SvgChart from "../../components/SvgChart.js";
import StrategyDetailModal from "../../components/StrategyDetailModal.js";
import { NumberInput, SimulationProgressModal } from "../../components/index.js";
import { useI18n } from "../../lib/i18n/useI18n.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FORM_STORAGE_KEY = "ratepath_lab_form_v1";

const DEFAULT_MARKET_RATES = {
  ocr: 0.0225,
  floating: 0.0579,
  "fixed-6m": 0.0449,
  "fixed-1y": 0.0465,
  "fixed-18m": 0.0495,
  "fixed-2y": 0.0525,
  "fixed-3y": 0.0549,
  "fixed-5y": 0.0589
};

const DEFAULT_FORECAST_YEARS = 5;
const FORECAST_YEARS_MIN = 3;
const FORECAST_YEARS_MAX = 10;

const SHORT_TO_DELTA = {
  "fall-strong": -0.02,
  "fall":        -0.005,
  "rise":        +0.005,
  "rise-strong": +0.02
};

const UNCERTAINTY_TO_DELTA = {
  low:    0.003,
  medium: 0.010,
  high:   0.020
};

const STEPS = ["welcome", "q1", "q2", "q3", "q4", "q5", "q6", "ocr", "results"];
const QUESTION_STEPS = ["q1", "q2", "q3", "q4", "q5", "q6"];

const PORTFOLIO_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#f43f5e", "#06b6d4", "#8b5cf6", "#ec4899"];

function formatAllocationPct(value) {
  const pct = Number(value);
  if (!Number.isFinite(pct)) return "0%";
  return `${Math.round(pct * 100)}%`;
}

function clampForecastYears(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return DEFAULT_FORECAST_YEARS;
  const num = Math.round(raw);
  return Math.max(FORECAST_YEARS_MIN, Math.min(FORECAST_YEARS_MAX, num));
}

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

function deriveMediumDirection(shortOutlook, mediumOutlook) {
  if (!shortOutlook || !mediumOutlook) return 0;
  const tier = shortOutlook.endsWith("strong") ? 1 : 0;
  const rise = shortOutlook.startsWith("rise");
  const mag = mediumOutlook === "continue" ? 1.0 : 0.4;
  const baseMag = tier === 1 ? 1.0 : 0.6;
  return rise ? baseMag * mag : -baseMag * mag;
}

function deriveRiskScore(shortOutlook, mediumOutlook, uncertainty) {
  let score = 0;
  if (shortOutlook?.endsWith("strong")) score += 2;
  else if (shortOutlook) score += 1;
  if (mediumOutlook === "continue") score += 1;
  if (uncertainty === "high") score += 2;
  else if (uncertainty === "low") score -= 1;
  return score;
}

function derivePreferenceWeights(shortOutlook, mediumOutlook, uncertainty) {
  const score = deriveRiskScore(shortOutlook, mediumOutlook, uncertainty);
  if (score >= 4) return { cost: 10, refix: 25, flex: 5, balance: 15, worstCaseDefense: 45 };
  if (score >= 2) return { cost: 15, refix: 22, flex: 10, balance: 18, worstCaseDefense: 35 };
  if (score >= 0) return { cost: 18, refix: 17, flex: 17, balance: 18, worstCaseDefense: 30 };
  return { cost: 30, refix: 15, flex: 20, balance: 15, worstCaseDefense: 20 };
}

const PREFERENCE_KEYS = ["cost", "refix", "flex", "balance", "worstCaseDefense"];

function normalizePreferenceWeights(input) {
  const raw = {};
  PREFERENCE_KEYS.forEach((k) => {
    const v = Number(input?.[k]);
    raw[k] = Number.isFinite(v) ? Math.max(0, Math.min(35, Math.round(v))) : 0;
  });
  const total = PREFERENCE_KEYS.reduce((s, k) => s + raw[k], 0);
  if (total === 100) return raw;
  if (total <= 0) return { cost: 18, refix: 17, flex: 17, balance: 18, worstCaseDefense: 30 };
  const next = {};
  let allocated = 0;
  PREFERENCE_KEYS.forEach((k, idx) => {
    if (idx === PREFERENCE_KEYS.length - 1) {
      next[k] = Math.max(0, 100 - allocated);
    } else {
      next[k] = Math.round((raw[k] / total) * 100);
      allocated += next[k];
    }
  });
  const newTotal = PREFERENCE_KEYS.reduce((s, k) => s + next[k], 0);
  if (newTotal !== 100) next[PREFERENCE_KEYS[0]] += 100 - newTotal;
  return next;
}

function estimateMonthlyPayment(principal, annualRate, termYears) {
  if (!principal || principal <= 0) return 0;
  const r = (annualRate || 0.0579) / 12;
  const n = (termYears || 25) * 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

function defaultPaymentForAmount(amount, frequency, annualRate) {
  const monthly = estimateMonthlyPayment(amount, annualRate || 0.0579, 25);
  // Use the same divisor as the engine's getPeriodsPerYear (52 / 26 / 12),
  // so the suggested per-period payment matches what simulateMortgageTimeline
  // would amortise at.
  if (frequency === "weekly") return Math.round((monthly * 12) / 52);
  if (frequency === "fortnightly") return Math.round((monthly * 12) / 26);
  return Math.round(monthly);
}

function buildMortgageFromAnswers(answers, marketRates) {
  const months = answers.targetMode === "term" ? answers.targetYears * 12 : 360;
  return {
    id: "lab-mortgage-v1",
    name: "Lab loan",
    countryCode: "NZ",
    currencyCode: "NZD",
    originalTermMonths: months,
    remainingTermMonths: months,
    repaymentFrequency: answers.repaymentFrequency,
    targetMode: answers.targetMode,
    targetPeriodicPayment: answers.targetMode === "payment" ? answers.targetPayment : undefined,
    repaymentType: "principal-and-interest",
    tranches: [
      {
        id: "tranche-floating",
        productCode: "floating",
        balance: answers.loanAmount,
        annualRate: marketRates.floating,
        fixedUntil: null,
        remainingTermMonths: months,
        repaymentType: "principal-and-interest",
        linkedOffsetBalance: 0
      }
    ],
    extraRepayments: []
  };
}

function buildConstraints() {
  return {
    maxSplits: nzProfile.rules.maxSplits,
    minPercentage: nzProfile.rules.minPercentage,
    // Use the country adapter's percentageStep directly — finer grid = richer candidate set.
    percentageStep: nzProfile.rules.percentageStep,
    minTrancheAmount: nzProfile.rules.minTrancheAmount,
    // No hard cap on floating; let the optimiser/Pareto frontier rank naturally.
    // (The strategy generator's PR-1 still prunes infeasible splits.)
    maxFloatingPercentage: 1.0,
    mustKeepFloating: false
  };
}

function riskBucket(riskScore) {
  if (riskScore >= 2) return "riskAverse";
  if (riskScore >= 0) return "neutral";
  return "riskSeeking";
}

function readSavedForm() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(FORM_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSavedForm(state) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota / privacy-mode errors
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LabPage() {
  const { t, formatMoney: formatMoneyCtx, productDisplayName } = useI18n();
  const formatMoney = formatMoneyCtx;

  // ---- Form state ---------------------------------------------------------
  const [step, setStep] = useState("welcome");

  // ---- Lifecycle state ----------------------------------------------------
  const [phase, setPhase] = useState("form"); // "form" | "running" | "success" | "cached" | "error"
  const [progress, setProgress] = useState(0);
  const [completedSims, setCompletedSims] = useState(0);
  const [totalSims, setTotalSims] = useState(0);
  const [simProgressInfo, setSimProgressInfo] = useState(null);
  const [simError, setSimError] = useState(null);
  const [error, setError] = useState(null);
  const [mortgage, setMortgage] = useState(null);
  const [allStrategies, setAllStrategies] = useState([]);
  const [simResults, setSimResults] = useState(null);
  const [optimisedData, setOptimisedData] = useState(null);

  // ---- Modal state --------------------------------------------------------
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailModalStrategyId, setDetailModalStrategyId] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTimelineData, setDetailTimelineData] = useState(null);
  const [premiumPopupOpen, setPremiumPopupOpen] = useState(false);
  const triggerBtnRef = useRef(null);
  const upgradeBtnRef = useRef(null);

  const workerRef = useRef(null);

  // ---- Market rates (localStorage + default fallback) ---------------------
  const [marketRates] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_MARKET_RATES;
    try {
      const raw = window.localStorage.getItem("ratepath_custom_market_rates");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return { ...DEFAULT_MARKET_RATES, ...parsed };
      }
    } catch {
      // fall through
    }
    return DEFAULT_MARKET_RATES;
  });

  // ---- Form state initialised from localStorage in one pass --------------
  const initialForm = useMemo(() => {
    const saved = readSavedForm();
    const out = {
      loanAmount: 600000,
      targetMode: "term",
      targetYears: 25,
      targetPayment: 0,
      repaymentFrequency: "fortnightly",
      shortOutlook: null,
      mediumOutlook: null,
      uncertainty: null,
      forecastYears: DEFAULT_FORECAST_YEARS
    };
    if (!saved || typeof saved !== "object") {
      out.targetPayment = defaultPaymentForAmount(out.loanAmount, out.repaymentFrequency);
      return out;
    }
    if (typeof saved.loanAmount === "number") out.loanAmount = saved.loanAmount;
    if (saved.targetMode === "term" || saved.targetMode === "payment") out.targetMode = saved.targetMode;
    if (typeof saved.targetYears === "number") out.targetYears = saved.targetYears;
    if (typeof saved.targetPayment === "number") out.targetPayment = saved.targetPayment;
    else out.targetPayment = defaultPaymentForAmount(out.loanAmount, out.repaymentFrequency);
    if (saved.repaymentFrequency) out.repaymentFrequency = saved.repaymentFrequency;
    if (saved.shortOutlook) out.shortOutlook = saved.shortOutlook;
    if (saved.mediumOutlook) out.mediumOutlook = saved.mediumOutlook;
    if (saved.uncertainty) out.uncertainty = saved.uncertainty;
    if (saved.forecastYears !== null && saved.forecastYears !== undefined) out.forecastYears = clampForecastYears(saved.forecastYears);
    return out;
  }, []);

  const [loanAmount, setLoanAmount] = useState(initialForm.loanAmount);
  const [targetMode, setTargetMode] = useState(initialForm.targetMode);
  const [targetYears, setTargetYears] = useState(initialForm.targetYears);
  const [targetPayment, setTargetPayment] = useState(initialForm.targetPayment);
  const [repaymentFrequency, setRepaymentFrequency] = useState(initialForm.repaymentFrequency);
  const [shortOutlook, setShortOutlook] = useState(initialForm.shortOutlook);
  const [mediumOutlook, setMediumOutlook] = useState(initialForm.mediumOutlook);
  const [uncertainty, setUncertainty] = useState(initialForm.uncertainty);
  const [forecastYears, setForecastYears] = useState(initialForm.forecastYears);
  const normalizedForecastYears = clampForecastYears(forecastYears);
  const forecastMonths = normalizedForecastYears * 12;

  // ---- Persist form on change (debounced) --------------------------------
  useEffect(() => {
    const handle = setTimeout(() => {
      writeSavedForm({
        loanAmount, targetMode, targetYears, targetPayment, repaymentFrequency,
        shortOutlook, mediumOutlook, uncertainty,
        forecastYears: Number.isFinite(forecastYears) ? forecastYears : null
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [loanAmount, targetMode, targetYears, targetPayment, repaymentFrequency,
      shortOutlook, mediumOutlook, uncertainty, forecastYears]);

  // ---- Premium popup: Escape to close + body scroll lock ------------------
  const closePremiumPopup = useCallback(() => {
    setPremiumPopupOpen(false);
    setTimeout(() => { if (upgradeBtnRef.current) upgradeBtnRef.current.focus(); }, 0);
  }, []);

  useEffect(() => {
    if (!premiumPopupOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") closePremiumPopup();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [premiumPopupOpen, closePremiumPopup]);

  // ---- Derived: scenarios (live OCR chart) -------------------------------
  const scenarios = useMemo(() => {
    if (!shortOutlook || !mediumOutlook || !uncertainty) return null;
    try {
      return generateScenarios({
        initialRate: marketRates.ocr,
        currentProductRates: marketRates,
        betas: nzBetas,
        products: nzProfile.products,
        forecastMonths,
        controls: {
          shortTermChange: SHORT_TO_DELTA[shortOutlook],
          mediumTermDirection: deriveMediumDirection(shortOutlook, mediumOutlook),
          changeSpeed: 0.5,
          uncertainty: UNCERTAINTY_TO_DELTA[uncertainty],
          scenarioProbabilities: { low: 0.15, base: 0.7, high: 0.15 },
          longTermCycleYears: 2,
          longTermReversalBias: 0.7,
          monteCarloSampleCount: 1
        }
      });
    } catch (err) {
      console.warn("lab: generateScenarios failed", err);
      return null;
    }
  }, [shortOutlook, mediumOutlook, uncertainty, marketRates, forecastMonths]);

  // ---- Navigation ---------------------------------------------------------
  const goNext = useCallback(() => {
    setStep((s) => {
      const idx = STEPS.indexOf(s);
      return STEPS[Math.min(idx + 1, STEPS.length - 1)];
    });
  }, []);

  const goBack = useCallback(() => {
    setStep((s) => {
      const idx = STEPS.indexOf(s);
      return STEPS[Math.max(idx - 1, 0)];
    });
  }, []);

  const goTo = useCallback((target) => {
    if (STEPS.includes(target)) setStep(target);
  }, []);

  const resetAll = useCallback(() => {
    setStep("welcome");
    setLoanAmount(600000);
    setTargetMode("term");
    setTargetYears(25);
    setTargetPayment(defaultPaymentForAmount(600000, "fortnightly", marketRates.floating));
    setRepaymentFrequency("fortnightly");
    setShortOutlook(null);
    setMediumOutlook(null);
    setUncertainty(null);
    setForecastYears(DEFAULT_FORECAST_YEARS);
    setError(null);
    setSimResults(null);
    setOptimisedData(null);
    setAllStrategies([]);
    setMortgage(null);
    setPhase("form");
    setProgress(0);
    setCompletedSims(0);
    setTotalSims(0);
    setSimProgressInfo(null);
    setSimError(null);
    if (typeof window !== "undefined") window.localStorage.removeItem(FORM_STORAGE_KEY);
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
  }, [marketRates.floating]);

  // ---- Validation per step -----------------------------------------------
  const canAdvance = useMemo(() => {
    switch (step) {
      case "welcome": return true;
      case "q1": return loanAmount >= 1000;
      case "q2":
        if (targetMode === "term") return targetYears >= 1 && targetYears <= 40;
        return targetPayment > 0;
      case "q3": return !!shortOutlook;
      case "q4": return !!mediumOutlook;
      case "q5": return !!uncertainty;
      case "q6": return forecastYears >= FORECAST_YEARS_MIN && forecastYears <= FORECAST_YEARS_MAX;
      case "ocr": return !!scenarios;
      default: return true;
    }
  }, [step, loanAmount, targetMode, targetYears, targetPayment, shortOutlook, mediumOutlook, uncertainty, forecastYears, scenarios]);

  // ---- Run simulation -----------------------------------------------------
  const startSimulation = useCallback(() => {
    setError(null);
    const m = buildMortgageFromAnswers(
      { loanAmount, targetMode, targetYears, targetPayment, repaymentFrequency },
      marketRates
    );
    setMortgage(m);

    let strategies;
    try {
      strategies = generateSplitStrategies({
        totalAmount: loanAmount,
        allowedProducts: nzProfile.products.map((p) => ({ code: p.code, type: p.type })),
        constraints: buildConstraints(),
        refixRule: { type: "same-term" }
      });
    } catch (err) {
      setError(t("lab.error.sim"));
      console.warn("lab: generateSplitStrategies failed", err);
      return;
    }
    setAllStrategies(strategies);

    if (!scenarios || strategies.length === 0) {
      setError(t("lab.error.sim"));
      return;
    }

    setPhase("running");
    setTotalSims(strategies.length * scenarios.length);
    setCompletedSims(0);
    setProgress(0);

    try {
      const worker = new Worker(new URL("../../workers/simulation.worker.js", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (e) => {
        const msg = e.data;
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "progress") {
          const completed = Number(msg.completed) || 0;
          const total = Number(msg.total) || 1;
          setCompletedSims(completed);
          setTotalSims(total);
          setProgress(Math.round((completed / total) * 100));
          setSimProgressInfo(msg.current || null);
          setPhase("running");
        } else if (msg.type === "success" || msg.type === "cached") {
          const weights = normalizePreferenceWeights(
            derivePreferenceWeights(shortOutlook, mediumOutlook, uncertainty)
          );
          let opt;
          try {
            opt = optimizeStrategies({
              simulationResults: msg.results,
              scenarios,
              strategies,
              weights,
              mode: targetMode === "payment" ? "payment" : "term",
              // Require at least 2 allocations so single-product extremes don't dominate
              // the beginner-facing recommendation (aligns with the v9 default behaviour).
              recommendationMinAllocationCount: 2,
              diversification: false,
              t
            });
          } catch (err) {
            console.warn("lab: optimizeStrategies failed", err);
            setSimError(err?.message || String(err));
            setError(t("lab.error.sim"));
            setPhase("error");
            return;
          }
          setSimResults(msg.results);
          setOptimisedData(opt);
          setPhase(msg.type); // "success" or "cached" — modal auto-dismisses
          setStep("results");
        } else if (msg.type === "error") {
          setSimError(msg.error || "Worker error");
          setError(t("lab.error.sim"));
          setPhase("error");
        }
      };
      worker.onerror = (err) => {
        console.warn("lab: worker error", err);
        setSimError(err?.message || "Worker crashed");
        setError(t("lab.error.sim"));
        setPhase("error");
      };
      worker.onmessageerror = (e) => {
        console.warn("lab: worker message error", e);
        setSimError("Worker message error");
        setError(t("lab.error.sim"));
        setPhase("error");
      };
      worker.postMessage({
        mortgage: m,
        strategies,
        scenarios,
        products: nzProfile.products,
        currentProductRates: marketRates,
        startDate: new Date().toISOString().split("T")[0],
        forecastMonths,
        maxAffordablePayment: Number.MAX_SAFE_INTEGER
      });
    } catch (err) {
      console.warn("lab: worker spawn failed", err);
      setError(t("lab.error.sim"));
      setPhase("form");
    }
  }, [loanAmount, targetMode, targetYears, targetPayment, repaymentFrequency,
      marketRates, scenarios, shortOutlook, mediumOutlook, uncertainty, t, forecastMonths]);

  // ---- Open detail modal (lazy-load timeline) ----------------------------
  const openDetail = useCallback(async (strategyId, triggerEl) => {
    if (triggerEl) triggerBtnRef.current = triggerEl;
    if (!strategyId || !scenarios || !mortgage) return;
    setDetailModalStrategyId(strategyId);
    setDetailModalOpen(true);
    setDetailLoading(true);
    setDetailTimelineData(null);
    const baseScenario = scenarios.find((s) => s.id === "base") || scenarios[0];
    if (!baseScenario) {
      setDetailLoading(false);
      return;
    }
    try {
      const res = await simulateStrategyScenario({
        mortgage,
        strategy: allStrategies.find((s) => s.id === strategyId),
        scenario: baseScenario,
        products: nzProfile.products,
        currentProductRates: marketRates,
        startDate: new Date().toISOString().split("T")[0],
        forecastMonths,
        maxAffordablePayment: Number.MAX_SAFE_INTEGER,
        includeTimeline: true,
        includeRefixEvents: true
      });
      setDetailTimelineData(res);
    } catch (err) {
      console.warn("lab: detail timeline failed", err);
    } finally {
      setDetailLoading(false);
    }
  }, [scenarios, mortgage, allStrategies, marketRates, forecastMonths]);

  const closeDetail = useCallback(() => {
    setDetailModalOpen(false);
    // Restore focus to the trigger
    setTimeout(() => { if (triggerBtnRef.current) triggerBtnRef.current.focus(); }, 0);
  }, []);

  // ---- OCR summary text --------------------------------------------------
  const ocrSummary = useMemo(() => {
    if (!scenarios || !shortOutlook) return "";
    const delta = Math.abs(SHORT_TO_DELTA[shortOutlook] || 0) * 100;
    const isRise = shortOutlook.startsWith("rise");
    const baseKey = isRise ? "lab.ocr.summary.rise" : "lab.ocr.summary.fall";
    let trajKey = "lab.ocr.traj.slow";
    if (mediumOutlook === "continue") trajKey = isRise ? "lab.ocr.traj.continue.rise" : "lab.ocr.traj.continue.fall";
    else trajKey = isRise ? "lab.ocr.traj.slow.rise" : "lab.ocr.traj.slow.fall";
    return t(baseKey, { pct: delta.toFixed(2), traj: t(trajKey) });
  }, [scenarios, shortOutlook, mediumOutlook, t]);

  // ---- Chart series (only when scenarios exist) ---------------------------
  const chartSeries = useMemo(() => {
    if (!scenarios) return [];
    return scenarios.map((sc, idx) => {
      // RateScenario objects carry the OCR path on `policyRatePath`, each
      // entry is {month, rate}. SvgChart expects points: [{month, value}].
      // Scenarios returned by generateScenarios are in order [low, base, high] where
      //   low  = LOW rates  (optimistic for borrower)
      //   high = HIGH rates (pessimistic for borrower)
      // The visual semantics the user expects:
      //   top line    = red  (pessimistic, high rates)
      //   middle line = indigo (base)
      //   bottom line = green (optimistic, low rates)
      const colorByIdx = ["#10b981", "#6366f1", "#f43f5e"]; // green, indigo, red
      const labelByIdx = [t("lab.ocr.low"), t("lab.ocr.base"), t("lab.ocr.high")];
      const path = Array.isArray(sc.policyRatePath) ? sc.policyRatePath : [];
      return {
        id: sc.id || `scenario-${idx}`,
        name: labelByIdx[idx] || sc.id,
        color: colorByIdx[idx] || "#6366f1",
        points: path.map((p) => ({ month: Number(p.month), value: Number(p.rate) }))
      };
    });
  }, [scenarios, t]);

  // ---- Risk score + intro helper -----------------------------------------
  const riskScore = deriveRiskScore(shortOutlook, mediumOutlook, uncertainty);
  const riskBucketKey = riskBucket(riskScore);
  const whyThisOneIntro = t(`lab.detail.intro.${riskBucketKey}`);

  // ---- Build the rec strategy for the results card ------------------------
  const topRec = optimisedData?.recommendations?.preference || null;
  // expectedInterest / expectedMaxPayment / expectedEndingBalance live on
  // rankedStrategies[i], NOT on the recommendation object. If the ranked
  // row can't be found, fall back to an empty record (UI handles null).
  const topRanked = topRec
    ? optimisedData?.rankedStrategies?.find((s) => s.strategyId === topRec.strategyId) || null
    : null;

  const enrichedTopRec = useMemo(() => {
    if (!topRec || !allStrategies.length) return null;
    const fullStrat = allStrategies.find((s) => s.id === topRec.strategyId);
    if (!fullStrat) return null;
    const enrichedAllocs = (fullStrat.allocations || []).map((a, idx) => {
      const prod = nzProfile.products.find((p) => p.code === a.productCode);
      const displayName = prod ? prod.displayName : a.productCode;
      return {
        productCode: a.productCode,
        displayName,
        amount: a.amount,
        percentage: a.percentage,
        isFloating: a.productCode === "floating",
        fixedMonths: prod?.fixedMonths ?? null,
        color: PORTFOLIO_COLORS[idx % PORTFOLIO_COLORS.length]
      };
    });
    return {
      ...topRanked, // carries expectedInterest, expectedMaxPayment, expectedEndingBalance
      ...topRec,    // carries pros, cons, score, isParetoOptimal
      strategyId: topRec.strategyId,
      allocations: enrichedAllocs
    };
  }, [topRec, topRanked, allStrategies]);

  const introForModal = useMemo(() => ({
    whyThisOne: whyThisOneIntro,
    tradeOff: [],
    suitableFor: [],
    comparison: []
  }), [whyThisOneIntro]);

  // ---- Per-step renderers ------------------------------------------------
  const renderStep = () => {
    switch (step) {
      case "welcome":
        return (
          <div className="welcome-hero glass-panel accent-primary">
            <h1 className="page-title gradient-text-primary">{t("lab.welcome.title")}</h1>
            <p className="welcome-body">{t("lab.welcome.body")}</p>
            <button
              type="button"
              className="btn btn-cta-run"
              onClick={() => setStep("q1")}
              aria-label={t("lab.welcome.start")}
            >
              <span className="btn-pulse-dot" aria-hidden="true" />
              {t("lab.welcome.start")}
            </button>
          </div>
        );

      case "q1":
        return (
          <div className="glass-panel accent-primary wizard-step">
            <h2 className="card-header"><span className="card-header-accent" />{t("lab.q1.title")}</h2>
            <p className="wizard-step-hint">{t("lab.q1.hint")}</p>
            <NumberInput
              ariaLabel={t("lab.q1.aria")}
              value={Number.isFinite(loanAmount) ? loanAmount : ""}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") { setLoanAmount(NaN); return; }
                const v = parseInt(raw, 10);
                setLoanAmount(Number.isFinite(v) ? v : NaN);
              }}
              min={1000}
              step={1000}
              prefix="$"
              align="left"
              size="lg"
              inputMode="numeric"
              className="lab-number-input"
            />
            {loanAmount < 1000 && <p className="form-error">{t("lab.error.amount")}</p>}
          </div>
        );

      case "q2":
        return (
          <div className="glass-panel accent-cyan wizard-step">
            <h2 className="card-header"><span className="card-header-accent" />{t("lab.q2.title")}</h2>
            <div className="q2-option-list" role="radiogroup" aria-label={t("lab.q2.title")}>
              <div
                className={`q2-option-row ${targetMode === "term" ? "selected" : ""}`}
                data-tone="primary"
                role="radio"
                tabIndex={0}
                onClick={() => setTargetMode("term")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setTargetMode("term");
                  }
                }}
                aria-checked={targetMode === "term"}
              >
                <span className="q2-option-icon" aria-hidden="true">YR</span>
                <div className="q2-option-copy">
                  <div className="q2-option-line">
                    <span className="q2-option-text">{t("lab.q2.term.before")}</span>
                    <NumberInput
                      ariaLabel={t("lab.q2.term.aria")}
                      value={targetMode === "term" && Number.isFinite(targetYears) ? targetYears : ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === "") { setTargetYears(NaN); return; }
                        const v = parseInt(raw, 10);
                        setTargetYears(Number.isFinite(v) ? v : NaN);
                      }}
                      min={1}
                      max={40}
                      step={1}
                      align="left"
                      size="sm"
                      disabled={targetMode !== "term"}
                      placeholder="X"
                      inputMode="numeric"
                      className="lab-number-input q2-inline-input"
                    />
                    <span className="q2-option-text">{t("lab.q2.term.after")}</span>
                  </div>
                  <p className="q2-option-hint">{t("lab.q2.term.hint")}</p>
                </div>
                <span className="q2-option-badge">
                  {targetMode === "term" ? t("lab.choice.selected") : ""}
                </span>
              </div>

              <div
                className={`q2-option-row ${targetMode === "payment" ? "selected" : ""}`}
                data-tone="cyan"
                role="radio"
                tabIndex={0}
                onClick={() => setTargetMode("payment")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setTargetMode("payment");
                  }
                }}
                aria-checked={targetMode === "payment"}
              >
                <span className="q2-option-icon" aria-hidden="true">$</span>
                <div className="q2-option-copy">
                  <div className="q2-option-line">
                    <span className="q2-option-text">{t("lab.q2.payment.before")}</span>
                    <NumberInput
                      ariaLabel={t("lab.q2.payment.aria")}
                      value={targetMode === "payment" && Number.isFinite(targetPayment) ? targetPayment : ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === "") { setTargetPayment(NaN); return; }
                        const v = parseInt(raw, 10);
                        setTargetPayment(Number.isFinite(v) ? v : NaN);
                      }}
                      min={1}
                      step={10}
                      align="left"
                      size="sm"
                      disabled={targetMode !== "payment"}
                      placeholder="X"
                      inputMode="numeric"
                      className="lab-number-input q2-inline-input"
                    />
                    <span className="q2-option-text">{t("lab.q2.payment.after")}</span>
                  </div>
                  <p className="q2-option-hint">{t("lab.q2.payment.hint")}</p>
                </div>
                <span className="q2-option-badge">
                  {targetMode === "payment" ? t("lab.choice.selected") : ""}
                </span>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">{t("lab.q2.frequency.label")}</label>
              <div className="frequency-picker">
                {["weekly", "fortnightly", "monthly"].map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`chip-btn ${repaymentFrequency === f ? "selected" : ""}`}
                    onClick={() => setRepaymentFrequency(f)}
                    aria-pressed={repaymentFrequency === f}
                  >
                    <span>{t(`common.${f}`)}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        );

      case "q3":
        return (
          <div className="glass-panel accent-emerald wizard-step">
            <h2 className="card-header"><span className="card-header-accent" />{t("lab.q3.title")}</h2>
            <p className="wizard-step-hint">{t("lab.q3.hint")}</p>
            <div className="choice-grid q3-grid">
              {[
                { value: "fall-strong", label: "↘↘", text: t("lab.q3.fallStrong"), tone: "green" },
                { value: "fall",        label: "↘",  text: t("lab.q3.fall"),       tone: "teal" },
                { value: "rise",        label: "↗",  text: t("lab.q3.rise"),       tone: "amber" },
                { value: "rise-strong", label: "↗↗", text: t("lab.q3.riseStrong"), tone: "red" }
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`choice-card tone-${opt.tone} ${shortOutlook === opt.value ? "selected" : ""}`}
                  onClick={() => setShortOutlook(opt.value)}
                  aria-pressed={shortOutlook === opt.value}
                >
                  <span className="choice-card-glyph" aria-hidden="true">{opt.label}</span>
                  <span className="choice-card-label">{opt.text}</span>
                  {shortOutlook === opt.value && <span className="choice-card-status">{t("lab.choice.selected")}</span>}
                </button>
              ))}
            </div>
          </div>
        );

      case "q4":
        return (
          <div className="glass-panel accent-amber wizard-step">
            <h2 className="card-header"><span className="card-header-accent" />{
              shortOutlook?.startsWith("rise")
                ? t("lab.q4.title.rise")
                : t("lab.q4.title.fall")
            }</h2>
            <p className="wizard-step-hint">{t("lab.q4.hint")}</p>
            <div className="choice-grid q4-grid">
              <button
                type="button"
                className={`choice-card tone-amber ${mediumOutlook === "continue" ? "selected" : ""}`}
                onClick={() => setMediumOutlook("continue")}
                aria-pressed={mediumOutlook === "continue"}
              >
                <span className="choice-card-glyph" aria-hidden="true">→</span>
                <span className="choice-card-label">{t("lab.q4.continue")}</span>
                {mediumOutlook === "continue" && <span className="choice-card-status">{t("lab.choice.selected")}</span>}
              </button>
              <button
                type="button"
                className={`choice-card tone-cyan ${mediumOutlook === "slow" ? "selected" : ""}`}
                onClick={() => setMediumOutlook("slow")}
                aria-pressed={mediumOutlook === "slow"}
              >
                <span className="choice-card-glyph" aria-hidden="true">~</span>
                <span className="choice-card-label">{t("lab.q4.slow")}</span>
                {mediumOutlook === "slow" && <span className="choice-card-status">{t("lab.choice.selected")}</span>}
              </button>
            </div>
          </div>
        );

      case "q5":
        return (
          <div className="glass-panel accent-rose wizard-step">
            <h2 className="card-header"><span className="card-header-accent" />{t("lab.q5.title")}</h2>
            <p className="wizard-step-hint">{t("lab.q5.hint")}</p>
            <div className="choice-grid q5-grid">
              {[
                { value: "low",    text: t("lab.q5.low"),    glyph: "I",   tone: "green" },
                { value: "medium", text: t("lab.q5.medium"), glyph: "II",  tone: "primary" },
                { value: "high",   text: t("lab.q5.high"),   glyph: "III", tone: "red" }
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`choice-card tone-${opt.tone} ${uncertainty === opt.value ? "selected" : ""}`}
                  onClick={() => setUncertainty(opt.value)}
                  aria-pressed={uncertainty === opt.value}
                >
                  <span className="choice-card-glyph" aria-hidden="true">{opt.glyph}</span>
                  <span className="choice-card-label">{opt.text}</span>
                  {uncertainty === opt.value && <span className="choice-card-status">{t("lab.choice.selected")}</span>}
                </button>
              ))}
            </div>
          </div>
        );

      case "q6":
        return (
          <div className="glass-panel accent-primary wizard-step">
            <h2 className="card-header"><span className="card-header-accent" />{t("lab.q6.title")}</h2>
            <p className="wizard-step-hint">{t("lab.q6.hint")}</p>
            <div className="form-group" style={{ maxWidth: "320px" }}>
              <NumberInput
                ariaLabel={t("lab.q6.aria")}
                value={Number.isFinite(forecastYears) ? forecastYears : ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") { setForecastYears(NaN); return; }
                  const v = parseInt(raw, 10);
                  setForecastYears(Number.isFinite(v) ? v : NaN);
                }}
                min={FORECAST_YEARS_MIN}
                max={FORECAST_YEARS_MAX}
                step={1}
                suffix={t("lab.q6.unit")}
                align="left"
                size="lg"
                inputMode="numeric"
                className="lab-number-input"
              />
              {(forecastYears < FORECAST_YEARS_MIN || forecastYears > FORECAST_YEARS_MAX) && (
                <p className="form-error">{t("lab.error.forecastYears")}</p>
              )}
            </div>
          </div>
        );

      case "ocr":
        return (
          <div className="glass-panel accent-primary wizard-step ocr-step">
            <h2 className="card-header"><span className="card-header-accent" />{t("lab.ocr.title")}</h2>
            <p className="wizard-step-hint">{t("lab.ocr.hint")}</p>
            {scenarios && chartSeries.length > 0 ? (
              <>
                <div className="ocr-chart-wrap">
                  <SvgChart data={chartSeries} yAxisType="rate" height={320} />
                </div>
                <p className="ocr-summary">{ocrSummary}</p>
              </>
            ) : (
              <p className="ocr-summary">{t("lab.error.sim")}</p>
            )}
          </div>
        );

      case "results":
        return (
          <div className="glass-panel accent-emerald wizard-step results-step">
            <h2 className="card-header"><span className="card-header-accent" />{t("lab.results.heading")}</h2>
            {!enrichedTopRec ? (
              <p className="ocr-summary">{t("lab.error.sim")}</p>
            ) : (
              <div className="rec-card">
                <div
                  className="portfolio-bar"
                  role="img"
                  aria-label={t("lab.results.portfolioAria", {
                    parts: enrichedTopRec.allocations.map((a) => `${formatAllocationPct(a.percentage)} ${a.displayName}`).join(", ")
                  })}
                >
                  {enrichedTopRec.allocations.map((a, i) => (
                    <span
                      key={i}
                      className="portfolio-segment"
                      style={{ width: formatAllocationPct(a.percentage), background: a.color }}
                      title={`${a.displayName} ${formatAllocationPct(a.percentage)}`}
                    />
                  ))}
                </div>
                <ul className="portfolio-legend">
                  {enrichedTopRec.allocations.map((a, i) => (
                    <li key={i} style={{ color: a.color }}>
                      {formatAllocationPct(a.percentage)} {a.displayName}
                    </li>
                  ))}
                </ul>
                <div className="stat-tile-grid">
                  <div className="stat-tile">
                    <span className="stat-tile-lbl">{t("lab.results.metrics.interest")}</span>
                    <span className="stat-tile-val">{formatMoney(Number(enrichedTopRec.expectedInterest) || 0)}</span>
                  </div>
                  <div className="stat-tile">
                    <span className="stat-tile-lbl">{t("lab.results.metrics.maxPayment")}</span>
                    <span className="stat-tile-val">{formatMoney(Number(enrichedTopRec.expectedMaxPayment) || 0)}</span>
                  </div>
                  <div className="stat-tile">
                    <span className="stat-tile-lbl">{t("lab.results.metrics.endingBalance", { years: normalizedForecastYears })}</span>
                    <span className="stat-tile-val">{formatMoney(Number(enrichedTopRec.expectedEndingBalance) || 0)}</span>
                  </div>
                  <div className="stat-tile">
                    <span className="stat-tile-lbl">{t("lab.results.metrics.principal")}</span>
                    <span className="stat-tile-val">
                      {formatMoney(Math.max(0, loanAmount - (Number(enrichedTopRec.expectedEndingBalance) || 0)))}
                    </span>
                  </div>
                </div>
                <p className="rec-intro">{whyThisOneIntro}</p>
                <div className="rec-actions">
                  <button
                    ref={triggerBtnRef}
                    type="button"
                    className="btn btn-primary"
                    onClick={(e) => openDetail(enrichedTopRec.strategyId, e.currentTarget)}
                  >
                    {t("lab.results.seeDetails")}
                  </button>
                  <button
                    ref={upgradeBtnRef}
                    type="button"
                    className="btn btn-secondary"
                    onClick={(e) => {
                      upgradeBtnRef.current = e.currentTarget;
                      setPremiumPopupOpen(true);
                    }}
                  >
                    {t("lab.results.upgrade")}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={resetAll}>
                    {t("lab.results.startOver")}
                  </button>
                </div>
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  // ---- Progress indicator ------------------------------------------------
  const questionIndex = QUESTION_STEPS.indexOf(step);
  const progressLabel = questionIndex >= 0
    ? t("lab.progress.label", { current: questionIndex + 1, total: QUESTION_STEPS.length })
    : null;

  // ---- Detail modal strategy + rec ---------------------------------------
  const detailStrategy = (() => {
    if (!detailModalStrategyId || !optimisedData) return null;
    const rec = optimisedData.recommendations?.preference;
    const ranked = optimisedData.rankedStrategies?.find((s) => s.strategyId === detailModalStrategyId);
    if (!ranked) return null;
    const fullStrat = allStrategies.find((s) => s.id === detailModalStrategyId);
    if (!fullStrat) return null;
    const enrichedAllocs = (fullStrat.allocations || []).map((a, idx) => {
      const prod = nzProfile.products.find((p) => p.code === a.productCode);
      const displayName = prod ? prod.displayName : a.productCode;
      return {
        productCode: a.productCode,
        displayName,
        amount: a.amount,
        percentage: a.percentage,
        isFloating: a.productCode === "floating",
        fixedMonths: prod?.fixedMonths ?? null,
        color: PORTFOLIO_COLORS[idx % PORTFOLIO_COLORS.length]
      };
    });
    const merged = rec ? { ...ranked, ...rec } : ranked;
    return { ...merged, allocations: enrichedAllocs };
  })();

  const detailRec = detailStrategy && optimisedData?.recommendations?.preference?.strategyId === detailStrategy.strategyId
    ? { type: "preference", label: t("strategyLab.recCard.preference.title") }
    : null;

  return (
    <div className="lab-container">
      {progressLabel && (() => {
        const totalSegments = STEPS.length - 1; // exclude "welcome"
        const currentIdx = STEPS.indexOf(step);
        // Map step index to a 0–totalSegments scale. welcome=0, q1=1, ... results=7.
        const filledSegments = Math.max(0, currentIdx);
        const pct = totalSegments > 0 ? (filledSegments / totalSegments) * 100 : 0;
        return (
          <div className="wizard-progress" aria-label={progressLabel}>
            <span className="wizard-progress-text">{progressLabel}</span>
            <div
              className="wizard-progress-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={totalSegments}
              aria-valuenow={filledSegments}
              style={{ "--progress-pct": `${pct}%` }}
            />
          </div>
        );
      })()}

      {error && <div className="form-error-banner" role="alert">{error}</div>}

      <div className="wizard-shell">
        {renderStep()}
      </div>

      {step !== "welcome" && step !== "results" && (
        <div className="wizard-nav">
          <button type="button" className="btn btn-ghost" onClick={goBack} disabled={phase === "running"}>
            {t("lab.nav.back")}
          </button>
          {step === "ocr" ? (
            <button
              type="button"
              className="btn btn-cta-run"
              onClick={startSimulation}
              disabled={phase === "running" || !canAdvance}
              aria-label={t("lab.runSimAria")}
            >
              {t("lab.runSim")}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={goNext}
              disabled={!canAdvance}
            >
              {t("lab.nav.next")}
            </button>
          )}
          <button type="button" className="wizard-reset-link" onClick={resetAll} disabled={phase === "running"}>
            {t("lab.nav.reset")}
          </button>
        </div>
      )}

      <SimulationProgressModal
        isOpen={phase === "running" || phase === "success" || phase === "cached" || phase === "error"}
        phase={phase}
        title={t("lab.running.title")}
        subtitle={t("lab.running.subtitle")}
        progress={progress}
        completedSims={completedSims}
        totalSims={totalSims}
        currentSimulationInfo={simProgressInfo}
        errorMessage={simError}
        simCountIsHigh={totalSims > 1500}
        simCountWarningThreshold={1500}
        onCancel={() => {
          if (workerRef.current) {
            workerRef.current.terminate();
            workerRef.current = null;
          }
          setPhase("form");
          setStep("ocr");
        }}
        onDismiss={() => {
          if (phase === "success" || phase === "cached") {
            // Already advanced to results by startSimulation; just close modal.
            setPhase("form");
          } else if (phase === "error") {
            setPhase("form");
            setStep("ocr");
          }
        }}
      />

      <StrategyDetailModal
        isOpen={detailModalOpen}
        onClose={closeDetail}
        strategy={detailStrategy}
        recommendation={detailRec}
        intro={introForModal}
        showInlineTimeline
        detailTimelineData={detailTimelineData}
        detailScenarioLabel={t("lab.ocr.base")}
        isDetailLoading={detailLoading}
        formatMoney={formatMoney}
      />

      {premiumPopupOpen && (
        <div
          className="premium-popup-scrim"
          onClick={closePremiumPopup}
          role="presentation"
        >
          <div
            className="premium-popup glass-panel accent-amber"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lab-premium-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="lab-premium-title" className="card-header">
              <span className="card-header-accent" />{t("lab.premium.title")}
            </h3>
            <p>{t("lab.premium.body")}</p>
            <button
              type="button"
              className="btn btn-primary"
              autoFocus
              onClick={closePremiumPopup}
            >
              {t("lab.premium.ok")}
            </button>
          </div>
        </div>
      )}

      <style jsx global>{`
        .lab-container {
          display: flex;
          flex-direction: column;
          gap: 24px;
          max-width: 800px;
          margin: 0 auto;
          position: relative;
          isolation: isolate;
        }
        .lab-container::before {
          content: "";
          position: fixed;
          inset: 0;
          z-index: -1;
          pointer-events: none;
          background-image:
            linear-gradient(rgba(99, 102, 241, 0.045) 1px, transparent 1px),
            linear-gradient(90deg, rgba(6, 182, 212, 0.035) 1px, transparent 1px);
          background-size: 54px 54px;
          mask-image: linear-gradient(to bottom, rgba(0,0,0,0.75), transparent 72%);
        }
        .lab-container .glass-panel {
          background: #10192d;
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
          border-color: #263450;
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.42);
        }
        .lab-container .glass-panel:hover {
          background: #121d34;
          border-color: #31405b;
        }

        /* ===== Welcome hero — animated conic backdrop + radial glow ===== */
        .welcome-hero {
          position: relative;
          overflow: hidden;
          padding: 82px 56px 88px;
          text-align: center;
          display: flex;
          flex-direction: column;
          gap: 34px;
          align-items: center;
        }
        .welcome-hero :global(.page-title) {
          font-size: 36px;
          line-height: 1.15;
          margin: 0;
        }
        .welcome-hero :global(.welcome-body) {
          font-size: var(--fs-xl);
          line-height: 1.85;
          max-width: 640px;
          color: var(--text-secondary);
          margin: 0;
        }
        .welcome-hero :global(.btn-cta-run) {
          margin-top: 22px;
          font-size: var(--fs-lg);
          padding: 17px 46px;
          min-width: 240px;
          min-height: 58px;
          gap: 12px;
        }
        .btn-pulse-dot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: #fff;
          box-shadow: 0 0 0 6px rgba(255,255,255,0.12), 0 0 22px rgba(255,255,255,0.55);
          animation: cta-dot-pulse 1.8s ease-in-out infinite;
        }
        @keyframes cta-dot-pulse {
          0%, 100% { transform: scale(1); opacity: 0.88; }
          50% { transform: scale(1.35); opacity: 1; }
        }
        .welcome-hero::before {
          content: "";
          position: absolute;
          inset: -20%;
          background: conic-gradient(from 0deg at 50% 50%,
            transparent 0deg,
            rgba(99, 102, 241, 0.18) 60deg,
            transparent 120deg,
            rgba(20, 184, 166, 0.12) 180deg,
            transparent 240deg,
            rgba(139, 92, 246, 0.15) 300deg,
            transparent 360deg);
          animation: welcome-spin 18s linear infinite;
          filter: blur(40px);
          z-index: 0;
          pointer-events: none;
        }
        .welcome-hero::after {
          content: "";
          position: absolute;
          top: -30%;
          right: -10%;
          width: 360px;
          height: 360px;
          background: radial-gradient(circle, rgba(99, 102, 241, 0.25), transparent 60%);
          pointer-events: none;
          z-index: 0;
        }
        .welcome-hero > * { position: relative; z-index: 1; }
        @keyframes welcome-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .welcome-hero::before { animation: none; }
        }

        .welcome-body {
          color: var(--text-secondary);
          max-width: 540px;
          line-height: 1.7;
          font-size: var(--fs-lg);
        }

        /* ===== Wizard progress — continuous track + complete vs active ===== */
        .wizard-progress {
          display: flex;
          flex-direction: column;
          gap: 10px;
          align-items: flex-start;
        }
        .wizard-progress-text {
          font-size: var(--fs-sm);
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .wizard-progress-bar {
          position: relative;
          width: 100%;
          max-width: 360px;
          height: 6px;
          border-radius: 999px;
          background: var(--border-glass);
          overflow: hidden;
        }
        .wizard-progress-bar::after {
          content: "";
          position: absolute;
          inset: 0 auto 0 0;
          width: var(--progress-pct, 0%);
          background: var(--gradient-primary);
          box-shadow: var(--glow-primary);
          transition: width 480ms cubic-bezier(0.4, 0, 0.2, 1);
        }
        .wizard-progress-dot { display: none; }

        /* ===== Wizard shell — fade-up entry ===== */
        .wizard-shell {
          min-height: 320px;
          animation: wizard-fade-up 360ms cubic-bezier(0.4, 0, 0.2, 1) both;
        }
        @keyframes wizard-fade-up {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .wizard-shell { animation: none; }
        }

        .wizard-step {
          padding: 46px 40px;
          display: flex;
          flex-direction: column;
          gap: 32px;
        }
        .wizard-step :global(.card-header) {
          font-family: var(--font-heading);
          font-size: 26px;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: #fff;
          margin: 0;
        }
        .wizard-step-hint {
          color: var(--text-secondary);
          font-size: var(--fs-md);
          margin: 0;
          line-height: 1.6;
        }
        .form-group {
          display: flex;
          flex-direction: column;
          gap: 16px;
          margin: 0;
        }
        .form-label {
          font-family: var(--font-heading);
          font-size: 13px;
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin: 0;
        }
        .form-error {
          color: var(--color-rose);
          font-size: var(--fs-sm);
          margin: 0;
        }
        .form-error-banner {
          padding: 12px 16px;
          border-radius: var(--radius-md);
          background: rgba(244, 63, 94, 0.12);
          border: 1px solid var(--color-rose);
          color: var(--color-rose);
          font-size: var(--fs-sm);
        }
        .wizard-step :global(.lab-number-input .ni-control) {
          min-height: 56px;
          border-radius: 12px;
          background: #0d1526;
          border-color: #2a3954;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 12px 26px rgba(0,0,0,0.24);
        }
        .wizard-step :global(.lab-number-input .ni-control:focus-within) {
          border-color: rgba(6, 182, 212, 0.72);
          box-shadow:
            0 0 0 4px rgba(6, 182, 212, 0.18),
            0 0 30px rgba(6, 182, 212, 0.16),
            inset 0 1px 0 rgba(255,255,255,0.06);
        }
        .wizard-step :global(.lab-number-input .ni-input) {
          font-family: var(--font-num);
          font-size: 18px;
          font-weight: 700;
        }
        .wizard-step :global(.lab-number-input .ni-prefix),
        .wizard-step :global(.lab-number-input .ni-suffix) {
          font-size: 15px;
          font-weight: 800;
          color: #e0f2fe;
        }

        /* ===== Q2 target toggle ===== */
        .q2-option-list {
          display: flex;
          flex-direction: column;
          gap: 14px;
          background: #0d1526;
          border-radius: 14px;
          padding: 10px;
          border: 1px solid #273450;
        }
        .q2-option-row {
          --choice-color: var(--color-primary);
          --choice-glow: rgba(99, 102, 241, 0.24);
          display: grid;
          grid-template-columns: 42px minmax(0, 1fr) auto;
          gap: 14px;
          align-items: center;
          min-height: 82px;
          padding: 18px 18px;
          border-radius: 12px;
          background: #16233b;
          border: 1px solid #2a3954;
          color: var(--text-primary);
          font-weight: 700;
          font-size: var(--fs-md);
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          overflow: hidden;
          text-align: left;
        }
        .q2-option-row[data-tone="cyan"] {
          --choice-color: var(--accent-cyan);
          --choice-glow: rgba(6, 182, 212, 0.24);
        }
        .q2-option-row::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(120deg, transparent 24%, rgba(255,255,255,0.10) 50%, transparent 76%);
          transform: translateX(-120%);
          transition: transform 560ms ease;
          pointer-events: none;
        }
        .q2-option-row:hover {
          background: #1d2b47;
          border-color: color-mix(in srgb, var(--choice-color) 40%, #7a869d);
          transform: translateY(-2px);
        }
        .q2-option-row:focus-visible {
          outline: none;
          box-shadow:
            0 0 0 3px color-mix(in srgb, var(--choice-color) 22%, transparent),
            0 0 0 6px rgba(10, 16, 38, 0.85),
            0 12px 34px var(--choice-glow);
        }
        .q2-option-row:hover::after {
          transform: translateX(120%);
        }
        .q2-option-row.selected {
          background: #1a2540;
          border-color: var(--choice-color);
          color: #fff;
          box-shadow:
            0 0 0 4px color-mix(in srgb, var(--choice-color) 18%, transparent),
            0 12px 34px var(--choice-glow),
            inset 0 1px 0 rgba(255,255,255,0.12);
          transform: translateY(-2px);
        }
        .q2-option-row:active { transform: scale(0.985); }
        .q2-option-icon {
          width: 42px;
          height: 42px;
          border-radius: 12px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex: 0 0 auto;
          color: #fff;
          background: color-mix(in srgb, var(--choice-color) 70%, #111827);
          box-shadow: 0 0 22px var(--choice-glow);
          font-family: var(--font-num);
          font-size: 13px;
          font-weight: 800;
        }
        .q2-option-copy {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .q2-option-line {
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          line-height: 1.35;
          color: inherit;
        }
        .q2-option-text {
          min-width: 0;
          color: inherit;
        }
        .q2-option-hint {
          margin: 0;
          color: var(--text-secondary);
          font-size: 11px;
          line-height: 1.3;
        }
        .q2-option-row.selected .q2-option-hint {
          color: rgba(219, 234, 254, 0.78);
        }
        .q2-inline-input {
          width: 128px;
          max-width: 128px;
          flex: 0 0 128px;
        }
        .q2-inline-input.ni-disabled {
          opacity: 0.88;
        }
        .q2-option-row .q2-inline-input :global(.ni-control) {
          background: rgba(8, 15, 30, 0.55);
          border-color: rgba(148, 163, 184, 0.18);
          box-shadow: none;
        }
        .q2-option-row .q2-inline-input.ni-disabled :global(.ni-control) {
          background: rgba(8, 15, 30, 0.32);
          border-color: rgba(148, 163, 184, 0.12);
        }
        .q2-option-row.selected .q2-inline-input :global(.ni-control) {
          background: rgba(10, 16, 38, 0.75);
          border-color: color-mix(in srgb, var(--choice-color) 54%, #8aa0c2);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--choice-color) 14%, transparent);
        }
        .q2-option-row .q2-inline-input :global(.ni-input) {
          font-size: 14px;
          font-weight: 700;
        }
        .q2-option-row .q2-inline-input :global(.ni-prefix),
        .q2-option-row .q2-inline-input :global(.ni-suffix) {
          font-size: 13px;
          font-weight: 800;
        }
        .q2-option-badge {
          min-width: 82px;
          justify-self: end;
          color: #cffafe;
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          text-align: right;
          animation: selected-label-in 220ms ease both;
        }
        .q2-option-row:not(.selected) .q2-option-badge {
          opacity: 0;
          animation: none;
        }
        .option-selected-text,
        .choice-card-status {
          color: #cffafe;
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          animation: selected-label-in 220ms ease both;
        }

        /* ===== Q2 frequency picker ===== */
        .frequency-picker {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }
        .chip-btn {
          padding: 12px 22px;
          border-radius: 999px;
          background: #16233b;
          border: 1px solid #2a3954;
          color: var(--text-primary);
          font-weight: 700;
          font-size: var(--fs-md);
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          min-height: 48px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .chip-btn:hover:not(.selected) {
          background: #1d2b47;
          color: var(--text-primary);
          border-color: rgba(6, 182, 212, 0.42);
          transform: translateY(-1px);
        }
        .chip-btn.selected {
          background: linear-gradient(135deg, var(--color-primary), var(--accent-cyan));
          color: white;
          border-color: rgba(255,255,255,0.16);
          box-shadow: var(--glow-primary), 0 8px 22px rgba(6, 182, 212, 0.18);
        }
        .chip-btn.selected::before {
          content: "✓";
          font-weight: 800;
          animation: choice-reveal 240ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }
        .chip-btn:active { transform: scale(0.98); }

        /* ===== Q3/Q4/Q5 choice cards — sequential reveal + ✓ indicator ===== */
        .choice-grid {
          display: grid;
          gap: 20px;
        }
        .q3-grid { grid-template-columns: repeat(2, 1fr); }
        .q4-grid { grid-template-columns: repeat(2, 1fr); }
        .q5-grid { grid-template-columns: repeat(3, 1fr); }
        .choice-card {
          --choice-color: var(--color-primary);
          --choice-glow: rgba(99, 102, 241, 0.28);
          position: relative;
          padding: 32px 20px 26px;
          border-radius: 14px;
          background: #16233b;
          border: 1px solid #2a3954;
          color: var(--text-primary);
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 10px;
          align-items: center;
          justify-content: center;
          transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1),
                      box-shadow 0.22s ease,
                      border-color 0.22s ease,
                      background 0.22s ease;
          min-height: 120px;
          animation: choice-reveal 360ms cubic-bezier(0.4, 0, 0.2, 1) both;
          text-align: center;
          overflow: hidden;
        }
        .choice-card.tone-green {
          --choice-color: var(--color-emerald);
          --choice-glow: rgba(16, 185, 129, 0.28);
        }
        .choice-card.tone-teal {
          --choice-color: var(--accent-teal);
          --choice-glow: rgba(20, 184, 166, 0.28);
        }
        .choice-card.tone-amber {
          --choice-color: var(--color-amber);
          --choice-glow: rgba(245, 158, 11, 0.28);
        }
        .choice-card.tone-red {
          --choice-color: var(--color-rose);
          --choice-glow: rgba(244, 63, 94, 0.30);
        }
        .choice-card.tone-cyan {
          --choice-color: var(--accent-cyan);
          --choice-glow: rgba(6, 182, 212, 0.28);
        }
        .choice-card::after {
          content: "";
          position: absolute;
          inset: 0;
          background:
            radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--choice-color) 18%, transparent), transparent 46%),
            linear-gradient(120deg, transparent 26%, rgba(255,255,255,0.12) 50%, transparent 74%);
          opacity: 0.65;
          transform: translateX(-115%);
          transition: transform 520ms ease, opacity 220ms ease;
          pointer-events: none;
        }
        .choice-card:hover:not(.selected) {
          background: #1d2b47;
          border-color: color-mix(in srgb, var(--choice-color) 44%, #7a869d);
          transform: translateY(-3px);
          box-shadow: 0 12px 26px rgba(0,0,0,0.24);
        }
        .choice-card:hover::after { transform: translateX(115%); }
        .choice-card:active { transform: scale(0.98); }
        .choice-card.selected {
          background: #1a2540;
          border-color: var(--choice-color);
          box-shadow:
            0 0 0 4px color-mix(in srgb, var(--choice-color) 20%, transparent),
            0 14px 38px var(--choice-glow),
            inset 0 1px 0 rgba(255,255,255,0.13);
          transform: translateY(-2px);
          animation: choice-selected-pop 260ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }
        .choice-card::before {
          content: "";
          position: absolute;
          top: 12px;
          right: 14px;
          width: 26px;
          height: 26px;
          border-radius: 50%;
          background: var(--choice-color);
          color: #fff;
          font-size: 14px;
          font-weight: 800;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transform: scale(0.4);
          transition: opacity 0.18s ease,
                      transform 0.24s cubic-bezier(0.34, 1.56, 0.64, 1);
          box-shadow: 0 0 0 4px color-mix(in srgb, var(--choice-color) 18%, transparent);
        }
        .choice-card.selected::before { opacity: 1; transform: scale(1); }
        .choice-card-glyph {
          font-size: 36px;
          font-weight: 800;
          color: var(--choice-color);
          line-height: 1;
          font-variant-numeric: tabular-nums;
        }
        .choice-card.selected .choice-card-glyph {
          color: #fff;
          text-shadow: 0 0 18px var(--choice-glow);
        }
        .choice-card-label {
          font-size: var(--fs-md);
          font-weight: 700;
          letter-spacing: 0.01em;
        }
        .choice-card-status {
          padding: 4px 9px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--choice-color) 20%, transparent);
          color: #fff;
          border: 1px solid color-mix(in srgb, var(--choice-color) 36%, transparent);
        }
        @keyframes selected-label-in {
          from { opacity: 0; transform: translateY(3px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes choice-selected-pop {
          0% { transform: translateY(-2px) scale(0.985); }
          100% { transform: translateY(-2px) scale(1); }
        }
        .choice-grid > .choice-card:nth-child(1) { animation-delay: 40ms; }
        .choice-grid > .choice-card:nth-child(2) { animation-delay: 110ms; }
        .choice-grid > .choice-card:nth-child(3) { animation-delay: 180ms; }
        .choice-grid > .choice-card:nth-child(4) { animation-delay: 250ms; }
        @keyframes choice-reveal {
          from { opacity: 0; transform: translateY(8px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .choice-card { animation: none; }
        }

        /* ===== OCR step ===== */
        .ocr-step { gap: 24px; }
        .ocr-chart-wrap {
          padding: 16px;
          border-radius: var(--radius-md);
          background: #0d1526;
          border: 1px solid #263450;
        }
        .ocr-summary {
          margin: 0;
          color: var(--text-secondary);
          font-size: var(--fs-md);
          line-height: 1.6;
          animation: ocr-text-in 600ms cubic-bezier(0.4, 0, 0.2, 1) both;
          animation-delay: 900ms;
        }
        @keyframes ocr-text-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .ocr-summary { animation: none; }
        }

        /* ===== Wizard nav ===== */
        .wizard-nav {
          display: flex;
          gap: 12px;
          align-items: center;
          padding: 16px 0;
        }
        .lab-container .btn-ghost {
          background: #16233b;
          border: 1px solid #2a3954;
          color: var(--text-primary);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
        }
        .lab-container .btn-ghost:hover:not(:disabled) {
          border-color: rgba(99, 102, 241, 0.46);
          background: #1d2b47;
          box-shadow: 0 8px 22px rgba(99, 102, 241, 0.18);
          transform: translateY(-1px);
        }
        .wizard-reset-link {
          margin-left: auto;
          background: none;
          border: none;
          color: var(--text-muted);
          font-size: var(--fs-sm);
          cursor: pointer;
          transition: color 0.15s ease;
        }
        .wizard-reset-link:hover:not(:disabled) { color: var(--text-secondary); }
        .wizard-reset-link:disabled, .btn:disabled { opacity: 0.5; cursor: not-allowed; }

        /* ===== Results — rec-card hover lift ===== */
        .results-step {
          gap: 30px;
          min-height: 700px;
          padding-bottom: 52px;
        }
        .rec-card {
          display: flex;
          flex-direction: column;
          gap: 34px;
          position: relative;
          padding: 8px 4px 4px;
          transition: transform 0.22s ease,
                      box-shadow 0.22s ease,
                      border-color 0.22s ease;
        }
        .rec-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 32px rgba(99, 102, 241, 0.20),
                      var(--glow-primary);
        }
        .portfolio-bar {
          display: flex;
          width: 100%;
          height: 32px;
          border-radius: var(--radius-md);
          overflow: hidden;
          background: var(--surface-1);
        }
        .portfolio-segment {
          height: 100%;
          transform-origin: left center;
          transition: width 700ms cubic-bezier(0.4, 0, 0.2, 1);
          animation: portfolio-grow 800ms cubic-bezier(0.4, 0, 0.2, 1) both;
        }
        .portfolio-segment:nth-child(1) { animation-delay: 80ms; }
        .portfolio-segment:nth-child(2) { animation-delay: 180ms; }
        .portfolio-segment:nth-child(3) { animation-delay: 280ms; }
        .portfolio-segment:nth-child(4) { animation-delay: 380ms; }
        .portfolio-segment:nth-child(5) { animation-delay: 480ms; }
        @keyframes portfolio-grow {
          from { transform: scaleX(0); opacity: 0; }
          to   { transform: scaleX(1); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .portfolio-segment { animation: none; }
        }
        .portfolio-legend {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          list-style: none;
          padding: 0;
          margin: 6px 0 0;
          font-size: var(--fs-sm);
          font-weight: 600;
        }
        .portfolio-legend li {
          padding: 4px 10px;
          border-radius: 999px;
          background: #10192d;
          border: 1px solid #263450;
          font-variant-numeric: tabular-nums;
          transition: var(--transition-smooth);
        }
        .portfolio-legend li:hover {
          background: rgba(255, 255, 255, 0.05);
          border-color: var(--border-strong);
        }
        .stat-tile-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 16px;
          margin-top: 2px;
        }
        .stat-tile-grid > .stat-tile {
          animation: stat-reveal 420ms cubic-bezier(0.4, 0, 0.2, 1) both;
        }
        .stat-tile-grid > .stat-tile:nth-child(1) { animation-delay: 100ms; }
        .stat-tile-grid > .stat-tile:nth-child(2) { animation-delay: 200ms; }
        .stat-tile-grid > .stat-tile:nth-child(3) { animation-delay: 300ms; }
        .stat-tile-grid > .stat-tile:nth-child(4) { animation-delay: 400ms; }
        @keyframes stat-reveal {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .stat-tile-grid > .stat-tile { animation: none; }
        }
        .rec-intro {
          margin: 2px 0 0;
          padding: 20px 22px;
          background: #0d1526;
          border-radius: var(--radius-md);
          border: 1px solid #263450;
          border-left: 3px solid var(--color-primary);
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.03);
          color: var(--text-secondary);
          line-height: 1.65;
          font-size: var(--fs-md);
        }
        .rec-actions {
          display: flex;
          gap: 14px;
          flex-wrap: wrap;
          margin-top: 2px;
        }

        /* ===== Premium popup — backdrop blur + slide-up ===== */
        .premium-popup-scrim {
          position: fixed;
          inset: 0;
          background: var(--backdrop-scrim);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          animation: prg-fade-in 200ms ease-out;
        }
        .premium-popup {
          max-width: 480px;
          width: 90vw;
          padding: 32px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          animation: prg-slide-in 280ms cubic-bezier(0.34, 1.56, 0.64, 1);
          background: #10192d;
          border-color: #263450;
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
        }
        .premium-popup p {
          margin: 0;
          color: var(--text-secondary);
          line-height: 1.6;
        }
        @keyframes prg-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes prg-slide-in {
          from { opacity: 0; transform: translateY(12px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }

        @media (max-width: 640px) {
          .wizard-step { padding: 24px 20px; gap: 26px; }
          .results-step {
            min-height: 0;
            padding-bottom: 36px;
            gap: 24px;
          }
          .rec-card {
            gap: 22px;
          }
          .welcome-hero { padding: 44px 22px 48px; gap: 28px; }
          .q2-option-row {
            grid-template-columns: 42px minmax(0, 1fr);
            gap: 12px;
            min-height: 0;
          }
          .q2-option-badge {
            display: none;
          }
          .q2-inline-input {
            width: min(100%, 144px);
            max-width: 144px;
            flex-basis: 144px;
          }
          .q3-grid,
          .q4-grid,
          .q5-grid { grid-template-columns: 1fr; }
          .rec-actions { flex-direction: column; align-items: stretch; }
        }
      `}</style>
    </div>
  );
}
