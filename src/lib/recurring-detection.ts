import type { Transaction } from "@/lib/queries/types"

export interface RecurringCharge {
  merchantName: string
  amount: number
  frequency: "weekly" | "biweekly" | "monthly" | "yearly"
  lastChargeDate: string
  chargeCount: number
  transactions: Transaction[]
}

/**
 * Normalize merchant identity for grouping.
 * Prefers merchant_entity_id (Plaid's stable identifier) when available.
 * Falls back to lowercased merchant_name with common suffixes stripped.
 */
function normalizeMerchant(t: Transaction): string {
  if (t.merchant_entity_id) return t.merchant_entity_id

  return (t.merchant_name || t.name || "unknown")
    .toLowerCase()
    .replace(/[.,]?\s*(com|net|inc|llc|ltd)$/i, "")
    .trim()
}

/**
 * Round amount to nearest cent for grouping.
 */
function roundAmount(amount: number): number {
  return Math.round(Math.abs(amount) * 100) / 100
}

/**
 * Infer charge frequency from sorted dates using median interval.
 * <=9 days = weekly, <=18 = biweekly, <=45 = monthly, else yearly.
 */
function inferFrequency(dates: string[]): RecurringCharge["frequency"] {
  if (dates.length < 2) return "monthly"

  const sorted = [...dates].sort()
  const intervals: number[] = []

  for (let i = 1; i < sorted.length; i++) {
    const diff =
      (new Date(sorted[i]).getTime() - new Date(sorted[i - 1]).getTime()) /
      (1000 * 60 * 60 * 24)
    intervals.push(diff)
  }

  intervals.sort((a, b) => a - b)
  const median = intervals[Math.floor(intervals.length / 2)]

  if (median <= 9) return "weekly"
  if (median <= 18) return "biweekly"
  if (median <= 45) return "monthly"
  return "yearly"
}

/**
 * Known subscription/recurring service keywords.
 * A single transaction from these merchants is treated as recurring.
 */
const SUBSCRIPTION_KEYWORDS = new Set([
  "netflix", "spotify", "apple", "icloud", "hulu", "disney", "hbo",
  "youtube", "amazon prime", "chatgpt", "openai", "claude", "anthropic",
  "github", "notion", "figma", "vercel", "dropbox", "google storage",
  "adobe", "microsoft 365", "zoom", "slack", "linear", "1password",
  "nordvpn", "expressvpn", "planet fitness", "24 hour fitness", "godaddy",
  "xbox", "game pass", "accuweather", "comcast", "att", "verizon",
  "t-mobile", "xfinity",
])

export function isLikelySubscription(t: Transaction): boolean {
  const name = (t.merchant_name || t.name || "").toLowerCase()
  for (const keyword of SUBSCRIPTION_KEYWORDS) {
    if (name.includes(keyword)) return true
  }
  return false
}

/**
 * Detect recurring charges from a list of transactions.
 * Groups spending transactions (amount > 0) by normalized merchant + rounded amount.
 * Requires 2+ occurrences, or 1 if the merchant matches known subscription services.
 * Returns sorted by amount descending.
 */
export function detectRecurring(transactions: Transaction[]): RecurringCharge[] {
  const groups = new Map<string, Transaction[]>()

  for (const t of transactions) {
    if (t.amount <= 0) continue // only spending
    const key = `${normalizeMerchant(t)}|${roundAmount(t.amount)}`
    const group = groups.get(key) ?? []
    group.push(t)
    groups.set(key, group)
  }

  return Array.from(groups.entries())
    .filter(
      ([, txns]) =>
        txns.length >= 2 ||
        // A lone keyword match only counts when it's priced like a service
        // fee — a one-off $1,100 Apple Store purchase is not a subscription.
        (isLikelySubscription(txns[0]) && roundAmount(txns[0].amount) <= 50)
    )
    .map(([, txns]) => {
      const sorted = [...txns].sort((a, b) => b.date.localeCompare(a.date))
      return {
        merchantName: sorted[0].merchant_name || sorted[0].name || "Unknown",
        amount: roundAmount(sorted[0].amount),
        frequency: txns.length >= 2 ? inferFrequency(txns.map((t) => t.date)) : "monthly",
        lastChargeDate: sorted[0].date,
        chargeCount: txns.length,
        transactions: sorted,
      }
    })
    .sort((a, b) => b.amount - a.amount)
}

/**
 * Estimate total monthly cost from recurring charges.
 * weekly * 4.33, biweekly * 2.17, monthly * 1, yearly / 12
 */
export function estimateMonthlyTotal(charges: RecurringCharge[]): number {
  const multipliers: Record<RecurringCharge["frequency"], number> = {
    weekly: 4.33,
    biweekly: 2.17,
    monthly: 1,
    yearly: 1 / 12,
  }

  return charges.reduce(
    (sum, charge) => sum + charge.amount * multipliers[charge.frequency],
    0
  )
}
