import { NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/cron-auth'
import { refreshAllInstitutions } from '@/lib/plaid/refresh'
import { syntheticTopUp } from '@/lib/plaid/synthetic-topup'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Weekly transaction refresh, invoked by Vercel Cron (see `crons` in vercel.json).
 *
 * Two stages:
 *  1. Ask Plaid to generate new transactions on each Item and sync them in.
 *     In practice the sandbox's transactionsRefresh errors more often than it
 *     works, so this is best-effort.
 *  2. Whatever Plaid did, top up synthetically: fill every day between the
 *     newest transaction and today with rows sampled from the DB's own recent
 *     history, so the demo data never goes stale.
 *
 * Additive: no table is ever cleared. Contrast with the manual
 * POST /api/plaid/seed, which wipes and rebuilds from a brand-new Item.
 *
 * Vercel Cron only issues GET requests. The CRON_SECRET check keeps this from
 * being a free Plaid-quota faucet for anyone who finds the URL.
 */
export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request)
  if (unauthorized) return unauthorized

  try {
    const results = await refreshAllInstitutions()

    const plaidTotals = results.reduce(
      (acc, r) => ({
        added: acc.added + r.added,
        modified: acc.modified + r.modified,
        removed: acc.removed + r.removed,
      }),
      { added: 0, modified: 0, removed: 0 }
    )

    const synthetic = await syntheticTopUp()

    console.log('Cron refresh complete:', { plaid: plaidTotals, synthetic })

    // A partial failure still returns 200 with per-institution errors, so one
    // broken Item doesn't mask the ones that succeeded.
    return NextResponse.json({ plaid: { totals: plaidTotals, results }, synthetic })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Refresh failed'
    console.error('Cron refresh failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
