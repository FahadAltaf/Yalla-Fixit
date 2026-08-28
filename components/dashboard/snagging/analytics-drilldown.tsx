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
} from "@/types/types";

import { ErrorState } from "./shared";

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
 * The records behind a figure (FR-10.06).
 *
 * A centred dialog rather than a side panel. These tables run to six
 * columns of codes, timestamps and durations; in a right-hand drawer
 * they lost half their width to the page behind them and the reader had
 * to scroll sideways to reach the column the figure was actually about.
 * A dialog gets the full width of the screen, so the whole row is
 * readable at once — which is the entire point of opening it.
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
      setError(
        err instanceof Error ? err.message : "Could not load these records",
      );
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

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => (open ? null : onClose())}
    >
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(72rem,calc(100vw-3rem))]"
        showCloseButton
      >
        <DialogHeader className="border-b px-6 pt-6 pb-4 text-left">
          <DialogTitle className="pr-10 text-lg">
            {data?.title ?? "Records"}
          </DialogTitle>
          <DialogDescription>
            {data
              ? `${data.totalCount} ${data.totalCount === 1 ? "job" : "jobs"}. ${data.description}`
              : "Opening the records behind this figure."}
          </DialogDescription>
          {canExport && data && data.rows.length > 0 ? (
            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => download("csv")}
              >
                <Download className="size-4" />
                CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => download("xlsx")}
              >
                <FileSpreadsheet className="size-4" />
                Excel
              </Button>
            </div>
          ) : null}
        </DialogHeader>

        {/*
          min-w-0 matters: without it this flex child is sized by its
          content, the table's w-full resolves against 800px of
          nowrap columns, and the whole page scrolls sideways behind
          the dialog instead of the table scrolling inside it.
        */}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="space-y-2 px-6 py-4">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
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
              <TableHeader className="bg-muted/40">
                <TableRow>
                  {data.columns.map((column, index) => (
                    <TableHead
                      key={column.key}
                      className={cn(
                        "whitespace-nowrap",
                        index === 0 && "pl-6",
                        index === data.columns.length - 1 && "pr-6",
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
                    className="hover:bg-muted/50 cursor-pointer"
                    onClick={() => router.push(`/snagging/${row.id}`)}
                  >
                    {data.columns.map((column, index) => (
                      <TableCell
                        key={column.key}
                        className={cn(
                          "whitespace-nowrap",
                          index === 0 && "pl-6 font-medium",
                          index === data.columns.length - 1 && "pr-6",
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
            Open a row to go to the inspection.
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
