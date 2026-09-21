"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Search } from "lucide-react";

import { DataTable } from "@/components/data-table";
import { RecordsToolbar } from "@/components/data-table/toolbars/records-toolbar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import {
  RECURRING_DEFECT_THRESHOLD,
  type SnaggingDeveloperRow,
} from "@/components/data-table/columns/column-snagging-analytics";

import { POPUP_PAGE_SIZES } from "./shared";

type DefectRow = SnaggingDeveloperRow["defect_mix"][number];

const columns: ColumnDef<DefectRow>[] = [
  {
    id: "label",
    header: "Defect",
    accessorKey: "label",
    cell: ({ row }) => <span className="font-medium">{row.original.label}</span>,
    enableSorting: false,
  },
  {
    id: "count",
    header: "Times found",
    accessorKey: "count",
    cell: ({ row }) => <span className="tabular-nums">{row.original.count}</span>,
    enableSorting: false,
  },
  {
    id: "pattern",
    header: "Pattern",
    cell: ({ row }) =>
      row.original.count >= RECURRING_DEFECT_THRESHOLD ? (
        <span className="bg-danger/10 text-danger rounded-full px-2 py-0.5 text-xs font-medium">
          Recurring
        </span>
      ) : (
        <span className="text-muted-foreground text-sm">One-off</span>
      ),
    enableSorting: false,
  },
];

/**
 * One developer's defects, most frequent first (FR-10.03), in the house
 * table: search, rows per page, Refresh and page numbers like every other
 * table. The breakdown arrives with the analytics, so Refresh re-reads
 * those and the rows follow.
 */
export function DeveloperDefectsDialog({
  developer,
  onClose,
  onRefresh,
  refreshing,
}: {
  developer: SnaggingDeveloperRow | null;
  onClose: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(POPUP_PAGE_SIZES[0]);
  const [search, setSearch] = useState("");
  // A fresh first page, with no search, whenever another developer opens.
  const name = developer?.developer_name ?? null;
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (name !== shownFor) {
    setShownFor(name);
    setPage(0);
    setSearch("");
  }

  const filtered = useMemo(() => {
    const rows = developer?.defect_mix ?? [];
    const term = search.trim().toLowerCase();
    return term ? rows.filter((row) => row.label.toLowerCase().includes(term)) : rows;
  }, [developer, search]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const shown = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);

  return (
    <Dialog open={developer !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(56rem,calc(100vw-3rem))]"
        showCloseButton
      >
        <DialogHeader className="px-6 pt-6 pb-4 text-left">
          <DialogTitle className="pr-10 text-lg">{name ?? "Developer"} · defects</DialogTitle>
          <DialogDescription>
            What this developer&apos;s units failed on in the selected dates, most frequent
            first. A defect seen {RECURRING_DEFECT_THRESHOLD} or more times is marked as
            recurring.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto border-t">
          <DataTable
            columns={columns}
            data={shown}
            loading={refreshing}
            rowCount={filtered.length}
            pageSize={pageSize}
            currentPage={safePage}
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
            toolbar={
              <RecordsToolbar
                fetchRecords={onRefresh}
                globalFilter={search}
                onGlobalFilterChange={(value) => {
                  setSearch(value);
                  setPage(0);
                }}
                isSearchLoading={refreshing}
                pageSize={pageSize}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(0);
                }}
                pageSizes={POPUP_PAGE_SIZES}
              />
            }
            emptyState={
              <EmptyState
                icon={<Search />}
                title={search.trim() ? "Nothing matches that" : "No defects logged"}
                description={
                  search.trim()
                    ? "Try part of the defect's name."
                    : "Nothing was recorded on this developer's units in these dates."
                }
              />
            }
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
