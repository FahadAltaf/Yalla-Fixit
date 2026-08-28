"use client";

import { ColumnDef } from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";
import type { SnaggingAnalytics } from "@/types/types";

type SnaggingDeveloperRow = SnaggingAnalytics["byDeveloper"][number];
type SnaggingInspectorRow = SnaggingAnalytics["byInspector"][number];

/**
 * Columns for the two analytics breakdowns (FR-10.03, FR-10.04).
 *
 * Both are read-only rankings the API has already sorted, so sorting is
 * off on every column: re-sorting only the rows on the current page
 * would silently reorder a leaderboard against the totals shown beside
 * it. Headers therefore render raw, which is what keeps the right-hand
 * alignment on the numeric columns.
 */
export function getSnaggingDeveloperColumns(): ColumnDef<SnaggingDeveloperRow>[] {
  return [
    {
      id: "developer_name",
      header: "Developer",
      accessorKey: "developer_name",
      cell: ({ row }) => <div className="font-medium">{row.original.developer_name}</div>,
      enableSorting: false,
    },
    {
      id: "unit_count",
      header: () => <span className="block text-right">Units inspected</span>,
      accessorKey: "unit_count",
      cell: ({ row }) => <div className="text-right tabular-nums">{row.original.unit_count}</div>,
      enableSorting: false,
    },
    {
      id: "snags_per_unit",
      header: () => <span className="block text-right">Snags per unit</span>,
      accessorKey: "snags_per_unit",
      // The one number the section exists to show, so it keeps the
      // emphasis it had in the raw table.
      cell: ({ row }) => (
        <div className="text-right font-medium tabular-nums">{row.original.snags_per_unit}</div>
      ),
      enableSorting: false,
    },
    {
      id: "outstanding_count",
      header: () => <span className="block text-right">Still outstanding</span>,
      accessorKey: "outstanding_count",
      cell: ({ row }) => (
        <div className="text-right tabular-nums">{row.original.outstanding_count}</div>
      ),
      enableSorting: false,
    },
    {
      id: "defect_mix",
      header: "Defect mix",
      // FR-10.03. Scoped to the developer on the row — the portfolio-wide
      // version of this is the chart FR-10.05 rules out.
      cell: ({ row }) => {
        const mix = row.original.defect_mix;
        if (mix.length === 0) {
          return <span className="text-muted-foreground text-sm">No defects logged</span>;
        }
        return (
          <div className="flex flex-wrap gap-1">
            {mix.map((entry) => (
              <Badge key={entry.label} variant="secondary" className="font-normal">
                {entry.label}
                <span className="text-muted-foreground ml-1 tabular-nums">{entry.count}</span>
              </Badge>
            ))}
          </div>
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
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      enableSorting: false,
    },
    {
      id: "inspection_count",
      header: () => <span className="block text-right">Inspections</span>,
      accessorKey: "inspection_count",
      cell: ({ row }) => (
        <div className="text-right tabular-nums">{row.original.inspection_count}</div>
      ),
      enableSorting: false,
    },
    {
      id: "avgMinutesPerInspection",
      header: () => <span className="block text-right">Average time</span>,
      accessorKey: "avgMinutesPerInspection",
      // There is no snag column here and there is not meant to be
      // (FR-10.04): snag count measures the building an inspector was
      // sent to, so ranking people by it rewards drawing easy work.
      cell: ({ row }) => {
        const minutes = row.original.avgMinutesPerInspection;
        return (
          <div className="text-right tabular-nums">
            {minutes === null ? (
              <span className="text-muted-foreground">Not submitted yet</span>
            ) : (
              <>
                {formatMinutes(minutes)}
                {row.original.timedSample < row.original.inspection_count ? (
                  <span className="text-muted-foreground block text-xs">
                    over {row.original.timedSample} of {row.original.inspection_count}
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
