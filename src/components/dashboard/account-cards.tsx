"use client"

import { formatCurrency } from "@/lib/plaid-amounts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Banknote, CreditCard, Landmark } from "lucide-react"
import { useDashboardStore } from "@/lib/store/dashboard-store"
import type { Account } from "@/lib/queries/types"

const TYPE_ORDER = ["depository", "credit", "loan"] as const

const TYPE_CONFIG: Record<
  string,
  {
    label: string
    icon: typeof Landmark
    badgeClass: string
  }
> = {
  depository: {
    label: "Depository",
    icon: Landmark,
    badgeClass: "bg-teal-500/15 text-teal-400",
  },
  credit: {
    label: "Credit",
    icon: CreditCard,
    badgeClass: "bg-amber-500/15 text-amber-400",
  },
  loan: {
    label: "Loan",
    icon: Banknote,
    badgeClass: "bg-red-500/15 text-red-400",
  },
}

function getUtilizationColor(ratio: number): string {
  if (ratio < 0.3) return "bg-green-500"
  if (ratio <= 0.7) return "bg-amber-500"
  return "bg-red-500"
}

function formatSubtype(type: string, subtype: string | null): string {
  if (!subtype) return TYPE_CONFIG[type]?.label ?? type
  return subtype
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00")
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function CreditUtilizationBar({ account }: { account: Account }) {
  const balance = account.balance_current ?? 0
  const limit = account.balance_limit

  if (limit == null || limit === 0) {
    return (
      <p className="text-xs text-muted-foreground mt-2">No limit set</p>
    )
  }

  const ratio = Math.min(balance / limit, 1)
  const percentage = Math.round(ratio * 100)
  const colorClass = getUtilizationColor(ratio)

  return (
    <div className="mt-3 space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">Utilization</span>
        <span className="text-muted-foreground">{percentage}% used</span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted/50">
        <div
          className={`h-full rounded-full transition-all ${colorClass}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {formatCurrency(balance)} of {formatCurrency(limit)}
      </p>
    </div>
  )
}

function CreditLiabilityInfo({ accountId }: { accountId: string }) {
  const { getCreditLiabilityForAccount } = useDashboardStore()
  const liability = getCreditLiabilityForAccount(accountId)

  if (!liability) return null

  const purchaseApr = liability.aprs.find((a) => a.apr_type === "purchase_apr")
  const balanceTransferApr = liability.aprs.find(
    (a) => a.apr_type === "balance_transfer_apr"
  )

  const hasAnyInfo =
    purchaseApr ||
    liability.next_payment_due_date ||
    liability.minimum_payment_amount != null

  if (!hasAnyInfo) return null

  return (
    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs border-t border-border/40 pt-3">
      {purchaseApr && (
        <div>
          <p className="text-muted-foreground">Purchase APR</p>
          <p className="font-medium">{purchaseApr.apr_percentage.toFixed(2)}%</p>
        </div>
      )}
      {liability.next_payment_due_date && (
        <div>
          <p className="text-muted-foreground">Next Payment Due</p>
          <p className="font-medium">
            {formatDate(liability.next_payment_due_date)}
          </p>
        </div>
      )}
      {liability.minimum_payment_amount != null && (
        <div>
          <p className="text-muted-foreground">Minimum Payment</p>
          <p className="font-medium">
            {formatCurrency(liability.minimum_payment_amount)}
          </p>
        </div>
      )}
      {balanceTransferApr && (
        <div>
          <p className="text-muted-foreground">Balance Transfer APR</p>
          <p className="font-medium">
            {balanceTransferApr.apr_percentage.toFixed(2)}%
            {balanceTransferApr.balance_subject_to_apr != null && (
              <span className="text-muted-foreground ml-1">
                on {formatCurrency(balanceTransferApr.balance_subject_to_apr)}
              </span>
            )}
          </p>
        </div>
      )}
    </div>
  )
}

function DepositoryActivityInfo({ accountId }: { accountId: string }) {
  const { transactions } = useDashboardStore()

  const accountTxns = transactions.filter((t) => t.account_id === accountId)
  if (accountTxns.length === 0) return null

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const recent = accountTxns.filter((t) => t.date >= cutoffStr)
  const moneyIn = recent
    .filter((t) => t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0)
  const moneyOut = recent
    .filter((t) => t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0)

  const lastDeposit = accountTxns
    .filter((t) => t.amount < 0)
    .sort((a, b) => b.date.localeCompare(a.date))[0]

  return (
    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs border-t border-border/40 pt-3">
      <div>
        <p className="text-muted-foreground">In (30 days)</p>
        <p className="font-medium text-emerald-400">+{formatCurrency(moneyIn)}</p>
      </div>
      <div>
        <p className="text-muted-foreground">Out (30 days)</p>
        <p className="font-medium">{formatCurrency(moneyOut)}</p>
      </div>
      {lastDeposit && (
        <div className="col-span-2">
          <p className="text-muted-foreground">Last Deposit</p>
          <p className="font-medium">
            +{formatCurrency(lastDeposit.amount)}
            <span className="text-muted-foreground ml-1">
              on {formatDate(lastDeposit.date)}
            </span>
          </p>
        </div>
      )}
    </div>
  )
}

function AccountCard({ account }: { account: Account }) {
  const config = TYPE_CONFIG[account.type] ?? TYPE_CONFIG.depository
  const Icon = config.icon
  const displayName = account.name ?? account.official_name ?? "Unknown Account"
  const mask = account.mask ? `****${account.mask}` : ""

  const isDepository = account.type === "depository"
  const isCredit = account.type === "credit"

  return (
    <Card className="border-border/40">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
          <CardTitle className="text-sm font-medium truncate">
            {displayName}
          </CardTitle>
        </div>
        <span
          className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${config.badgeClass}`}
        >
          {formatSubtype(account.type, account.subtype)}
        </span>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline justify-between">
          {isDepository ? (
            <div>
              <span className="text-xl font-bold text-cyan-400">
                {formatCurrency(account.balance_available ?? account.balance_current ?? 0)}
              </span>
              {account.balance_available != null &&
                account.balance_current != null &&
                account.balance_available !== account.balance_current && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Posted: {formatCurrency(account.balance_current)}
                  </p>
                )}
            </div>
          ) : (
            <span className="text-xl font-bold text-cyan-400">
              {formatCurrency(account.balance_current ?? 0)}
            </span>
          )}
          {mask && (
            <span className="text-xs text-muted-foreground">{mask}</span>
          )}
        </div>
        {isDepository && <DepositoryActivityInfo accountId={account.id} />}
        {isCredit && <CreditUtilizationBar account={account} />}
        {(isCredit || account.type === "loan") && (
          <CreditLiabilityInfo accountId={account.id} />
        )}
      </CardContent>
    </Card>
  )
}

interface AccountCardsProps {
  accounts: Account[]
}

export function AccountCards({ accounts }: AccountCardsProps) {
  if (accounts.length === 0) {
    return (
      <Card className="border-border/40">
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">No accounts linked</p>
        </CardContent>
      </Card>
    )
  }

  const grouped: { type: string; accounts: Account[] }[] = TYPE_ORDER.map(
    (type) => ({
      type,
      accounts: accounts.filter((a) => a.type === type),
    })
  ).filter((g) => g.accounts.length > 0)

  // Include any account types not in TYPE_ORDER
  const coveredTypes = new Set<string>(TYPE_ORDER)
  const otherAccounts = accounts.filter((a) => !coveredTypes.has(a.type))
  if (otherAccounts.length > 0) {
    grouped.push({ type: "other", accounts: otherAccounts })
  }

  return (
    <div className="space-y-6">
      {grouped.map((group) => (
        <div key={group.type}>
          <h3 className="text-sm font-medium text-muted-foreground mb-3 capitalize">
            {TYPE_CONFIG[group.type]?.label ?? group.type}
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {group.accounts.map((account) => (
              <AccountCard key={account.id} account={account} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default AccountCards
