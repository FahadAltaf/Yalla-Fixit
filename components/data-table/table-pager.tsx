"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from "@/components/ui/pagination";
import { usePagination } from "@/hooks/use-pagination";

/**
 * The footer every table in the app has: "Showing X to Y of Z entries" on
 * the left, Previous / page circles / Next on the right. DataTable uses it,
 * and a table built by hand (Workforce → People) uses it too, so the two
 * cannot drift apart (2 Nov).
 */
export function TablePager({
  currentPage,
  pageSize,
  rowCount,
  rowsOnPage,
  loading = false,
  onPageChange,
  isPagination = true,
  hasMore,
}: {
  /** Zero-based. */
  currentPage: number;
  pageSize: number;
  rowCount: number;
  /** Rows on this page; only needed with hasMore. */
  rowsOnPage?: number;
  loading?: boolean;
  onPageChange: (pageIndex: number) => void;
  isPagination?: boolean;
  /**
   * For a source that gives no total (Zoho FSM): whether there is a page
   * after this one. When set, rowCount is ignored, the footer reads
   * "Showing 11 to 20" without "of N", and Next follows this.
   */
  hasMore?: boolean;
}) {
  const openEnded = hasMore !== undefined;
  const dataLength = rowsOnPage ?? 0;
  // Without a total, the pages known are those up to this one, and the next if there is one.
  const knownRows = openEnded ? currentPage * pageSize + dataLength + (hasMore ? 1 : 0) : rowCount;
  const totalPages = knownRows > 0 ? Math.ceil(knownRows / pageSize) : 0;
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

  const pageStart = openEnded
    ? dataLength === 0
      ? 0
      : currentPage * pageSize + 1
    : rowCount === 0
      ? 0
      : currentPage * pageSize + 1;
  const pageEnd = openEnded
    ? currentPage * pageSize + dataLength
    : rowCount === 0
      ? 0
      : Math.min((currentPage + 1) * pageSize, rowCount);

  const canGoPrevious = currentPage > 0;
  const canGoNext = openEnded
    ? Boolean(hasMore)
    : totalPages > 0 && currentPage < totalPages - 1;

  return (
      <div className="flex items-center justify-between gap-3 px-6 py-4 max-sm:flex-col">
      <p
        className="text-muted-foreground text-sm whitespace-nowrap"
        aria-live="polite"
      >
        Showing{" "}
        <span>
          {pageStart} to {pageEnd}
        </span>
        {openEnded ? null : (
          <>
            {" "}
            of <span>{rowCount.toString()} entries</span>
          </>
        )}
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
                      // A circle, not a pill: the active page reads as a dot.
                      size="icon"
                      className={`rounded-full tabular-nums ${
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
                      // A circle, not a pill: the active page reads as a dot.
                      size="icon"
                      className={`rounded-full tabular-nums ${
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
                      // A circle, not a pill: the active page reads as a dot.
                      size="icon"
                      className={`rounded-full tabular-nums ${
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
  );
}
