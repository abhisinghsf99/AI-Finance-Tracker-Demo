import { NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/cron-auth'
import { seedSandboxData, describeSeedError } from '@/lib/plaid/seed'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Manual re-seed. Wipes the database and repopulates it from a fresh Plaid
 * sandbox item, which is the only way to get transactions dated near today —
 * Plaid's sandbox anchors an item's history to its creation and never adds more.
 *
 * Deliberately manual, never scheduled: it is destructive, and the dashboard
 * already degrades gracefully on stale data (see lib/spend-window.ts). Invoke
 * only when you want to trade the existing data for fresh dates:
 *
 *   curl -X POST https://<host>/api/plaid/seed \
 *     -H "Authorization: Bearer $CRON_SECRET"
 *
 * Guarded because this app has no user auth — without the guard anyone who
 * knows the URL could drop every row.
 */
export async function POST(request: Request) {
  const unauthorized = requireCronAuth(request)
  if (unauthorized) return unauthorized

  try {
    const result = await seedSandboxData()
    return NextResponse.json(result)
  } catch (error: unknown) {
    const message = describeSeedError(error)
    console.error('Sandbox seed error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
