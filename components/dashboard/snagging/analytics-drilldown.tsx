"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileSpreadsheet, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { exportFilename, exportTable } from "@/lib/snagging/export-table";
import { snaggingService } from "@/modules/snagging";
import type {
  SnaggingAnalyticsDrilldown,
  SnaggingAnalyticsGranularity,
  SnaggingAnalyticsMetric,
  SnaggingTaskStatus,
} from "@/types/types";

import { ErrorState, TASK_STATUS_LABELS, TaskStatusBadge } from "./shared";

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

  const load = useCallback(async () => {
    if (!request) return;
    setLoading(true);
    setError(null);
    try {
      setData(await snaggingService.getAnalyticsRecords(request));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load these records");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    // Clearing first stops the previous metric's rows showing under the
    // new metric's heading while the request is in flight.
    setData(null);
    void load();
  }, [load]);

  function download(format: "csv" | "xlsx") {
    if (!data) return;
    exportTable({
      columns: data.columns.map(({ key, label }) => ({ key, label })),
      rows: data.rows,
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

  // Everything the identity cell already says is dropped from the column
  // list, so the table shows the metric's own fields and nothing twice.
  const detailColumns = (data?.columns ?? []).filter(
    (column) => !IDENTITY_KEYS.includes(column.key),
  );
  const showExport = canExport && data && data.rows.length > 0;

  return (
    <Dialog open={request !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(72rem,calc(100vw-3rem))]"
        showCloseButton
      >
        <DialogHeader className="px-6 pt-6 pb-4 text-left">
          <DialogTitle className="pr-10 text-lg">{data?.title ?? "Records"}</DialogTitle>
          <DialogDescription>
            {data ? data.description : "Opening the records behind this figure."}
          </DialogDescription>
        </DialogHeader>

        {/*
          The toolbar row the house tables use: what you are looking at on
          the left, the actions clustered on the right. The two exports
          used to sit loose under the description, which read as two
          stray links rather than as the table's controls.
        */}
        {data && !error ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-y px-6 py-3">
            <p className="text-muted-foreground text-sm">
              {data.totalCount === 1 ? "1 record" : `${data.totalCount} records`}
            </p>
            {showExport ? (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => download("csv")}>
                  <Download className="size-4" />
                  Export CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => download("xlsx")}>
                  <FileSpreadsheet className="size-4" />
                  Export Excel
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {/*
          min-w-0 matters: without it this flex child is sized by its
          content, the table's w-full resolves against 800px of nowrap
          columns, and the whole page scrolls sideways behind the dialog
          instead of the table scrolling inside it.
        */}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {loading ? (
            <RowsSkeleton columns={3} />
          ) : error ? (
            <div className="px-6 py-4">
              <ErrorState
                title="Could not load these records"
                message={error}
                onRetry={() => void load()}
                retrying={loading}
              />
            </div>
          ) : data && data.rows.length === 0 ? (
            <div className="px-6 py-4">
              <EmptyState
                icon={<Search />}
                title="Nothing behind this figure"
                description="The number is zero for the dates selected. Widen the range to look further back."
              />
            </div>
          ) : data ? (
            // Table brings its own horizontal scroll container, so a
            // narrow screen scrolls the columns rather than the page.
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-11 pl-6">Job</TableHead>
                  {detailColumns.map((column, index) => (
                    <TableHead
                      key={column.key}
                      className={cn(
                        "h-11 whitespace-nowrap",
                        index === detailColumns.length - 1 && "pr-6",
                        column.align === "right" && "text-right",
                      )}
                    >
                      {column.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="hover:bg-muted/40 cursor-pointer"
                    onClick={() => router.push(`/snagging/${row.id}`)}
                  >
                    <TableCell className="py-3 pl-6">
                      <IdentityCell
                        seed={row.id}
                        title={String(row.code ?? "—")}
                        subtitle={row.unit ? String(row.unit) : null}
                        badge={
                          row.status ? (
                            <TaskStatusBadge status={statusFor(row.status)} />
                          ) : null
                        }
                      />
                    </TableCell>
                    {detailColumns.map((column, index) => (
                      <TableCell
                        key={column.key}
                        className={cn(
                          "py-3 whitespace-nowrap",
                          index === detailColumns.length - 1 && "pr-6",
                          column.align === "right" && "text-right tabular-nums",
                        )}
                      >
                        {row[column.key] ?? "—"}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </div>

        {data && data.rows.length > 0 ? (
          <div className="text-muted-foreground border-t px-6 py-3 text-xs">
            Showing {data.rows.length} of {data.totalCount}{" "}
            {data.totalCount === 1 ? "entry" : "entries"}. Open a row to go to the inspection.
          </div>
        ) : null}
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

/**
 * Rows shaped like the real ones — a circle for the avatar, two stacked
 * bars for the code and unit, then the detail columns — so nothing
 * shifts when the data lands.
 */
function RowsSkeleton({ columns }: { columns: number }) {
  return (
    <div className="divide-y">
      {Array.from({ length: 5 }).map((_, row) => (
        <div key={row} className="flex items-center gap-4 px-6 py-3.5">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="min-w-40 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
          {Array.from({ length: columns }).map((_, cell) => (
            <Skeleton key={cell} className="h-3.5 w-20 shrink-0" />
          ))}
        </div>
      ))}
    </div>
  );
}
