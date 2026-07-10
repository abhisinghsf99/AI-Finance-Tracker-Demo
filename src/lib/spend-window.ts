export const SPEND_WINDOW_DAYS = 30

export interface SpendWindow {
  /** Inclusive start of the window, YYYY-MM-DD. */
  start: string
  /** Inclusive end of the window, YYYY-MM-DD. */
  end: string
  /** True when the window is anchored to old data rather than to today. */
  isStale: boolean
}

/** Today in UTC as YYYY-MM-DD. */
export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Subtract whole days from a YYYY-MM-DD date, staying in UTC. */
export function subtractDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

/**
 * Compute the spending window.
 *
 * Normally this is the last SPEND_WINDOW_DAYS ending today. Plaid's sandbox
 * generates transactions relative to when the item was created and never adds
 * more, so between re-seeds the newest transaction drifts into the past. Once
 * it drifts past the window the dashboard would show an empty summary, which
 * reads as "you spent nothing" rather than "this data is old". When that
 * happens, anchor the window to the newest transaction and flag it as stale so
 * the UI can say so.
 */
export function computeSpendWindow(
  latestTransactionDate: string | null,
  today: string = todayUTC()
): SpendWindow {
  const freshStart = subtractDays(today, SPEND_WINDOW_DAYS)

  if (!latestTransactionDate || latestTransactionDate >= freshStart) {
    return { start: freshStart, end: today, isStale: false }
  }

  return {
    start: subtractDays(latestTransactionDate, SPEND_WINDOW_DAYS),
    end: latestTransactionDate,
    isStale: true,
  }
}

/** Whether a YYYY-MM-DD transaction date falls inside the window. */
export function isInWindow(date: string, window: SpendWindow): boolean {
  return date >= window.start && date <= window.end
}
