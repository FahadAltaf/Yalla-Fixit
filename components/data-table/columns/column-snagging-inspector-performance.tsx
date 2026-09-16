"use client";

import Link from "next/link";
import { ColumnDef } from "@tanstack/react-table";

type Row = {
  id: string;
  name: string;
  assigned: number;
  inProgress: number;
  completed: number;
};

/**
 * Inspector | Assigned | In progress | Completed.
 *
 * Numbers right-aligned, as every numeric column in the app is, so a
 * reader can compare down a column instead of across ragged text. The
 * API has already ordered the rows, so sorting stays off — re-sorting
 * one page against a total that spans several is a leaderboard that
 * lies.
 *
 * Every figure opens the jobs it counts, filtered to that inspector and
 * that status (FR-10.01). A zero is left as plain text: a link to an
 * empty list is a promise the list cannot keep.
 */
const STATUS_PARAM: Record<string, string> = {
  assigned: "assigned",
  inProgress: "in_progress",
  completed: "approved",
};

export function getSnaggingInspectorPerformanceColumns(): ColumnDef<Row>[] {
  const numeric = (id: keyof Row, header: string): ColumnDef<Row> => ({
    id,
    header: () => <span className="block text-right">{header}</span>,
    accessorKey: id,
    cell: ({ row }) => {
      const value = row.original[id] as number;
      if (!value) {
        return <div className="text-muted-foreground text-right tabular-nums">0</div>;
      }
      return (
        <div className="text-right tabular-nums">
          <Link
            href={`/snagging/jobs?status=${STATUS_PARAM[id as string]}&assignee=${row.original.id}`}
            className="hover:text-brand underline-offset-4 hover:underline"
          >
            {value}
          </Link>
        </div>
      );
    },
    enableSorting: false,
  });

  return [
    {
      id: "name",
      header: "Inspector",
      accessorKey: "name",
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      enableSorting: false,
    },
    numeric("assigned", "Assigned"),
    numeric("inProgress", "In progress"),
    numeric("completed", "Completed"),
  ];
}
