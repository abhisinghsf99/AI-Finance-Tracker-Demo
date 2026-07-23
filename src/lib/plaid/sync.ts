import { plaidClient } from './client'
import { createServerSupabase } from '@/lib/supabase/server'
import type { RemovedTransaction, Transaction as PlaidTransaction } from 'plaid'
import { canonicalizeCategory } from '@/lib/categories'

/**
 * Sync transactions for a given institution (plaid item).
 * Uses the institutions table which stores plaid_access_token and sync_cursor.
 */
export async function syncTransactions(institutionId: string) {
  const supabase = createServerSupabase()

  // Get the stored cursor and access_token from the institutions table
  const { data: institution } = await supabase
    .from('institutions')
    .select('id, plaid_access_token, sync_cursor, plaid_item_id')
    .eq('id', institutionId)
    .single()

  if (!institution) throw new Error(`No institution found for ${institutionId}`)

  let cursor = institution.sync_cursor || undefined
  let hasMore = true
  const added: PlaidTransaction[] = []
  const modified: PlaidTransaction[] = []
  const removed: RemovedTransaction[] = []

  // Paginate through all updates
  while (hasMore) {
    const response = await plaidClient.transactionsSync({
      access_token: institution.plaid_access_token,
      cursor,
      count: 500,
    })

    added.push(...response.data.added)
    modified.push(...response.data.modified)
    removed.push(...response.data.removed)
    hasMore = response.data.has_more
    cursor = response.data.next_cursor
  }

  // Get the account mapping (plaid_account_id -> our account id)
  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, plaid_account_id')

  const accountMap = new Map(
    (accounts || []).map((a: { id: string; plaid_account_id: string }) => [a.plaid_account_id, a.id])
  )

  // Upsert added and modified transactions
  const toUpsert = [...added, ...modified].map(txn => ({
    plaid_transaction_id: txn.transaction_id,
    account_id: accountMap.get(txn.account_id) || txn.account_id,
    amount: txn.amount,
    date: txn.date,
    datetime: txn.datetime || null,
    name: txn.name,
    merchant_name: txn.merchant_name || null,
    merchant_entity_id: txn.merchant_entity_id || null,
    category_primary: canonicalizeCategory(txn.personal_finance_category?.primary),
    category_detailed: txn.personal_finance_category?.detailed || null,
    payment_channel: txn.payment_channel || null,
    is_pending: txn.pending,
    pending_transaction_id: txn.pending_transaction_id || null,
    iso_currency_code: txn.iso_currency_code || 'USD',
    logo_url: txn.logo_url || null,
    website: txn.website || null,
    updated_at: new Date().toISOString(),
  }))

  if (toUpsert.length > 0) {
    const { error } = await supabase
      .from('transactions')
      .upsert(toUpsert, { onConflict: 'plaid_transaction_id' })
    if (error) throw new Error(`Failed to upsert transactions: ${error.message}`)
  }

  // Remove deleted transactions
  if (removed.length > 0) {
    const removedIds = removed.map(t => t.transaction_id).filter(Boolean)
    if (removedIds.length > 0) {
      await supabase
        .from('transactions')
        .delete()
        .in('plaid_transaction_id', removedIds as string[])
    }
  }

  // Update sync cursor on the institutions table
  await supabase
    .from('institutions')
    .update({ sync_cursor: cursor })
    .eq('id', institutionId)

  // Log the sync
  await supabase.from('sync_log').insert({
    institution_id: institutionId,
    transactions_added: added.length,
    transactions_modified: modified.length,
    transactions_removed: removed.length,
    cursor_before: institution.sync_cursor || null,
    cursor_after: cursor,
  })

  return { added: added.length, modified: modified.length, removed: removed.length }
}
