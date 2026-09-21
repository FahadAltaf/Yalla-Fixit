"use client";

import { useId, useState } from "react";
import { LoaderCircleIcon, RefreshCwIcon, SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusSelect } from "@/components/data-table/toolbars/status-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type SnaggingJobsStatusFilter = string;

interface SnaggingJobsToolbarProps {
  fetchRecords: () => void;
  onGlobalFilterChange: (filter: string) => void;
  isSearchLoading: boolean;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  /** Status pills, kept in the toolbar so filter and search sit together. */
  statusTabs: ReadonlyArray<{ value: string; label: string }>;
  statusValue: string;
  onStatusChange: (value: string) => void;
  /** Kept for callers; the create action now lives in the page heading. */
  canCreate?: boolean;
  onCreate?: () => void;
}

/**
 * Toolbar for the snagging jobs table.
 *
 * Same shape as the users toolbar — search on the left, page size,
 * refresh and the primary create action on the right — with the status
 * pills underneath, because a coordinator filters by status far more
 * often than they search.
 */
export function SnaggingJobsToolbar({
  fetchRecords,
  onGlobalFilterChange,
  isSearchLoading,
  pageSize,
  onPageSizeChange,
  statusTabs,
  statusValue,
  onStatusChange,
}: SnaggingJobsToolbarProps) {
  const searchInputId = useId();
  const [globalFilter, setGlobalFilter] = useState<string>("");

  function handleFilterChange(event: React.ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setGlobalFilter(value);
    onGlobalFilterChange?.(value);
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:py-6">
      <div className="flex flex-row items-center justify-between gap-2 sm:gap-4">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-80 sm:flex-none">
            <Input
              id={searchInputId}
              type="search"
              placeholder="Search..."
              className="peer w-full ps-9"
              value={globalFilter}
              onChange={handleFilterChange}
              aria-label="Search jobs"
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
          <StatusSelect options={statusTabs} value={statusValue} onChange={onStatusChange} />
        </div>

        <div className="flex gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="hidden w-full items-center gap-2 sm:flex sm:w-auto">
            <Label htmlFor="snagging-jobs-rows" className="sr-only">
              Show
            </Label>
            <Select
              value={pageSize?.toString() || "10"}
              onValueChange={(value) => onPageSizeChange(Number(value))}
            >
              <SelectTrigger id="snagging-jobs-rows" className="w-full whitespace-nowrap sm:w-fit">
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
          </div>
        </div>
      </div>
    </div>
  );
}
