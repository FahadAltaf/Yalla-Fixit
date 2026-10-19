"use client";

import { useId } from "react";
import { LoaderCircleIcon, RefreshCwIcon, SearchIcon, SlidersHorizontalIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * The toolbar above the enquiries and site visits tables, built like the
 * Snagging jobs toolbar: search with its icon and the filter dropdowns on
 * the left, page size, export and Refresh on the right. The create action
 * lives in the page heading, not here.
 */
export function ListToolbar({
  search,
  onSearchChange,
  searchPlaceholder,
  searchLabel,
  loading,
  filters,
  pageSize,
  onPageSizeChange,
  onRefresh,
  extra,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  searchLabel: string;
  loading: boolean;
  /** The filter dropdowns, beside the search box. */
  filters?: React.ReactNode;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  onRefresh: () => void;
  /** Anything else on the right before Refresh, e.g. the export menu. */
  extra?: React.ReactNode;
}) {
  const searchId = useId();
  const rowsId = useId();
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
              onChange={(e) => onSearchChange(e.target.value)}
              aria-label={searchLabel}
            />
            <div className="text-muted-foreground/80 pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 peer-disabled:opacity-50">
              {loading ? <LoaderCircleIcon aria-label="Loading..." className="animate-spin" role="status" size={16} /> : <SearchIcon aria-hidden="true" size={16} />}
            </div>
          </div>
          {filters}
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <div className="hidden items-center gap-2 sm:flex">
            <Label htmlFor={rowsId} className="sr-only">
              Show
            </Label>
            <Select value={pageSize.toString()} onValueChange={(value) => onPageSizeChange(Number(value))}>
              <SelectTrigger id={rowsId} className="w-fit whitespace-nowrap">
                <SelectValue placeholder="Rows per page" />
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
          {extra}
          <Button onClick={onRefresh} variant="outline" disabled={loading}>
            <RefreshCwIcon className="size-4 sm:mr-1" />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

/** One filter in the Filters panel. `defaultValue` is what Clear all returns it to. */
export type FilterField = {
  key: string;
  label: string;
  value: string;
  defaultValue: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  /** The "no filter" choice (value "any"), when the filter has one. */
  anyLabel?: string;
};

/**
 * Every filter behind one button, so the toolbar stays a search box and a
 * button however many filters a list has. The button counts the filters
 * that are set; the panel holds one labelled dropdown each and a Clear all.
 * A change applies at once, as the dropdowns in the toolbar did.
 */
export function FilterPopover({ fields }: { fields: ReadonlyArray<FilterField> }) {
  const active = fields.filter((field) => field.value !== field.defaultValue).length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" aria-label={active ? `Filters, ${active} set` : "Filters"}>
          <SlidersHorizontalIcon className="size-4" />
          Filters
          {active ? (
            <Badge variant="secondary" className="ml-0.5 h-5 min-w-5 rounded-full px-1.5 tabular-nums">
              {active}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Filters</p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            disabled={!active}
            onClick={() =>
              fields.forEach((field) => {
                if (field.value !== field.defaultValue) field.onChange(field.defaultValue);
              })
            }
          >
            Clear all
          </Button>
        </div>
        <div className="grid gap-3 p-4">
          {fields.map((field) => (
            <div key={field.key} className="grid gap-1.5">
              <Label className="text-muted-foreground text-xs font-medium">{field.label}</Label>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-full" aria-label={field.label}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {field.anyLabel ? <SelectItem value="any">{field.anyLabel}</SelectItem> : null}
                  {field.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A filter dropdown for the toolbar, shaped like Snagging's StatusSelect.
 * `anyLabel` names the "no filter" choice (value "any").
 */
export function ToolbarSelect({
  label,
  value,
  onChange,
  options,
  anyLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  anyLabel?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full whitespace-nowrap sm:w-44" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {anyLabel ? <SelectItem value="any">{anyLabel}</SelectItem> : null}
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
