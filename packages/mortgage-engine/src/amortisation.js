import { roundMoney, addDays, addMonths } from "./utils.js";
export { addMonths };
import { determineRefixProduct, getProductFixedMonths, getRateForMonth } from "./refix.js";

/** @typedef {import("@mortgage/schemas").Mortgage} Mortgage */
/** @typedef {import("@mortgage/schemas").RateScenario} RateScenario */
/** @typedef {import("@mortgage/schemas").MortgageTranche} MortgageTranche */
/** @typedef {import("@mortgage/schemas").ExtraRepayment} ExtraRepayment */
/** @typedef {import("@mortgage/schemas").MortgageProductDefinition} MortgageProductDefinition */
/** @typedef {import("@mortgage/schemas").RefixRule} RefixRule */

/**
 * Calculates the number of remaining periods based on months and repayment frequency.
 * @param {number} termMonths - Remaining term in months
 * @param {"weekly"|"fortnightly"|"monthly"} frequency - Repayment frequency
 * @returns {number} Integer number of remaining periods
 */
export function getRemainingPeriods(termMonths, frequency) {
  switch (frequency) {
    case "weekly":
      return Math.round(termMonths * 52 / 12);
    case "fortnightly":
      return Math.round(termMonths * 26 / 12);
    case "monthly":
      return termMonths;
    default:
      throw new Error(`Invalid frequency: ${frequency}`);
  }
}

/**
 * Gets the number of payment periods per calendar year.
 * @param {"weekly"|"fortnightly"|"monthly"} frequency - Repayment frequency
 * @returns {number} Number of periods per year
 */
export function getPeriodsPerYear(frequency) {
  switch (frequency) {
    case "weekly":
      return 52;
    case "fortnightly":
      return 26;
    case "monthly":
      return 12;
    default:
      throw new Error(`Invalid frequency: ${frequency}`);
  }
}

/**
 * Calculates the scheduled payment amount for a tranche.
 * @param {Object} input
 * @param {number} input.balance - Current balance of the tranche
 * @param {number} input.annualRate - Annual interest rate (decimal, e.g. 0.0525)
 * @param {number} input.remainingTermMonths - Remaining term of the tranche in months
 * @param {"principal-and-interest"|"interest-only"} input.repaymentType - Repayment type
 * @param {"weekly"|"fortnightly"|"monthly"} input.frequency - Repayment frequency
 * @returns {number} The scheduled payment amount, rounded to 2 decimal places
 */
export function calculateScheduledPayment({
  balance,
  annualRate,
  remainingTermMonths,
  repaymentType,
  frequency
}) {
  if (balance <= 0) {
    return 0;
  }
  
  const periods = getRemainingPeriods(remainingTermMonths, frequency);
  if (periods <= 0) {
    return roundMoney(balance);
  }

  const periodsPerYear = getPeriodsPerYear(frequency);
  const periodicRate = annualRate / periodsPerYear;

  if (repaymentType === "interest-only") {
    return roundMoney(balance * periodicRate);
  }

  if (periodicRate === 0) {
    return roundMoney(balance / periods);
  }

  const rateFactor = Math.pow(1 + periodicRate, periods);
  const payment = balance * (periodicRate * rateFactor) / (rateFactor - 1);
  return roundMoney(payment);
}

/**
 * Sorts tranches for allocation of general (non-targeted) extra repayments.
 * Order: Floating/Offset/Revolving products first, then highest interest rate first.
 * @param {any[]} tranches - Active tranches list
 * @returns {any[]} Sorted tranches copy
 */
export function sortTranchesForExtraRepayment(tranches) {
  return [...tranches].sort((a, b) => {
    const aIsFloating = ["floating", "offset", "revolving"].includes(a.productCode);
    const bIsFloating = ["floating", "offset", "revolving"].includes(b.productCode);

    if (aIsFloating && !bIsFloating) {
      return -1;
    }
    if (!aIsFloating && bIsFloating) {
      return 1;
    }

    return b.annualRate - a.annualRate;
  });
}

/**
 * Simulates the amortization timeline for a mortgage under a given scenario.
 * @param {Object} input
 * @param {Mortgage} input.mortgage - The Mortgage object containing tranches and base terms
 * @param {RateScenario} input.scenario - The RateScenario containing forecasting paths
 * @param {string} [input.startDate] - Start date of the simulation (defaults to YYYY-MM-DD from today)
 * @param {number} [input.forecastMonths] - Number of months to forecast (default 36)
 * @param {RefixRule} [input.refixRule] - Default refix rule for matured tranches
 * @param {MortgageProductDefinition[]} [input.products] - Supported products list
 * @returns {any} Full simulation results including timeline and totals
 */
