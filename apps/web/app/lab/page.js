// @ts-nocheck — React UI page; see apps/web/app/strategy-lab/page.js for the
// @ts-nocheck rationale (JSDoc strict mode is too strict for dynamic-key access
// patterns this page uses; financial correctness is owned by packages/*/src/*).
"use client";

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { nzProfile, nzBetas } from "@mortgage/country-adapters";
import { generateScenarios, buildQuantileScenarios } from "@mortgage/scenario-engine";
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
const REPAYMENT_YEARS_MAX = 40;

// NZ-typical mortgage ranges. CCCFA / Responsible Lending Code doesn't set
// hard limits, but NZ owner-occupied lenders broadly require these bounds:
//   - min amount: below ~$50k falls into personal-loan territory
//   - max amount: most owner-occupied caps sit at $5M (above = investment)
//   - min term: 5y is the shortest mortgage product banks typically offer
//   - max term: 30y is the longest amortisation banks typically accept
const NZ_AMOUNT_MIN = 50000;
const NZ_AMOUNT_MAX = 5000000;
const NZ_TERM_MIN_YEARS = 5;
const NZ_TERM_MAX_YEARS = 30;

const SHORT_TO_DELTA = {
  "fall-strong": -0.02,
  "fall":        -0.005,
  "flat":         0.000,
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

function DetailsIcon() {
  return (
    <svg className="rec-action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M5 7.5h14" />
      <path d="M5 12h9" />
      <path d="M5 16.5h12" />
      <path d="M18 12.5h.01" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg className="rec-action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M12 3.5l1.66 4.84L18.5 10l-4.84 1.66L12 16.5l-1.66-4.84L5.5 10l4.84-1.66L12 3.5z" />
      <path d="M18.5 14.5l.72 2.12L21.34 17l-2.12.72-.72 2.12-.72-2.12-2.12-.72 2.12-.72.72-2.12z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg className="rec-action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v5h-5" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg className="rec-action-arrow-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M5 12h13" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

function TrendIcon({ direction }) {
  if (direction === "fall") {
    return (
      <svg className="scenario-picker-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M6 7h12" />
        <path d="M12 7v10" />
        <path d="M8 13l4 4 4-4" />
      </svg>
    );
  }

  if (direction === "rise") {
    return (
      <svg className="scenario-picker-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M6 17h12" />
        <path d="M12 17V7" />
        <path d="M8 11l4-4 4 4" />
      </svg>
    );
  }

  return (
    <svg className="scenario-picker-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M6 12h12" />
      <path d="M15 9l3 3-3 3" />
    </svg>
  );
}

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

function buildDetailTimelineDataFromResult({ detailResult, strategy, mortgage }) {
  if (!detailResult?.timeline || !strategy) return null;

  const frequency = mortgage?.repaymentFrequency || "monthly";
  const snapshotMonths = [];
  const forecastMonths = detailResult.timeline.length > 0
    ? detailResult.timeline[detailResult.timeline.length - 1].monthIndex + 1
    : 0;
  for (let m = 6; m <= forecastMonths; m += 6) {
    snapshotMonths.push(m);
  }
  if (snapshotMonths.length === 0) return null;

  const getEventMonth = (periodIndex) => {
    if (frequency === "monthly") return periodIndex;
    if (frequency === "fortnightly") return Math.floor(periodIndex * 12 / 26);
    return Math.floor(periodIndex * 12 / 52);
  };

  const refixEvents = detailResult.refixEvents || [];

  const tranches = strategy.allocations.map((alloc, idx) => {
    const trancheId = `tranche-${idx}-${alloc.productCode}`;
    const prod = nzProfile.products.find((p) => p.code === alloc.productCode);
    const displayName = prod ? prod.displayName : alloc.productCode;
    const initialBalance = alloc.amount;
    let prevBalance = initialBalance;

    const snapshots = snapshotMonths.map((snapshotMonth, snapshotIdx) => {
      const prevSnapshot = snapshotIdx > 0 ? snapshotMonths[snapshotIdx - 1] : 0;
      const windowMonths = detailResult.timeline.filter(
        (t) => t.monthIndex >= prevSnapshot && t.monthIndex < snapshotMonth
      );
      const snapshotMonthData = detailResult.timeline.find((t) => t.monthIndex === snapshotMonth - 1)
        || detailResult.timeline[detailResult.timeline.length - 1];
      const trancheAtSnapshot = snapshotMonthData?.tranches?.find((t) => t.id === trancheId);

      const rate = trancheAtSnapshot?.rate ?? 0;
      const balance = trancheAtSnapshot?.closingBalance ?? prevBalance;
      const interestPaid = windowMonths.reduce((sum, mt) => {
        const td = mt.tranches?.find((t) => t.id === trancheId);
        return sum + (td ? td.interest : 0);
      }, 0);
      const principalRepaid = prevBalance - balance;
      const windowEvents = refixEvents.filter((e) => {
        if (e.trancheId !== trancheId) return false;
        const em = getEventMonth(e.periodIndex);
        return em >= prevSnapshot && em < snapshotMonth;
      }).map((e) => {
        const newProd = nzProfile.products.find((p) => p.code === e.newProduct);
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
}

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

function deriveMediumDirection(shortOutlook, mediumOutlook) {
  if (!shortOutlook || !mediumOutlook) return 0;

  // q3 = flat → q4 becomes an independent direction question with options
  // "rise" / "flat" / "fall". Magnitude 0.6 matches the q3=rise + q4=continue
  // / q3=fall + q4=continue combos so users opting out of short-term
  // direction still get a meaningful medium-term slope.
  if (shortOutlook === "flat") {
    if (mediumOutlook === "rise") return +0.6;
    if (mediumOutlook === "fall") return -0.6;
    return 0;
  }

  // q3 expresses a direction → continue / slow / reverse semantic.
  const tier = shortOutlook.endsWith("strong") ? 1 : 0;
  const rise = shortOutlook.startsWith("rise");
  const baseMag = tier === 1 ? 1.0 : 0.6;
  const sign = rise ? 1 : -1;
  // "reverse" = same baseMag as continue but flipped direction and discounted
  // by 0.6 — a reversal of one's short-term view is treated as a softer
  // commitment than reaffirming it.
  if (mediumOutlook === "reverse")  return -sign * baseMag * 0.6;
  if (mediumOutlook === "continue") return  sign * baseMag;
  if (mediumOutlook === "slow")     return  sign * baseMag * 0.4;
  return 0;
}

function deriveRiskScore(shortOutlook, mediumOutlook, uncertainty) {
  let score = 0;
  if (shortOutlook?.endsWith("strong")) score += 2;
  else if (shortOutlook && shortOutlook !== "flat") score += 1;
  // q3=flat carries no directional risk preference — don't bump the score.
  // In flat mode, q4 options are "rise"/"flat"/"fall"; "rise" and "fall"
  // each commit to a medium-term direction and count the same as the
  // original "continue" answer in directional mode.
  const mediumConfirms =
    mediumOutlook === "continue" ||
    (shortOutlook === "flat" && (mediumOutlook === "rise" || mediumOutlook === "fall"));
  if (mediumConfirms) score += 1;
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

function getPeriodsPerYearForFrequency(frequency) {
  if (frequency === "weekly") return 52;
  if (frequency === "fortnightly") return 26;
  return 12;
}

function estimatePeriodicPayment(principal, annualRate, termYears, frequency) {
  if (!principal || principal <= 0) return 0;
  const periodsPerYear = getPeriodsPerYearForFrequency(frequency);
  const totalPeriods = Math.max(1, Math.round((termYears || 25) * periodsPerYear));
  const periodicRate = (annualRate || 0.0579) / periodsPerYear;
  if (periodicRate === 0) return principal / totalPeriods;
  const rateFactor = Math.pow(1 + periodicRate, totalPeriods);
  return (principal * periodicRate * rateFactor) / (rateFactor - 1);
}

function estimatePayoffYears(principal, annualRate, periodicPayment, frequency) {
  if (!principal || principal <= 0 || !periodicPayment || periodicPayment <= 0) return 0;
  const periodsPerYear = getPeriodsPerYearForFrequency(frequency);
  const periodicRate = (annualRate || 0.0579) / periodsPerYear;
  if (periodicRate === 0) {
    return Math.min(REPAYMENT_YEARS_MAX, principal / periodicPayment / periodsPerYear);
  }
  const interestOnlyPayment = principal * periodicRate;
  if (periodicPayment <= interestOnlyPayment) {
    return REPAYMENT_YEARS_MAX;
  }
  const periods = -Math.log(1 - (principal * periodicRate) / periodicPayment) / Math.log(1 + periodicRate);
  return Math.min(REPAYMENT_YEARS_MAX, periods / periodsPerYear);
}

function defaultPaymentForAmount(amount, frequency, annualRate) {
  return Math.round(estimatePeriodicPayment(amount, annualRate || 0.0579, 25, frequency));
}

// Minimum per-period payment that at least covers the interest portion of
// the loan. Used to validate "payment" mode in q2: a payment below this
// threshold would cause the loan balance to grow instead of amortise.
function getMinInterestPayment(loanAmount, annualRate, frequency) {
  if (!Number.isFinite(loanAmount) || loanAmount <= 0) return 0;
  if (!Number.isFinite(annualRate) || annualRate <= 0) return 0;
  const periodsPerYear = getPeriodsPerYearForFrequency(frequency);
  return (loanAmount * annualRate) / periodsPerYear;
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
    // 10% step matches the Strategy Lab default preset — coarser grid than
    // the country adapter's 5% to keep the candidate set interpretable and
    // mirror Strategy Lab's default behaviour.
    percentageStep: 0.10,
    minTrancheAmount: nzProfile.rules.minTrancheAmount,
    // Force 100% fixed-rate: maxFloating=0 ⇒ minFixed=1.0, so every candidate
    // strategy has zero floating exposure. Strategy generator's PR-1 prunes
    // any allocation with >0% floating.
    maxFloatingPercentage: 0,
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
  // Default to the median quantile scenario ("p50") — the closest match to
  // "what will most likely happen" for a non-expert user.
  const [selectedScenarioId, setSelectedScenarioId] = useState("p50");

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
    if (out.targetMode === "term" && Number.isFinite(out.targetYears) && out.targetYears > 0) {
      out.targetPayment = Math.round(
        estimatePeriodicPayment(out.loanAmount, marketRates.floating, out.targetYears, out.repaymentFrequency)
      );
    } else if (out.targetMode === "payment" && Number.isFinite(out.targetPayment) && out.targetPayment > 0) {
      out.targetYears = Math.max(
        1,
        Math.ceil(estimatePayoffYears(out.loanAmount, marketRates.floating, out.targetPayment, out.repaymentFrequency))
      );
    } else {
      out.targetPayment = defaultPaymentForAmount(out.loanAmount, out.repaymentFrequency, marketRates.floating);
    }
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

  const syncTargetFromMode = useCallback((nextMode, nextLoanAmount, nextYears, nextPayment, nextFrequency) => {
    const loan = Number.isFinite(nextLoanAmount) ? nextLoanAmount : loanAmount;
    const frequency = nextFrequency || repaymentFrequency;
    if (nextMode === "term") {
      if (Number.isFinite(nextYears) && nextYears > 0) {
        const payment = Math.round(estimatePeriodicPayment(loan, marketRates.floating, nextYears, frequency));
        setTargetYears(nextYears);
        setTargetPayment(payment);
      } else {
        setTargetYears(nextYears);
        setTargetPayment(NaN);
      }
      return;
    }
    if (Number.isFinite(nextPayment) && nextPayment > 0) {
      const years = Math.max(1, Math.ceil(estimatePayoffYears(loan, marketRates.floating, nextPayment, frequency)));
      setTargetPayment(nextPayment);
      setTargetYears(years);
    } else {
      setTargetPayment(nextPayment);
      setTargetYears(NaN);
    }
  }, [loanAmount, marketRates.floating, repaymentFrequency]);

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
  // Mirrors the Strategy Lab pipeline: 200-sample Monte Carlo pool is
  // aggregated into 3 quantile scenarios (P10/P50/P90) and a probability-
  // weighted expected scenario, then handed to the worker as 4 deterministic
  // `RateScenario`s. The raw MC pool is never sent to the simulation engine.
  const buildExpectedPolicyPath = (/** @type {any[]} */ quantileScenarios) => {
    if (!Array.isArray(quantileScenarios) || quantileScenarios.length === 0) return [];
    const template = quantileScenarios[0].policyRatePath || [];
    // Quantile scenarios carry tail-mass probabilities (P10/P50/P90 = 0.1/0.5/0.1,
    // sum 0.7 — see buildQuantileScenarios). To get the true probability-weighted
    // expected rate at each month we have to divide by the total weight; otherwise
    // the expected path sits ~30% below the quantiles even when all quantiles start
    // at the same initialRate.
    const totalWeight = quantileScenarios.reduce((sum, sc) => sum + (sc.probability || 0), 0) || 1;
    return template.map((/** @type {any} */ point, /** @type {number} */ idx) => ({
      month: point.month,
      value: quantileScenarios.reduce(
        (sum, scenario) => sum + (scenario.probability || 0) * (scenario.policyRatePath[idx]?.rate || 0),
        0
      ) / totalWeight
    }));
  };

  const scenarios = useMemo(() => {
    if (!shortOutlook || !mediumOutlook || !uncertainty) return null;
    try {
      // Stage 1a: raw MC pool — 3 families × 200 samples = 600 paths. Used
      // only to derive quantile/expected scenarios; never sent to the worker.
      const mcScenarios = generateScenarios({
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
          monteCarloSampleCount: 200
        }
      });

      // Stage 1b: 3 quantile scenarios from the MC pool.
      const quantileScenarios = buildQuantileScenarios(
        mcScenarios,
        [0.1, 0.5, 0.9],
        { forecastMonths, currentProductRates: marketRates, betas: nzBetas, products: nzProfile.products }
      );

      // Stage 1c: probability-weighted expected path + 4th scenario.
      const expectedPath = buildExpectedPolicyPath(quantileScenarios);
      const expectedScenario = {
        id: "expected",
        countryCode: "NZ",
        name: "Expected",
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

      return [...quantileScenarios, expectedScenario];
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

  // "Start over" / "Try different answers" buttons must NOT clear the user's
  // inputs — they are navigation aids only. They take the user back to q1 so
  // they can tweak answers and re-run the simulation with their existing
  // loan amount, target, outlook, etc. preserved.
  const goToFirstQuestion = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    setPhase("form");
    setError(null);
    setSimError(null);
    setStep("q1");
  }, []);

  // ---- Validation per step -----------------------------------------------
  // q1/q2 enforce NZ-typical mortgage ranges (NZ_AMOUNT_*, NZ_TERM_*, see top
  // of file). q2 payment mode additionally checks that the per-period payment
  // covers the interest portion of the loan at the worst-case (floating) rate
  // — otherwise the balance would grow and the amortisation engine would loop.
  const canAdvance = useMemo(() => {
    switch (step) {
      case "welcome": return true;
      case "q1":
        return Number.isFinite(loanAmount)
          && loanAmount >= NZ_AMOUNT_MIN
          && loanAmount <= NZ_AMOUNT_MAX;
      case "q2":
        if (targetMode === "term") {
          return Number.isFinite(targetYears)
            && targetYears >= NZ_TERM_MIN_YEARS
            && targetYears <= NZ_TERM_MAX_YEARS;
        }
        // payment mode
        if (!Number.isFinite(targetPayment) || targetPayment <= 0) return false;
        const minInterest = getMinInterestPayment(
          loanAmount,
          marketRates?.floating ?? 0.0579,
          repaymentFrequency
        );
        return targetPayment >= minInterest;
      case "q3": return !!shortOutlook;
      case "q4": return !!mediumOutlook;
      case "q5": return !!uncertainty;
      case "q6": return forecastYears >= FORECAST_YEARS_MIN && forecastYears <= FORECAST_YEARS_MAX;
      case "ocr": return !!scenarios;
      default: return true;
    }
  }, [step, loanAmount, targetMode, targetYears, targetPayment, repaymentFrequency,
      shortOutlook, mediumOutlook, uncertainty, forecastYears, scenarios, marketRates]);

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
    const baseScenario = scenarios.find((s) => s.id === "p50") || scenarios[0];
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
      const detailStrategy = allStrategies.find((s) => s.id === strategyId);
      setDetailTimelineData(buildDetailTimelineDataFromResult({
        detailResult: res,
        strategy: detailStrategy,
        mortgage
      }));
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
  // Three-axis branching that matches the questionnaire structure:
  //   - q3 = "flat"      → flat summary + q4 (rise/flat/fall) trajectory
  //   - q3 = "rise*"     → rise summary + q4 (continue/slow) trajectory
  //   - q3 = "fall*"     → fall summary + q4 (continue/slow) trajectory
  // Previously the q3=flat path silently fell through to the fall-summary
  // branch, producing "下降约 0.00%" — neither direction nor magnitude.
  const ocrSummary = useMemo(() => {
    if (!scenarios || !shortOutlook) return "";
    const isFlat = shortOutlook === "flat";
    const isRise = !isFlat && shortOutlook.startsWith("rise");

    let trajKey;
    if (isFlat) {
      if (mediumOutlook === "rise")      trajKey = "lab.ocr.traj.indep.rise";
      else if (mediumOutlook === "fall") trajKey = "lab.ocr.traj.indep.fall";
      else                                trajKey = "lab.ocr.traj.indep.flat";
    } else if (mediumOutlook === "continue") {
      trajKey = isRise ? "lab.ocr.traj.continue.rise" : "lab.ocr.traj.continue.fall";
    } else if (mediumOutlook === "slow") {
      trajKey = isRise ? "lab.ocr.traj.slow.rise" : "lab.ocr.traj.slow.fall";
    } else {
      // q4 = "reverse" or any other value — map to the same trajectory as
      // "continue" but with reversed semantic implied by the chart.
      trajKey = isRise ? "lab.ocr.traj.continue.fall" : "lab.ocr.traj.continue.rise";
    }

    const traj = t(trajKey);
    if (isFlat) {
      return t("lab.ocr.summary.flat", { traj });
    }
    const delta = Math.abs(SHORT_TO_DELTA[shortOutlook] || 0) * 100;
    const baseKey = isRise ? "lab.ocr.summary.rise" : "lab.ocr.summary.fall";
    return t(baseKey, { pct: delta.toFixed(2), traj });
  }, [scenarios, shortOutlook, mediumOutlook, t]);

  // ---- Chart series (only when scenarios exist) ---------------------------
  // Lab's 4 active scenarios arrive in order [P10, P50, P90, expected].
  // Map them to the same green/indigo/red palette the v1 lab used for
  // low/base/high, plus a dashed white "expected" line — matching the
  // Strategy Lab chart semantics so users get a consistent visual across
  // both pages. SvgChart expects `points: [{month, value}]`.
  const chartSeries = useMemo(() => {
    if (!scenarios) return [];
    const styles = [
      { color: "#10b981", label: t("lab.ocr.low") },       // P10  (low/optimistic)
      { color: "#6366f1", label: t("lab.ocr.base") },      // P50  (median)
      { color: "#f43f5e", label: t("lab.ocr.high") },      // P90  (high/pessimistic)
      { color: "#f8fafc", label: t("lab.ocr.expected"), strokeDasharray: "6 6", strokeOpacity: 0.85 } // expected
    ];
    return scenarios.map((sc, idx) => {
      const style = styles[idx] || { color: "#6366f1", label: sc.id };
      const path = Array.isArray(sc.policyRatePath) ? sc.policyRatePath : [];
      return {
        id: sc.id || `scenario-${idx}`,
        name: style.label,
        color: style.color,
        ...(style.strokeDasharray ? { strokeDasharray: style.strokeDasharray } : {}),
        ...(style.strokeOpacity ? { strokeOpacity: style.strokeOpacity } : {}),
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

  // Per-scenario view of the recommended strategy. When the user picks a
  // different rate-future pill, we look up the matching row in simResults
  // (which already contains all strategy × scenario rows from the worker)
  // and surface that row's raw metrics. Falls back to null when the row
  // can't be found — render-side then falls back to enrichedTopRec.expected*.
  const scenarioMetrics = useMemo(() => {
    if (!enrichedTopRec || !Array.isArray(simResults) || simResults.length === 0) return null;
    const row = simResults.find(
      (r) => r && r.strategyId === enrichedTopRec.strategyId && r.scenarioId === selectedScenarioId
    );
    if (!row) return null;
    return {
      interest: Number(row.totalInterest) || 0,
      maxPayment: Number(row.maximumPayment) || 0,
      endingBalance: Number(row.endingBalance) || 0
    };
  }, [enrichedTopRec, simResults, selectedScenarioId]);

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
                if (raw === "") {
                  setLoanAmount(NaN);
                  setTargetYears(NaN);
                  setTargetPayment(NaN);
                  return;
                }
                const v = parseInt(raw, 10);
                if (!Number.isFinite(v)) {
                  setLoanAmount(NaN);
                  setTargetYears(NaN);
                  setTargetPayment(NaN);
                  return;
                }
                setLoanAmount(v);
                if (targetMode === "term") {
                  syncTargetFromMode("term", v, targetYears, targetPayment, repaymentFrequency);
                } else {
                  syncTargetFromMode("payment", v, targetYears, targetPayment, repaymentFrequency);
                }
              }}
              min={NZ_AMOUNT_MIN}
              step={1000}
              prefix="$"
              align="left"
              size="lg"
              inputMode="numeric"
              className="lab-number-input"
            />
            {(loanAmount < NZ_AMOUNT_MIN || loanAmount > NZ_AMOUNT_MAX) && (
              <p className="form-error">{t("lab.error.amount")}</p>
            )}
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
                      value={Number.isFinite(targetYears) ? targetYears : ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === "") {
                          setTargetYears(NaN);
                          setTargetPayment(NaN);
                          return;
                        }
                        const v = parseInt(raw, 10);
                        if (!Number.isFinite(v)) {
                          setTargetYears(NaN);
                          setTargetPayment(NaN);
                          return;
                        }
                        syncTargetFromMode("term", loanAmount, v, targetPayment, repaymentFrequency);
                      }}
                      min={NZ_TERM_MIN_YEARS}
                      max={NZ_TERM_MAX_YEARS}
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
                  {targetMode === "term" ? t("lab.choice.selected") : t("lab.choice.autoCalculated")}
                </span>
                {targetMode === "term" && Number.isFinite(targetYears) && (targetYears < NZ_TERM_MIN_YEARS || targetYears > NZ_TERM_MAX_YEARS) && (
                  <p className="form-error q2-error">{t("lab.error.years")}</p>
                )}
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
                      value={Number.isFinite(targetPayment) ? targetPayment : ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === "") {
                          setTargetPayment(NaN);
                          setTargetYears(NaN);
                          return;
                        }
                        const v = parseInt(raw, 10);
                        if (!Number.isFinite(v)) {
                          setTargetPayment(NaN);
                          setTargetYears(NaN);
                          return;
                        }
                        syncTargetFromMode("payment", loanAmount, targetYears, v, repaymentFrequency);
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
                  {targetMode === "payment" ? t("lab.choice.selected") : t("lab.choice.autoCalculated")}
                </span>
                {targetMode === "payment" && Number.isFinite(targetPayment) && targetPayment > 0 && (() => {
                  const minPay = getMinInterestPayment(loanAmount, marketRates?.floating ?? 0.0579, repaymentFrequency);
                  return targetPayment < minPay ? (
                    <p className="form-error q2-error">{t("lab.error.payment.tooSmall", { min: Math.ceil(minPay) })}</p>
                  ) : null;
                })()}
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
                    onClick={() => {
                      setRepaymentFrequency(f);
                      if (targetMode === "term") {
                        syncTargetFromMode("term", loanAmount, targetYears, targetPayment, f);
                      } else {
                        syncTargetFromMode("payment", loanAmount, targetYears, targetPayment, f);
                      }
                    }}
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
                { value: "flat",        label: "→",  text: t("lab.q3.flat"),       tone: "primary" },
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

      case "q4": {
        // When q3 = "flat", q4 becomes an independent 3-way direction question
        // (rise / flat / fall) with its own title and hint. Otherwise we keep
        // the original continue/slow semantic with the q3-derived title.
        const flatMode = shortOutlook === "flat";
        const q4Title = flatMode
          ? t("lab.q4.indep.title")
          : (shortOutlook?.startsWith("rise")
              ? t("lab.q4.title.rise")
              : t("lab.q4.title.fall"));
        const q4Hint = flatMode ? t("lab.q4.indep.hint") : t("lab.q4.hint");
        const q4Buttons = flatMode
          ? [
              { value: "rise", label: "↗", text: t("lab.q4.indep.rise"), tone: "amber" },
              { value: "flat", label: "→", text: t("lab.q4.indep.flat"), tone: "primary" },
              { value: "fall", label: "↘", text: t("lab.q4.indep.fall"), tone: "teal" }
            ]
          : [
              { value: "continue", label: "→", text: t("lab.q4.continue"), tone: "amber" },
              { value: "slow",     label: "~", text: t("lab.q4.slow"),     tone: "cyan" },
              // Rose tone signals "you're going against your earlier q3 choice";
              // the parameter derivation discounts reverse to 0.6× the equivalent
              // continue strength (see deriveMediumDirection).
              { value: "reverse",  label: "↩", text: t("lab.q4.reverse"),  tone: "rose" }
            ];
        return (
          <div className="glass-panel accent-amber wizard-step">
            <h2 className="card-header"><span className="card-header-accent" />{q4Title}</h2>
            <p className="wizard-step-hint">{q4Hint}</p>
            <div className="choice-grid q4-grid">
              {q4Buttons.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`choice-card tone-${opt.tone} ${mediumOutlook === opt.value ? "selected" : ""}`}
                  onClick={() => setMediumOutlook(opt.value)}
                  aria-pressed={mediumOutlook === opt.value}
                >
                  <span className="choice-card-glyph" aria-hidden="true">{opt.label}</span>
                  <span className="choice-card-label">{opt.text}</span>
                  {mediumOutlook === opt.value && <span className="choice-card-status">{t("lab.choice.selected")}</span>}
                </button>
              ))}
            </div>
          </div>
        );
      }

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
              <div className="rec-card-wrap">
                <div
                  className="scenario-picker"
                  role="tablist"
                  aria-label={t("lab.results.scenarioPicker.aria")}
                >
                  <button
                    type="button"
                    role="tab"
                    className="scenario-picker-btn scenario-picker-btn-fall"
                    aria-selected={selectedScenarioId === "p10"}
                    onClick={() => setSelectedScenarioId("p10")}
                  >
                    <span className="scenario-picker-btn-icon-wrap" aria-hidden="true">
                      <TrendIcon direction="fall" />
                    </span>
                    <span className="scenario-picker-btn-label">{t("lab.results.scenarioPicker.low")}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    className="scenario-picker-btn scenario-picker-btn-flat"
                    aria-selected={selectedScenarioId === "p50"}
                    onClick={() => setSelectedScenarioId("p50")}
                  >
                    <span className="scenario-picker-btn-icon-wrap" aria-hidden="true">
                      <TrendIcon direction="flat" />
                    </span>
                    <span className="scenario-picker-btn-label">{t("lab.results.scenarioPicker.base")}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    className="scenario-picker-btn scenario-picker-btn-rise"
                    aria-selected={selectedScenarioId === "p90"}
                    onClick={() => setSelectedScenarioId("p90")}
                  >
                    <span className="scenario-picker-btn-icon-wrap" aria-hidden="true">
                      <TrendIcon direction="rise" />
                    </span>
                    <span className="scenario-picker-btn-label">{t("lab.results.scenarioPicker.high")}</span>
                  </button>
                </div>
                <p className="scenario-picker-hint">{t("lab.results.scenarioPicker.hint")}</p>
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
                      <span className="stat-tile-val">{formatMoney(scenarioMetrics?.interest ?? (Number(enrichedTopRec.expectedInterest) || 0))}</span>
                    </div>
                    <div className="stat-tile">
                      <span className="stat-tile-lbl">{t("lab.results.metrics.maxPayment")}</span>
                      <span className="stat-tile-val">{formatMoney(scenarioMetrics?.maxPayment ?? (Number(enrichedTopRec.expectedMaxPayment) || 0))}</span>
                    </div>
                    <div className="stat-tile">
                      <span className="stat-tile-lbl">{t("lab.results.metrics.endingBalance", { years: normalizedForecastYears })}</span>
                      <span className="stat-tile-val">{formatMoney(scenarioMetrics?.endingBalance ?? (Number(enrichedTopRec.expectedEndingBalance) || 0))}</span>
                    </div>
                    <div className="stat-tile">
                      <span className="stat-tile-lbl">{t("lab.results.metrics.principal")}</span>
                      <span className="stat-tile-val">
                        {formatMoney(Math.max(0, loanAmount - (scenarioMetrics?.endingBalance ?? (Number(enrichedTopRec.expectedEndingBalance) || 0))))}
                      </span>
                    </div>
                  </div>
                  <p className="rec-intro">{whyThisOneIntro}</p>
                  <div className="rec-actions">
                    <button
                      ref={triggerBtnRef}
                      type="button"
                      className="btn btn-primary rec-action-btn rec-action-btn-primary"
                      onClick={(e) => openDetail(enrichedTopRec.strategyId, e.currentTarget)}
                    >
                      <span className="rec-action-copy">
                        <span className="rec-action-icon-wrap" aria-hidden="true">
                          <DetailsIcon />
                        </span>
                        <span>{t("lab.results.seeDetails")}</span>
                      </span>
                      <span className="rec-action-arrow" aria-hidden="true">
                        <ArrowRightIcon />
                      </span>
                    </button>
                    <button
                      ref={upgradeBtnRef}
                      type="button"
                      className="btn btn-secondary rec-action-btn rec-action-btn-secondary"
                      onClick={(e) => {
                        upgradeBtnRef.current = e.currentTarget;
                        setPremiumPopupOpen(true);
                      }}
                    >
                      <span className="rec-action-copy">
                        <span className="rec-action-icon-wrap" aria-hidden="true">
                          <SparkleIcon />
                        </span>
                        <span>{t("lab.results.upgrade")}</span>
                      </span>
                    </button>
                    <button type="button" className="btn btn-ghost rec-action-btn rec-action-btn-tertiary" onClick={goToFirstQuestion}>
                      <span className="rec-action-copy">
                        <span className="rec-action-icon-wrap" aria-hidden="true">
                          <RefreshIcon />
                        </span>
                        <span>{t("lab.results.startOver")}</span>
                      </span>
                    </button>
                  </div>
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
          <button type="button" className="wizard-reset-link" onClick={goToFirstQuestion} disabled={phase === "running"}>
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
        /* Error message inside the option row — must span all 3 grid
           columns, otherwise it lands in the 42px icon column and wraps
           one word per line. */
        .q2-error {
          grid-column: 1 / -1;
          margin-top: 6px;
          padding-left: 56px;
          font-weight: 500;
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
          min-width: 118px;
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
          color: rgba(191, 219, 254, 0.72);
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

        /* ===== Results — scenario picker (rate-future switcher) ===== */
        .rec-card-wrap {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .scenario-picker {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .scenario-picker-btn {
          --scenario-accent: #6366f1;
          --scenario-accent-soft: rgba(99, 102, 241, 0.14);
          flex: 1 1 0;
          min-width: 0;
          padding: 12px 16px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: var(--text-primary, #e5e7eb);
          font: inherit;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition:
            background 140ms ease,
            border-color 140ms ease,
            color 140ms ease,
            box-shadow 140ms ease,
            transform 140ms ease;
          white-space: nowrap;
          text-align: center;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
        }
        .scenario-picker-btn:hover:not([aria-selected="true"]) {
          background: var(--scenario-accent-soft);
          border-color: color-mix(in srgb, var(--scenario-accent) 55%, white 12%);
          transform: translateY(-1px);
        }
        .scenario-picker-btn:focus-visible {
          outline: 2px solid var(--scenario-accent);
          outline-offset: 2px;
        }
        .scenario-picker-btn[aria-selected="true"] {
          background: color-mix(in srgb, var(--scenario-accent) 20%, rgba(255, 255, 255, 0.04));
          border-color: color-mix(in srgb, var(--scenario-accent) 65%, white 6%);
          color: #fff;
          font-weight: 600;
          box-shadow: 0 8px 18px color-mix(in srgb, var(--scenario-accent) 24%, transparent);
        }
        .scenario-picker-btn-fall {
          --scenario-accent: #10b981;
          --scenario-accent-soft: rgba(16, 185, 129, 0.14);
        }
        .scenario-picker-btn-flat {
          --scenario-accent: #6366f1;
          --scenario-accent-soft: rgba(99, 102, 241, 0.14);
        }
        .scenario-picker-btn-rise {
          --scenario-accent: #f59e0b;
          --scenario-accent-soft: rgba(245, 158, 11, 0.14);
        }
        .scenario-picker-btn-icon-wrap {
          width: 28px;
          height: 28px;
          flex: none;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: color-mix(in srgb, var(--scenario-accent) 18%, rgba(255, 255, 255, 0.04));
          border: 1px solid color-mix(in srgb, var(--scenario-accent) 34%, rgba(255, 255, 255, 0.08));
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
        }
        .scenario-picker-icon {
          width: 16px;
          height: 16px;
          stroke: var(--scenario-accent);
          stroke-width: 2.2;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        .scenario-picker-btn-label {
          min-width: 0;
        }
        .scenario-picker-hint {
          font-size: 12px;
          color: var(--text-secondary, #94a3b8);
          margin: 0 4px 4px;
          max-width: 1120px;
          line-height: 1.5;
        }

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
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 14px;
          align-items: stretch;
          margin-top: 2px;
        }
        .rec-actions :global(.btn) {
          width: 100%;
          min-width: 0;
        }
        .rec-action-btn {
          min-height: 62px;
          padding: 16px 18px;
          border-radius: 18px;
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 0.01em;
          transition:
            transform 180ms ease,
            box-shadow 180ms ease,
            border-color 180ms ease,
            background-color 180ms ease,
            color 180ms ease,
            filter 180ms ease;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
        }
        .rec-action-btn:hover:not(:disabled) {
          transform: translateY(-2px);
        }
        .rec-action-btn:active:not(:disabled) {
          transform: translateY(0) scale(0.99);
        }
        .rec-action-btn:focus-visible {
          outline: 2px solid rgba(99, 102, 241, 0.9);
          outline-offset: 3px;
        }
        .rec-action-copy {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }
        .rec-action-icon-wrap {
          width: 34px;
          height: 34px;
          border-radius: 12px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex: none;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
        }
        .rec-action-icon {
          width: 18px;
          height: 18px;
          stroke: currentColor;
          stroke-width: 2;
          stroke-linecap: round;
          stroke-linejoin: round;
          opacity: 0.96;
        }
        .rec-action-arrow {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-left: auto;
          width: 30px;
          height: 30px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.08);
          flex: none;
        }
        .rec-action-arrow-icon {
          width: 16px;
          height: 16px;
          stroke: currentColor;
          stroke-width: 2.2;
          stroke-linecap: round;
          stroke-linejoin: round;
          opacity: 0.95;
        }
        .rec-actions .rec-action-btn-primary {
          justify-content: space-between;
          background: linear-gradient(135deg, #7c6cf7 0%, #6c63ff 54%, #8b5cf6 100%);
          color: #fff;
          border: 1px solid rgba(255, 255, 255, 0.12);
          box-shadow: 0 16px 30px rgba(99, 102, 241, 0.32);
        }
        .rec-actions .rec-action-btn-primary:hover:not(:disabled) {
          filter: brightness(1.04);
          box-shadow: 0 20px 36px rgba(99, 102, 241, 0.42);
        }
        .rec-actions .rec-action-btn-primary .rec-action-icon-wrap,
        .rec-actions .rec-action-btn-primary .rec-action-arrow {
          background: rgba(255, 255, 255, 0.14);
          border-color: rgba(255, 255, 255, 0.14);
        }
        .rec-actions .rec-action-btn-secondary {
          justify-content: flex-start;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.035));
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: var(--text-primary);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
        }
        .rec-actions .rec-action-btn-secondary:hover:not(:disabled) {
          background: linear-gradient(180deg, rgba(16, 185, 129, 0.14), rgba(16, 185, 129, 0.08));
          border-color: rgba(16, 185, 129, 0.26);
          box-shadow: 0 16px 28px rgba(16, 185, 129, 0.14);
        }
        .rec-actions .rec-action-btn-secondary .rec-action-icon-wrap {
          background: rgba(16, 185, 129, 0.12);
          border-color: rgba(16, 185, 129, 0.22);
          color: #34d399;
        }
        .rec-actions .rec-action-btn-tertiary {
          justify-content: flex-start;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.02));
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: var(--text-secondary);
        }
        .rec-actions .rec-action-btn-tertiary:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.07);
          border-color: rgba(255, 255, 255, 0.14);
          color: var(--text-primary);
          box-shadow: 0 12px 24px rgba(0, 0, 0, 0.14);
        }
        .rec-actions .rec-action-btn-tertiary .rec-action-icon-wrap {
          background: rgba(255, 255, 255, 0.055);
          border-color: rgba(255, 255, 255, 0.08);
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
          .rec-actions { grid-template-columns: 1fr; }
          .rec-action-btn { min-height: 58px; }
          .scenario-picker-btn {
            padding: 10px 12px;
            font-size: 13px;
            gap: 8px;
          }
          .scenario-picker-btn-icon-wrap {
            width: 26px;
            height: 26px;
          }
        }
      `}</style>
    </div>
  );
}
