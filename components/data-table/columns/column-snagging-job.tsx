"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Building2 } from "lucide-react";

import {
  SeverityCounts,
  TaskStatusBadge,
  timeAgo,
} from "@/components/dashboard/snagging/shared";
import type { SnaggingTaskSummary } from "@/types/types";

/**
 * Columns for the snagging jobs table.
 *
 * Kept beside the other table column sets rather than inside the
 * snagging folder so the jobs list is built the same way as users,
 * roles and permissions — one ColumnDef array handed to the shared
 * DataTable, which owns sorting, pagination and the empty slot.
 *
 * `sortKey` values are the column ids the API accepts, because sorting
 * is resolved on the server; a column the API cannot order by leaves
 * `enableSorting` off rather than silently doing nothing.
 */
export function getSnaggingJobColumns(): ColumnDef<SnaggingTaskSummary>[] {
  return [
    /*
      No Code column.

      The generated job code (ALMUNI23-BHQT) is an internal handle, and the
      one thing it carried that a reader needs — whether a row is a de-snag
      round or an additional visit — the Round column already states as R2
      or V2. Nothing else is lost by dropping it: the row itself opens the
      job, so the code was not the only way in, and the list sorts by
      creation date rather than by code.
    */
    {
      id: "unit_label",
      header: "Unit",
      accessorKey: "unit_label",
      cell: ({ row }) => {
        const task = row.original;
        return (
          <div className="min-w-40">
            <div className="flex items-center gap-2 font-medium">
              {task.task_type === "full_building" ? (
                <Building2 className="text-muted-foreground size-4" aria-hidden />
              ) : null}
              {task.unit_label}
            </div>
            <div className="text-muted-foreground text-xs">
              {[task.building_name, task.client_name].filter(Boolean).join(" · ") || "—"}
            </div>
          </div>
        );
      },
      enableSorting: false,
    },
    {
      id: "inspector_name",
      header: "Inspector",
      accessorKey: "inspector_name",
      cell: ({ row }) => (
        <span className="text-sm">{row.original.inspector_name ?? "—"}</span>
      ),
      enableSorting: false,
    },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      cell: ({ row }) => <TaskStatusBadge status={row.original.status} />,
      enableSorting: true,
    },
    {
      id: "round",
      header: "Round",
      cell: ({ row }) => {
        const task = row.original;
        return (
          <span className="text-sm tabular-nums">
            {task.visit_type === "additional" ? "V" : "R"}
            {task.round_number}
          </span>
        );
      },
      enableSorting: false,
    },
    {
      id: "severity",
      // Severity is never carried by colour alone: the header names the
      // order the three numbers are read in.
      header: () => <span title="High / medium / low">H / M / L</span>,
      cell: ({ row }) => (
        <SeverityCounts
          high={row.original.high_severity_count}
          medium={row.original.medium_severity_count ?? 0}
          low={row.original.low_severity_count ?? 0}
        />
      ),
      enableSorting: false,
    },
    {
      id: "updated_at",
      header: "Updated",
      accessorKey: "updated_at",
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm whitespace-nowrap">
          {timeAgo(row.original.updated_at)}
        </span>
      ),
      enableSorting: true,
    },
  ];
}
