import { plaidClient } from './client'
import { createServerSupabase } from '@/lib/supabase/server'
import { syncTransactions } from './sync'

/**
 * Plaid's refresh is an on-demand extraction; the new transactions are not
 * guaranteed to be queryable the instant it returns. Sync, and if nothing came
 * back, give it a moment and sync once more before concluding there was
 * nothing to fetch. The cursor makes repeat syncs safe — a second call with an
 * unchanged cursor simply returns the same (empty) delta.
 */
const SYNC_RETRY_DELAY_MS = 2500
const SYNC_ATTEMPTS = 3

export interface RefreshResult {
  institution_id: string
  refreshed: boolean
  added: number
  modified: number
  removed: number
  error?: string
}

/**
 * Ask Plaid for new transactions on every linked Item, then pull them into
 * Supabase through the existing cursor-based sync.
 *
 * Non-destructive. Rows are added and updated; the only deletions are the ones
 * Plaid itself reports as removed — chiefly pending transactions being replaced
 * by their posted counterparts, which is correct and prevents double-counting.
 *
 * Only produces new data for Items created as `user_transactions_dynamic`
 * (see lib/plaid/seed.ts). On a `user_good` Item the refresh is a no-op.
 */
export async function refreshAllInstitutions(): Promise<RefreshResult[]> {
  const supabase = createServerSupabase()

  const { data: institutions } = await supabase
    .from('institutions')
    .select('id, plaid_access_token')

  if (!institutions || institutions.length === 0) return []

  const results: RefreshResult[] = []

  for (const inst of institutions) {
    try {
      await plaidClient.transactionsRefresh({ access_token: inst.plaid_access_token })

      const totals = { added: 0, modified: 0, removed: 0 }

      for (let attempt = 1; attempt <= SYNC_ATTEMPTS; attempt++) {
        const counts = await syncTransactions(inst.id)
        totals.added += counts.added
        totals.modified += counts.modified
        totals.removed += counts.removed

        if (counts.added > 0 || counts.modified > 0 || counts.removed > 0) break
        if (attempt < SYNC_ATTEMPTS) {
          await new Promise(resolve => setTimeout(resolve, SYNC_RETRY_DELAY_MS))
        }
      }

      results.push({ institution_id: inst.id, refreshed: true, ...totals })
    } catch (error: unknown) {
      const plaidError = (error as { response?: { data?: unknown } })?.response?.data
      const message = plaidError
        ? JSON.stringify(plaidError)
        : error instanceof Error ? error.message : 'Refresh failed'

      console.error(`Refresh failed for institution ${inst.id}:`, message)
      results.push({
        institution_id: inst.id,
        refreshed: false,
        added: 0,
        modified: 0,
        removed: 0,
        error: message,
      })
    }
  }

  return results
}
