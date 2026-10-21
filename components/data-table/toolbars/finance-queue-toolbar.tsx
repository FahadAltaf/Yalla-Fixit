"use client";

import { useId, useState } from "react";
import { LoaderCircleIcon, RefreshCwIcon, SearchIcon, XIcon } from "lucide-react";

import { StatusSelect } from "@/components/data-table/toolbars/status-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const ALL = "__all__";

export type FinanceQueueToolbarFilters = {
  status: string;
  client: string;
  coordinator: string;
  from: string;
  to: string;
  aged: boolean;
};

/**
 * Toolbar for the Ready-to-Invoice queue: the users/jobs toolbar shape
 * (search left; page size and Refresh right), with the BRD §6.4 filters on
 * a second row: status, client, coordinator, date entered, aged only.
 */
export function FinanceQueueToolbar({
  onSearchChange,
  loading,
  pageSize,
  onPageSizeChange,
  onRefresh,
  statusOptions,
  clients,
  coordinators,
  filters,
  onFiltersChange,
  agedAfterDays,
}: {
  onSearchChange: (value: string) => void;
  loading: boolean;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  onRefresh: () => void;
  statusOptions: ReadonlyArray<{ value: string; label: string; count?: number }>;
  clients: string[];
  coordinators: string[];
  filters: FinanceQueueToolbarFilters;
  onFiltersChange: (next: FinanceQueueToolbarFilters) => void;
  agedAfterDays: number;
}) {
  const searchId = useId();
  const [search, setSearch] = useState("");
  const set = (patch: Partial<FinanceQueueToolbarFilters>) => onFiltersChange({ ...filters, ...patch });
  const anyFilter = filters.client || filters.coordinator || filters.from || filters.to || filters.aged;

  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:py-6">
      <div className="flex flex-row items-center justify-between gap-2 sm:gap-4">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-80 sm:flex-none">
            <Input
              id={searchId}
              type="search"
              placeholder="Search by item, quotation, work order or client…"
              className="peer w-full ps-9"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                onSearchChange(event.target.value);
              }}
              aria-label="Search the queue"
            />
            <div className="text-muted-foreground/80 pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3">
              {loading ? (
                <LoaderCircleIcon aria-label="Loading..." className="animate-spin" role="status" size={16} />
              ) : (
                <SearchIcon aria-hidden="true" size={16} />
              )}
            </div>
          </div>
          <StatusSelect options={statusOptions} value={filters.status} onChange={(status) => set({ status })} />
        </div>

        <div className="flex gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="hidden w-full items-center gap-2 sm:flex sm:w-auto">
            <Label htmlFor="finance-queue-rows" className="sr-only">
              Show
            </Label>
            <Select value={pageSize.toString()} onValueChange={(value) => onPageSizeChange(Number(value))}>
              <SelectTrigger id="finance-queue-rows" className="w-full whitespace-nowrap sm:w-fit">
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

      <div className="flex flex-wrap items-center gap-2">
        <Select value={filters.client || ALL} onValueChange={(value) => set({ client: value === ALL ? "" : value })}>
          <SelectTrigger className="w-full sm:w-52" aria-label="Filter by client">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All clients</SelectItem>
            {clients.map((client) => (
              <SelectItem key={client} value={client}>
                {client}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.coordinator || ALL}
          onValueChange={(value) => set({ coordinator: value === ALL ? "" : value })}
        >
          <SelectTrigger className="w-full sm:w-52" aria-label="Filter by coordinator">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All coordinators</SelectItem>
            {coordinators.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Label htmlFor="finance-queue-from" className="text-muted-foreground text-xs whitespace-nowrap">
            Entered
          </Label>
          <Input
            id="finance-queue-from"
            type="date"
            className="w-36"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(event) => set({ from: event.target.value })}
            aria-label="Entered from"
          />
          <span className="text-muted-foreground text-xs">to</span>
          <Input
            type="date"
            className="w-36"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(event) => set({ to: event.target.value })}
            aria-label="Entered to"
          />
        </div>
        <label className="flex items-center gap-2 text-sm whitespace-nowrap">
          <Switch checked={filters.aged} onCheckedChange={(aged) => set({ aged })} aria-label="Aged only" />
          Aged only <span className="text-muted-foreground text-xs">(pending over {agedAfterDays} days)</span>
        </label>
        {anyFilter ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => set({ client: "", coordinator: "", from: "", to: "", aged: false })}
          >
            <XIcon className="size-4" />
            Clear filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}
