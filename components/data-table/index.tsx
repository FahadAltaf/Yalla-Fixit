"use client";

import React, { useState } from "react";

import {
  ChevronDownIcon,
  ChevronUpIcon,
  ChevronsUpDownIcon,
} from "lucide-react";

import type {
  ColumnDef,
  ColumnFiltersState,
  RowData,
  SortingState,
} from "@tanstack/react-table";
import {
  flexRender,
  getCoreRowModel,
  getFacetedMinMaxValues,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";

import { Skeleton } from "@/components/ui/skeleton";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { TablePager } from "./table-pager";

import { cn } from "@/lib/utils";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    filterVariant?: "text" | "range" | "select";
  }
}

interface DataTableToolbarProps {
  onRefresh: () => void;
  onGlobalFilterChange: (filter: string) => void;
  table?: unknown; // Add other specific props as needed
  onExport?: () => void;
  tableName?: string;
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  onGlobalFilterChange: (filter: string) => void;
  onPageChange: (pageIndex: number) => void;
  onPageSizeChange: (size: number) => void;
  onSortingChange?: (sortBy?: string, sortOrder?: "asc" | "desc") => void;
  pageSize: number;
  currentPage: number;
  loading: boolean;
  rowCount: number | 0;
  tableName?: string;
  toolbar?: React.ReactElement<DataTableToolbarProps>; // Update toolbar type
  isPagination?: boolean;
  type?: string;
  handleRowClick?: (row: TData) => void;
  pageSizeOptions?: number[];
  /**
   * What to show when there are no rows. Defaults to the plain
   * "No results." cell; pass an <EmptyState /> to explain what would be
   * here and offer the action that fills it.
   */
  emptyState?: React.ReactNode;
  /**
   * For a source that gives no total (Zoho FSM): whether there is a page
   * after this one. When set, rowCount is ignored, the footer reads
   * "Showing 11 to 20" without "of N", and Next follows this.
   */
  hasMore?: boolean;
}

export function DataTable<TData, TValue>({
  data,
  toolbar,
  columns,
  onPageChange,
  onSortingChange,
  pageSize,
  currentPage,
  loading,
  rowCount,
  isPagination,
  emptyState,
  handleRowClick,
  hasMore,
}: DataTableProps<TData, TValue>) {
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [sortingState, setSortingState] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    state: {
      columnFilters,
      sorting: sortingState,
    },
    onColumnFiltersChange: setColumnFilters,
    onSortingChange: (updater) => {
      setSortingState((prev) => {
        const nextState =
          typeof updater === "function" ? updater(prev) : updater;

        const primarySort = nextState[0];
        if (onSortingChange) {
          if (primarySort) {
            onSortingChange(primarySort.id, primarySort.desc ? "desc" : "asc");
          } else {
            onSortingChange(undefined, undefined);
          }
        }

        return nextState;
      });
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getFacetedMinMaxValues: getFacetedMinMaxValues(),
    enableSortingRemoval: false,
  });

  return (
    <div className="w-full">
      <div className="border-b">
        {toolbar && React.cloneElement(toolbar)}
        <div className="grid auto-rows-max items-start gap-4 md:gap-8 lg:col-span-2">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="h-14 border-t">
                  {headerGroup.headers.map((header) => {
                    return (
                      <TableHead
                        key={header.id}
                        style={{ width: `${header.getSize()}px` }}
                        /* text-foreground, not black: on a dark theme the header
                             went black on a dark hover and disappeared. */
                        className="text-muted-foreground hover:text-foreground hover:bg-muted first:pl-4 last:px-4"
                      >
                        {header.isPlaceholder ? null : header.column.getCanSort() ? (
                          <div
                            className={cn(
                              header.column.getCanSort() &&
                                "flex h-full cursor-pointer hover:dark:text-white hover:text-black items-center  gap-2 select-none"
                            )}
                            onClick={header.column.getToggleSortingHandler()}
                            onKeyDown={(e) => {
                              if (
                                header.column.getCanSort() &&
                                (e.key === "Enter" || e.key === " ")
                              ) {
                                e.preventDefault();
                                header.column.getToggleSortingHandler()?.(e);
                              }
                            }}
                            tabIndex={
                              header.column.getCanSort() ? 0 : undefined
                            }
                          >
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                            {(() => {
                              const sortState = header.column.getIsSorted() as
                                | false
                                | "asc"
                                | "desc";

                              if (sortState === "asc") {
                                return (
                                  <ChevronUpIcon
                                    className="shrink-0 opacity-60"
                                    size={16}
                                    aria-hidden="true"
                                  />
                                );
                              }

                              if (sortState === "desc") {
                                return (
                                  <ChevronDownIcon
                                    className="shrink-0 opacity-60"
                                    size={16}
                                    aria-hidden="true"
                                  />
                                );
                              }

                              return (
                                <ChevronsUpDownIcon
                                  className="shrink-0 opacity-40"
                                  size={16}
                                  aria-hidden="true"
                                />
                              );
                            })()}
                          </div>
                        ) : (
                          flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {loading ? (
                // Skeleton rows rather than one spinner cell: the table
                // keeps its real shape and height while it loads, so the
                // page does not collapse to a thin bar and then jump back
                // open when the rows land.
                Array.from({ length: Math.min(Math.max(pageSize, 3), 8) }).map((_, rowIndex) => (
                  <TableRow key={`skeleton-${rowIndex}`} className="hover:bg-transparent">
                    {columns.map((_column, colIndex) => (
                      <TableCell
                        key={`skeleton-${rowIndex}-${colIndex}`}
                        className="h-14 first:w-12.5 first:pl-4 last:w-29 last:px-4"
                      >
                        <Skeleton
                          className={cn(
                            "h-4",
                            colIndex === 0 ? "w-24" : colIndex === columns.length - 1 ? "w-12" : "w-16"
                          )}
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                    onClick={
                      handleRowClick ? () => handleRowClick(row.original) : undefined
                    }
                    className={cn(
                      handleRowClick ? "hover:bg-muted/50 cursor-pointer" : "hover:bg-transparent"
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className="h-14 first:w-12.5 first:pl-4 last:w-29 last:px-4"
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={columns.length}
                    className={cn(
                      // A table cell does not wrap by default; an empty state's
                      // sentence must, or it runs past the table off-centre.
                      emptyState ? "p-0 whitespace-normal" : "h-24 text-center"
                    )}
                  >
                    {emptyState ?? "No results."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <TablePager
        currentPage={currentPage}
        pageSize={pageSize}
        rowCount={rowCount}
        rowsOnPage={data.length}
        loading={loading}
        onPageChange={onPageChange}
        isPagination={isPagination}
        hasMore={hasMore}
      />
    </div>
  );
}
