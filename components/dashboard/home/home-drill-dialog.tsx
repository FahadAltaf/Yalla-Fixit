"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowRight, ChevronRight, Inbox } from "lucide-react";

import { ErrorState } from "@/components/dashboard/shared/kaizen-states";
import { DataTable } from "@/components/data-table";
import { RecordsToolbar } from "@/components/data-table/toolbars/records-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebounce } from "@/hooks/use-debounce";
import type { HomeTone } from "@/lib/home/summary";
import { executeRESTBackend } from "@/lib/rest-server";
import type { DrillPage, DrillRow } from "@/lib/server/home/drill";
import { cn } from "@/lib/utils";

const PAGE_SIZES = [5, 10, 25];

/* Soft-tinted status pills, as on the canonical table. */
export const TONE_PILL: Record<HomeTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  progress: "bg-warning/10 text-warning",
  review: "bg-brand/10 text-brand",
  good: "bg-success/10 text-success",
  bad: "bg-danger/10 text-danger",
};

const when = (iso: string | null) => {
  if (!iso) return "—";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(dateOnly ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", ...(dateOnly ? { timeZone: "UTC" } : { timeZone: "Asia/Dubai" }) }).format(d);
};

/**
 * The records behind a figure on the home dashboard (26 Nov 2026): the
 * house table in a popup, searched and paged on the server, each row
 * opening its record's page. The footer opens the module page that holds
 * the whole list.
 */
export function HomeDrillDialog({ drillKey, fallbackTitle, onClose }: { drillKey: string | null; fallbackTitle?: string; onClose: () => void }) {
  const router = useRouter();
  const [data, setData] = useState<DrillPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  /* Five rows to start (26 Nov 2026, the user), more from the page-size picker. */
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [search, setSearch] = useState("");
  const q = useDebounce(search.trim(), 300);

  /* A fresh first page whenever another figure opens. */
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (drillKey !== shownFor) {
    setShownFor(drillKey);
    setPage(0);
    setSearch("");
    setData(null);
    setError(null);
  }

  const ticket = useRef(0);
  const load = useCallback(async () => {
    if (!drillKey) return;
    const mine = ++ticket.current;
    setLoading(true);
    setError(null);
    try {
      const result = await executeRESTBackend<DrillPage>("/api/home/items", { params: { key: drillKey, page, pageSize, ...(q ? { q } : {}) } });
      if (mine === ticket.current) setData(result);
    } catch (e) {
      if (mine === ticket.current) setError(e instanceof Error ? e.message : "Could not load the list.");
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  }, [drillKey, page, pageSize, q]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = useCallback(
    (row: DrillRow) => {
      onClose();
      router.push(row.href);
    },
    [onClose, router],
  );

  const columns = useMemo<ColumnDef<DrillRow>[]>(
    () => [
      {
        id: "record",
        header: "Record",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-0 max-w-[28rem]">
            <div className="truncate font-medium">{row.original.title}</div>
            {row.original.subtitle ? <div className="text-muted-foreground truncate text-sm">{row.original.subtitle}</div> : null}
          </div>
        ),
      },
      {
        id: "when",
        header: "Date",
        enableSorting: false,
        cell: ({ row }) => <span className="text-muted-foreground text-sm whitespace-nowrap tabular-nums">{when(row.original.when)}</span>,
      },
      {
        id: "status",
        header: "Status",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.status ? (
            <Badge variant="secondary" className={cn("rounded-full border-0 font-medium whitespace-nowrap", TONE_PILL[row.original.tone])}>
              {row.original.status}
            </Badge>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          ),
      },
      {
        id: "open",
        header: () => <span className="sr-only">Open</span>,
        enableSorting: false,
        enableHiding: false,
        cell: () => (
          <div className="flex justify-end">
            <ChevronRight className="text-muted-foreground size-4" aria-hidden />
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <Dialog open={drillKey !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(60rem,calc(100vw-3rem))]" showCloseButton>
        <DialogHeader className="px-6 pt-6 pb-4 text-left">
          <DialogTitle className="pr-10 text-lg">
            {data ? data.title : fallbackTitle ?? <Skeleton className="h-6 w-56" />}
            {data ? <span className="text-muted-foreground ml-2 text-base font-normal tabular-nums">({data.total.toLocaleString("en-AE")})</span> : null}
          </DialogTitle>
          <DialogDescription>{data ? `${data.description} Open a row to go to its page.` : "Loading the records…"}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto border-t">
          {error && !data ? (
            <div className="px-6 py-4">
              <ErrorState title="Could not load the list" message={error} onRetry={() => void load()} retrying={loading} />
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={data?.rows ?? []}
              loading={loading}
              rowCount={data?.total ?? 0}
              pageSize={pageSize}
              currentPage={page}
              isPagination
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(0);
              }}
              onGlobalFilterChange={(value) => {
                setSearch(value);
                setPage(0);
              }}
              handleRowClick={open}
              toolbar={
                <RecordsToolbar
                  fetchRecords={() => void load()}
                  globalFilter={search}
                  onGlobalFilterChange={(value) => {
                    setSearch(value);
                    setPage(0);
                  }}
                  isSearchLoading={loading || search.trim() !== q}
                  pageSize={pageSize}
                  onPageSizeChange={(size) => {
                    setPageSize(size);
                    setPage(0);
                  }}
                  searchPlaceholder="Search these records…"
                  pageSizes={PAGE_SIZES}
                />
              }
              emptyState={
                <EmptyState
                  icon={<Inbox />}
                  title={q ? "Nothing matches that" : "Nothing here now"}
                  description={q ? "Try another word from the name, number or status." : "It may have been dealt with since the dashboard was read. Refresh the dashboard to update its figures."}
                />
              }
            />
          )}
        </div>

        {data ? (
          /* This popup has no padding of its own, so the footer sits flush instead of reaching out past the edge. */
          <DialogFooter className="m-0 items-center rounded-none border-t bg-transparent px-6 py-4">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button asChild>
              <Link href={data.href} onClick={onClose}>
                {data.hrefLabel}
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
