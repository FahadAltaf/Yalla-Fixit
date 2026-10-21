"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { CalendarClock, CalendarDays, ClipboardList, Clock, FileText, UserRound, Wrench } from "lucide-react";

import { aed } from "@/components/dashboard/finance/shared";
import { FlagBadge, QuotationStatusBadge, plural } from "@/components/dashboard/reports/shared";
import { IconText } from "@/components/data-table/columns/icon-text";
import { IdentityCell } from "@/components/ui/entity-avatar";
import type { MissingActualsRow, UnflaggedRow } from "@/lib/reports/exceptions";
import type { QuotationRow } from "@/lib/reports/quotations";
import { formatZonedDate, formatZonedDateTime } from "@/lib/scheduling/org-time";

/**
 * Columns for the P5 reports, built like every other table here
 * (column-user.tsx): an identity column first, soft pills, numbers
 * right-aligned. Order is fixed on the server, so no header sorts.
 */

const dateOnly = (date: string | null) => (date ? formatZonedDate(`${date}T08:00:00Z`) : "—");

// ---------------------------------------------------------------------
// Quotation summary
// ---------------------------------------------------------------------

export const QUOTATION_COLUMNS: ColumnDef<QuotationRow>[] = [
  {
    id: "quotation",
    header: "Quotation",
    cell: ({ row }) => (
      <div className="min-w-48">
        <IdentityCell
          title={row.original.number ? `Quotation ${row.original.number}` : "Quotation"}
          subtitle={row.original.clientName ?? "No client"}
          icon={FileText}
        />
      </div>
    ),
    enableSorting: false,
  },
  {
    id: "owner",
    header: "Owner",
    cell: ({ row }) =>
      row.original.ownerName ? <IconText icon={UserRound}>{row.original.ownerName}</IconText> : <IconText icon={UserRound} muted>—</IconText>,
    enableSorting: false,
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => <QuotationStatusBadge statusKey={row.original.statusKey} label={row.original.statusLabel} />,
    enableSorting: false,
  },
  {
    id: "value",
    header: () => <div className="text-right">Value (before VAT)</div>,
    cell: ({ row }) => <div className="text-right text-sm font-medium tabular-nums">{aed(row.original.value)}</div>,
    enableSorting: false,
  },
  {
    id: "days",
    header: "Days in status",
    cell: ({ row }) => {
      const r = row.original;
      if (r.daysInStatus === null) return <span className="text-muted-foreground text-sm">—</span>;
      return (
        <div className="flex flex-col items-start gap-1">
          <IconText icon={Clock}>
            <span
              className={r.breached ? "text-destructive font-medium tabular-nums" : "tabular-nums"}
              title={r.statusSinceExact ? undefined : "Estimated: the status was already set when the portal first read this quotation"}
            >
              {r.statusSinceExact ? "" : "≈ "}
              {plural(r.daysInStatus, "day")}
            </span>
          </IconText>
          {r.breached ? <FlagBadge tone="danger">Over the {r.ageingLimit}-day limit</FlagBadge> : null}
        </div>
      );
    },
    enableSorting: false,
  },
  {
    id: "validity",
    header: "Valid until",
    cell: ({ row }) => {
      const r = row.original;
      if (!r.expiryDate) return <span className="text-muted-foreground text-sm">—</span>;
      return (
        <div className="flex flex-col items-start gap-1">
          <IconText icon={CalendarClock}>{dateOnly(r.expiryDate)}</IconText>
          {r.expiring ? (
            <FlagBadge>{r.daysToExpiry === 0 ? "Expires today" : `Expires in ${plural(r.daysToExpiry ?? 0, "day")}`}</FlagBadge>
          ) : r.pastValidity ? (
            <FlagBadge tone="muted">Validity ended, no answer</FlagBadge>
          ) : null}
        </div>
      );
    },
    enableSorting: false,
  },
  {
    id: "created",
    header: "Created",
    cell: ({ row }) => <IconText icon={CalendarDays}>{dateOnly(row.original.createdDate)}</IconText>,
    enableSorting: false,
  },
];

export const QUOTATION_EXPORT_COLUMNS = [
  { key: "number", label: "Quotation" },
  { key: "client", label: "Client" },
  { key: "owner", label: "Owner" },
  { key: "status", label: "Status" },
  { key: "value", label: "Value before VAT (AED)" },
  { key: "days", label: "Days in status" },
  { key: "daysEstimated", label: "Days estimated" },
  { key: "limit", label: "Limit (days)" },
  { key: "overLimit", label: "Over the limit" },
  { key: "validUntil", label: "Valid until" },
  { key: "expiry", label: "Expiry" },
  { key: "created", label: "Created" },
];

export function quotationExportRow(r: QuotationRow) {
  return {
    number: r.number,
    client: r.clientName,
    owner: r.ownerName,
    status: r.statusLabel,
    value: r.value,
    days: r.daysInStatus,
    daysEstimated: r.statusSinceExact ? "" : "Yes",
    limit: r.ageingLimit,
    overLimit: r.breached ? "Yes" : "",
    validUntil: r.expiryDate,
    expiry: r.expiring ? `In ${r.daysToExpiry} day(s)` : r.pastValidity ? "Validity ended" : "",
    created: r.createdDate,
  };
}

