import { NextResponse } from "next/server"
import { createServerSupabase } from "@/lib/supabase/server"
import { EXCLUDED_SUBTYPES } from "@/lib/plaid/excluded-accounts"
import { computeSpendWindow, isInWindow } from "@/lib/spend-window"

export const dynamic = "force-dynamic"

export async function GET() {
  const supabase = createServerSupabase()

  const [accountsRes, liabilitiesRes, transactionsRes] = await Promise.all([
    supabase.from("accounts").select("*")
      .not("subtype", "in", `(${[...EXCLUDED_SUBTYPES].join(",")})`)
      .order("created_at", { ascending: true }),
    supabase
      .from("credit_liabilities")
      .select("*, credit_liability_aprs(*)")
      .order("updated_at", { ascending: false }),
    supabase
      .from("transactions")
      .select("*, accounts(name)")
      .order("date", { ascending: false }),
  ])

  if (accountsRes.error) {
    return NextResponse.json({ error: accountsRes.error.message }, { status: 500 })
  }
  if (liabilitiesRes.error) {
    return NextResponse.json({ error: liabilitiesRes.error.message }, { status: 500 })
  }
  if (transactionsRes.error) {
    return NextResponse.json({ error: transactionsRes.error.message }, { status: 500 })
  }

  const accounts = accountsRes.data
  const creditLiabilities = (liabilitiesRes.data || []).map((row: Record<string, unknown>) => {
    const { credit_liability_aprs, ...rest } = row
    return { ...rest, aprs: credit_liability_aprs || [] }
  })

  // Flatten account name into transactions
  type RawTransaction = Record<string, unknown> & {
    amount: number
    date: string
    category_primary: string | null
    accounts: { name: string | null } | null
  }
  const transactions = (transactionsRes.data as RawTransaction[] || []).map((row) => {
    const { accounts: accountData, ...txn } = row
    return {
      ...txn,
      account_name: accountData?.name ?? "Unknown Account",
    }
  })

  // Transactions come back ordered by date DESC, so the first is the newest.
  // When sandbox data has gone stale the window anchors to it instead of today.
  const spendWindow = computeSpendWindow(transactions[0]?.date ?? null)

  // Compute category spending within the window.
  // Exclude transfers and loan payments from the spending total — these are
  // money movements, not spending, and would otherwise double-count.
  const NON_SPENDING_CATEGORIES = new Set([
    "TRANSFER_OUT",
    "TRANSFER_IN",
    "LOAN_PAYMENTS",
    "BANK_FEES",
  ])

  const categoryMap = new Map<string, { total: number; count: number }>()
  let totalSpend30Days = 0

  for (const t of transactions) {
    if (t.amount > 0 && isInWindow(t.date, spendWindow)) {
      const cat = t.category_primary ?? "OTHER"
      const entry = categoryMap.get(cat) ?? { total: 0, count: 0 }
      entry.total += t.amount
      entry.count += 1
      categoryMap.set(cat, entry)

      if (!NON_SPENDING_CATEGORIES.has(cat)) {
        totalSpend30Days += t.amount
      }
    }
  }

  const categorySpending = Array.from(categoryMap.entries())
    .map(([category, { total, count }]) => ({ category, total, count }))
    .sort((a, b) => b.total - a.total)

  return NextResponse.json({
    accounts,
    creditLiabilities,
    transactions,
    categorySpending,
    totalSpend30Days,
    spendWindow,
  })
}
