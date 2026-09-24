"use client";

import { ColumnDef } from "@tanstack/react-table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Clock, UserRound } from "lucide-react";

import { IconText } from "@/components/data-table/columns/icon-text";
import { IdentityCell } from "@/components/ui/entity-avatar";
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
      /*
        Client & property, the same column the Quotations table leads
        with: who the job is for, and the unit and building under it.
      */
      id: "unit_label",
      header: "Client & property",
      accessorKey: "unit_label",
      cell: ({ row }) => {
        const task = row.original;
        const place = [task.unit_label, task.building_name].filter(Boolean).join(", ");
        return (
          <div className="min-w-48">
            <IdentityCell
              title={task.client_name || "—"}
              subtitle={place || "No property recorded"}
              icon={UserRound}
            />
          </div>
        );
      },
      enableSorting: false,
    },
    {
      id: "inspector_name",
      header: "Inspector",
      accessorKey: "inspector_name",
      cell: ({ row }) => {
        /*
          One name and a count, with the rest on hover.

          The column is narrow and a job rarely has more than two or three
          people on it, so the first name plus "+2" keeps every row the
          same height and still says that there are others. The tooltip is
          the real answer: all of them, one per line.
        */
        const names = row.original.inspector_names ?? [];
        if (names.length === 0) {
          return (
            <IconText icon={UserRound} muted>
              Unassigned
            </IconText>
          );
        }
        const extra = names.length - 1;
        const cell = (
          <IconText icon={UserRound}>
            <span className="truncate">{names[0]}</span>
            {extra > 0 ? (
              <span className="text-muted-foreground shrink-0"> +{extra}</span>
            ) : null}
          </IconText>
        );
        // No tooltip when there is nothing it could add.
        if (extra === 0) return cell;
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block min-w-0 cursor-default">{cell}</span>
            </TooltipTrigger>
            <TooltipContent>
              {names.map((name) => (
                <p key={name}>{name}</p>
              ))}
            </TooltipContent>
          </Tooltip>
        );
      },
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
        <IconText icon={Clock} muted>
          {timeAgo(row.original.updated_at)}
        </IconText>
      ),
      enableSorting: true,
    },
  ];
}
