"use client";

import { useId, useState } from "react";
import { LoaderCircleIcon, RefreshCwIcon, SearchIcon, XIcon } from "lucide-react";

import { ExportMenu } from "@/components/dashboard/snagging/export-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ExportFormat } from "@/lib/snagging/export-table";

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
 * the finance queue's shape. Search left; page size, Refresh and Export
 * right; the report's own filters, the date range and Clear on the second
 * row. Filters are strings, so they travel in links and saved filters.
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
  canExport: boolean;
  exporting: boolean;
  onExport: (format: ExportFormat) => void;
}) {
  const searchId = useId();
  const [search, setSearch] = useState(initialSearch);
  const set = (patch: Record<string, string>) => onFiltersChange({ ...filters, ...patch });
  const anyFilter = clearable.some((key) => Boolean(filters[key]));
  const [fromKey, toKey] = dateKeys;

  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:py-6">
      <div className="flex flex-row items-center justify-between gap-2 sm:gap-4">
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

      <div className="flex flex-wrap items-center gap-2">
        {selects.map((select) => (
          <Select
            key={select.key}
            value={filters[select.key] || (select.required ? select.options[0]?.value : ALL)}
            onValueChange={(value) => set({ [select.key]: value === ALL ? "" : value })}
          >
            <SelectTrigger className={select.width ?? "w-full sm:w-48"} aria-label={select.allLabel}>
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
        ))}
        {dateLabel ? (
          <div className="flex items-center gap-2">
            <Label htmlFor={`${idPrefix}-from`} className="text-muted-foreground text-xs whitespace-nowrap">
              {dateLabel}
            </Label>
            <Input
              id={`${idPrefix}-from`}
              type="date"
              className="w-36"
              value={filters[fromKey] ?? ""}
              max={filters[toKey] || undefined}
              onChange={(event) => set({ [fromKey]: event.target.value })}
              aria-label={`${dateLabel} from`}
            />
            <span className="text-muted-foreground text-xs">to</span>
            <Input
              type="date"
              className="w-36"
              value={filters[toKey] ?? ""}
              min={filters[fromKey] || undefined}
              onChange={(event) => set({ [toKey]: event.target.value })}
              aria-label={`${dateLabel} to`}
            />
          </div>
        ) : null}
        {switches.map((s) => (
          <label key={s.key} className="flex items-center gap-2 text-sm whitespace-nowrap">
            <Switch
              checked={filters[s.key] === "1"}
              onCheckedChange={(on) => set({ [s.key]: on ? "1" : "" })}
              aria-label={s.label}
            />
            {s.label} {s.hint ? <span className="text-muted-foreground text-xs">({s.hint})</span> : null}
          </label>
        ))}
        {anyFilter ? (
          <Button variant="ghost" size="sm" onClick={() => set(Object.fromEntries(clearable.map((key) => [key, ""])))}>
            <XIcon className="size-4" />
            Clear filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}
