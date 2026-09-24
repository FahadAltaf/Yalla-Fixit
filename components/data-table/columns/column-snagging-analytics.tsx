"use client";

import { ColumnDef } from "@tanstack/react-table";
import { CalendarDays, HardHat, ListChecks, UserRound } from "lucide-react";

import { IconText } from "@/components/data-table/columns/icon-text";
import { Button } from "@/components/ui/button";
import type { SnaggingAnalytics } from "@/types/types";

/**
 * How many times one defect has to recur on a developer's units before
 * it stops being an incident and starts being a pattern worth colouring.
 */
export const RECURRING_DEFECT_THRESHOLD = 3;

export type SnaggingDeveloperRow = SnaggingAnalytics["byDeveloper"][number];
type SnaggingInspectorRow = SnaggingAnalytics["byInspector"][number];

/**
 * Columns for the two analytics breakdowns (FR-10.03, FR-10.04).
 *
 * Both are read-only rankings the API has already sorted, so sorting is
 * off on every column: re-sorting only the rows on the current page
 * would silently reorder a leaderboard against the totals shown beside
 * it. Every column reads from the left, like the rest of the portal's
 * tables, and sizes to what it holds.
 */
export function getSnaggingDeveloperColumns({
  onViewDefects,
}: {
  /** Opens the developer's full defect breakdown in a popup. */
  onViewDefects: (row: SnaggingDeveloperRow) => void;
}): ColumnDef<SnaggingDeveloperRow>[] {
  return [
    {
      id: "developer_name",
      header: "Developer",
      accessorKey: "developer_name",
      cell: ({ row }) => (
        <IconText icon={HardHat} className="font-medium">
          {row.original.developer_name}
        </IconText>
      ),
      enableSorting: false,
    },
    {
      id: "unit_count",
      header: "Units inspected",
      accessorKey: "unit_count",
      cell: ({ row }) => <div className="tabular-nums">{row.original.unit_count}</div>,
      enableSorting: false,
    },
    {
      id: "snags_per_unit",
      header: "Snags per unit",
      accessorKey: "snags_per_unit",
      // The one number the section exists to show, so it keeps the emphasis.
      cell: ({ row }) => (
        <div className="font-medium tabular-nums">{row.original.snags_per_unit}</div>
      ),
      enableSorting: false,
    },
    {
      id: "outstanding_count",
      header: "Still outstanding",
      accessorKey: "outstanding_count",
      cell: ({ row }) => (
        <div className="tabular-nums">{row.original.outstanding_count}</div>
      ),
      enableSorting: false,
    },
    {
      id: "last_inspection_at",
      header: "Last inspection",
      accessorKey: "last_inspection_at",
      cell: ({ row }) => (
        <IconText icon={CalendarDays} muted className="tabular-nums">
          {row.original.last_inspection_at
            ? row.original.last_inspection_at.slice(0, 10)
            : "—"}
        </IconText>
      ),
      enableSorting: false,
    },
    {
      id: "defects",
      header: "Defects",
      // FR-10.03. The breakdown grows with the catalogue, so it opens in a
      // popup rather than stretching every row with pills.
      cell: ({ row }) => {
        const mix = row.original.defect_mix;
        if (mix.length === 0) {
          return <span className="text-muted-foreground text-sm">None logged</span>;
        }
        return (
          <Button
            variant="outline"
            size="sm"
            onClick={(event) => {
              // The row itself opens the developer's jobs.
              event.stopPropagation();
              onViewDefects(row.original);
            }}
          >
            <ListChecks className="size-3.5" aria-hidden />
            View defects ({mix.length})
          </Button>
        );
      },
      enableSorting: false,
    },
  ];
}

export function getSnaggingInspectorColumns(): ColumnDef<SnaggingInspectorRow>[] {
  return [
    {
      id: "name",
      header: "Inspector",
      accessorKey: "name",
      cell: ({ row }) => (
        <IconText icon={UserRound} className="font-medium">
          {row.original.name}
        </IconText>
      ),
      enableSorting: false,
    },
    {
      id: "inspection_count",
      /*
        "Jobs worked", not "Inspections": a job split between two people
        counts for both of them, so this column sums to more than the
        number of jobs. Naming it for the person rather than the job is
        what stops it reading as a job count.
      */
      header: "Jobs worked",
      accessorKey: "inspection_count",
      cell: ({ row }) => (
        <div className="tabular-nums">{row.original.inspection_count}</div>
      ),
      enableSorting: false,
    },
    {
      id: "firstTimeApprovalRate",
      header: "First-time approval",
      accessorKey: "firstTimeApprovalRate",
      cell: ({ row }) => (
        <div className="tabular-nums">
          {row.original.firstTimeApprovalRate === null ? (
            <span className="text-muted-foreground">No approvals yet</span>
          ) : (
            <>
              {row.original.firstTimeApprovalRate}%
              <span className="text-muted-foreground block text-xs">
                over {row.original.approvalSample}
              </span>
            </>
          )}
        </div>
      ),
      enableSorting: false,
    },
    {
      id: "avgSubmitToApprovalMinutes",
      header: "Submit to approval",
      accessorKey: "avgSubmitToApprovalMinutes",
      cell: ({ row }) => (
        <div className="tabular-nums">
          {row.original.avgSubmitToApprovalMinutes === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            formatMinutes(row.original.avgSubmitToApprovalMinutes)
          )}
        </div>
      ),
      enableSorting: false,
    },
    {
      id: "avgMinutesPerInspection",
      header: "Average time",
      accessorKey: "avgMinutesPerInspection",
      // There is no snag column here and there is not meant to be
      // (FR-10.04): snag count measures the building an inspector was
      // sent to, so ranking people by it rewards drawing easy work.
      cell: ({ row }) => {
        const minutes = row.original.avgMinutesPerInspection;
        return (
          <div className="tabular-nums">
            {minutes === null ? (
              <span className="text-muted-foreground">Not submitted yet</span>
            ) : (
              <>
                {formatMinutes(minutes)}
                {row.original.timedSample < row.original.inspection_count ? (
                  <span className="text-muted-foreground block text-xs">
                    over {row.original.timedSample} of{" "}
                    {row.original.inspection_count}
                  </span>
                ) : null}
              </>
            )}
          </div>
        );
      },
      enableSorting: false,
    },
  ];
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
