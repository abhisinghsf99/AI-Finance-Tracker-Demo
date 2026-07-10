import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'

/**
 * Guard for endpoints that mutate or destroy data.
 *
 * The secret is named CRON_SECRET rather than something like SEED_SECRET
 * because Vercel attaches `Authorization: Bearer $CRON_SECRET` to scheduled
 * requests automatically when a var by that exact name exists. Nothing is
 * scheduled today, but keeping the name means adding a cron later needs no
 * change here.
 *
 * Returns a response to short-circuit with, or null when the caller is allowed.
 */
export function requireCronAuth(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET

  if (!secret) {
    // Fail closed. An unset secret must never mean "open to everyone".
    console.error('CRON_SECRET is not set — refusing to run a protected route.')
    return NextResponse.json(
      { error: 'Server is missing CRON_SECRET' },
      { status: 500 }
    )
  }

  const header = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`

  if (!isEqual(header, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}

/** Constant-time string compare that tolerates length mismatches. */
function isEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
