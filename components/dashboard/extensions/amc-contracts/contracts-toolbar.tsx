"use client";

import { useId } from "react";
import { LoaderCircleIcon, RefreshCwIcon, SearchIcon } from "lucide-react";

import { StatusSelect } from "@/components/data-table/toolbars/status-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const ALL_MANAGERS = "__all__";

/**
 * Toolbar for the AMC contracts table, the same shape as the snagging jobs
 * toolbar: search with its icon and a status dropdown on the left, page
 * size and Refresh on the right. The account manager filter sits beside
 * the status, because "my contracts" is the other question asked here.
 *
 * Search is controlled, so "Clear filters" on the empty state can empty it.
 */
export function ContractsToolbar({
  search,
  onSearchChange,
  isLoading,
  statusOptions,
  status,
  onStatusChange,
  managers,
  manager,
  onManagerChange,
  pageSize,
  onPageSizeChange,
  onRefresh,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  isLoading: boolean;
  statusOptions: ReadonlyArray<{ value: string; label: string; count?: number }>;
  status: string;
  onStatusChange: (value: string) => void;
  managers: string[];
  manager: string;
  onManagerChange: (value: string) => void;
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
              // What the list endpoint matches.
              placeholder="Search client, property, number or manager…"
              className="peer w-full ps-9"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              aria-label="Search contracts"
            />
            <div className="text-muted-foreground/80 pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 peer-disabled:opacity-50">
              {isLoading ? (
                <LoaderCircleIcon aria-label="Loading..." className="animate-spin" role="status" size={16} />
              ) : (
                <SearchIcon aria-hidden="true" size={16} />
              )}
            </div>
          </div>
          <StatusSelect options={statusOptions} value={status} onChange={onStatusChange} />
          <Select value={manager} onValueChange={onManagerChange}>
            <SelectTrigger className="w-full whitespace-nowrap sm:w-52" aria-label="Filter by account manager">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_MANAGERS}>All account managers</SelectItem>
              {managers.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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

          <div className="flex items-center gap-2">
            <Button onClick={onRefresh} variant="outline" disabled={isLoading}>
              <RefreshCwIcon className="size-4 sm:mr-1" />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
