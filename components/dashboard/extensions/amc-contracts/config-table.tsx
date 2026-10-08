"use client";

import { useId, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { EllipsisVerticalIcon, LoaderCircleIcon, RefreshCwIcon, SearchIcon } from "lucide-react";

import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Toolbar for the AMC settings and report tables: the same shape as the
 * Snagging jobs and pricing toolbars (search on the left with its icon
 * inside the box, page size and Refresh on the right), so these screens
 * read as part of the same product. `children` sits on the right before
 * page size, for a table's own action such as "Add a rate".
 */
export function ConfigTableToolbar({
  search,
  onSearchChange,
  placeholder = "Search…",
  searchLabel,
  loading = false,
  pageSize,
  onPageSizeChange,
  onRefresh,
  filters,
  children,
}: {
  search?: string;
  onSearchChange?: (value: string) => void;
  placeholder?: string;
  searchLabel?: string;
  loading?: boolean;
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
  onRefresh?: () => void;
  /** Beside the search box, e.g. a StatusSelect. */
  filters?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const searchId = useId();
  const rowsId = useId();

  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:py-6">
      <div className="flex flex-row flex-wrap items-center justify-between gap-2 sm:gap-4">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {onSearchChange ? (
            <div className="relative w-full sm:w-80 sm:flex-none">
              <Input
                id={searchId}
                type="search"
                placeholder={placeholder}
                className="peer w-full ps-9"
                value={search ?? ""}
                onChange={(event) => onSearchChange(event.target.value)}
                aria-label={searchLabel ?? placeholder}
              />
              <div className="text-muted-foreground/80 pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 peer-disabled:opacity-50">
                {loading ? (
                  <LoaderCircleIcon aria-label="Loading..." className="animate-spin" role="status" size={16} />
                ) : (
                  <SearchIcon aria-hidden="true" size={16} />
                )}
              </div>
            </div>
          ) : null}
          {filters}
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          {children}
          {pageSize && onPageSizeChange ? (
            <div className="hidden items-center gap-2 sm:flex">
              <Label htmlFor={rowsId} className="sr-only">
                Show
              </Label>
              <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
                <SelectTrigger id={rowsId} className="w-fit whitespace-nowrap">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="[&_*[role=option]]:pr-8 [&_*[role=option]]:pl-2 [&_*[role=option]>span]:right-2 [&_*[role=option]>span]:left-auto">
                  {[10, 25, 50].map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {onRefresh ? (
            <Button onClick={onRefresh} variant="outline" disabled={loading}>
              <RefreshCwIcon className="size-4 sm:mr-1" />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The shared DataTable over rows that arrive whole, paged in the browser:
 * the shape Snagging analytics uses for its breakdowns. The page goes back
 * to the first whenever `resetKey` changes (a new search or filter), and is
 * clamped when the rows shrink, so a filter never leaves an empty page.
 */
export function LocalDataTable<T>({
  columns,
  rows,
  pageSize = 10,
  resetKey = "",
  loading = false,
  toolbar,
  emptyState,
  onRowClick,
}: {
  columns: ColumnDef<T, unknown>[];
  rows: T[];
  pageSize?: number;
  resetKey?: string;
  loading?: boolean;
  toolbar?: React.JSX.Element;
  emptyState?: React.ReactNode;
  onRowClick?: (row: T) => void;
}) {
  const [page, setPage] = useState(0);
  /* Back to page one on a new search or page size, set during render so the old page never paints. */
  const seed = `${resetKey}|${pageSize}`;
  const [seenSeed, setSeenSeed] = useState(seed);
  if (seenSeed !== seed) {
    setSeenSeed(seed);
    setPage(0);
  }
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pageCount - 1);

  return (
    <DataTable
      columns={columns}
      data={rows.slice(current * pageSize, (current + 1) * pageSize)}
      loading={loading}
      rowCount={rows.length}
      pageSize={pageSize}
      currentPage={current}
      onPageChange={setPage}
      onPageSizeChange={() => undefined}
      onGlobalFilterChange={() => undefined}
      isPagination
      toolbar={toolbar}
      emptyState={emptyState}
      handleRowClick={onRowClick}
    />
  );
}

export type RowAction = {
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  destructive?: boolean;
};

/**
 * The single right-aligned kebab a row gets when it has more than one
 * action (role-actions.tsx is the canonical one). Clicks are stopped here
 * so opening the menu, or picking from it, never also opens the row: React
 * events bubble out of the menu's portal into the table row.
 */
export function RowActionsMenu({ label, actions }: { label: string; actions: RowAction[] }) {
  if (actions.length === 0) return null;
  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${label}`} onClick={(event) => event.stopPropagation()}>
            <EllipsisVerticalIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-max" onClick={(event) => event.stopPropagation()}>
          {actions.map((action) => (
            <DropdownMenuItem
              key={action.label}
              onClick={action.onSelect}
              className={action.destructive ? "text-destructive focus:text-destructive" : undefined}
            >
              {action.icon}
              {action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
