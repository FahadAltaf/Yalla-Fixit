"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Building2, Clock, UserRound } from "lucide-react";

import { WorkOrderQueueBadge, aed, daysSince } from "@/components/dashboard/finance/shared";
import { IconText } from "@/components/data-table/columns/icon-text";
import { IdentityCell } from "@/components/ui/entity-avatar";
import type { WorkOrderListRow } from "@/lib/server/finance/work-orders";

/**
 * Columns for Ready to invoice, one row per FSM work order (read live):
 * the queue's columns (quotation and work order, client, value, how much
 * is invoiced, status, days in status, assignee), built like every other
 * table here (column-user.tsx). Sorting is fixed (newest first).
 */
export function getWorkOrderQueueColumns(agedAfterDays: number): ColumnDef<WorkOrderListRow>[] {
  return [
    {
      id: "item",
      header: "Quotation / work order",
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="min-w-48">
            <IdentityCell
              title={r.quotationNumber ? `Quotation ${r.quotationNumber}` : (r.number ?? r.id)}
              subtitle={[r.quotationNumber ? r.number : null, r.type, r.fsmStatus].filter(Boolean).join(" · ")}
              icon={Building2}
            />
          </div>
        );
      },
      enableSorting: false,
    },
    {
      id: "client",
      header: "Client",
      cell: ({ row }) => (
        <div className="min-w-36">
          <p className="text-sm">{row.original.clientName ?? "—"}</p>
          {row.original.coordinatorName ? <p className="text-muted-foreground text-xs">{row.original.coordinatorName}</p> : null}
        </div>
      ),
      enableSorting: false,
    },
    {
      id: "value",
      header: "Value",
      cell: ({ row }) => {
        const r = row.original;
        const ready = r.invoicing.readyValue;
        return (
          <div className="text-sm font-medium tabular-nums">
            {aed(r.value)}
            <div className="text-muted-foreground text-xs font-normal">
              {ready > 0 ? `${aed(ready)} ready` : r.invoicing.readyLines ? "ready lines invoiced" : "before VAT"}
            </div>
          </div>
        );
      },
      enableSorting: false,
    },
    {
      id: "completion",
      header: "Invoiced",
      cell: ({ row }) => {
        const r = row.original;
        const pct = r.value && r.value > 0 ? Math.min(100, (r.invoicing.invoicedValue / r.value) * 100) : null;
        return <div className="text-sm tabular-nums">{pct === null ? "—" : `${pct.toFixed(1)}%`}</div>;
      },
      enableSorting: false,
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => <WorkOrderQueueBadge status={row.original.queueStatus} />,
      enableSorting: false,
    },
    {
      id: "days",
      header: "Days in status",
      cell: ({ row }) => {
        const since = row.original.statusSince;
        if (!since) return <span className="text-muted-foreground text-sm">—</span>;
        const days = daysSince(since);
        const aged = row.original.queueStatus === "pending" && days >= agedAfterDays;
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
