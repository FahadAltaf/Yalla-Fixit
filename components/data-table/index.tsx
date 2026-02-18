"use client";

import React, { useState } from "react";

import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ChevronsUpDownIcon,
  Loader2Icon,
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

import { Button } from "@/components/ui/button";

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from "@/components/ui/pagination";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { usePagination } from "@/hooks/use-pagination";

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

  const totalPages = rowCount > 0 ? Math.ceil(rowCount / pageSize) : 0;
  const { pages, showLeftEllipsis, showRightEllipsis } = usePagination({
    currentPage: currentPage + 1,
    totalPages,
    paginationItemsToDisplay: 2,
  });

  // Always show page 1 if not already in pages
  const firstPageInPages = pages.includes(1);
  const showFirstPageSeparately = totalPages > 1 && !firstPageInPages;

  // Always show last page if not already in pages
  const lastPageInPages = totalPages > 0 && pages.includes(totalPages);
  const showLastPageSeparately = totalPages > 1 && !lastPageInPages;

  // Adjust ellipsis display when showing first/last page separately
  const adjustedShowRightEllipsis =
    showRightEllipsis && !showLastPageSeparately;
  const adjustedShowLeftEllipsis = showLeftEllipsis && !showFirstPageSeparately;

  const pageStart = rowCount === 0 ? 0 : currentPage * pageSize + 1;
  const pageEnd =
    rowCount === 0 ? 0 : Math.min((currentPage + 1) * pageSize, rowCount);

  const canGoPrevious = currentPage > 0;
  const canGoNext = totalPages > 0 && currentPage < totalPages - 1;

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
                        className="text-muted-foreground hover:text-black hover:bg-muted first:pl-4 last:px-4"
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
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="h-24 text-center text-muted-foreground "
                  >
                    <div className="flex items-center justify-center gap-2">
                      <Loader2Icon className="animate-spin size-4" />
                      Loading...
                    </div>
                  </TableCell>
                </TableRow>
              ) : table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                    className="hover:bg-transparent"
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
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="h-24 text-center"
                  >
                    No results.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 px-6 py-4 max-sm:flex-col">
        <p
          className="text-muted-foreground text-sm whitespace-nowrap"
          aria-live="polite"
        >
          Showing{" "}
          <span>
            {pageStart} to {pageEnd}
          </span>{" "}
          of <span>{rowCount.toString()} entries</span>
        </p>

        <div>
          {isPagination && (
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <Button
                    className="disabled:pointer-events-none disabled:opacity-50"
                    variant={"ghost"}
                    onClick={() => {
                      if (canGoPrevious && !loading) {
                        onPageChange(currentPage - 1);
                      }
                    }}
                    disabled={!canGoPrevious || loading}
                    aria-label="Go to previous page"
                  >
                    <ChevronLeftIcon aria-hidden="true" />
                    <span className="max-sm:hidden">Previous</span>
                  </Button>
                </PaginationItem>

                {showFirstPageSeparately && (
                  <>
                    <PaginationItem>
                      <Button
                        className={`${
                          currentPage !== 0 &&
                          "bg-primary/10 text-primary hover:bg-primary/20 focus-visible:ring-primary/20 dark:focus-visible:ring-primary/40"
                        }`}
                        onClick={() => {
                          if (!loading && currentPage !== 0) {
                            onPageChange(0);
                          }
                        }}
                        disabled={loading}
                        aria-current={currentPage === 0 ? "page" : undefined}
                        aria-label="Go to first page"
                      >
                        1
                      </Button>
                    </PaginationItem>
                    {pages.length > 0 && pages[0] > 2 && (
                      <PaginationItem>
                        <PaginationEllipsis />
                      </PaginationItem>
                    )}
                  </>
                )}

                {adjustedShowLeftEllipsis && (
                  <PaginationItem>
                    <PaginationEllipsis />
                  </PaginationItem>
                )}

                {pages.map((page) => {
                  const isActive = page === currentPage + 1;

                  return (
                    <PaginationItem key={page}>
                      <Button
                        className={`${
                          !isActive &&
                          "bg-primary/10 text-primary hover:bg-primary/20 focus-visible:ring-primary/20 dark:focus-visible:ring-primary/40"
                        }`}
                        onClick={() => {
                          if (!loading && page - 1 !== currentPage) {
                            onPageChange(page - 1);
                          }
                        }}
                        disabled={loading}
                        aria-current={isActive ? "page" : undefined}
                      >
                        {page}
                      </Button>
                    </PaginationItem>
                  );
                })}

                {adjustedShowRightEllipsis && (
                  <PaginationItem>
                    <PaginationEllipsis />
                  </PaginationItem>
                )}

                {showLastPageSeparately && (
                  <>
                    {pages.length > 0 &&
                      pages[pages.length - 1] < totalPages - 1 && (
                        <PaginationItem>
                          <PaginationEllipsis />
                        </PaginationItem>
                      )}
                    <PaginationItem>
                      <Button
                        // size="icon"
                        className={`${
                          currentPage !== totalPages - 1 &&
                          "bg-primary/10 text-primary hover:bg-primary/20 focus-visible:ring-primary/20 dark:focus-visible:ring-primary/40"
                        }`}
                        onClick={() => {
                          if (!loading && currentPage !== totalPages - 1) {
                            onPageChange(totalPages - 1);
                          }
                        }}
                        disabled={loading}
                        aria-current={
                          currentPage === totalPages - 1 ? "page" : undefined
                        }
                      >
                        {totalPages}
                      </Button>
                    </PaginationItem>
                  </>
                )}

                <PaginationItem>
                  <Button
                    className="disabled:pointer-events-none disabled:opacity-50"
                    variant={"ghost"}
                    onClick={() => {
                      if (canGoNext && !loading) {
                        onPageChange(currentPage + 1);
                      }
                    }}
                    disabled={!canGoNext || loading}
                    aria-label="Go to next page"
                  >
                    <span className="max-sm:hidden">Next</span>
                    <ChevronRightIcon aria-hidden="true" />
                  </Button>
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      </div>
    </div>
  );
}
