"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2, Search } from "lucide-react";

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
import { IdentityCell } from "@/components/ui/entity-avatar";
import { useDebounce } from "@/hooks/use-debounce";
import { exportFilename, exportTable } from "@/lib/snagging/export-table";
import { snaggingService } from "@/modules/snagging";
import type {
  SnaggingAnalyticsDrilldown,
  SnaggingAnalyticsGranularity,
  SnaggingAnalyticsMetric,
  SnaggingTaskStatus,
} from "@/types/types";

import { ExportMenu } from "./export-menu";
import { ErrorState, POPUP_PAGE_SIZES, TASK_STATUS_LABELS, TaskStatusBadge } from "./shared";

type DrilldownRow = SnaggingAnalyticsDrilldown["rows"][number];

/** What a figure on the page needs to say to open itself. */
export type DrilldownRequest = {
  metric: SnaggingAnalyticsMetric;
  /** Which slice: a status, a period key, a developer name, an inspector id. */
  value?: string | null;
  from: string;
  to: string;
  granularity?: SnaggingAnalyticsGranularity;
};

/**
 * The three columns every drill-down opens with.
 *
 * They are rendered as one identity cell rather than three columns —
 * avatar, job code, unit underneath — which is the house table pattern
 * and buys back the width the metric's own columns actually need.
 */
const IDENTITY_KEYS = ["code", "unit", "status"];
// `code` stays in the key list so the drilldown still consumes it from the
// payload rather than rendering it as a column of its own.

/**
 * The records behind a figure (FR-10.06).
 *
 * A centred dialog rather than a side panel. These tables run to six
 * columns of codes, timestamps and durations; in a right-hand drawer
 * they lost half their width to the page behind them and the reader had
 * to scroll sideways to reach the column the figure was actually about.
 *
 * The columns come from the server with the rows, so this renders any
 * metric and the export writes whatever is on screen — there is no
 * second list of fields here to drift out of step with the first.
 */
export function AnalyticsDrilldown({
  request,
  onClose,
  canExport,
}: {
  request: DrilldownRequest | null;
  onClose: () => void;
  canExport: boolean;
}) {
  const router = useRouter();
  const [data, setData] = useState<SnaggingAnalyticsDrilldown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Rows come a page at a time; a wide date range can hold thousands.
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(POPUP_PAGE_SIZES[0]);
  const [exporting, setExporting] = useState(false);
  // Searched on the server by unit, building or job code.
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search.trim(), 300);
  // Back to the first page, and a clear search, whenever another figure opens.
  const [shownFor, setShownFor] = useState<DrilldownRequest | null>(null);
  if (request !== shownFor) {
    setShownFor(request);
    setPage(0);
    setSearch("");
  }

  const load = useCallback(async () => {
    if (!request) return;
    setLoading(true);
    setError(null);
    try {
      setData(
        await snaggingService.getAnalyticsRecords({
          ...request,
          page,
          pageSize,
          search: debouncedSearch || undefined,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load these records");
    } finally {
      setLoading(false);
    }
  }, [request, page, pageSize, debouncedSearch]);

  // Clearing first stops the previous metric's rows showing under the
  // new metric's heading while the request is in flight.
  useEffect(() => {
    setData(null);
  }, [request]);

  useEffect(() => {
    void load();
  }, [load]);

  /* The export carries every row, not just the page on screen. */
  async function download(format: "csv" | "xlsx") {
    if (!data || !request || exporting) return;
    setExporting(true);
    let everything: SnaggingAnalyticsDrilldown;
    try {
      everything = await snaggingService.getAnalyticsRecords({
        ...request,
        all: true,
        search: debouncedSearch || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not prepare the export");
      return;
    } finally {
      setExporting(false);
    }
    void exportTable({
      columns: everything.columns.map(({ key, label }) => ({ key, label })),
      rows: everything.rows,
      filename: exportFilename([
        "snagging",
        data.metric,
        request?.value,
        request?.from,
        request?.to,
      ]),
      format,
      sheetName: data.title,
    });
  }

  /*
    The house table: the unit names the row, status sits in its own
    column, then the metric's own fields as the server lists them.
    Everything the unit and status columns already say is dropped from
    that list so nothing shows twice.
  */
  const columns = useMemo<ColumnDef<DrilldownRow>[]>(() => {
    const detail = (data?.columns ?? []).filter(
      (column) => !IDENTITY_KEYS.includes(column.key),
    );
    return [
      {
        id: "unit",
        header: "Job",
        cell: ({ row }) => (
          <IdentityCell
            title={row.original.unit ? String(row.original.unit) : "—"}
            subtitle={null}
            icon={Building2}
          />
        ),
        enableSorting: false,
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) =>
          row.original.status ? (
            <TaskStatusBadge status={statusFor(row.original.status)} />
          ) : (
            "—"
          ),
        enableSorting: false,
      },
      ...detail.map<ColumnDef<DrilldownRow>>((column) => ({
        id: column.key,
        header: column.label,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {row.original[column.key] ?? "—"}
          </span>
        ),
        enableSorting: false,
      })),
    ];
  }, [data?.columns]);

  const showExport = canExport && data && data.totalCount > 0;

  return (
    <Dialog open={request !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent
        className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(72rem,calc(100vw-3rem))]"
        showCloseButton
      >
        <DialogHeader className="px-6 pt-6 pb-4 text-left">
          <DialogTitle className="pr-10 text-lg">{data?.title ?? "Records"}</DialogTitle>
          <DialogDescription>
            {data ? data.description : "Opening the records behind this figure."}
          </DialogDescription>
        </DialogHeader>

        {/*
          min-w-0 matters: without it this flex child is sized by its
          content and the page scrolls sideways behind the dialog instead
          of the table scrolling inside it.
        */}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto border-t">
          {error ? (
            <div className="px-6 py-4">
              <ErrorState
                title="Could not load these records"
                message={error}
                onRetry={() => void load()}
                retrying={loading}
              />
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={data?.rows ?? []}
              loading={loading}
              rowCount={data?.totalCount ?? 0}
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
              handleRowClick={(row) => router.push(`/snagging/${row.id}`)}
              toolbar={
                <RecordsToolbar
                  fetchRecords={() => void load()}
                  globalFilter={search}
                  onGlobalFilterChange={(value) => {
                    setSearch(value);
                    setPage(0);
                  }}
                  isSearchLoading={loading}
                  pageSize={pageSize}
                  onPageSizeChange={(size) => {
                    setPageSize(size);
                    setPage(0);
                  }}
                  pageSizes={POPUP_PAGE_SIZES}
                  searchPlaceholder="Search..."
                  actions={
                    showExport ? (
                      <ExportMenu
                        size="default"
                        disabled={exporting}
                        onExport={(format) => void download(format)}
                      />
                    ) : null
                  }
                />
              }
              emptyState={
                <EmptyState
                  icon={<Search />}
                  title={debouncedSearch ? "Nothing matches that" : "Nothing behind this figure"}
                  description={
                    debouncedSearch
                      ? "Try part of the unit, the building or the job code."
                      : "The number is zero for the dates selected. Widen the range to look further back."
                  }
                />
              }
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The server sends the status already written for a person to read, and
 * the badge wants the raw value back. Reversing the label map keeps the
 * two in step without the endpoint having to send both.
 */
const STATUS_BY_LABEL = new Map(
  Object.entries(TASK_STATUS_LABELS).map(([status, label]) => [label, status]),
);

function statusFor(value: string | number): SnaggingTaskStatus {
  return (STATUS_BY_LABEL.get(String(value)) ?? "draft") as SnaggingTaskStatus;
}
