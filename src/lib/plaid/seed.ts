import { plaidClient } from './client'
import { createServerSupabase } from '@/lib/supabase/server'
import { EXCLUDED_SUBTYPES } from '@/lib/plaid/excluded-accounts'
import { Products, SandboxPublicTokenCreateRequestOptions } from 'plaid'
import type { Transaction as PlaidTransaction } from 'plaid'

const SANDBOX_INSTITUTION_ID = 'ins_109508' // First Platypus Bank (non-OAuth, required by the test user below)
const SANDBOX_INSTITUTION_NAME = 'First Platypus Bank'

/**
 * The `user_good` default produces a static transaction history that can never
 * be extended. `user_transactions_dynamic` produces a depository and a credit
 * card account whose transactions grow each time /transactions/refresh is
 * called — which is what keeps this dashboard's data current without wiping it.
 * Any password is accepted for this user.
 */
const SANDBOX_USERNAME = 'user_transactions_dynamic'
const SANDBOX_PASSWORD = 'pass_good'

/**
 * The dynamic user only exposes a checking and a credit card account, but the
 * account cards and Payoff Planner also want a savings account, a student loan,
 * and a mortgage. These come from a throwaway `user_good` Item at the same
 * institution — we want its balances, never its transactions, which are static
 * and cannot be refreshed.
 */
const BALANCE_ONLY_USERNAME = 'user_good'
const BALANCE_ONLY_SUBTYPES = new Set(['savings', 'student', 'mortgage'])
const TRANSACTION_HISTORY_DAYS = 365
const PRODUCT_READY_ATTEMPTS = 5
const PRODUCT_READY_DELAY_MS = 3000
const UPSERT_CHUNK_SIZE = 500

export interface SeedResult {
  success: true
  institution: string
  accounts_added: number
  /** Subset of accounts_added borrowed from a `user_good` Item for balances only. */
  balance_only_accounts_added: number
  transactions_added: number
  liabilities_added: number
  items_removed: number
}

/**
 * Seeds sandbox data by creating a fresh Plaid sandbox item, then pulling its
 * accounts, transactions, and liabilities into Supabase.
 *
 * Uses transactionsGet (not transactionsSync) because sandbox items don't have
 * sync data available immediately after creation.
 *
 * DESTRUCTIVE: wipes every row in the six tables below before re-populating.
 * Callers must authenticate.
 */
export async function seedSandboxData(): Promise<SeedResult> {
  const supabase = createServerSupabase()

  // Release the sandbox items from previous seeds. Without this, every run
  // strands another item on the Plaid side that nothing references.
  const { data: staleInstitutions } = await supabase
    .from('institutions')
    .select('plaid_access_token')

  let itemsRemoved = 0
  for (const inst of staleInstitutions ?? []) {
    if (!inst.plaid_access_token) continue
    try {
      await plaidClient.itemRemove({ access_token: inst.plaid_access_token })
      itemsRemoved++
    } catch (err) {
      // A stale item may already be gone, or its token invalidated. Log and keep
      // going — failing here would block the reseed for a cosmetic cleanup step.
      // Surface Plaid's error_code; the raw AxiosError says nothing useful.
      console.error('Failed to remove old Plaid item:', describeSeedError(err))
    }
  }

  // Clear all existing data to prevent duplicates on re-seed.
  // Order matters: children before parents.
  await supabase.from('credit_liability_aprs').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('credit_liabilities').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('transactions').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('sync_log').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('accounts').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('institutions').delete().neq('id', '00000000-0000-0000-0000-000000000000')

  // Use Plaid sandbox to create a public token directly (no Link UI needed)
  const sandboxResponse = await plaidClient.sandboxPublicTokenCreate({
    institution_id: SANDBOX_INSTITUTION_ID,
    initial_products: [Products.Transactions],
    options: {
      webhook: '',
      override_username: SANDBOX_USERNAME,
      override_password: SANDBOX_PASSWORD,
    } as SandboxPublicTokenCreateRequestOptions,
  })

  const exchangeResponse = await plaidClient.itemPublicTokenExchange({
    public_token: sandboxResponse.data.public_token,
  })

  const accessToken = exchangeResponse.data.access_token
  const itemId = exchangeResponse.data.item_id

  // Store institution
  const { data: institution } = await supabase
    .from('institutions')
    .upsert({
      plaid_item_id: itemId,
      plaid_access_token: accessToken,
      sync_cursor: null,
      institution_name: SANDBOX_INSTITUTION_NAME,
      institution_id: SANDBOX_INSTITUTION_ID,
      status: 'active',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'plaid_item_id' })
    .select('id')
    .single()

  // Fetch and store accounts
  const accountsResponse = await plaidClient.accountsGet({ access_token: accessToken })

  const filteredAccounts = accountsResponse.data.accounts.filter(
    account => !EXCLUDED_SUBTYPES.has(account.subtype ?? '')
  )

  const accountsToInsert = filteredAccounts.map(account => ({
    plaid_account_id: account.account_id,
    institution_id: institution?.id,
    name: account.name,
    official_name: account.official_name,
    type: account.type,
    subtype: account.subtype,
    mask: account.mask,
    balance_available: account.balances.available,
    balance_current: account.balances.current,
    balance_limit: account.balances.limit,
    balance_updated_at: new Date().toISOString(),
  }))

  await supabase
    .from('accounts')
    .upsert(accountsToInsert, { onConflict: 'plaid_account_id' })

  // Build account map (plaid_account_id -> our UUID)
  const { data: dbAccounts } = await supabase
    .from('accounts')
    .select('id, plaid_account_id')

  const accountMap = new Map(
    (dbAccounts || []).map((a: { id: string; plaid_account_id: string }) => [a.plaid_account_id, a.id])
  )

  const allTransactions = await fetchTransactionsWithRetry(accessToken)

  // Upsert transactions into Supabase
  const toUpsert = allTransactions.map(txn => ({
    plaid_transaction_id: txn.transaction_id,
    account_id: accountMap.get(txn.account_id) || txn.account_id,
    amount: txn.amount,
    date: txn.date,
    datetime: txn.datetime || null,
    name: txn.name,
    merchant_name: txn.merchant_name || null,
    merchant_entity_id: txn.merchant_entity_id || null,
    category_primary: txn.personal_finance_category?.primary || null,
    category_detailed: txn.personal_finance_category?.detailed || null,
    payment_channel: txn.payment_channel || null,
    is_pending: txn.pending,
    pending_transaction_id: txn.pending_transaction_id || null,
    iso_currency_code: txn.iso_currency_code || 'USD',
    logo_url: txn.logo_url || null,
    website: txn.website || null,
    updated_at: new Date().toISOString(),
  }))

  for (let i = 0; i < toUpsert.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = toUpsert.slice(i, i + UPSERT_CHUNK_SIZE)
    const { error } = await supabase
      .from('transactions')
      .upsert(chunk, { onConflict: 'plaid_transaction_id' })
    if (error) throw new Error(`Failed to upsert transactions: ${error.message}`)
  }

  const balanceOnlyAdded = await seedBalanceOnlyAccounts(institution!.id)
  const liabilitiesAdded = await seedLiabilities()

  return {
    success: true,
    institution: SANDBOX_INSTITUTION_NAME,
    accounts_added: accountsToInsert.length + balanceOnlyAdded,
    balance_only_accounts_added: balanceOnlyAdded,
    transactions_added: allTransactions.length,
    liabilities_added: liabilitiesAdded,
    items_removed: itemsRemoved,
  }
}

