"use client"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import type { TransactionFilters } from "@/lib/transaction-filters"

interface TransactionFiltersProps {
  filters: TransactionFilters
  onFiltersChange: (filters: TransactionFilters) => void
  categories: string[]
  accounts: { id: string; name: string }[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Element the popover drops down from (e.g. the toolbar's Filter button). */
  anchor?: React.RefObject<HTMLElement | null>
  children?: React.ReactNode
}

function formatCategoryName(category: string): string {
  return category
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function TransactionFilterPopover({
  filters,
  onFiltersChange,
  categories,
  accounts,
  open,
  onOpenChange,
  anchor,
  children,
}: TransactionFiltersProps) {
  const handleClearAll = () => {
    onFiltersChange({})
  }

  const handleApply = () => {
    onOpenChange(false)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={children ? (children as React.ReactElement) : undefined} />
      <PopoverContent
        className="w-72 max-sm:w-[calc(100vw-2rem)] p-4"
        align="end"
        anchor={anchor}
      >
        <div className="flex flex-col gap-3">
          <h4 className="font-medium text-sm">Filters</h4>

          {/* Date range */}
          <div className="flex flex-col gap-1.5">
            <Label>Date range</Label>
            <div className="flex gap-2">
              <input
                type="date"
                value={filters.dateRange?.start ?? ""}
                onChange={(e) =>
                  onFiltersChange({
                    ...filters,
                    dateRange: e.target.value
                      ? {
                          start: e.target.value,
                          end: filters.dateRange?.end ?? "",
                        }
                      : undefined,
                  })
                }
                className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs [color-scheme:dark]"
                aria-label="From date"
              />
              <input
                type="date"
                value={filters.dateRange?.end ?? ""}
                onChange={(e) =>
                  onFiltersChange({
                    ...filters,
                    dateRange: e.target.value
                      ? {
                          start: filters.dateRange?.start ?? "",
                          end: e.target.value,
                        }
                      : undefined,
                  })
                }
                className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs [color-scheme:dark]"
                aria-label="To date"
              />
            </div>
          </div>

          {/* Category */}
          <div className="flex flex-col gap-1.5">
            <Label>Category</Label>
            <Select
              value={filters.category ?? ""}
              onValueChange={(val) =>
                onFiltersChange({
                  ...filters,
                  category: val || undefined,
                })
              }
            >
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue placeholder="All categories">
                  {(value: string | null) =>
                    value ? formatCategoryName(value) : "All categories"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All categories</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {formatCategoryName(cat)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Amount range */}
          <div className="flex flex-col gap-1.5">
            <Label>Amount range</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                placeholder="Min"
                value={filters.amountMin ?? ""}
                onChange={(e) =>
                  onFiltersChange({
                    ...filters,
                    amountMin: e.target.value
                      ? Number(e.target.value)
                      : undefined,
                  })
                }
                className="h-8 text-xs"
                aria-label="Minimum amount"
              />
              <Input
                type="number"
                placeholder="Max"
                value={filters.amountMax ?? ""}
                onChange={(e) =>
                  onFiltersChange({
                    ...filters,
                    amountMax: e.target.value
                      ? Number(e.target.value)
                      : undefined,
                  })
                }
                className="h-8 text-xs"
                aria-label="Maximum amount"
              />
            </div>
          </div>

          {/* Account */}
          <div className="flex flex-col gap-1.5">
            <Label>Account</Label>
            <Select
              value={filters.accountId ?? ""}
              onValueChange={(val) =>
                onFiltersChange({
                  ...filters,
                  accountId: val || undefined,
                })
              }
            >
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue placeholder="All accounts">
                  {(value: string | null) =>
                    value
                      ? accounts.find((a) => a.id === value)?.name ?? "Account"
                      : "All accounts"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All accounts</SelectItem>
                {accounts.map((acc) => (
                  <SelectItem key={acc.id} value={acc.id}>
                    {acc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearAll}
              className="text-xs"
            >
              Clear all
            </Button>
            <Button size="sm" onClick={handleApply} className="text-xs">
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
