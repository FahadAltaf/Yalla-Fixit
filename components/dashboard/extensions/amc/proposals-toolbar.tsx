"use client";

import { useId } from "react";
import { LoaderCircleIcon, RefreshCwIcon, SearchIcon } from "lucide-react";

import { StatusSelect } from "@/components/data-table/toolbars/status-select";
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

export type ProposalScope = "all" | "mine";

/**
 * Toolbar for the proposals table, the same shape as the snagging jobs
 * toolbar: search and the filters on the left, page size and refresh on
 * the right. The search is controlled from outside because "Clear
 * filters" in the empty state has to empty the box as well.
 */
export function ProposalsToolbar({
  search,
  onSearchChange,
  isLoading,
  onRefresh,
  statusOptions,
  status,
  onStatusChange,
  showScope,
  scope,
  onScopeChange,
  pageSize,
  onPageSizeChange,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  isLoading: boolean;
  onRefresh: () => void;
  statusOptions: ReadonlyArray<{ value: string; label: string; count?: number }>;
  status: string;
  onStatusChange: (value: string) => void;
  /** Approvers only: everyone's proposals or just their own. */
  showScope: boolean;
  scope: ProposalScope;
  onScopeChange: (value: ProposalScope) => void;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
}) {
  const searchInputId = useId();
  const rowsId = useId();

  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:py-6">
      <div className="flex flex-row items-center justify-between gap-2 sm:gap-4">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-80 sm:flex-none">
            <Input
              id={searchInputId}
              type="search"
              // What GET /api/amc-submissions matches.
              placeholder="Search by client, number or address…"
              className="peer w-full ps-9"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              aria-label="Search proposals"
            />
            <div className="text-muted-foreground/80 pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 peer-disabled:opacity-50">
              {isLoading ? (
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
          {showScope ? (
            <Select value={scope} onValueChange={(value) => onScopeChange(value as ProposalScope)}>
              <SelectTrigger className="w-full whitespace-nowrap sm:w-44" aria-label="Show proposals">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All proposals</SelectItem>
                <SelectItem value="mine">Mine only</SelectItem>
              </SelectContent>
            </Select>
          ) : null}
          <StatusSelect options={statusOptions} value={status} onChange={onStatusChange} />
        </div>

        <div className="flex gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="hidden w-full items-center gap-2 sm:flex sm:w-auto">
            <Label htmlFor={rowsId} className="sr-only">
              Show
            </Label>
            <Select
              value={pageSize.toString()}
              onValueChange={(value) => onPageSizeChange(Number(value))}
            >
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

          <Button onClick={onRefresh} variant="outline" disabled={isLoading}>
            <RefreshCwIcon className="size-4 sm:mr-1" />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
