"use client"

import { useState, useMemo } from "react"
import { ChevronRight, X } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { RecurringRow } from "@/components/dashboard/recurring-row"
import {
  detectRecurring,
  estimateMonthlyTotal,
} from "@/lib/recurring-detection"
import { formatCurrency } from "@/lib/plaid-amounts"
import type { Transaction } from "@/lib/queries/types"

interface RecurringPanelProps {
  transactions: Transaction[]
}

const PREVIEW_COUNT = 5

export function RecurringPanel({ transactions }: RecurringPanelProps) {
  const [modalOpen, setModalOpen] = useState(false)

  const recurring = useMemo(
    () => detectRecurring(transactions),
    [transactions]
  )
  const monthlyTotal = useMemo(
    () => estimateMonthlyTotal(recurring),
    [recurring]
  )

  if (recurring.length === 0) {
    return (
      <Card>
        <div className="p-4 text-center text-muted-foreground text-sm">
          No recurring charges detected
        </div>
      </Card>
    )
  }

  const previewCharges = recurring.slice(0, PREVIEW_COUNT)

  return (
    <>
      {/* Inline preview card */}
      <Card>
        <div className="px-4 pt-4">
          {previewCharges.map((charge) => (
            <RecurringRow key={`${charge.merchantName}-${charge.amount}`} charge={charge} />
          ))}
        </div>

        {/* Footer with monthly total + expand button */}
        <div className="px-4 py-3 border-t border-border flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            ~{formatCurrency(monthlyTotal)}/mo estimated
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="text-sm text-muted-foreground hover:text-foreground gap-1"
            onClick={() => setModalOpen(true)}
          >
            View All ({recurring.length})
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </Card>

      {/* Full recurring charges modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent
          className="sm:max-w-3xl max-h-[90vh] flex flex-col"
          showCloseButton={false}
        >
          <DialogHeader className="flex flex-row items-center justify-between shrink-0">
            <DialogTitle className="text-lg font-semibold">
              All Recurring Charges ({recurring.length})
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setModalOpen(false)}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto min-h-0 px-1">
            {recurring.map((charge) => (
              <RecurringRow key={`${charge.merchantName}-${charge.amount}`} charge={charge} />
            ))}
          </div>

          <div className="shrink-0 pt-2 border-t border-border text-sm text-muted-foreground">
            ~{formatCurrency(monthlyTotal)}/mo estimated
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