/**
 * Borrow the savings / student loan / mortgage accounts from a `user_good` Item,
 * attach them to the institution row we already created (it is the same Plaid
 * institution), then release the Item.
 *
 * Only the accounts and their balances are stored. No transactions are pulled,
 * so nothing stale can enter the transactions table and the refresh cron has
 * nothing extra to sync. Balances are static in Sandbox anyway — the Payoff
 * Planner reads balances and APRs, not transaction history.
 */
async function seedBalanceOnlyAccounts(institutionRowId: string): Promise<number> {
  const supabase = createServerSupabase()

  const sandboxResponse = await plaidClient.sandboxPublicTokenCreate({
    institution_id: SANDBOX_INSTITUTION_ID,
    initial_products: [Products.Transactions],
    options: {
      webhook: '',
      override_username: BALANCE_ONLY_USERNAME,
      override_password: SANDBOX_PASSWORD,
    } as SandboxPublicTokenCreateRequestOptions,
  })

  const exchangeResponse = await plaidClient.itemPublicTokenExchange({
    public_token: sandboxResponse.data.public_token,
  })
  const accessToken = exchangeResponse.data.access_token

  try {
    const accountsResponse = await plaidClient.accountsGet({ access_token: accessToken })

    const wanted = accountsResponse.data.accounts.filter(account => {
      const subtype = account.subtype ?? ''
      return BALANCE_ONLY_SUBTYPES.has(subtype) && !EXCLUDED_SUBTYPES.has(subtype)
    })

    if (wanted.length === 0) return 0

    const { error } = await supabase.from('accounts').upsert(
      wanted.map(account => ({
        plaid_account_id: account.account_id,
        institution_id: institutionRowId,
        name: account.name,
        official_name: account.official_name,
        type: account.type,
        subtype: account.subtype,
        mask: account.mask,
        balance_available: account.balances.available,
        balance_current: account.balances.current,
        balance_limit: account.balances.limit,
        balance_updated_at: new Date().toISOString(),
      })),
      { onConflict: 'plaid_account_id' }
    )
    if (error) throw new Error(`Failed to upsert balance-only accounts: ${error.message}`)

    return wanted.length
  } finally {
    // Release the borrowed Item either way. Its access token is never stored,
    // so leaving it alive would strand it with no way to reach it again.
    try {
      await plaidClient.itemRemove({ access_token: accessToken })
    } catch (err) {
      console.error('Failed to release balance-only Plaid item:', describeSeedError(err))
    }
  }
}

