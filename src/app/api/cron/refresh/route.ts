import { NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/cron-auth'
import { refreshAllInstitutions } from '@/lib/plaid/refresh'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Daily transaction refresh, invoked by Vercel Cron (see `crons` in vercel.json).
 *
 * Asks Plaid to generate new transactions on each Item, then syncs them into
 * Supabase. Additive: no table is ever cleared. Contrast with the manual
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

    if (results.length === 0) {
      console.log('Cron refresh: no linked institutions')
      return NextResponse.json({ message: 'No linked accounts to refresh', results })
    }

    const totals = results.reduce(
      (acc, r) => ({
        added: acc.added + r.added,
        modified: acc.modified + r.modified,
        removed: acc.removed + r.removed,
      }),
      { added: 0, modified: 0, removed: 0 }
    )

    console.log('Cron refresh complete:', totals)

    // A partial failure still returns 200 with per-institution errors, so one
    // broken Item doesn't mask the ones that succeeded.
    return NextResponse.json({ totals, results })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Refresh failed'
    console.error('Cron refresh failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
