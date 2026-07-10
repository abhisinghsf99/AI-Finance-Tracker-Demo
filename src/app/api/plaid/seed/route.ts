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
 * Deliberately manual, never scheduled. Day-to-day freshness comes from the
 * additive GET /api/cron/refresh instead; this route exists to establish (or
 * rebuild) the Item that refresh then keeps current. Invoke only when you mean
 * to trade the existing data for a fresh Item:
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
