"use client";

import { useId } from "react";
import { LoaderCircleIcon, PlusIcon, RefreshCwIcon, RotateCcwIcon, SearchIcon } from "lucide-react";

import { PillTabs } from "@/components/dashboard/shared/kaizen";
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

interface SnaggingQuotationsToolbarProps {
  fetchRecords: () => void;
  onGlobalFilterChange: (filter: string) => void;
  globalFilter: string;
  isSearchLoading: boolean;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  statusTabs: ReadonlyArray<{ value: string; label: string; count?: number }>;
  statusValue: string;
  onStatusChange: (value: string) => void;
  canCreate: boolean;
  onCreate: () => void;
  onCreateDesnag: () => void;
}

/**
 * Toolbar for the quotations table.
 *
 * The jobs toolbar's shape, including the status pills underneath — a
 * coordinator filters quotations by status far more often than they search
 * them, exactly as they do with jobs, and the two screens should not
 * disagree about where that control lives.
 *
 * The one addition is a second, secondary create action: a de-snag
 * quotation starts from a finished job rather than a property, so it
 * cannot share the primary button's form.
 */
export function SnaggingQuotationsToolbar({
  fetchRecords,
  onGlobalFilterChange,
  globalFilter,
  isSearchLoading,
  pageSize,
  onPageSizeChange,
  statusTabs,
  statusValue,
  onStatusChange,
  canCreate,
  onCreate,
  onCreateDesnag,
}: SnaggingQuotationsToolbarProps) {
  const searchInputId = useId();

  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:py-6">
      <div className="flex flex-row items-center justify-between gap-2 sm:gap-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:max-w-md sm:min-w-[260px]">
            <Input
              id={searchInputId}
              type="search"
              placeholder="Search number, client, unit or job..."
              className="peer w-full ps-9"
              value={globalFilter}
              onChange={(event) => onGlobalFilterChange(event.target.value)}
              aria-label="Search quotations"
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
          <div className="hidden w-full items-center gap-2 sm:flex sm:w-auto">
            <Label htmlFor="snagging-quotations-rows" className="sr-only">
              Show
            </Label>
            <Select
              value={pageSize?.toString() || "10"}
              onValueChange={(value) => onPageSizeChange(Number(value))}
            >
              <SelectTrigger
                id="snagging-quotations-rows"
                className="w-full whitespace-nowrap sm:w-fit"
              >
                <SelectValue placeholder="Select number of results" />
              </SelectTrigger>
              <SelectContent className="[&_*[role=option]]:pr-8 [&_*[role=option]]:pl-2 [&_*[role=option]>span]:right-2 [&_*[role=option]>span]:left-auto">
                {[10, 25, 50].map((size) => (
                  <SelectItem key={size} value={size.toString()}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={fetchRecords} variant="outline" disabled={isSearchLoading}>
              <RefreshCwIcon className="size-4 sm:mr-1" />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            {canCreate ? (
              <>
                {/* <Button onClick={onCreateDesnag} variant="outline">
                  <RotateCcwIcon className="size-4 sm:mr-1" />
                  <span className="hidden sm:inline">De-snag</span>
                </Button> */}
                <Button onClick={onCreate} className="flex-1 sm:flex-initial">
                  <PlusIcon className="size-4 sm:mr-2" />
                  <span className="hidden sm:inline">New quotation</span>
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <PillTabs tabs={statusTabs} value={statusValue} onChange={onStatusChange} />
    </div>
  );
}
