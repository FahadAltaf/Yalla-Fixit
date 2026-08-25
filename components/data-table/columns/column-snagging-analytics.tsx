"use client";

import { ColumnDef } from "@tanstack/react-table";

import type { SnaggingAnalytics } from "@/types/types";

type SnaggingDeveloperRow = SnaggingAnalytics["byDeveloper"][number];
type SnaggingInspectorRow = SnaggingAnalytics["byInspector"][number];

/**
 * Columns for the two analytics breakdowns.
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
      cell: ({ row }) => (
        <div className="font-medium">
          {row.original.developer_name}
          {row.original.building_name ? (
            <span className="text-muted-foreground block text-xs font-normal">
              {row.original.building_name}
            </span>
          ) : null}
        </div>
      ),
      enableSorting: false,
    },
    {
      id: "unit_count",
      header: () => <span className="block text-right">Units</span>,
      accessorKey: "unit_count",
      cell: ({ row }) => (
        <div className="text-right tabular-nums">{row.original.unit_count}</div>
      ),
      enableSorting: false,
    },
    {
      id: "snag_count",
      header: () => <span className="block text-right">Snags</span>,
      accessorKey: "snag_count",
      cell: ({ row }) => (
        <div className="text-right tabular-nums">{row.original.snag_count}</div>
      ),
      enableSorting: false,
    },
    {
      id: "snags_per_unit",
      header: () => <span className="block text-right">Per unit</span>,
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
      header: () => <span className="block text-right">Outstanding</span>,
      accessorKey: "outstanding_count",
      cell: ({ row }) => (
        <div className="text-right tabular-nums">{row.original.outstanding_count}</div>
      ),
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
      id: "task_count",
      header: () => <span className="block text-right">Inspections</span>,
      accessorKey: "task_count",
      cell: ({ row }) => (
        <div className="text-right tabular-nums">{row.original.task_count}</div>
      ),
      enableSorting: false,
    },
    {
      id: "snag_count",
      header: () => <span className="block text-right">Snags captured</span>,
      accessorKey: "snag_count",
      cell: ({ row }) => (
        <div className="text-right tabular-nums">{row.original.snag_count}</div>
      ),
      enableSorting: false,
    },
  ];
}