// ---------------------------------------------------------------------
// Exceptions: completed without the invoice flag
// ---------------------------------------------------------------------

export function getUnflaggedColumns(afterDays: number): ColumnDef<UnflaggedRow>[] {
  return [
    {
      id: "workOrder",
      header: "Work order",
      cell: ({ row }) => (
        <div className="min-w-44">
          <IdentityCell
            title={row.original.workOrderNumber ?? "Work order"}
            subtitle={row.original.quotationNumber ? `Quotation ${row.original.quotationNumber}` : null}
            icon={ClipboardList}
          />
        </div>
      ),
      enableSorting: false,
    },
    {
      id: "client",
      header: "Client",
      cell: ({ row }) => <span className="text-sm">{row.original.clientName ?? "—"}</span>,
      enableSorting: false,
    },
    {
      id: "coordinator",
      header: "Coordinator",
      cell: ({ row }) =>
        row.original.coordinatorName ? (
          <IconText icon={UserRound}>{row.original.coordinatorName}</IconText>
        ) : (
          <IconText icon={UserRound} muted>
            —
          </IconText>
        ),
      enableSorting: false,
    },
    {
      id: "value",
      header: () => <div className="text-right">Value (before VAT)</div>,
      cell: ({ row }) => <div className="text-right text-sm font-medium tabular-nums">{aed(row.original.value)}</div>,
      enableSorting: false,
    },
    {
      id: "completed",
      header: "Completed",
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex flex-col items-start gap-1">
            <IconText icon={CalendarDays}>{dateOnly(r.completedDate)}</IconText>
            {r.daysSinceCompleted === null ? null : r.overdue ? (
              <FlagBadge tone="danger">{plural(r.daysSinceCompleted, "day")} ago, over {afterDays}</FlagBadge>
            ) : (
              <span className="text-muted-foreground text-xs">{plural(r.daysSinceCompleted, "day")} ago</span>
            )}
          </div>
        );
      },
      enableSorting: false,
    },
  ];
}

export const UNFLAGGED_EXPORT_COLUMNS = [
  { key: "workOrder", label: "Work order" },
  { key: "quotation", label: "Quotation" },
  { key: "client", label: "Client" },
  { key: "coordinator", label: "Coordinator" },
  { key: "value", label: "Value before VAT (AED)" },
  { key: "completed", label: "Completed" },
  { key: "days", label: "Days since completed" },
  { key: "overdue", label: "Overdue" },
];

export function unflaggedExportRow(r: UnflaggedRow) {
  return {
    workOrder: r.workOrderNumber,
    quotation: r.quotationNumber,
    client: r.clientName,
    coordinator: r.coordinatorName,
    value: r.value,
    completed: r.completedDate,
    days: r.daysSinceCompleted,
    overdue: r.overdue ? "Yes" : "",
  };
}

// ---------------------------------------------------------------------
// Exceptions: completed appointments without actual times
// ---------------------------------------------------------------------

const MISSING_LABEL = { start: "No actual start", end: "No actual end", both: "No actual times" } as const;

export const MISSING_ACTUALS_COLUMNS: ColumnDef<MissingActualsRow>[] = [
  {
    id: "appointment",
    header: "Appointment",
    cell: ({ row }) => (
      <div className="min-w-44">
        <IdentityCell
          title={row.original.number ?? "Appointment"}
          subtitle={[row.original.workOrderNumber, row.original.clientName].filter(Boolean).join(" · ") || null}
          icon={Wrench}
        />
      </div>
    ),
    enableSorting: false,
  },
  {
    id: "crew",
    header: "Technicians",
    cell: ({ row }) =>
      row.original.technicianNames.length ? (
        <span className="text-sm">{row.original.technicianNames.join(", ")}</span>
      ) : (
        <span className="text-muted-foreground text-sm">—</span>
      ),
    enableSorting: false,
  },
  {
    id: "scheduled",
    header: "Scheduled",
    cell: ({ row }) =>
      row.original.scheduledStart ? (
        <IconText icon={CalendarDays}>{formatZonedDateTime(row.original.scheduledStart)}</IconText>
      ) : (
        <span className="text-muted-foreground text-sm">—</span>
      ),
    enableSorting: false,
  },
  {
    id: "missing",
    header: "Missing",
    cell: ({ row }) => <FlagBadge tone={row.original.missing === "both" ? "danger" : "warning"}>{MISSING_LABEL[row.original.missing]}</FlagBadge>,
    enableSorting: false,
  },
];

export const MISSING_ACTUALS_EXPORT_COLUMNS = [
  { key: "appointment", label: "Appointment" },
  { key: "workOrder", label: "Work order" },
  { key: "client", label: "Client" },
  { key: "technicians", label: "Technicians" },
  { key: "scheduled", label: "Scheduled date" },
  { key: "missing", label: "Missing" },
];

export function missingActualsExportRow(r: MissingActualsRow) {
  return {
    appointment: r.number,
    workOrder: r.workOrderNumber,
    client: r.clientName,
    technicians: r.technicianNames.join(", "),
    scheduled: r.scheduledDate,
    missing: MISSING_LABEL[r.missing],
  };
}
