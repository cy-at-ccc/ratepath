import { roundMoney, addDays, addMonths } from "./utils.js";
export { addMonths };
import { determineRefixProduct, getProductFixedMonths, getRateForMonth, calculateBreakFee } from "./refix.js";

/** @typedef {import("@mortgage/schemas").Mortgage} Mortgage */
/** @typedef {import("@mortgage/schemas").RateScenario} RateScenario */
/** @typedef {import("@mortgage/schemas").MortgageTranche} MortgageTranche */
/** @typedef {import("@mortgage/schemas").ExtraRepayment} ExtraRepayment */
/** @typedef {import("@mortgage/schemas").OffsetEvent} OffsetEvent */
/** @typedef {import("@mortgage/schemas").MortgageProductDefinition} MortgageProductDefinition */
/** @typedef {import("@mortgage/schemas").RefixRule} RefixRule */

/**
 * Floating product types eligible for offset / extra-repayment-first ordering.
 * @param {string} productCode
 * @returns {boolean}
 */
function isFloatingType(productCode) {
  return ["floating", "offset", "revolving"].includes(productCode);
}

/**
 * Counts how many trigger dates an extra repayment / offset event contributes
 * to the current period. Honours the event's own frequency field per spec 6.5.
 * @param {{type: "one-off"|"recurring", frequency: "weekly"|"fortnightly"|"monthly", startDate: string, endDate: string|null}} event
 * @param {string} periodStartDate - ISO YYYY-MM-DD of the period start
 * @param {string} periodEndDate - ISO YYYY-MM-DD of the period end (exclusive)
 * @returns {number}
 */
