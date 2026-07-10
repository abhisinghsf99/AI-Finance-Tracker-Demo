"use client"

import dynamic from "next/dynamic"
import { formatCurrency } from "@/lib/plaid-amounts"
import { getCategoryColor } from "@/lib/chart-colors"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent } from "@/components/ui/card"
import { useDashboardStore } from "@/lib/store/dashboard-store"
import type { Transaction } from "@/lib/queries/types"

const CategoryChart = dynamic(
  () => import("@/components/dashboard/category-chart"),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[300px] w-full rounded-lg" />,
  }
)

function prettifyCategory(category: string): string {
  return category
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

interface SummaryCardsProps {
  transactions: Transaction[]
}

/** Renders a YYYY-MM-DD date as MM-DD-YYYY without tripping over timezones. */
function formatWindowDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-")
  return `${month}-${day}-${year}`
}

export function SummaryCards({ transactions }: SummaryCardsProps) {
  const { totalSpend30Days, categorySpending, spendWindow } = useDashboardStore()

  const NON_SPENDING_CATEGORIES = new Set([
    "TRANSFER_OUT",
    "TRANSFER_IN",
    "LOAN_PAYMENTS",
    "BANK_FEES",
  ])

  const sortedCategories = [...categorySpending]
    .filter((e) => !NON_SPENDING_CATEGORIES.has(e.category))
    .sort((a, b) => b.total - a.total)

  return (
    <Card className="border-border/40">
      <CardContent className="pt-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left side: 30-day total + category breakdown */}
          <div>
            <p className="text-sm text-muted-foreground mb-1">
              {spendWindow?.isStale ? "Last 30 Days of Activity" : "Last 30 Days"}
            </p>
            <p className="text-4xl font-bold text-cyan-400 mb-1">
              {totalSpend30Days > 0
                ? formatCurrency(totalSpend30Days)
                : "$0.00"}
            </p>
            <p className="text-xs text-muted-foreground mb-6 h-4">
              {spendWindow?.isStale
                ? `Through ${formatWindowDate(spendWindow.end)} — no newer data`
                : ""}
            </p>

            {sortedCategories.length > 0 ? (
              <div className="space-y-2">
                {sortedCategories.map((entry) => (
                  <div
                    key={entry.category}
                    className="flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="h-2.5 w-2.5 rounded-sm shrink-0"
                        style={{
                          backgroundColor: getCategoryColor(entry.category),
                        }}
                      />
                      <span className="text-muted-foreground truncate">
                        {prettifyCategory(entry.category)}
                      </span>
                    </div>
                    <span className="font-medium ml-4 shrink-0">
                      {formatCurrency(entry.total)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No spending data available
              </p>
            )}
          </div>

          {/* Right side: Donut chart */}
          <div className="flex items-center justify-center">
            <CategoryChart
              data={categorySpending}
              transactions={transactions}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default SummaryCards
