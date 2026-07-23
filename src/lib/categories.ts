/**
 * Canonical transaction categories.
 *
 * Plaid's personal-finance taxonomy is wider than this dashboard wants —
 * near-empty buckets like TRAVEL vs TRANSPORTATION or MEDICAL vs
 * PERSONAL_CARE fragment the filters and charts. Every write path
 * (Plaid sync, seeding, synthetic generation) MUST pass category_primary
 * through canonicalizeCategory() so only the categories below ever reach
 * the database. If Plaid introduces a primary we don't know, it lands in
 * OTHER rather than growing the taxonomy silently.
 */

export const CANONICAL_CATEGORIES = [
  'ENTERTAINMENT',
  'FOOD_AND_DRINK',
  'GENERAL_MERCHANDISE',
  'GENERAL_SERVICES',
  'INCOME',
  'LOAN_PAYMENTS',
  'OTHER',
  'PERSONAL_CARE',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'TRANSPORTATION',
  'BANK_FEES',
] as const

export type CanonicalCategory = (typeof CANONICAL_CATEGORIES)[number]

/** Legacy / wider Plaid primaries folded into the canonical set. */
const CATEGORY_MERGES: Record<string, CanonicalCategory> = {
  TRAVEL: 'TRANSPORTATION',
  HOME_IMPROVEMENT: 'GENERAL_MERCHANDISE',
  MEDICAL: 'PERSONAL_CARE',
  GOVERNMENT_AND_NON_PROFIT: 'OTHER',
  LOAN_DISBURSEMENTS: 'TRANSFER_IN',
  RENT_AND_UTILITIES: 'GENERAL_SERVICES',
}

const CANONICAL_SET = new Set<string>(CANONICAL_CATEGORIES)

/**
 * Map any Plaid category_primary onto the canonical set.
 * Null stays null (uncategorized); unknown values become OTHER.
 */
export function canonicalizeCategory(primary: string | null | undefined): string | null {
  if (!primary) return null
  if (CANONICAL_SET.has(primary)) return primary
  return CATEGORY_MERGES[primary] ?? 'OTHER'
}
