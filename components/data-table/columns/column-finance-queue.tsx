"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Building2, Clock, UserRound } from "lucide-react";

import { IconText } from "@/components/data-table/columns/icon-text";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { QueueStatusBadge, TestItemBadge, aed, daysSince, itemCode } from "@/components/dashboard/finance/shared";
import type { QueueRow } from "@/lib/server/finance/queue-read";

/**
 * Columns for the Ready-to-Invoice queue (BRD §6.4): quotation, work order,
 * client, value, completion %, status, days in status, assignee. Built like
 * every other table here (column-user.tsx): an identity column first, soft
 * status pill, numbers right-aligned. Sorting is fixed on the server
 * (newest first), so no header offers it.
 */
export function getFinanceQueueColumns(agedAfterDays: number): ColumnDef<QueueRow>[] {
  return [
    {
      id: "item",
      header: "Quotation / work order",
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="min-w-48">
            <IdentityCell
              title={r.quotationNumber ? `Quotation ${r.quotationNumber}` : (r.workOrderNumber ?? itemCode(r.number))}
              subtitle={[itemCode(r.number), r.quotationNumber ? r.workOrderNumber : null].filter(Boolean).join(" · ")}
              icon={Building2}
              badge={r.isTest ? <TestItemBadge /> : undefined}
            />
          </div>
        );
      },
      enableSorting: false,
    },
    {
      id: "client",
      header: "Client",
      cell: ({ row }) => <span className="text-sm">{row.original.clientName ?? "—"}</span>,
      enableSorting: false,
    },
    {
      id: "value",
      header: () => <div className="text-right">Value</div>,
      cell: ({ row }) => (
        <div className="text-right text-sm font-medium tabular-nums">
          {aed(row.original.value)}
          <div className="text-muted-foreground text-xs font-normal">
            {row.original.lineCount} line{row.original.lineCount === 1 ? "" : "s"}
          </div>
        </div>
      ),
      enableSorting: false,
    },
    {
      id: "completion",
      header: () => <div className="text-right">Completion</div>,
      cell: ({ row }) => (
        <div className="text-right text-sm tabular-nums">
          {row.original.completionPercent === null ? "—" : `${row.original.completionPercent.toFixed(1)}%`}
        </div>
      ),
      enableSorting: false,
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => <QueueStatusBadge status={row.original.status} />,
      enableSorting: false,
    },
    {
      id: "days",
      header: "Days in status",
      cell: ({ row }) => {
        const days = daysSince(row.original.statusChangedAt);
        const aged = row.original.status === "pending" && days > agedAfterDays;
        return (
          <IconText icon={Clock}>
            <span className={aged ? "text-warning font-medium tabular-nums" : "tabular-nums"}>
              {days} day{days === 1 ? "" : "s"}
              {aged ? " · aged" : ""}
            </span>
          </IconText>
        );
      },
      enableSorting: false,
    },
    {
      id: "assignee",
      header: "Assignee",
      cell: ({ row }) =>
        row.original.assigneeName ? (
          <IconText icon={UserRound}>{row.original.assigneeName}</IconText>
        ) : (
          <span className="text-muted-foreground text-sm">Unassigned</span>
        ),
      enableSorting: false,
    },
  ];
}
