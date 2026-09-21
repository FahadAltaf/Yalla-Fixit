"use client";

import { useId } from "react";
import { LoaderCircleIcon, RefreshCwIcon, SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface RecordsToolbarProps {
  fetchRecords: () => void;
  onGlobalFilterChange: (filter: string) => void;
  globalFilter: string;
  isSearchLoading: boolean;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  /** Placeholder for the search box, naming what it matches. */
  searchPlaceholder?: string;
  pageSizes?: number[];
  /** Extra actions on the right, before Refresh (exports and the like). */
  actions?: React.ReactNode;
  /** Filters beside the search box (category pickers and the like). */
  filters?: React.ReactNode;
}

/**
 * The house table toolbar for read-only lists: search on the left, page
 * size, any extra actions and Refresh on the right. The same shape as the
 * jobs, quotations and clients toolbars, so every table reads alike.
 */
export function RecordsToolbar({
  fetchRecords,
  onGlobalFilterChange,
  globalFilter,
  isSearchLoading,
  pageSize,
  onPageSizeChange,
  searchPlaceholder = "Search...",
  pageSizes = [10, 25, 50],
  actions,
  filters,
}: RecordsToolbarProps) {
  const searchInputId = useId();
  const rowsId = useId();

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <div className="flex flex-row flex-wrap items-center justify-between gap-2 sm:gap-4">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-80 sm:flex-none">
            <Input
              id={searchInputId}
              type="search"
              placeholder={searchPlaceholder}
              className="peer w-full ps-9"
              value={globalFilter}
              onChange={(event) => onGlobalFilterChange(event.target.value)}
              aria-label={searchPlaceholder}
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
          {filters}
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-2 sm:flex">
            <Label htmlFor={rowsId} className="sr-only">
              Show
            </Label>
            <Select
              value={pageSize.toString()}
              onValueChange={(value) => onPageSizeChange(Number(value))}
            >
              <SelectTrigger id={rowsId} className="w-fit whitespace-nowrap">
                <SelectValue placeholder="Rows" />
              </SelectTrigger>
              <SelectContent className="[&_*[role=option]]:pr-8 [&_*[role=option]]:pl-2 [&_*[role=option]>span]:right-2 [&_*[role=option]>span]:left-auto">
                {pageSizes.map((size) => (
                  <SelectItem key={size} value={size.toString()}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {actions}
          <Button
            onClick={fetchRecords}
            variant="outline"
            disabled={isSearchLoading}
          >
            <RefreshCwIcon className="size-4 sm:mr-1" />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
