"use client";

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
 */
export function getSnaggingInspectorPerformanceColumns(): ColumnDef<Row>[] {
  const numeric = (id: keyof Row, header: string): ColumnDef<Row> => ({
    id,
    header: () => <span className="block text-right">{header}</span>,
    accessorKey: id,
    cell: ({ row }) => <div className="text-right tabular-nums">{row.original[id]}</div>,
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
