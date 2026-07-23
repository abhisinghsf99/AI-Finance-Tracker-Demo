/**
 * Plaid amount convention:
 * - POSITIVE = money leaving the account (spending, debits, payments)
 * - NEGATIVE = money entering the account (income, refunds, credits)
 *
 * This is counterintuitive. All display/aggregation logic MUST use
 * these utilities rather than raw amount values.
 */

export const isSpending = (amount: number): boolean => amount > 0
export const isIncome = (amount: number): boolean => amount < 0

/** Returns the absolute display value (always positive) */
export const displayAmount = (amount: number): number => Math.abs(amount)

/** Format as USD currency string: "$1,234.50" */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount))
}

/** Format with an explicit sign for money coming in: "+$4,750.00" */
export function formatSignedCurrency(amount: number): string {
  const base = formatCurrency(amount)
  return isIncome(amount) ? `+${base}` : base
}

/** Sum only spending transactions (positive amounts) */
export function totalSpending(amounts: number[]): number {
  return amounts.filter((a) => a > 0).reduce((sum, a) => sum + a, 0)
}

/** Sum only income transactions (negative amounts, returned as positive) */
export function totalIncome(amounts: number[]): number {
  return amounts
    .filter((a) => a < 0)
    .reduce((sum, a) => sum + Math.abs(a), 0)
}
