import { create } from "zustand"
import type { Account, CreditLiability, CategorySpendingEntry } from "@/lib/queries/types"
import type { TransactionWithAccount } from "@/lib/queries/transactions"
import type { SpendWindow } from "@/lib/spend-window"

const STALE_AFTER_MS = 15 * 60 * 1000 // 15 minutes

interface DashboardStore {
  // Data
  accounts: Account[]
  creditLiabilities: CreditLiability[]
  transactions: TransactionWithAccount[]
  categorySpending: CategorySpendingEntry[]
  totalSpend30Days: number
  spendWindow: SpendWindow | null

  // State
  isLoaded: boolean
  isLoading: boolean
  error: string | null
  loadedAt: number | null

  // Actions
  loadDashboard: () => Promise<void>
  clear: () => void

  // Computed getters
  getAccountsByType: (type: string) => Account[]
  getCreditLiabilityForAccount: (accountId: string) => CreditLiability | undefined
  getPurchaseAPR: (accountId: string) => number | null
}

const initialState = {
  accounts: [],
  creditLiabilities: [],
  transactions: [],
  categorySpending: [],
  totalSpend30Days: 0,
  spendWindow: null,
  isLoaded: false,
  isLoading: false,
  error: null,
  loadedAt: null,
}

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  ...initialState,

  loadDashboard: async () => {
    const state = get()

    // If already loading, skip
    if (state.isLoading) return

    // If loaded and not stale, skip (unless this is a background refresh)
    if (state.isLoaded && state.loadedAt) {
      const age = Date.now() - state.loadedAt
      if (age < STALE_AFTER_MS) return
    }

    set({ isLoading: true, error: null })

    try {
      const res = await fetch("/api/dashboard")
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }

      const data = await res.json()

      set({
        accounts: data.accounts,
        creditLiabilities: data.creditLiabilities,
        transactions: data.transactions,
        categorySpending: data.categorySpending,
        totalSpend30Days: data.totalSpend30Days,
        spendWindow: data.spendWindow ?? null,
        isLoaded: true,
        isLoading: false,
        loadedAt: Date.now(),
      })
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to load dashboard",
      })
    }
  },

  clear: () => {
    set({ ...initialState })
  },

  getAccountsByType: (type: string) => {
    return get().accounts.filter((a) => a.type === type)
  },

  getCreditLiabilityForAccount: (accountId: string) => {
    return get().creditLiabilities.find((l) => l.account_id === accountId)
  },

  getPurchaseAPR: (accountId: string) => {
    const liability = get().creditLiabilities.find((l) => l.account_id === accountId)
    if (!liability) return null
    const purchaseApr = liability.aprs.find((a) => a.apr_type === "purchase_apr")
    return purchaseApr?.apr_percentage ?? null
  },
}))
