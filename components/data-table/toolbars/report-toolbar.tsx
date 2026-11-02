"use client";

import { useId, useState } from "react";
import { LoaderCircleIcon, RefreshCwIcon, SearchIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";

import { ExportMenu } from "@/components/dashboard/snagging/export-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ExportFormat } from "@/lib/snagging/export-table";

import { DateRangePicker } from "./date-range-picker";

const ALL = "__all__";

export type ReportSelect = {
  key: string;
  /** What "everything" reads as, e.g. "All owners". */
  allLabel: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  /** Without an "everything" entry (a filter that always has a value). */
  required?: boolean;
  width?: string;
};

export type ReportSwitch = { key: string; label: string; hint?: string };

/**
 * The toolbar every report shares (BRD 5.2 B5: date range, filters, export):
 * search and a Filters button left (28 Oct: the report's own filters open
 * from it, with how many are in use); page size, Refresh and Export right.
 * Filters are strings, so they travel in links and saved filters.
 */
export function ReportToolbar({
  idPrefix,
  searchPlaceholder,
  initialSearch,
  onSearchChange,
  loading,
  pageSize,
  onPageSizeChange,
  onRefresh,
  filters,
  onFiltersChange,
  selects,
  switches = [],
  dateLabel,
  dateKeys = ["from", "to"],
  clearable,
  filtersInToolbar = true,
  canExport,
  exporting,
  onExport,
}: {
  idPrefix: string;
  searchPlaceholder: string;
  initialSearch: string;
  onSearchChange: (value: string) => void;
  loading: boolean;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  onRefresh: () => void;
  filters: Record<string, string>;
  onFiltersChange: (next: Record<string, string>) => void;
  selects: ReportSelect[];
  switches?: ReportSwitch[];
  /** e.g. "Created"; no date range when not given. */
  dateLabel?: string;
  dateKeys?: [string, string];
  /** The keys "Clear filters" empties. */
  clearable: string[];
  /** False when the page shows <ReportFiltersButton> itself, above the stats the filters also change. */
  filtersInToolbar?: boolean;
  canExport: boolean;
  exporting: boolean;
  onExport: (format: ExportFormat) => void;
}) {
  const searchId = useId();
  const [search, setSearch] = useState(initialSearch);

  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:py-6">
      <div className="flex flex-row flex-wrap items-center justify-between gap-2 sm:gap-4">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-80 sm:flex-none">
            <Input
              id={searchId}
              type="search"
              placeholder={searchPlaceholder}
              className="peer w-full ps-9"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                onSearchChange(event.target.value);
              }}
              aria-label={searchPlaceholder}
            />
            <div className="text-muted-foreground/80 pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3">
              {loading ? (
                <LoaderCircleIcon aria-label="Loading..." className="animate-spin" role="status" size={16} />
              ) : (
                <SearchIcon aria-hidden="true" size={16} />
              )}
            </div>
          </div>

          {filtersInToolbar && (selects.length || switches.length || dateLabel) ? (
            <ReportFiltersButton
              filters={filters}
              onFiltersChange={onFiltersChange}
              selects={selects}
              switches={switches}
              dateLabel={dateLabel}
              dateKeys={dateKeys}
              clearable={clearable}
            />
          ) : null}
        </div>

        <div className="flex gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="hidden w-full items-center gap-2 sm:flex sm:w-auto">
            <Label htmlFor={`${idPrefix}-rows`} className="sr-only">
              Show
            </Label>
            <Select value={pageSize.toString()} onValueChange={(value) => onPageSizeChange(Number(value))}>
              <SelectTrigger id={`${idPrefix}-rows`} className="w-full whitespace-nowrap sm:w-fit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50, 100].map((size) => (
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
          {canExport ? <ExportMenu size="default" onExport={onExport} disabled={exporting || loading} /> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The report's Filters button: its dropdowns in a popover, with how many are
 * in use. In the toolbar by default; a page whose filters also change its
 * figures puts it beside the dates instead (29 Oct).
 */
export function ReportFiltersButton({
  filters,
  onFiltersChange,
  selects,
  switches = [],
  dateLabel,
  dateKeys = ["from", "to"],
  clearable,
}: {
  filters: Record<string, string>;
  onFiltersChange: (next: Record<string, string>) => void;
  selects: ReportSelect[];
  switches?: ReportSwitch[];
  dateLabel?: string;
  dateKeys?: [string, string];
  clearable: string[];
}) {
  const set = (patch: Record<string, string>) => onFiltersChange({ ...filters, ...patch });
  const inUse = clearable.filter((key) => Boolean(filters[key])).length;
  const anyFilter = inUse > 0;
  const [fromKey, toKey] = dateKeys;
  /* "All owners" reads as "Owner" above its dropdown in the Filters box. */
  const labelOf = (select: ReportSelect) => {
    const text = select.allLabel
      .replace(/^(All|Any)\s+/i, "")
      .replace(/(s)es$/i, "$1")
      .replace(/([^su])s$/i, "$1");
    return text.charAt(0).toUpperCase() + text.slice(1);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">
          <SlidersHorizontalIcon className="size-4" />
          Filters
          {inUse ? (
            <Badge variant="secondary" className="bg-brand text-primary-foreground ml-0.5 h-5 min-w-5 rounded-full px-1.5 tabular-nums">
              {inUse}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="grid w-80 gap-3">
        {selects.map((select) => (
          <div key={select.key} className="grid gap-1.5">
            <Label className="text-muted-foreground text-xs">{labelOf(select)}</Label>
            <Select
              value={filters[select.key] || (select.required ? select.options[0]?.value : ALL)}
              onValueChange={(value) => set({ [select.key]: value === ALL ? "" : value })}
            >
              <SelectTrigger className="w-full" aria-label={select.allLabel}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {select.required ? null : <SelectItem value={ALL}>{select.allLabel}</SelectItem>}
                {select.options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
        {dateLabel ? (
          <div className="grid gap-1.5">
            <Label className="text-muted-foreground text-xs">{dateLabel}</Label>
            <DateRangePicker
              from={filters[fromKey] ?? ""}
              to={filters[toKey] ?? ""}
              label={dateLabel}
              className="w-full"
              onChange={(from, to) => set({ [fromKey]: from, [toKey]: to })}
            />
          </div>
        ) : null}
        {switches.map((s) => (
          <label key={s.key} className="flex items-start justify-between gap-3 text-sm">
            <span>
              {s.label}
              {s.hint ? <span className="text-muted-foreground block text-xs">{s.hint}</span> : null}
            </span>
            <Switch checked={filters[s.key] === "1"} onCheckedChange={(on) => set({ [s.key]: on ? "1" : "" })} aria-label={s.label} />
          </label>
        ))}
        {anyFilter ? (
          <Button
            variant="ghost"
            size="sm"
            className="justify-self-start"
            onClick={() => set(Object.fromEntries(clearable.map((key) => [key, ""])))}
          >
            <XIcon className="size-4" />
            Clear filters
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
