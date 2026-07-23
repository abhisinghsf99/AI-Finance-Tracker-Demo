import { createServerSupabase } from '@/lib/supabase/server'
import { randomUUID } from 'crypto'

/**
 * Plaid's sandbox refresh has proven unreliable (transactionsRefresh returns
 * INTERNAL_SERVER_ERROR on the dynamic Item), which left the demo's data
 * frozen at seed time. This module keeps the demo current without Plaid:
 * it samples the database's own recent transaction history and generates
 * plausible new rows for every day between the latest transaction and today.
 *
 * Generated rows carry a `synthetic-` prefix on plaid_transaction_id so they
 * are identifiable and can be deleted without touching Plaid-sourced data.
 * A re-seed (POST /api/plaid/seed) wipes them along with everything else.
 */

const SPEND_PER_DAY = 2 // average; actual count varies day to day
const CATALOG_WINDOW_DAYS = 90
const NON_SPENDING = ['TRANSFER_OUT', 'TRANSFER_IN', 'LOAN_PAYMENTS', 'BANK_FEES']

/** Merchants with a fixed monthly cadence, anchored to a day of the month. */
const MONTHLY_SUBSCRIPTIONS = [
  { merchant: 'Netflix', amount: 19.57, dayOfMonth: 10 },
  { merchant: 'Spotify', amount: 12.65, dayOfMonth: 10 },
  { merchant: 'Anthropic', amount: 20.0, dayOfMonth: 10 },
  { merchant: 'Apple iCloud+', amount: 9.99, dayOfMonth: 10 },
  { merchant: 'Apple', amount: 16.99, dayOfMonth: 10 },
  { merchant: '24 Hour Fitness', amount: 25.98, dayOfMonth: 5 },
  { merchant: 'Amazon Prime', amount: 14.99, dayOfMonth: 24 },
  { merchant: 'DNH*GODADDY#XXXXXXXXXX', amount: 23.19, dayOfMonth: 10 },
  { merchant: 'Xbox Game Pass', amount: 19.99, dayOfMonth: 15 },
  { merchant: 'Hulu', amount: 18.99, dayOfMonth: 18 },
  { merchant: 'HBO Max', amount: 16.99, dayOfMonth: 12 },
  { merchant: 'AccuWeather', amount: 4.99, dayOfMonth: 8 },
]

/** The demo's recurring weekly payroll deposit (Saturdays). */
const WEEKLY_INCOME = {
  name: 'DIRECT DEPOSIT - APEX TECHNOLOGIES PAYROLL',
  amount: -4750,
  saturday: 6,
}

interface CatalogEntry {
  name: string
  merchant_name: string | null
  merchant_entity_id: string | null
  category_primary: string | null
  category_detailed: string | null
  payment_channel: string | null
  account_id: string
  logo_url: string | null
  website: string | null
  amounts: number[]
}

export interface TopUpResult {
  added: number
  from: string | null
  to: string | null
}

const fmt = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Fill every missing day from the newest transaction through today with
 * sampled spending, due subscriptions, and the weekly income deposit.
 * No-op when the data is already current.
 */
