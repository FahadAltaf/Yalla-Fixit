"use client";

import { useId, useState } from "react";
import { LoaderCircleIcon, RefreshCwIcon, SearchIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import { DateRangePicker } from "./date-range-picker";

/* An FSM status in the one status dropdown: "fsm:Completed". */
const FSM_PREFIX = "fsm:";

export type FinanceQueueToolbarFilters = {
  status: string;
  /** The work order's status in Zoho FSM; "" for all. */
  fsm: string;
  client: string;
  coordinator: string;
  from: string;
  to: string;
  aged: boolean;
};

/**
 * Toolbar for Ready to invoice (27 Oct): search, one status dropdown (the
 * portal's invoicing statuses and Zoho FSM's in one list), the date range
 * and Aged only beside it; page size and Refresh on the right.
 */
export function FinanceQueueToolbar({
  onSearchChange,
  loading,
  pageSize,
  onPageSizeChange,
  onRefresh,
  statusOptions,
  fsmStatuses,
  filters,
  onFiltersChange,
  agedAfterDays,
  dateLabel = "Entered",
  initialSearch = "",
  dateBounds,
  activeFilters = 0,
}: {
  onSearchChange: (value: string) => void;
  loading: boolean;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  onRefresh: () => void;
  /** The portal's invoicing statuses ("all" first). */
  statusOptions: ReadonlyArray<{ value: string; label: string }>;
  /** Zoho FSM's work order statuses. */
  fsmStatuses: string[];
  filters: FinanceQueueToolbarFilters;
  onFiltersChange: (next: FinanceQueueToolbarFilters) => void;
  agedAfterDays: number;
  /** What the date range filters on ("Raised" for work orders). */
  dateLabel?: string;
  initialSearch?: string;
  /** The earliest and latest dates that may be picked. */
  dateBounds?: { min: string; max: string };
  /** How many of the dates and Aged only are in use: "Clear" shows when any is. */
  activeFilters?: number;
}) {
  const searchId = useId();
  const [search, setSearch] = useState(initialSearch);
  const set = (patch: Partial<FinanceQueueToolbarFilters>) => onFiltersChange({ ...filters, ...patch });
  const statusValue = filters.fsm ? `${FSM_PREFIX}${filters.fsm}` : filters.status;
  /* One list (27 Oct): the invoicing statuses, then FSM's not already in it ("In Progress" once, for both). */
  const named = new Set(statusOptions.map((option) => option.label.toLowerCase()));
  const options = [
    ...statusOptions,
    ...fsmStatuses.filter((status) => !named.has(status.toLowerCase())).map((status) => ({ value: `${FSM_PREFIX}${status}`, label: status })),
  ];

  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:py-6">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64 sm:flex-none">
          <Input
            id={searchId}
            type="search"
            placeholder="Search work orders…"
            className="peer w-full ps-9"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              onSearchChange(event.target.value);
            }}
            aria-label="Search by work order, quotation or client"
          />
          <div className="text-muted-foreground/80 pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3">
            {loading ? <LoaderCircleIcon aria-label="Loading..." className="animate-spin" role="status" size={16} /> : <SearchIcon aria-hidden="true" size={16} />}
          </div>
        </div>

        {/* One status: the portal's invoicing status, or the work order's status in Zoho FSM. */}
        <Select
          value={statusValue}
          onValueChange={(value) =>
            value.startsWith(FSM_PREFIX) ? set({ status: "all", fsm: value.slice(FSM_PREFIX.length) }) : set({ status: value, fsm: "" })
          }
        >
          <SelectTrigger className="w-full whitespace-nowrap sm:w-52" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* The dates beside the status (27 Oct): shadcn's range picker, two months. */}
        <DateRangePicker
          from={filters.from}
          to={filters.to}
          min={dateBounds?.min}
          max={dateBounds?.max}
          label={`${dateLabel} dates`}
          onChange={(from, to) => set({ from, to })}
        />
        <label className="flex items-center gap-2 text-sm whitespace-nowrap" title={`Pending over ${agedAfterDays} days`}>
          <Switch checked={filters.aged} onCheckedChange={(aged) => set({ aged })} aria-label="Aged only" />
          Aged only
        </label>
        {activeFilters ? (
          <Button variant="ghost" size="sm" onClick={() => set({ from: "", to: "", aged: false })}>
            <XIcon className="size-4" />
            Clear
          </Button>
        ) : null}
      </div>

      <div className="flex items-center gap-3 sm:gap-4">
        <div className="hidden items-center gap-2 sm:flex">
          <Label htmlFor="finance-queue-rows" className="sr-only">
            Show
          </Label>
          <Select value={pageSize.toString()} onValueChange={(value) => onPageSizeChange(Number(value))}>
            <SelectTrigger id="finance-queue-rows" className="w-fit whitespace-nowrap">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 25, 50].map((size) => (
                <SelectItem key={size} value={size.toString()}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={onRefresh} variant="outline" disabled={loading}>
          <RefreshCwIcon className="size-4 sm:mr-1" />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>
    </div>
  );
}
