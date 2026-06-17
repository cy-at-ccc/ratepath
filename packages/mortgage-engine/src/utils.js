/**
 * Rounds a number to 2 decimal places to simulate real banking transactions.
 * @param {number} amount - Input monetary amount
 * @returns {number} Rounded amount
 */
export function roundMoney(amount) {
  return Math.round(amount * 100) / 100;
}

/**
 * Adds a specific number of days to an ISO YYYY-MM-DD date string.
 * @param {string} dateStr - Input date string
 * @param {number} days - Days to add
 * @returns {string} ISO YYYY-MM-DD date string
 */
export function addDays(dateStr, days) {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return date.toISOString().split("T")[0];
}

/**
 * Adds a specific number of months to an ISO YYYY-MM-DD date string.
 * @param {string} dateStr - Input date string
 * @param {number} months - Months to add
 * @returns {string} ISO YYYY-MM-DD date string
 */
export function addMonths(dateStr, months) {
  const date = new Date(dateStr);
  // Using setMonth adjusts years automatically
  date.setMonth(date.getMonth() + months);
  return date.toISOString().split("T")[0];
}

/**
 * Calculates the difference in months between two YYYY-MM-DD date strings.
 * @param {string} startDateStr - Start date
 * @param {string} endDateStr - End date
 * @returns {number} Month difference (can be negative if end < start)
 */
export function getMonthDifference(startDateStr, endDateStr) {
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  const yearDiff = end.getFullYear() - start.getFullYear();
  const monthDiff = end.getMonth() - start.getMonth();
  return yearDiff * 12 + monthDiff;
}