export function simulateMortgageTimeline({
  mortgage,
  scenario,
  startDate,
  forecastMonths = 36,
  refixRule,
  products = []
}) {
  const start = startDate || new Date().toISOString().split("T")[0];
  const frequency = mortgage.repaymentFrequency;
  const totalPeriods = getRemainingPeriods(forecastMonths, frequency);
  const periodsPerYear = getPeriodsPerYear(frequency);

  // Initialize tranche states
  /** @type {any[]} */
  const trancheStates = mortgage.tranches.map((/** @type {any} */ t) => ({
    id: t.id,
    productCode: t.productCode,
    balance: t.balance,
    annualRate: t.annualRate,
    fixedUntil: t.fixedUntil,
    originalRemainingTermMonths: t.remainingTermMonths,
    repaymentType: t.repaymentType,
    refixCount: 0,
    scheduledPayment: calculateScheduledPayment({
      balance: t.balance,
      annualRate: t.annualRate,
      remainingTermMonths: t.remainingTermMonths,
      repaymentType: t.repaymentType,
      frequency
    })
  }));

  /** @type {any[]} */
  const periodsTimeline = [];
  /** @type {any[]} */
  const refixEvents = [];

  let totalInterestPaid = 0;
  let totalPaymentsPaid = 0;

  for (let p = 0; p < totalPeriods; p++) {
    // Determine calendar date and month index of current period
    let currentDate;
    let monthIndex;

    if (frequency === "monthly") {
      currentDate = addMonths(start, p);
      monthIndex = p;
    } else if (frequency === "fortnightly") {
      currentDate = addDays(start, p * 14);
      monthIndex = Math.floor(p * 12 / 26);
    } else {
      currentDate = addDays(start, p * 7);
      monthIndex = Math.floor(p * 12 / 52);
    }

    // Step 1: Handle tranche refix & floating adjustments
    trancheStates.forEach((/** @type {any} */ tranche) => {
      if (tranche.balance <= 0) {
        return;
      }

      const elapsedMonths = monthIndex;
      const remainingTerm = Math.max(1, tranche.originalRemainingTermMonths - elapsedMonths);

      // Check if fixed period has matured
      if (tranche.fixedUntil && new Date(currentDate) >= new Date(tranche.fixedUntil)) {
        const prevProduct = tranche.productCode;
        const prevRate = tranche.annualRate;

        // Perform refix
        tranche.productCode = determineRefixProduct(prevProduct, refixRule, tranche.refixCount);
        tranche.refixCount += 1;

        const fixedMonths = getProductFixedMonths(tranche.productCode, products);
        tranche.fixedUntil = fixedMonths ? addMonths(currentDate, fixedMonths) : null;

        const path = scenario.productRatePaths[tranche.productCode] || [];
        tranche.annualRate = getRateForMonth(path, monthIndex);

        // Re-calculate payment
        tranche.scheduledPayment = calculateScheduledPayment({
          balance: tranche.balance,
          annualRate: tranche.annualRate,
          remainingTermMonths: remainingTerm,
          repaymentType: tranche.repaymentType,
          frequency
        });

        refixEvents.push({
          trancheId: tranche.id,
          periodIndex: p,
          date: currentDate,
          prevProduct,
          newProduct: tranche.productCode,
          prevRate,
          newRate: tranche.annualRate,
          balance: tranche.balance
        });
      }
      // If tranche is floating, update its rate periodically
      else if (!tranche.fixedUntil) {
        const path = scenario.productRatePaths[tranche.productCode] || [];
        const currentPathRate = getRateForMonth(path, monthIndex);

        if (tranche.annualRate !== currentPathRate) {
          tranche.annualRate = currentPathRate;
          tranche.scheduledPayment = calculateScheduledPayment({
            balance: tranche.balance,
            annualRate: tranche.annualRate,
            remainingTermMonths: remainingTerm,
            repaymentType: tranche.repaymentType,
            frequency
          });
        }
      }
    });

    // Step 2: Sum interest and scheduled payments for active tranches
    /** @type {any[]} */
    const periodTrancheDetails = [];
    let periodScheduledTotal = 0;
    let periodInterestTotal = 0;

    trancheStates.forEach((/** @type {any} */ tranche) => {
      if (tranche.balance <= 0) {
        periodTrancheDetails.push({
          id: tranche.id,
          openingBalance: 0,
          interest: 0,
          scheduledPayment: 0,
          extraRepayment: 0,
          closingBalance: 0,
          rate: tranche.annualRate
        });
        return;
      }

      const periodicRate = tranche.annualRate / periodsPerYear;
      const interest = roundMoney(tranche.balance * periodicRate);
      let scheduled = tranche.scheduledPayment;

      // For Interest-Only, scheduled payment matches interest
      if (tranche.repaymentType === "interest-only") {
        scheduled = interest;
      }

      periodScheduledTotal += scheduled;
      periodInterestTotal += interest;

      periodTrancheDetails.push({
        id: tranche.id,
        openingBalance: tranche.balance,
        interest,
        scheduledPayment: scheduled,
        extraRepayment: 0, // Will be populated in Step 3
        closingBalance: 0, // Will be populated in Step 3
        rate: tranche.annualRate
      });
    });

    // Step 3: Handle extra repayments (targeted & general)
    let generalExtraAmount = 0;
    // Simple mock extra repayment retrieval for MVP.
    // In full implementation, extra repayments are filtered by date and tranche id
    mortgage.extraRepayments.forEach((/** @type {any} */ extra) => {
      // Check if extra repayment is active at this currentDate
      if (currentDate >= extra.startDate && (!extra.endDate || currentDate <= extra.endDate)) {
        // Match frequency or process recurring
        // For recurring, we apply it in each period of matching frequency.
        // For MVP simplicity, we assume recurring matches mortgage frequency
        const periodAmount = extra.amount;

        if (extra.targetTrancheId) {
          const detail = periodTrancheDetails.find(d => d.id === extra.targetTrancheId);
          if (detail && detail.openingBalance > 0) {
            detail.extraRepayment += periodAmount;
          }
        } else {
          generalExtraAmount += periodAmount;
        }
      }
    });

    // Distribute general extra repayments across active tranches
    // Distribute general extra repayments across active tranches
    if (mortgage.targetMode === "payment" && mortgage.targetPeriodicPayment > 0) {
      const currentTrancheTotalObligation = periodTrancheDetails.reduce((sum, d) => {
        if (d.openingBalance <= 0) return sum;
        return sum + Math.max(0, d.openingBalance + d.interest);
      }, 0);

      const targetPaymentLimit = Math.min(mortgage.targetPeriodicPayment, currentTrancheTotalObligation);
      const scheduledAndTargetedExtra = periodScheduledTotal + periodTrancheDetails.reduce((sum, d) => sum + d.extraRepayment, 0);
      const paymentDiff = targetPaymentLimit - scheduledAndTargetedExtra;

      if (paymentDiff > 0) {
        generalExtraAmount += paymentDiff;
      }
    }

    if (generalExtraAmount > 0) {
      const sortedActiveDetails = periodTrancheDetails
        .filter(d => d.openingBalance > 0)
        .map(d => ({
          detail: d,
          state: trancheStates.find((/** @type {any} */ ts) => ts.id === d.id)
        }));

      // Sort by extra repayment allocation rules
      sortedActiveDetails.sort((a, b) => {
        const aIsFloating = ["floating", "offset", "revolving"].includes(a.state.productCode);
        const bIsFloating = ["floating", "offset", "revolving"].includes(b.state.productCode);
        if (aIsFloating && !bIsFloating) {
          return -1;
        }
        if (!aIsFloating && bIsFloating) {
          return 1;
        }
        return b.state.annualRate - a.state.annualRate;
      });

      let remainingExtra = generalExtraAmount;
      for (const item of sortedActiveDetails) {
        if (remainingExtra <= 0) {
          break;
        }
        const maxAllocatable = roundMoney(
          item.detail.openingBalance + item.detail.interest - item.detail.scheduledPayment - item.detail.extraRepayment
        );
        if (maxAllocatable > 0) {
          const allocation = Math.min(remainingExtra, maxAllocatable);
          item.detail.extraRepayment += allocation;
          remainingExtra = roundMoney(remainingExtra - allocation);
        }
      }
    }

    // Step 4: Finalize period balances & payments
    let periodActualPaymentTotal = 0;
    let periodActualExtraTotal = 0;

    periodTrancheDetails.forEach(detail => {
      if (detail.openingBalance <= 0) {
        return;
      }

      const trancheState = trancheStates.find((/** @type {any} */ ts) => ts.id === detail.id);
      const totalObligation = roundMoney(detail.openingBalance + detail.interest);

      let actualScheduled = detail.scheduledPayment;
      let actualExtra = detail.extraRepayment;

      if (actualScheduled + actualExtra >= totalObligation) {
        // Cap repayments so balance does not go negative
        if (actualScheduled >= totalObligation) {
          actualScheduled = totalObligation;
          actualExtra = 0;
        } else {
          actualExtra = roundMoney(totalObligation - actualScheduled);
        }
        trancheState.balance = 0;
      } else {
        trancheState.balance = roundMoney(totalObligation - (actualScheduled + actualExtra));
      }

      detail.scheduledPayment = actualScheduled;
      detail.extraRepayment = actualExtra;
      detail.closingBalance = trancheState.balance;

      periodActualPaymentTotal += roundMoney(actualScheduled + actualExtra);
      periodActualExtraTotal += actualExtra;
    });

    totalInterestPaid += periodInterestTotal;
    totalPaymentsPaid += periodActualPaymentTotal;

    periodsTimeline.push({
      periodIndex: p,
      date: currentDate,
      monthIndex,
      openingBalance: roundMoney(periodTrancheDetails.reduce((sum, d) => sum + d.openingBalance, 0)),
      interest: roundMoney(periodInterestTotal),
      scheduledPayment: roundMoney(periodScheduledTotal),
      extraRepayment: roundMoney(periodActualExtraTotal),
      closingBalance: roundMoney(trancheStates.reduce((/** @type {number} */ sum, /** @type {any} */ t) => sum + t.balance, 0)),
      tranches: periodTrancheDetails
    });
  }

  // Step 5: Aggregate period-by-period timeline to monthly timeline
  const monthlyTimelineMap = new Map();
  periodsTimeline.forEach(pRecord => {
    const m = pRecord.monthIndex;
    if (!monthlyTimelineMap.has(m)) {
      monthlyTimelineMap.set(m, {
        monthIndex: m,
        date: pRecord.date,
        openingBalance: pRecord.openingBalance, // First period in month
        interest: 0,
        scheduledPayment: 0,
        extraRepayment: 0,
        closingBalance: pRecord.closingBalance, // Overwritten by last period in month
        tranches: mortgage.tranches.map((/** @type {any} */ t) => ({
          id: t.id,
          interest: 0,
          scheduledPayment: 0,
          extraRepayment: 0,
          closingBalance: 0,
          rate: 0
        }))
      });
    }

    const monthRecord = monthlyTimelineMap.get(m);
    monthRecord.interest = roundMoney(monthRecord.interest + pRecord.interest);
    monthRecord.scheduledPayment = roundMoney(monthRecord.scheduledPayment + pRecord.scheduledPayment);
    monthRecord.extraRepayment = roundMoney(monthRecord.extraRepayment + pRecord.extraRepayment);
    monthRecord.closingBalance = pRecord.closingBalance;

    pRecord.tranches.forEach((/** @type {any} */ trancheDetail) => {
      const mTranche = monthRecord.tranches.find((/** @type {any} */ t) => t.id === trancheDetail.id);
      if (mTranche) {
        mTranche.interest = roundMoney(mTranche.interest + trancheDetail.interest);
        mTranche.scheduledPayment = roundMoney(mTranche.scheduledPayment + trancheDetail.scheduledPayment);
        mTranche.extraRepayment = roundMoney(mTranche.extraRepayment + trancheDetail.extraRepayment);
        mTranche.closingBalance = trancheDetail.closingBalance;
        mTranche.rate = trancheDetail.rate;
      }
    });
  });

  const monthlyTimeline = Array.from(monthlyTimelineMap.values());

  // Calculate final summary metrics
  const endingBalance = monthlyTimeline.length > 0 ? monthlyTimeline[monthlyTimeline.length - 1].closingBalance : mortgage.tranches.reduce((/** @type {number} */ sum, /** @type {any} */ t) => sum + t.balance, 0);
  const periodicPayments = periodsTimeline.map(p => roundMoney(p.scheduledPayment + p.extraRepayment));
  const maximumPayment = periodicPayments.length > 0 ? Math.max(...periodicPayments) : 0;
  const minimumPayment = periodicPayments.length > 0 ? Math.min(...periodicPayments) : 0;
  const averagePayment = periodicPayments.length > 0 ? roundMoney(periodicPayments.reduce((sum, val) => sum + val, 0) / periodicPayments.length) : 0;

  return {
    totalInterest: roundMoney(totalInterestPaid),
    totalRepayments: roundMoney(totalPaymentsPaid),
    endingBalance: roundMoney(endingBalance),
    maximumPayment,
    minimumPayment,
    averagePayment,
    refixEventCount: refixEvents.length,
    refixEvents,
    timeline: monthlyTimeline,
    rawPeriodsTimeline: periodsTimeline
  };
}
