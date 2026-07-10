import { describe, it, expect } from "vitest"
import {
  computeSpendWindow,
  isInWindow,
  subtractDays,
  SPEND_WINDOW_DAYS,
} from "@/lib/spend-window"

const TODAY = "2026-07-09"

describe("subtractDays", () => {
  it("subtracts within a month", () => {
    expect(subtractDays("2026-07-09", 8)).toBe("2026-07-01")
  })

  it("crosses a month boundary", () => {
    expect(subtractDays("2026-07-09", 30)).toBe("2026-06-09")
  })

  it("crosses a year boundary", () => {
    expect(subtractDays("2026-01-05", 10)).toBe("2025-12-26")
  })

  it("handles leap days", () => {
    expect(subtractDays("2024-03-01", 1)).toBe("2024-02-29")
  })
})

describe("computeSpendWindow", () => {
  it("uses a today-anchored window when data is fresh", () => {
    const window = computeSpendWindow("2026-07-08", TODAY)
    expect(window).toEqual({
      start: "2026-06-09",
      end: TODAY,
      isStale: false,
    })
  })

  it("treats a transaction exactly on the boundary as fresh", () => {
    const boundary = subtractDays(TODAY, SPEND_WINDOW_DAYS)
    const window = computeSpendWindow(boundary, TODAY)
    expect(window.isStale).toBe(false)
    expect(window.end).toBe(TODAY)
  })

  it("anchors to the newest transaction once data falls out of the window", () => {
    // 40 days stale — the old behavior produced an empty summary here.
    const window = computeSpendWindow("2026-05-30", TODAY)
    expect(window).toEqual({
      start: "2026-04-30",
      end: "2026-05-30",
      isStale: true,
    })
  })

  it("falls back to a today-anchored window when there are no transactions", () => {
    const window = computeSpendWindow(null, TODAY)
    expect(window).toEqual({
      start: "2026-06-09",
      end: TODAY,
      isStale: false,
    })
  })

  it("never reports stale for a future-dated transaction", () => {
    const window = computeSpendWindow("2026-08-01", TODAY)
    expect(window.isStale).toBe(false)
    expect(window.end).toBe(TODAY)
  })
})

describe("isInWindow", () => {
  const window = computeSpendWindow("2026-05-30", TODAY)

  it("includes both endpoints", () => {
    expect(isInWindow("2026-04-30", window)).toBe(true)
    expect(isInWindow("2026-05-30", window)).toBe(true)
  })

  it("excludes dates before the start", () => {
    expect(isInWindow("2026-04-29", window)).toBe(false)
  })

  it("excludes dates after the end", () => {
    expect(isInWindow("2026-05-31", window)).toBe(false)
  })
})
