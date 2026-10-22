"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Building2, CalendarDays, ListChecks } from "lucide-react";

import { InvoiceStatusBadge, WorkOrderStatusBadge, aed } from "@/components/dashboard/finance/shared";
import { IconText } from "@/components/data-table/columns/icon-text";
import { IdentityCell } from "@/components/ui/entity-avatar";
import type { WorkOrderListRow } from "@/lib/server/finance/work-orders";
import { formatZonedDate } from "@/lib/scheduling/org-time";

/**
 * Columns for Invoicing → Work orders: the work order and its quotation,
 * client, FSM status, when it was raised, its value and its line items
 * (read when the work order is first opened). Built like the queue table.
 */
export const FINANCE_WORK_ORDER_COLUMNS: ColumnDef<WorkOrderListRow>[] = [
  {
    id: "workOrder",
    header: "Work order / quotation",
    cell: ({ row }) => {
      const r = row.original;
      return (
        <div className="min-w-44">
          <IdentityCell
            title={r.number ?? r.id}
            subtitle={r.quotation?.number ? `Quotation ${r.quotation.number}` : "No quotation"}
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
        {row.original.type ? <p className="text-muted-foreground text-xs">{row.original.type}</p> : null}
      </div>
    ),
    enableSorting: false,
  },
  {
    id: "status",
    header: "FSM status",
    cell: ({ row }) => <WorkOrderStatusBadge status={row.original.status} />,
    enableSorting: false,
  },
  {
    id: "created",
    header: "Raised",
    cell: ({ row }) => (
      <IconText icon={CalendarDays} muted>
        {row.original.createdAt ? formatZonedDate(row.original.createdAt) : "—"}
      </IconText>
    ),
    enableSorting: false,
  },
  {
    id: "value",
    header: () => <div className="text-right">Value</div>,
    cell: ({ row }) => (
      <div className="text-right text-sm font-medium tabular-nums">
        {aed(row.original.value)}
        <div className="text-muted-foreground text-xs font-normal">before VAT</div>
      </div>
    ),
    enableSorting: false,
  },
  {
    id: "lines",
    header: "Line items",
    cell: ({ row }) => {
      const lines = row.original.lines;
      return lines ? (
        <IconText icon={ListChecks}>
          {lines.count} {lines.count === 1 ? "line" : "lines"} · {lines.completed} completed
        </IconText>
      ) : (
        <span className="text-muted-foreground text-sm">Read when opened</span>
      );
    },
    enableSorting: false,
  },
  {
    id: "invoicing",
    header: "Invoicing",
    cell: ({ row }) => {
      const inv = row.original.invoicing;
      if (!inv) return <span className="text-muted-foreground text-sm">—</span>;
      return (
        <div className="min-w-32">
          <InvoiceStatusBadge status={inv.status} />
          <p className="text-muted-foreground mt-1 text-xs tabular-nums">
            {inv.status === "ready"
              ? `${aed(inv.readyValue)} ready`
              : inv.invoicedValue > 0
                ? `${aed(inv.invoicedValue)} invoiced`
                : `${inv.lines} ${inv.lines === 1 ? "line" : "lines"}`}
          </p>
        </div>
      );
    },
    enableSorting: false,
  },
];
