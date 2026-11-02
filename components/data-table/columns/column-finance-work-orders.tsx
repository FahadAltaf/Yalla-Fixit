"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Building2, CalendarDays, Clock } from "lucide-react";

import { WorkOrderQueueBadge, aed, daysSince } from "@/components/dashboard/finance/shared";
import { IconText } from "@/components/data-table/columns/icon-text";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { viewerDate, viewerDateTime } from "@/lib/reports/viewer-time";
import type { WorkOrderListRow } from "@/lib/server/finance/work-orders";

/**
 * Columns for Ready to invoice, one row per FSM work order (read live):
 * quotation and work order, client (the contact first, then the company),
 * value before and with VAT, when it was created in FSM (30 Oct), how much
 * is invoiced, status and days in it,
 * built like every other table here (column-user.tsx). Sorting is fixed
 * (newest first).
 */
export function getWorkOrderQueueColumns(agedAfterDays: number, operations = false): ColumnDef<WorkOrderListRow>[] {
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
      cell: ({ row }) => {
        const r = row.original;
        const name = r.contactName ?? r.clientName;
        return (
          <div className="min-w-36">
            <p className="text-sm font-medium">{name ?? "—"}</p>
            {r.contactName && r.clientName ? <p className="text-muted-foreground text-xs">{r.clientName}</p> : null}
          </div>
        );
      },
      enableSorting: false,
    },
    {
      id: "created",
      header: "Created",
      cell: ({ row }) => {
        const at = row.original.createdAt;
        if (!at) return <span className="text-muted-foreground text-sm">—</span>;
        return (
          <span title={`Created in Zoho FSM ${viewerDateTime(at)}`}>
            <IconText icon={CalendarDays} muted>
              <span className="whitespace-nowrap tabular-nums">{viewerDate(at)}</span>
            </IconText>
          </span>
        );
      },
      enableSorting: false,
    },
    {
      id: "value",
      header: "Value",
      cell: ({ row }) => {
        const r = row.original;
        /* With VAT, at the work order's own rate (FSM's Grand_Total over Sub_Total). */
        const rate = r.value && r.valueWithVat !== null && r.value > 0 ? r.valueWithVat / r.value : 1;
        const toInvoice = Math.round(r.invoicing.readyValue * rate * 100) / 100;
        return (
          <div className="text-sm font-medium tabular-nums">
            {aed(r.valueWithVat ?? r.value)}
            <div className="text-muted-foreground text-xs font-normal">incl. VAT</div>
            {toInvoice > 0 ? <div className="text-warning text-xs font-normal">{aed(toInvoice)} to invoice</div> : null}
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
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex flex-col items-start gap-1">
            <WorkOrderQueueBadge status={r.queueStatus} />
            {r.needsCompleting ? <span className="text-warning text-xs">Appointments done · mark Completed in FSM</span> : null}
            {/* 30 Oct: Operations' completion (Complete once confirmed; Partially complete while lines have a % and it is not). */}
            {r.operationsCompletion === "complete" ? (
              <span className="text-success text-xs">Complete (Operations)</span>
            ) : r.operationsCompletion === "partial" ? (
              <span className="text-warning text-xs" title="Operations has marked lines done, and has not yet confirmed the work order complete">Partially complete (Operations)</span>
            ) : null}
            {operations && r.fsmStatus === "Completed" && r.flagged === false ? (
              <span className="text-muted-foreground text-xs">Quotation not flagged To Be Invoiced</span>
            ) : null}
          </div>
        );
      },
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
  ];
}