export function countTriggersForPeriod(event, periodStartDate, periodEndDate) {
  // For one-off, exactly one if the start date falls inside the period.
  if (event.type === "one-off") {
    return periodStartDate <= event.startDate && event.startDate < periodEndDate ? 1 : 0;
  }
  // Recurring: count trigger dates from event.startDate to periodEndDate, stepping
  // by the appropriate day interval, and within [periodStart, periodEnd).
  const stepDays = event.frequency === "weekly" ? 7 : event.frequency === "fortnightly" ? 14 : null;
  const startMs = Date.parse(periodStartDate);
  const endMs = Date.parse(periodEndDate);
  if (stepDays !== null) {
    let triggers = 0;
    // Walk forward from event.startDate by stepDays; check each candidate lies within the period.
    let cursor = Date.parse(event.startDate);
    const endCap = event.endDate ? Math.min(Date.parse(event.endDate), endMs) : endMs;
    if (event.endDate && cursor > endCap) return 0;
    // Move cursor to the first trigger >= periodStart
    if (cursor < startMs) {
      const stepMs = stepDays * 24 * 60 * 60 * 1000;
      const k = Math.ceil((startMs - cursor) / stepMs);
      cursor = cursor + k * stepMs;
    }
    while (cursor < endMs && cursor <= endCap) {
      triggers++;
      cursor = cursor + stepDays * 24 * 60 * 60 * 1000;
    }
    return triggers;
  }
  // Monthly: the day-of-month from startDate, falling on the last day of short months.
  const startD = new Date(event.startDate + "T00:00:00Z");
  const startDayOfMonth = startD.getUTCDate();
  const periodStartD = new Date(periodStartDate + "T00:00:00Z");
  const periodEndD = new Date(periodEndDate + "T00:00:00Z");
  // Walk the calendar month grid from periodStart's month (or event.startDate's month if later).
  // Iterate month-by-month, considering the day-of-month in each month.
  let triggers = 0;
  // Start cursor at max(periodStart, event.startDate)'s month.
  const startCursor = periodStartD > startD ? new Date(periodStartD) : new Date(startD);
  // Roll back to the first of that month.
  const cursor = new Date(Date.UTC(startCursor.getUTCFullYear(), startCursor.getUTCMonth(), 1));
  while (cursor < periodEndD) {
    const month = cursor.getUTCMonth();
    const year = cursor.getUTCFullYear();
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const day = Math.min(startDayOfMonth, lastDay);
    const trigger = new Date(Date.UTC(year, month, day));
    if (trigger >= startD && trigger >= periodStartD && trigger < periodEndD) {
      if (!event.endDate || trigger <= new Date(event.endDate + "T00:00:00Z")) {
        triggers++;
      }
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return triggers;
}

/**
 * Computes the inclusive end date (exclusive) of the current period.
 * @param {string} periodStart - ISO YYYY-MM-DD
 * @param {"weekly"|"fortnightly"|"monthly"} frequency
 * @returns {string} ISO YYYY-MM-DD
 */
function nextPeriodStart(periodStart, frequency) {
  if (frequency === "weekly") return addDays(periodStart, 7);
  if (frequency === "fortnightly") return addDays(periodStart, 14);
  return addMonths(periodStart, 1);
}

/**
 * Applies offset events for the current period, mutating tranche state
 * `linkedOffsetBalance` per spec section 7 step 3.
 * @param {any[]} trancheStates
 * @param {OffsetEvent[]|undefined} offsetEvents
 * @param {string} periodStartDate
 * @param {string} periodEndDate
 */
function applyOffsetEvents(trancheStates, offsetEvents, periodStartDate, periodEndDate) {
  if (!offsetEvents || offsetEvents.length === 0) return;
  // Spec section 12: when two offset events fire on the same date for the same
  // tranche, apply in `offsetEvent.id` order. Rounding is applied per event.
  // Sort a shallow copy so we don't mutate the caller's array.
  const sorted = offsetEvents.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const ev of sorted) {
    if (ev.endDate && periodStartDate > ev.endDate) continue;
    if (periodEndDate <= ev.startDate) continue;
    const triggers = countTriggersForPeriod(ev, periodStartDate, periodEndDate);
    if (triggers === 0) continue;
    const target = trancheStates.find((/** @type {any} */ ts) => ts.id === ev.targetTrancheId);
    if (!target || target.balance <= 0) continue;
    const delta = roundMoney(ev.amount * triggers);
    target.linkedOffsetBalance = Math.max(0, roundMoney((target.linkedOffsetBalance || 0) + delta));
  }
}

/**
 * Returns the per-period budget split under the payment policy per spec 6.3.
 * The function returns `{ mandatory, policyExtra, isInfeasible, infeasibilityReason }`,
 * where `mandatory` is the policy-controlled minimum debit and `policyExtra`
 * is the policy-driven general extra (e.g. minimum mode when target > mandatory,
 * or exact mode when target > mandatory). The full period debit is
 * `mandatory + policyExtra + recurringExtras + targetedExtras`.
 *
 * @param {Object} input
 * @param {Mortgage} input.mortgage
 * @param {number} input.mandatoryTotal
 * @param {number} [input.targetPaymentOverride] - Override target (used by tests).
 * @returns {{ mandatory: number, policyExtra: number, isInfeasible: boolean, infeasibilityReason: string|null }}
 */
export function applyPaymentPolicy({ mortgage, mandatoryTotal, targetPaymentOverride }) {
  const targetMode = mortgage.targetMode || "term";
  const target = targetPaymentOverride !== undefined ? targetPaymentOverride : (mortgage.targetPeriodicPayment || 0);
  const policy = mortgage.paymentPolicy || "minimum";

  if (targetMode !== "payment" || target <= 0) {
    // Term mode (or no target): mandatory = full schedule, no policy extra.
    return { mandatory: roundMoney(mandatoryTotal), policyExtra: 0, isInfeasible: false, infeasibilityReason: null };
  }

  if (policy === "exact") {
    if (mandatoryTotal > target + 0.005) {
      return { mandatory: 0, policyExtra: 0, isInfeasible: true, infeasibilityReason: "mandatory exceeds target under exact policy" };
    }
    const policyExtra = Math.max(0, roundMoney(target - mandatoryTotal));
    return { mandatory: roundMoney(mandatoryTotal), policyExtra, isInfeasible: false, infeasibilityReason: null };
  }
  if (policy === "maximum") {
    if (mandatoryTotal > target + 0.005) {
      return { mandatory: 0, policyExtra: 0, isInfeasible: true, infeasibilityReason: "mandatory exceeds target under maximum policy" };
    }
    return { mandatory: roundMoney(mandatoryTotal), policyExtra: 0, isInfeasible: false, infeasibilityReason: null };
  }
  // minimum
  const policyExtra = Math.max(0, roundMoney(target - mandatoryTotal));
  return { mandatory: roundMoney(mandatoryTotal), policyExtra, isInfeasible: false, infeasibilityReason: null };
}

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
    const aIsFloating = isFloatingType(a.productCode);
    const bIsFloating = isFloatingType(b.productCode);

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
 * The per-period event order is the contract from spec section 7:
 *  1. Compute currentDate and monthIndex
 *  2. Refix / floating rate update per tranche
 *  3. Apply offset events
 *  4. Compute period interest using effectiveBalance (6.1, 6.2)
 *  5. Compute mandatory scheduled principal for active P&I tranches
 *  6. Compute mandatoryTotal
 *  7. Apply payment policy (6.3) -> totalPayment
 *  8. Compute extras for this period (6.5) -> generalExtra + targeted extras
 *  9. Allocate debits (6.4)
 * 10. Update tranche balances (cap to non-negative)
 * 11. Update totals
 * 12. Push periodTrancheDetails and accumulate into monthly timeline
 *
 * @param {Object} input
 * @param {Mortgage} input.mortgage
 * @param {RateScenario} input.scenario
 * @param {string} [input.startDate] - Start date of the simulation (defaults to YYYY-MM-DD from today)
 * @param {number} [input.forecastMonths] - Number of months to forecast (default 36)
 * @param {RefixRule} [input.refixRule] - Default refix rule for matured tranches
 * @param {MortgageProductDefinition[]} [input.products] - Supported products list
 * @param {boolean} [input.userInitiatedBreak] - Whether the user is breaking a fixed term this period (reserved for future use)
 * @returns {any} Full simulation results including timeline, totals, payoffTime, offsetUtilisation, isInfeasible.
 */
export function simulateMortgageTimeline({
  mortgage,
  scenario,
  startDate,
  forecastMonths = 36,
  refixRule,
  products = [],
  userInitiatedBreak = false
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
    linkedOffsetBalance: t.linkedOffsetBalance || 0,
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
  let isInfeasible = false;
  let infeasibilityReason = null;
  let payoffTime = totalPeriods + 1; // default: not paid off
  let offsetUtilisationAccumulator = 0;
  let offsetUtilisationActivePeriods = 0;

  for (let p = 0; p < totalPeriods; p++) {
    // Step 1: Compute currentDate and monthIndex
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
    const nextDate = nextPeriodStart(currentDate, frequency);

    // Step 2: Refix & floating rate update per tranche
    for (const tranche of trancheStates) {
      if (tranche.balance <= 0) continue;
      const elapsedMonths = monthIndex;
      const remainingTerm = Math.max(1, tranche.originalRemainingTermMonths - elapsedMonths);

      if (tranche.fixedUntil && new Date(currentDate) >= new Date(tranche.fixedUntil)) {
        const prevProduct = tranche.productCode;
        const prevRate = tranche.annualRate;
        const newProduct = determineRefixProduct(prevProduct, refixRule, tranche.refixCount);
        const newPath = scenario.productRatePaths[newProduct] || [];
        let newRate = getRateForMonth(newPath, monthIndex);
        // Optional: apply break-fee economics (stub; breakFeeSchedule is empty in this iteration).
        if (userInitiatedBreak) {
          const monthsToMaturity = Math.max(0, Math.round((Date.parse(tranche.fixedUntil) - Date.parse(currentDate)) / (1000 * 60 * 60 * 24 * 30)));
          const breakFee = calculateBreakFee({
            productCode: prevProduct,
            balance: tranche.balance,
            monthsToMaturity,
            breakFeeSchedule: (scenario && /** @type {any} */ (scenario).assumptions && /** @type {any} */ (scenario).assumptions.breakFeeSchedule) || {}
          });
          if (breakFee > 0) {
            newRate = newRate + breakFee / Math.max(1, tranche.balance) * periodsPerYear;
          }
        }
        tranche.productCode = newProduct;
        tranche.refixCount += 1;
        const fixedMonths = getProductFixedMonths(newProduct, products);
        tranche.fixedUntil = fixedMonths ? addMonths(currentDate, fixedMonths) : null;
        tranche.annualRate = newRate;
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
          type: "scheduled-refix",
          prevProduct,
          newProduct: tranche.productCode,
          prevRate,
          newRate: tranche.annualRate,
          balance: tranche.balance
        });
      } else if (!tranche.fixedUntil) {
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
    }

    // Step 3: Apply offset events
    applyOffsetEvents(trancheStates, mortgage.offsetEvents, currentDate, nextDate);

    // Step 4-5: Period interest (with offset) and scheduled principal per active tranche
    /** @type {any[]} */
    const periodTrancheDetails = [];
    let periodInterestTotal = 0;
    let periodScheduledTotal = 0;

    for (const tranche of trancheStates) {
      if (tranche.balance <= 0) {
        periodTrancheDetails.push({
          id: tranche.id,
          openingBalance: 0,
          effectiveBalance: 0,
          interest: 0,
          scheduledPayment: 0,
          extraRepayment: 0,
          targetedExtra: 0,
          closingBalance: 0,
          rate: tranche.annualRate,
          linkedOffsetBalance: tranche.linkedOffsetBalance || 0
        });
        continue;
      }
      const effectiveBalance = Math.max(0, roundMoney(tranche.balance - (tranche.linkedOffsetBalance || 0)));
      const periodicRate = tranche.annualRate / periodsPerYear;
      const interest = roundMoney(effectiveBalance * periodicRate);
      let scheduled = tranche.scheduledPayment;
      if (tranche.repaymentType === "interest-only") {
        scheduled = interest;
      }
      periodInterestTotal += interest;
      periodScheduledTotal += scheduled;
      periodTrancheDetails.push({
        id: tranche.id,
        openingBalance: tranche.balance,
        effectiveBalance,
        interest,
        scheduledPayment: scheduled,
        extraRepayment: 0,
        targetedExtra: 0,
        closingBalance: 0,
        rate: tranche.annualRate,
        linkedOffsetBalance: tranche.linkedOffsetBalance || 0
      });
    }

    // Step 6: Mandatory total = the schedule (interest + scheduled principal).
    // periodScheduledTotal already equals the sum of (interest + scheduled principal)
    // per tranche because scheduledPayment for P&I = interest + principal, and
    // for interest-only = interest. So mandatoryTotal is just the schedule total.
    const mandatoryTotal = roundMoney(periodScheduledTotal);

    // Step 7: Apply payment policy
    const policyResult = applyPaymentPolicy({ mortgage, mandatoryTotal });
    if (policyResult.isInfeasible) {
      isInfeasible = true;
      infeasibilityReason = `${policyResult.infeasibilityReason} at period ${p}`;
      // Still record a partial period record (zero cash-out) so the timeline stays
      // contiguous. No balance change.
      const periodRecord = {
        periodIndex: p,
        date: currentDate,
        monthIndex,
        openingBalance: roundMoney(trancheStates.reduce((/** @type {number} */ sum, /** @type {any} */ t) => sum + t.balance, 0)),
        interest: 0,
        scheduledPayment: 0,
        extraRepayment: 0,
        closingBalance: roundMoney(trancheStates.reduce((/** @type {number} */ sum, /** @type {any} */ t) => sum + t.balance, 0)),
        tranches: periodTrancheDetails
      };
      periodsTimeline.push(periodRecord);
      break;
    }
    // mandatory is the schedule portion (interest + scheduled principal). The
    // policy may add a "policy extra" (e.g. minimum mode when target > schedule,
    // or exact mode) which flows through the same general-extra water-fall as
    // recurring non-targeted extras.
    const mandatory = policyResult.mandatory;
    let generalExtra = policyResult.policyExtra;

    // Step 8: Extras for this period (targeted & general recurring from mortgage.extraRepayments)
    /** @type {Map<string, number>} */
    const targetedExtrasByTranche = new Map();
    if (mortgage.extraRepayments && mortgage.extraRepayments.length > 0) {
      for (const extra of mortgage.extraRepayments) {
        if (currentDate < extra.startDate) continue;
        if (extra.endDate && currentDate > extra.endDate) continue;
        const triggers = countTriggersForPeriod(extra, currentDate, nextDate);
        if (triggers === 0) continue;
        const periodAmount = roundMoney(extra.amount * triggers);
        if (extra.targetTrancheId) {
          const detail = periodTrancheDetails.find(d => d.id === extra.targetTrancheId);
          if (detail && detail.openingBalance > 0) {
            targetedExtrasByTranche.set(extra.targetTrancheId, (targetedExtrasByTranche.get(extra.targetTrancheId) || 0) + periodAmount);
          }
        } else {
          generalExtra = roundMoney(generalExtra + periodAmount);
        }
      }
    }

    // Step 9: Allocate debits. Total budget = mandatory + general extra + targeted extras.
    let remaining = roundMoney(mandatory + generalExtra +
      Array.from(targetedExtrasByTranche.values()).reduce((a, b) => a + b, 0));
    // 9.1 Mandatory interest first, in tranche.id order.
    for (const detail of periodTrancheDetails) {
      if (detail.openingBalance <= 0) continue;
      const pay = Math.min(detail.interest, remaining);
      detail.paidInterest = roundMoney(pay);
      remaining = roundMoney(remaining - pay);
    }
    // 9.2 Mandatory scheduled principal, in tranche.id order, capped to remaining principal
    for (const detail of periodTrancheDetails) {
      if (detail.openingBalance <= 0) continue;
      const principalPart = roundMoney(detail.scheduledPayment - detail.interest);
      const cap = roundMoney(detail.openingBalance - (detail.paidInterest || 0));
      const pay = Math.max(0, Math.min(principalPart, remaining, cap));
      detail.paidScheduledPrincipal = pay;
      remaining = roundMoney(remaining - pay);
    }
    // 9.3 General extra (from policy + recurring non-targeted extras)
    if (generalExtra > 0 && remaining > 0) {
      const sorted = sortTranchesForExtraRepayment(
        trancheStates.filter(t => t.balance > 0).map(t => ({ ...t, state: t }))
      );
      for (const t of sorted) {
        if (remaining <= 0) break;
        const detail = periodTrancheDetails.find(d => d.id === t.id);
        if (!detail) continue;
        const cap = roundMoney(detail.openingBalance - (detail.paidInterest || 0) - (detail.paidScheduledPrincipal || 0));
        const pay = Math.max(0, Math.min(generalExtra, remaining, cap));
        detail.paidGeneralExtra = pay;
        detail.extraRepayment = roundMoney((detail.extraRepayment || 0) + pay);
        remaining = roundMoney(remaining - pay);
        generalExtra = roundMoney(generalExtra - pay);
      }
    }
    // 9.4 Targeted extras
    if (targetedExtrasByTranche.size > 0 && remaining > 0) {
      for (const [trancheId, amt] of targetedExtrasByTranche) {
        if (remaining <= 0) break;
        const detail = periodTrancheDetails.find(d => d.id === trancheId);
        if (!detail || detail.openingBalance <= 0) continue;
        const cap = roundMoney(detail.openingBalance - (detail.paidInterest || 0) - (detail.paidScheduledPrincipal || 0) - (detail.paidGeneralExtra || 0));
        const pay = Math.max(0, Math.min(amt, remaining, cap));
        detail.paidTargetedExtra = pay;
        detail.targetedExtra = roundMoney((detail.targetedExtra || 0) + pay);
        detail.extraRepayment = roundMoney((detail.extraRepayment || 0) + pay);
        remaining = roundMoney(remaining - pay);
      }
    }
    // 9.5 Cap to non-negative balance (defensive). The earlier caps already enforce
    // this; we still ensure a final safety pass in case of sub-cent drift.

    // 9.6 Update balances and aggregate
    let periodActualPaymentTotal = 0;
    let periodActualExtraTotal = 0;
    for (const detail of periodTrancheDetails) {
      if (detail.openingBalance <= 0) {
        detail.closingBalance = 0;
        continue;
      }
      const trancheState = trancheStates.find((/** @type {any} */ ts) => ts.id === detail.id);
      const principalPaid = roundMoney(
        (detail.paidScheduledPrincipal || 0) +
        (detail.paidGeneralExtra || 0) +
        (detail.paidTargetedExtra || 0)
      );
      const newBalance = roundMoney(detail.openingBalance - principalPaid);
      trancheState.balance = Math.max(0, newBalance);
      detail.closingBalance = trancheState.balance;
      const detailTotal = roundMoney((detail.paidInterest || 0) + principalPaid);
      periodActualPaymentTotal = roundMoney(periodActualPaymentTotal + detailTotal);
      periodActualExtraTotal = roundMoney(periodActualExtraTotal + (detail.extraRepayment || 0));
    }

    totalInterestPaid = roundMoney(totalInterestPaid + periodInterestTotal);
    totalPaymentsPaid = roundMoney(totalPaymentsPaid + periodActualPaymentTotal);

    // Offset utilisation accumulator
    for (const detail of periodTrancheDetails) {
      if (detail.openingBalance > 0) {
        const denom = Math.max(1, detail.openingBalance);
        const ratio = Math.min(1, (detail.linkedOffsetBalance || 0) / denom);
        offsetUtilisationAccumulator += ratio;
        offsetUtilisationActivePeriods += 1;
      }
    }

    // Payoff detection.
    // Spec section 8: payoffTime is in months. We use monthIndex (already
    // computed in the per-period loop) rather than the period index `p`, so
    // weekly / fortnightly mortgages report payoff in months (e.g. ~12 months
    // ≈ 52 weeks ≈ 26 fortnights) — consistent with the payment-mode Pareto
    // objective's `payoffTime: 1` month tolerance.
    const totalClosing = roundMoney(trancheStates.reduce((/** @type {number} */ sum, /** @type {any} */ t) => sum + t.balance, 0));
    if (totalClosing <= 0 && payoffTime > monthIndex) {
      payoffTime = monthIndex;
    }

    periodsTimeline.push({
      periodIndex: p,
      date: currentDate,
      monthIndex,
      openingBalance: roundMoney(periodTrancheDetails.reduce((sum, d) => sum + d.openingBalance, 0)),
      interest: roundMoney(periodInterestTotal),
      scheduledPayment: roundMoney(periodScheduledTotal),
      extraRepayment: roundMoney(periodActualExtraTotal),
      closingBalance: totalClosing,
      tranches: periodTrancheDetails
    });
  }

  // Step 12: Aggregate to monthly timeline
  const monthlyTimelineMap = new Map();
  for (const pRecord of periodsTimeline) {
    const m = pRecord.monthIndex;
    if (!monthlyTimelineMap.has(m)) {
      monthlyTimelineMap.set(m, {
        monthIndex: m,
        date: pRecord.date,
        openingBalance: pRecord.openingBalance,
        interest: 0,
        scheduledPayment: 0,
        extraRepayment: 0,
        closingBalance: pRecord.closingBalance,
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

    for (const trancheDetail of pRecord.tranches) {
      const mTranche = monthRecord.tranches.find((/** @type {any} */ t) => t.id === trancheDetail.id);
      if (mTranche) {
        mTranche.interest = roundMoney(mTranche.interest + trancheDetail.interest);
        mTranche.scheduledPayment = roundMoney(mTranche.scheduledPayment + trancheDetail.scheduledPayment);
        mTranche.extraRepayment = roundMoney(mTranche.extraRepayment + trancheDetail.extraRepayment);
        mTranche.closingBalance = trancheDetail.closingBalance;
        mTranche.rate = trancheDetail.rate;
      }
    }
  }
  const monthlyTimeline = Array.from(monthlyTimelineMap.values());

  const endingBalance = monthlyTimeline.length > 0
    ? monthlyTimeline[monthlyTimeline.length - 1].closingBalance
    : roundMoney(trancheStates.reduce((/** @type {number} */ sum, /** @type {any} */ t) => sum + t.balance, 0));

  const periodicPayments = periodsTimeline.map(p => roundMoney(p.scheduledPayment + p.extraRepayment));
  const maximumPayment = periodicPayments.length > 0 ? Math.max(...periodicPayments) : 0;
  const minimumPayment = periodicPayments.length > 0 ? Math.min(...periodicPayments) : 0;
  const averagePayment = periodicPayments.length > 0
    ? roundMoney(periodicPayments.reduce((sum, val) => sum + val, 0) / periodicPayments.length)
    : 0;

  const offsetUtilisation = offsetUtilisationActivePeriods > 0
    ? roundMoney(offsetUtilisationAccumulator / offsetUtilisationActivePeriods)
    : 0;

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
    rawPeriodsTimeline: periodsTimeline,
    payoffTime,
    offsetUtilisation,
    isInfeasible,
    infeasibilityReason
  };
}