/**
 * Sandbox items need a few seconds before transactions are ready, and Plaid
 * answers PRODUCT_NOT_READY until then. Retry through that specific error only.
 */
async function fetchTransactionsWithRetry(accessToken: string): Promise<PlaidTransaction[]> {
  const now = new Date()
  const startDate = new Date(now)
  startDate.setDate(startDate.getDate() - TRANSACTION_HISTORY_DAYS)

  for (let attempt = 1; attempt <= PRODUCT_READY_ATTEMPTS; attempt++) {
    await new Promise(resolve => setTimeout(resolve, PRODUCT_READY_DELAY_MS))

    try {
      let totalTransactions = Infinity
      let offset = 0
      let collected: PlaidTransaction[] = []

      while (collected.length < totalTransactions) {
        const txnResponse = await plaidClient.transactionsGet({
          access_token: accessToken,
          start_date: startDate.toISOString().split('T')[0],
          end_date: now.toISOString().split('T')[0],
          options: { count: 500, offset },
        })

        collected = collected.concat(txnResponse.data.transactions)
        totalTransactions = txnResponse.data.total_transactions
        offset = collected.length
      }

      return collected
    } catch (err: unknown) {
      const plaidError = (err as { response?: { data?: { error_code?: string } } })?.response?.data?.error_code
      if (plaidError === 'PRODUCT_NOT_READY' && attempt < PRODUCT_READY_ATTEMPTS) {
        continue
      }
      throw err
    }
  }

  throw new Error('Plaid transactions were not ready after all retries')
}

/** APR + minimum payment configs by account subtype. */
const APR_CONFIGS: Record<string, { apr: number; cashApr?: number; btApr?: number; minPay: (b: number) => number }> = {
  'credit card': { apr: 21.99, cashApr: 25.49, btApr: 15.99, minPay: (b) => Math.max(25, Math.round(b * 0.02 * 100) / 100) },
  'student': { apr: 3.625, cashApr: 5.50, minPay: (b) => Math.max(350, Math.round(b * 0.005 * 100) / 100) },
  'mortgage': { apr: 3.25, minPay: () => 4250 },
}

async function seedLiabilities(): Promise<number> {
  const supabase = createServerSupabase()

  const { data: liabilityAccounts } = await supabase
    .from('accounts')
    .select('id, name, type, subtype, balance_current')
    .in('type', ['credit', 'loan'])

  // Override mortgage balance to realistic amount
  for (const acc of liabilityAccounts || []) {
    if (acc.subtype === 'mortgage') {
      await supabase.from('accounts').update({ balance_current: 729103.37 }).eq('id', acc.id)
      acc.balance_current = 729103.37
    }
  }

  let liabilitiesAdded = 0
  for (const acc of liabilityAccounts || []) {
    const balance = Number(acc.balance_current) || 410
    const config = APR_CONFIGS[acc.subtype ?? ''] ?? APR_CONFIGS['credit card']

    const { data: liability } = await supabase
      .from('credit_liabilities')
      .insert({
        account_id: acc.id,
        is_overdue: false,
        last_payment_amount: Math.round(balance * 0.03 * 100) / 100,
        last_payment_date: new Date(Date.now() - 15 * 86400000).toISOString().split('T')[0],
        last_statement_issue_date: new Date(Date.now() - 20 * 86400000).toISOString().split('T')[0],
        last_statement_balance: balance,
        minimum_payment_amount: config.minPay(balance),
        next_payment_due_date: new Date(Date.now() + 10 * 86400000).toISOString().split('T')[0],
      })
      .select('id')
      .single()

    if (!liability) continue

    liabilitiesAdded++
    const aprs = [
      {
        credit_liability_id: liability.id,
        apr_percentage: config.apr,
        apr_type: 'purchase_apr',
        balance_subject_to_apr: balance,
        interest_charge_amount: Math.round(balance * config.apr / 100 / 12 * 100) / 100,
      },
    ]
    if (config.cashApr) {
      aprs.push({
        credit_liability_id: liability.id,
        apr_percentage: config.cashApr,
        apr_type: 'cash_apr',
        balance_subject_to_apr: 0,
        interest_charge_amount: 0,
      })
    }
    if (config.btApr) {
      aprs.push({
        credit_liability_id: liability.id,
        apr_percentage: config.btApr,
        apr_type: 'balance_transfer_apr',
        balance_subject_to_apr: 0,
        interest_charge_amount: 0,
      })
    }
    await supabase.from('credit_liability_aprs').insert(aprs)
  }

  return liabilitiesAdded
}

/** Normalizes a thrown Plaid/JS error into a message safe to log and return. */
export function describeSeedError(error: unknown): string {
  const plaidError = (error as { response?: { data?: unknown } })?.response?.data
  if (plaidError) return JSON.stringify(plaidError)
  return error instanceof Error ? error.message : 'Failed to seed sandbox data'
}
