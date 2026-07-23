"use client"

import type { TransactionWithAccount } from "@/lib/queries/transactions"
import { formatSignedCurrency, isIncome } from "@/lib/plaid-amounts"
import { getCategoryColor } from "@/lib/chart-colors"

interface TransactionRowProps {
  transaction: TransactionWithAccount
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00")
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatCategoryName(category: string): string {
  return category
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function TransactionRow({ transaction }: TransactionRowProps) {
  const merchantName =
    transaction.merchant_name ?? transaction.name ?? "Unknown"
  const amount = formatSignedCurrency(transaction.amount)
  const incoming = isIncome(transaction.amount)
  const category = transaction.category_primary ?? "OTHER"
  const categoryColor = getCategoryColor(category)
  const date = formatDate(transaction.date)

  return (
    <div className="flex flex-col gap-1 py-3 border-b border-border last:border-b-0">
      {/* Line 1: merchant + amount */}
      <div className="flex items-center justify-between">
        <span className="font-medium text-foreground truncate mr-2">
          {merchantName}
        </span>
        <span
          className={`font-medium whitespace-nowrap ${incoming ? "text-emerald-400" : "text-foreground"}`}
        >
          {amount}
        </span>
      </div>

      {/* Line 2: category badge + date + account */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white shrink-0"
          style={{ backgroundColor: categoryColor }}
          data-testid="category-badge"
        >
          {formatCategoryName(category)}
        </span>
        <span>{date}</span>
        <span className="text-muted-foreground/70">{transaction.account_name}</span>
      </div>
    </div>
  )
}
