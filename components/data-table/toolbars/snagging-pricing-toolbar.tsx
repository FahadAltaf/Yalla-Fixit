"use client";

import { useId } from "react";
import { LoaderCircleIcon, RefreshCwIcon, SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SnaggingPricingToolbarProps {
  fetchRecords: () => void;
  onGlobalFilterChange: (filter: string) => void;
  globalFilter: string;
  isSearchLoading: boolean;
  /** When the card was last changed, already formatted. */
  updatedAt: string | null;
  currency: string;
}

/**
 * Toolbar for the rate card table.
 *
 * The same shape as the jobs, clients and quotations toolbars — search on
 * the left, refresh on the right — so the pricing screen reads as part of
 * the same product rather than a settings form that wandered in.
 *
 * Two of the house controls are deliberately absent. There is no page size
 * because the card has one row per property type and never paginates, and
 * there is no create action because a property type is not something a
 * coordinator invents; a new one arrives with a migration. Their place on
 * the right is taken by the only thing a person actually wants to know
 * before trusting a figure: when it last changed, and in what currency.
 */
export function SnaggingPricingToolbar({
  fetchRecords,
  onGlobalFilterChange,
  globalFilter,
  isSearchLoading,
  updatedAt,
  currency,
}: SnaggingPricingToolbarProps) {
  const searchInputId = useId();

  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:py-6">
      <div className="flex flex-row items-center justify-between gap-2 sm:gap-4">
        <div className="flex items-center gap-2">
          <div className="relative w-full sm:w-80 sm:flex-none">
            <Input
              id={searchInputId}
              type="search"
              placeholder="Search..."
              className="peer w-full ps-9"
              value={globalFilter}
              onChange={(event) => onGlobalFilterChange(event.target.value)}
              aria-label="Search property types"
            />
            <div className="text-muted-foreground/80 pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 peer-disabled:opacity-50">
              {isSearchLoading ? (
                <LoaderCircleIcon
                  aria-label="Loading..."
                  className="animate-spin"
                  role="status"
                  size={16}
                />
              ) : (
                <SearchIcon aria-hidden="true" size={16} />
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-3 sm:flex-row sm:items-center sm:gap-4">
          <p className="text-muted-foreground hidden text-xs sm:block">
            {updatedAt ? `Updated ${updatedAt}` : "Never changed"}
            <span className="px-1.5">·</span>
            {currency}, excluding VAT
          </p>

          <div className="flex items-center gap-2">
            <Button onClick={fetchRecords} variant="outline" disabled={isSearchLoading}>
              <RefreshCwIcon className="size-4 sm:mr-1" />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
