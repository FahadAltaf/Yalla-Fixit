"use client";

import { useId } from "react";
import { LoaderCircleIcon, SearchIcon } from "lucide-react";

import { StatusSelect } from "@/components/data-table/toolbars/status-select";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { AmcRefreshButton } from "./refresh-button";

/**
 * The AMC clients table's toolbar, the same shape as Snagging's jobs
 * toolbar: search and the status dropdown on the left, page size and
 * Refresh on the right. "New client" lives in the page heading.
 */
export function ClientsToolbar({
  search,
  onSearchChange,
  loading,
  statusOptions,
  status,
  onStatusChange,
  pageSize,
  onPageSizeChange,
  onRefresh,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  loading: boolean;
  /** AMC's status filter; left out for someone without AMC's view of clients. */
  statusOptions?: ReadonlyArray<{ value: string; label: string }>;
  status?: string;
  onStatusChange?: (value: string) => void;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  onRefresh: () => void;
}) {
  const searchId = useId();
  const rowsId = useId();

  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:py-6">
      <div className="flex flex-row items-center justify-between gap-2 sm:gap-4">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-80 sm:flex-none">
            <Input
              id={searchId}
              type="search"
              placeholder="Search name, Customer ID, phone or email…"
              className="peer w-full ps-9"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              aria-label="Search clients"
            />
            <div className="text-muted-foreground/80 pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 peer-disabled:opacity-50">
              {loading ? <LoaderCircleIcon aria-label="Loading..." className="animate-spin" role="status" size={16} /> : <SearchIcon aria-hidden="true" size={16} />}
            </div>
          </div>
          {statusOptions && onStatusChange ? (
            <StatusSelect options={statusOptions} value={status ?? ""} onChange={onStatusChange} label="Filter by client status" />
          ) : null}
        </div>

        <div className="flex gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="hidden w-full items-center gap-2 sm:flex sm:w-auto">
            <Label htmlFor={rowsId} className="sr-only">
              Show
            </Label>
            <Select value={pageSize.toString()} onValueChange={(value) => onPageSizeChange(Number(value))}>
              <SelectTrigger id={rowsId} className="w-full whitespace-nowrap sm:w-fit">
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

          <AmcRefreshButton onRefresh={onRefresh} loading={loading} />
        </div>
      </div>
    </div>
  );
}
