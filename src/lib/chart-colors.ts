/**
 * Category color palette for the canonical category set (see lib/categories.ts).
 *
 * Colorblind-safe: hues derive from the Okabe-Ito palette (distinguishable
 * under deuteranopia, protanopia, and tritanopia), softened to sit well on the
 * dark navy background. Categories likely to sit next to each other in the
 * donut also differ in LIGHTNESS, so slices remain separable in grayscale —
 * the safety net for any remaining hue confusion.
 */

export const CATEGORY_COLORS: Record<string, string> = {
  // Chart-visible spending categories
  GENERAL_MERCHANDISE: "hsl(38, 75%, 57%)", // amber
  FOOD_AND_DRINK: "hsl(168, 52%, 46%)", // teal
  GENERAL_SERVICES: "hsl(222, 62%, 58%)", // royal blue
  TRANSPORTATION: "hsl(203, 72%, 72%)", // sky blue
  ENTERTAINMENT: "hsl(320, 45%, 65%)", // orchid
  PERSONAL_CARE: "hsl(48, 70%, 68%)", // soft gold
  OTHER: "hsl(220, 12%, 62%)", // slate

  // Badge-only categories (excluded from spending charts)
  INCOME: "hsl(160, 50%, 55%)", // green
  LOAN_PAYMENTS: "hsl(15, 60%, 62%)", // vermillion
  TRANSFER_IN: "hsl(190, 30%, 62%)", // cool grey-cyan
  TRANSFER_OUT: "hsl(255, 42%, 70%)", // violet
  BANK_FEES: "hsl(345, 45%, 62%)", // rose
} as const

/**
 * Returns the HSL color for a given category.
 * Falls back to OTHER color for unknown categories.
 */
export function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.OTHER
}