export async function syntheticTopUp(): Promise<TopUpResult> {
  const supabase = createServerSupabase()

  const { data: newest, error: newestError } = await supabase
    .from('transactions')
    .select('date')
    .order('date', { ascending: false })
    .limit(1)
    .single()
  if (newestError || !newest) return { added: 0, from: null, to: null }

  const today = new Date()
  const start = new Date(`${newest.date}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() + 1)
  if (fmt(start) > fmt(today)) return { added: 0, from: null, to: null }

  // Build the sampling catalog from the DB's own recent history so generated
  // rows automatically match whatever the data currently looks like.
  const windowStart = new Date(today)
  windowStart.setUTCDate(windowStart.getUTCDate() - CATALOG_WINDOW_DAYS)

  const { data: history } = await supabase
    .from('transactions')
    .select('name, merchant_name, merchant_entity_id, category_primary, category_detailed, payment_channel, account_id, logo_url, website, amount')
    .gt('amount', 0)
    .gte('date', fmt(windowStart))
  const spendHistory = (history ?? []).filter(
    (t) => !NON_SPENDING.includes(t.category_primary ?? '')
  )
  if (spendHistory.length === 0) return { added: 0, from: null, to: null }

  const catalog = new Map<string, CatalogEntry>()
  for (const t of spendHistory) {
    const key = `${t.merchant_name ?? t.name}|${t.account_id}`
    const entry = catalog.get(key)
    if (entry) entry.amounts.push(Number(t.amount))
    else catalog.set(key, { ...t, amounts: [Number(t.amount)] })
  }
  const entries = [...catalog.values()]
  const totalWeight = entries.reduce((s, e) => s + e.amounts.length, 0)

  const pick = (): CatalogEntry => {
    let r = Math.random() * totalWeight
    for (const e of entries) {
      r -= e.amounts.length
      if (r <= 0) return e
    }
    return entries[entries.length - 1]
  }

  const amountFor = (e: CatalogEntry): number => {
    const base = e.amounts[Math.floor(Math.random() * e.amounts.length)]
    // A merchant whose charges are all identical is fixed-price (subscription,
    // membership) — jittering it would split its recurring-detection group.
    if (e.amounts.every((a) => a === e.amounts[0])) {
      return Math.round(base * 100) / 100
    }
    const jittered = base * (0.85 + Math.random() * 0.3)
    return Math.max(0.99, Math.round(jittered * 100) / 100)
  }

  const subscriptionNames = new Set(MONTHLY_SUBSCRIPTIONS.map((s) => s.merchant))

  // Income rows are negative, so the spending-history query above can never
  // contain them — fetch the latest paycheck separately as the template.
  const { data: incomeRows } = await supabase
    .from('transactions')
    .select('name, merchant_name, merchant_entity_id, category_primary, category_detailed, payment_channel, account_id, logo_url, website, amount')
    .eq('name', WEEKLY_INCOME.name)
    .lt('amount', 0)
    .order('date', { ascending: false })
    .limit(1)
  const incomeTemplate = incomeRows?.[0]

  const rows = []
  for (let d = new Date(start); fmt(d) <= fmt(today); d.setUTCDate(d.getUTCDate() + 1)) {
    const dateStr = fmt(d)

    // Due subscriptions land on their anchor day; skip them in random sampling.
    for (const sub of MONTHLY_SUBSCRIPTIONS) {
      if (d.getUTCDate() !== sub.dayOfMonth) continue
      const template = entries.find((e) => (e.merchant_name ?? e.name) === sub.merchant)
      if (!template) continue
      rows.push(buildRow(dateStr, template, sub.amount))
    }

    if (d.getUTCDay() === WEEKLY_INCOME.saturday && incomeTemplate) {
      rows.push(buildRow(dateStr, { ...incomeTemplate, amounts: [] }, WEEKLY_INCOME.amount))
    }

    const count = Math.round(SPEND_PER_DAY * (0.5 + Math.random()))
    for (let i = 0; i < count; i++) {
      let entry = pick()
      for (let tries = 0; subscriptionNames.has(entry.merchant_name ?? entry.name) && tries < 5; tries++) {
        entry = pick()
      }
      rows.push(buildRow(dateStr, entry, amountFor(entry)))
    }
  }

  if (rows.length === 0) return { added: 0, from: fmt(start), to: fmt(today) }

  const { error } = await supabase.from('transactions').insert(rows)
  if (error) throw new Error(`Synthetic top-up insert failed: ${error.message}`)

  return { added: rows.length, from: fmt(start), to: fmt(today) }
}

function buildRow(
  date: string,
  template: Omit<CatalogEntry, 'amounts'> & { amounts?: number[] },
  amount: number
) {
  return {
    plaid_transaction_id: `synthetic-${randomUUID()}`,
    account_id: template.account_id,
    amount,
    date,
    datetime: null,
    name: template.name,
    merchant_name: template.merchant_name,
    merchant_entity_id: template.merchant_entity_id,
    category_primary: template.category_primary,
    category_detailed: template.category_detailed,
    payment_channel: template.payment_channel,
    is_pending: false,
    pending_transaction_id: null,
    iso_currency_code: 'USD',
    logo_url: template.logo_url,
    website: template.website,
  }
}
