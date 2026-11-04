"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Building2, CalendarDays, Star, UserRound, Users, Wrench } from "lucide-react";

import { aed } from "@/components/dashboard/finance/shared";
import { FlagBadge } from "@/components/dashboard/reports/shared";
import { Explained, helpHeader, hrs, type Help } from "@/components/data-table/columns/column-utilization";
import { IconText } from "@/components/data-table/columns/icon-text";
import { Badge } from "@/components/ui/badge";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { TruncatedText } from "@/components/ui/truncated-text";
import type { RevenueClientRow, RevenueMonthRow, RevenueTechnicianRow, RevenueWorkOrderRow } from "@/lib/reports/revenue";
import { formatZonedDate } from "@/lib/scheduling/org-time";

/**
 * Columns for the revenue report (DEV-454), built like the other reports'
 * (column-utilization.tsx): identity first, numbers as they read, hover a
 * header for what it counts and a value for its sum. Order is fixed on the
 * server (largest revenue first; months oldest first).
 */

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v}%`);
const dateOnly = (date: string) => formatZonedDate(`${date}T08:00:00Z`);
const num = (children: React.ReactNode, strong = false) => (
  <div className={strong ? "text-sm font-medium tabular-nums" : "text-sm tabular-nums"}>{children}</div>
);

export const REVENUE_HELP: Record<string, Help> = {
  revenue: {
    title: "Revenue",
    lines: [
      "The value of the work orders completed in Zoho FSM in the dates, before VAT, on the day FSM completed them.",
      "A work order with no value of its own counts its quotation's; with neither, it counts 0.",
    ],
  },
  technicianRevenue: {
    title: "Revenue (their share)",
    lines: [
      "Each work order's revenue is split between the technicians who worked on it, by their hours on it: their own FSM time sheet, else the appointment's actual times.",
      "With no hours recorded for anyone on it, the crew share it equally. Hover a value for the work orders behind it.",
      "Shares add up to the company's revenue; work orders with nobody from the technician list on them (none in FSM, or only test and office accounts) sit under Not on the technician list.",
    ],
  },
  share: { title: "Share of revenue", lines: ["This row's revenue ÷ all revenue in the dates (the filters narrow what is listed, not the whole)."] },
  amc: {
    title: "AMC and one-time",
    lines: ["AMC: the work order's Work Type is AMC PPM, or it carries an AMC contract reference (29 Oct). Everything else is one-time work."],
  },
  invoiced: {
    title: "Invoiced",
    lines: [
      "MAHER invoices recorded in Ready to invoice against these work orders, before VAT, whenever they were recorded.",
      "Invoices raised outside the portal are not known here.",
    ],
  },
  rating: {
    title: "Customer rating",
    lines: [
      "The stars the customer gave on FSM service reports made in the dates, 1 to 5, averaged; the count beside it is how many ratings.",
      "FSM records 0 when the customer gave none: those are left out. A rating counts for every technician on its appointment.",
    ],
  },
  hours: { title: "Hours on the work", lines: ["Their hours on the work orders credited here: own time sheet, else the appointment's actual times."] },
  workOrders: { title: "Work orders", lines: ["Work orders completed in the dates that this row's revenue comes from."] },
};

function RatingCell({ average, count }: { average: number | null; count: number }) {
  if (average === null) return <span className="text-muted-foreground text-sm">—</span>;
  return (
    <Explained help={{ title: `${average} of 5`, lines: [`Average of ${count} customer ${count === 1 ? "rating" : "ratings"} in the dates.`] }}>
      <span className="inline-flex items-center gap-1 text-sm tabular-nums">
        <Star className="text-warning size-3.5 fill-current" aria-hidden />
        {average}
        <span className="text-muted-foreground"> · {count}</span>
      </span>
    </Explained>
  );
}

function InvoicedCell({ invoiced, revenue }: { invoiced: number; revenue: number }) {
  if (!invoiced) return <span className="text-muted-foreground text-sm">—</span>;
  const share = revenue > 0 ? Math.round((invoiced / revenue) * 1000) / 10 : null;
  return (
    <Explained help={{ title: `${aed(invoiced)} invoiced`, lines: [`${aed(invoiced)} ÷ ${aed(revenue)} revenue = ${pct(share)}.`] }}>
      {num(
        <>
          {aed(invoiced)}
          <span className="text-muted-foreground"> · {pct(share)}</span>
        </>,
      )}
    </Explained>
  );
}

function MixCell({ amc, oneTime }: { amc: number; oneTime: number }) {
  const total = amc + oneTime;
  if (!total) return <span className="text-muted-foreground text-sm">—</span>;
  const amcShare = Math.round((amc / total) * 1000) / 10;
  return (
    <Explained help={{ title: `AMC ${pct(amcShare)}`, lines: [`AMC ${aed(amc)}`, `One-time ${aed(oneTime)}`] }}>
      {num(pct(amcShare))}
    </Explained>
  );
}

const revenueColumn = <T extends { revenue: number }>(): ColumnDef<T> => ({
  id: "revenue",
  header: helpHeader("Revenue", REVENUE_HELP.revenue),
  cell: ({ row }) => num(aed(row.original.revenue), true),
  enableSorting: false,
});

const shareColumn = <T extends { sharePercent: number | null }>(): ColumnDef<T> => ({
  id: "share",
  header: helpHeader("Share", REVENUE_HELP.share),
  cell: ({ row }) => num(pct(row.original.sharePercent)),
  enableSorting: false,
});

const mixColumn = <T extends { amc: number; oneTime: number }>(): ColumnDef<T> => ({
  id: "mix",
  header: helpHeader("AMC share", REVENUE_HELP.amc),
  cell: ({ row }) => <MixCell amc={row.original.amc} oneTime={row.original.oneTime} />,
  enableSorting: false,
});

const invoicedColumn = <T extends { invoiced: number; revenue: number }>(): ColumnDef<T> => ({
  id: "invoiced",
  header: helpHeader("Invoiced", REVENUE_HELP.invoiced),
  cell: ({ row }) => <InvoicedCell invoiced={row.original.invoiced} revenue={row.original.revenue} />,
  enableSorting: false,
});

const ratingColumn = <T extends { averageRating: number | null; ratings: number }>(): ColumnDef<T> => ({
  id: "rating",
  header: helpHeader("Rating", REVENUE_HELP.rating),
  cell: ({ row }) => <RatingCell average={row.original.averageRating} count={row.original.ratings} />,
  enableSorting: false,
});

const workOrdersColumn = <T extends { workOrders: number }>(): ColumnDef<T> => ({
  id: "workOrders",
  header: helpHeader("Work orders", REVENUE_HELP.workOrders),
  cell: ({ row }) => num(row.original.workOrders),
  enableSorting: false,
});

export const REVENUE_CLIENT_COLUMNS: ColumnDef<RevenueClientRow>[] = [
  {
    id: "client",
    header: "Client",
    cell: ({ row }) => (
      <div className="max-w-72 min-w-44">
        <IdentityCell title={row.original.name} icon={Building2} />
      </div>
    ),
    enableSorting: false,
  },
  workOrdersColumn(),
  revenueColumn(),
  shareColumn(),
  mixColumn(),
  invoicedColumn(),
  ratingColumn(),
];

export const REVENUE_TECHNICIAN_COLUMNS: ColumnDef<RevenueTechnicianRow>[] = [
  {
    id: "technician",
    header: "Technician",
    cell: ({ row }) => (
      <div className="min-w-44">
        <IdentityCell title={row.original.name} subtitle={row.original.teamName} icon={row.original.key === "none" ? Wrench : UserRound} />
      </div>
    ),
    enableSorting: false,
  },
  workOrdersColumn(),
  {
    id: "hours",
    header: helpHeader("Hours", REVENUE_HELP.hours),
    cell: ({ row }) => num(row.original.minutes ? hrs(row.original.minutes) : "—"),
    enableSorting: false,
  },
  {
    id: "revenue",
    header: helpHeader("Revenue", REVENUE_HELP.technicianRevenue),
    cell: ({ row }) => {
      const r = row.original;
      if (r.key === "none") {
        return (
          <Explained
            help={{
              title: `${aed(r.revenue)} not credited`,
              lines: [`${r.workOrders} work ${r.workOrders === 1 ? "order has" : "orders have"} nobody from the technician list on ${r.workOrders === 1 ? "it" : "them"} in FSM: no one at all, or only test and office accounts.`],
            }}
          >
            {num(aed(r.revenue), true)}
          </Explained>
        );
      }
      return (
        <Explained
          help={{
            title: `${aed(r.revenue)}, their share`,
            lines: [
              `Their share of ${r.workOrders} work ${r.workOrders === 1 ? "order" : "orders"}, by their ${hrs(r.minutes)} on them against the crew's.`,
              r.equalSplits ? `${r.equalSplits} of them had no hours recorded for anyone, so the crew shared ${r.equalSplits === 1 ? "it" : "them"} equally.` : "",
            ].filter(Boolean),
          }}
        >
          {r.equalSplits ? (
            <span className="inline-flex items-center gap-1.5">
              {num(aed(r.revenue), true)}
              <FlagBadge tone="muted">{r.equalSplits} equal</FlagBadge>
            </span>
          ) : (
            num(aed(r.revenue), true)
          )}
        </Explained>
      );
    },
    enableSorting: false,
  },
  shareColumn(),
  mixColumn(),
  invoicedColumn(),
  ratingColumn(),
];

export const REVENUE_MONTH_COLUMNS: ColumnDef<RevenueMonthRow>[] = [
  {
    id: "month",
    header: "Month",
    cell: ({ row }) => <IconText icon={CalendarDays}>{row.original.label}</IconText>,
    enableSorting: false,
  },
  workOrdersColumn(),
  revenueColumn(),
  mixColumn(),
  invoicedColumn(),
  ratingColumn(),
];

const BASIS_WORDS: Record<RevenueWorkOrderRow["basis"], string> = {
  hours: "split by hours worked",
  equal: "no hours recorded: split equally",
  unassigned: "nobody from the technician list on it: not credited",
};

export const REVENUE_WORK_ORDER_COLUMNS: ColumnDef<RevenueWorkOrderRow>[] = [
  {
    id: "workOrder",
    header: "Work order",
    cell: ({ row }) => (
      <div className="max-w-64 min-w-44">
        <IdentityCell title={row.original.number ?? row.original.id} subtitle={row.original.clientName ?? "No client"} icon={Building2} />
      </div>
    ),
    enableSorting: false,
  },
  {
    id: "completed",
    header: "Completed",
    cell: ({ row }) => <IconText icon={CalendarDays}>{dateOnly(row.original.completedDate)}</IconText>,
    enableSorting: false,
  },
  {
    id: "value",
    header: helpHeader("Revenue", REVENUE_HELP.revenue),
    cell: ({ row }) => {
      const r = row.original;
      if (r.valueSource === "none") return <FlagBadge tone="muted">No value in FSM</FlagBadge>;
      return (
        <Explained help={{ title: aed(r.value), lines: [r.valueSource === "quotation" ? "The work order has no value of its own: its quotation's, before VAT." : "The work order's total before VAT."] }}>
          {num(aed(r.value), true)}
        </Explained>
      );
    },
    enableSorting: false,
  },
  {
    id: "kind",
    header: helpHeader("Kind", REVENUE_HELP.amc),
    cell: ({ row }) => (
      <Badge variant="secondary" className="border-0 font-medium">
        {row.original.amc ? "AMC" : "One-time"}
      </Badge>
    ),
    enableSorting: false,
  },
  {
    id: "technicians",
    header: helpHeader("Technicians", REVENUE_HELP.technicianRevenue),
    cell: ({ row }) => {
      const r = row.original;
      if (!r.shares.length) return <span className="text-muted-foreground text-sm">Not on the technician list</span>;
      const first = r.shares[0];
      return (
        <Explained
          help={{
            title: BASIS_WORDS[r.basis],
            lines: r.shares.map((s) => `${s.name}: ${aed(s.amount)} (${s.percent}%${r.basis === "hours" ? `, ${hrs(s.minutes)}` : ""})`),
          }}
        >
          <IconText icon={r.shares.length > 1 ? Users : UserRound}>
            <TruncatedText text={first.name} className="max-w-36" />
            {r.shares.length > 1 ? <span className="text-muted-foreground shrink-0"> +{r.shares.length - 1}</span> : null}
          </IconText>
        </Explained>
      );
    },
    enableSorting: false,
  },
  {
    id: "invoiced",
    header: helpHeader("Invoiced", REVENUE_HELP.invoiced),
    cell: ({ row }) => <InvoicedCell invoiced={row.original.invoiced} revenue={row.original.value} />,
    enableSorting: false,
  },
  ratingColumn(),
];

// ---------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------

export const REVENUE_EXPORT_COLUMNS = {
  clients: [
    { key: "name", label: "Client" },
    { key: "workOrders", label: "Work orders" },
    { key: "revenue", label: "Revenue (AED, before VAT)" },
    { key: "share", label: "Share %" },
    { key: "amc", label: "AMC (AED)" },
    { key: "oneTime", label: "One-time (AED)" },
    { key: "invoiced", label: "Invoiced (AED)" },
    { key: "rating", label: "Average rating" },
    { key: "ratings", label: "Ratings" },
  ],
  technicians: [
    { key: "name", label: "Technician" },
    { key: "team", label: "Team" },
    { key: "workOrders", label: "Work orders" },
    { key: "hours", label: "Hours" },
    { key: "revenue", label: "Revenue share (AED, before VAT)" },
    { key: "share", label: "Share %" },
    { key: "equalSplits", label: "Split equally (no hours)" },
    { key: "amc", label: "AMC (AED)" },
    { key: "oneTime", label: "One-time (AED)" },
    { key: "invoiced", label: "Invoiced (AED)" },
    { key: "rating", label: "Average rating" },
    { key: "ratings", label: "Ratings" },
  ],
  months: [
    { key: "month", label: "Month" },
    { key: "workOrders", label: "Work orders" },
    { key: "revenue", label: "Revenue (AED, before VAT)" },
    { key: "amc", label: "AMC (AED)" },
    { key: "oneTime", label: "One-time (AED)" },
    { key: "invoiced", label: "Invoiced (AED)" },
    { key: "rating", label: "Average rating" },
    { key: "ratings", label: "Ratings" },
  ],
  work_orders: [
    { key: "workOrder", label: "Work order" },
    { key: "client", label: "Client" },
    { key: "completed", label: "Completed" },
    { key: "revenue", label: "Revenue (AED, before VAT)" },
    { key: "valueFrom", label: "Value from" },
    { key: "kind", label: "Kind" },
    { key: "technicians", label: "Technicians (share)" },
    { key: "split", label: "Split" },
    { key: "invoiced", label: "Invoiced (AED)" },
    { key: "rating", label: "Average rating" },
  ],
} as const;

const hoursNumber = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

export const revenueExportRow = {
  clients: (r: RevenueClientRow) => ({
    name: r.name,
    workOrders: r.workOrders,
    revenue: r.revenue,
    share: r.sharePercent,
    amc: r.amc,
    oneTime: r.oneTime,
    invoiced: r.invoiced,
    rating: r.averageRating,
    ratings: r.ratings,
  }),
  technicians: (r: RevenueTechnicianRow) => ({
    name: r.name,
    team: r.teamName,
    workOrders: r.workOrders,
    hours: hoursNumber(r.minutes),
    revenue: r.revenue,
    share: r.sharePercent,
    equalSplits: r.equalSplits,
    amc: r.amc,
    oneTime: r.oneTime,
    invoiced: r.invoiced,
    rating: r.averageRating,
    ratings: r.ratings,
  }),
  months: (r: RevenueMonthRow) => ({
    month: r.label,
    workOrders: r.workOrders,
    revenue: r.revenue,
    amc: r.amc,
    oneTime: r.oneTime,
    invoiced: r.invoiced,
    rating: r.averageRating,
    ratings: r.ratings,
  }),
  work_orders: (r: RevenueWorkOrderRow) => ({
    workOrder: r.number,
    client: r.clientName,
    completed: r.completedDate,
    revenue: r.value,
    valueFrom: r.valueSource === "work_order" ? "Work order" : r.valueSource === "quotation" ? "Quotation" : "No value",
    kind: r.amc ? "AMC" : "One-time",
    technicians: r.shares.map((s) => `${s.name} ${s.amount.toFixed(2)}`).join("; "),
    split: BASIS_WORDS[r.basis],
    invoiced: r.invoiced,
    rating: r.averageRating,
  }),
};
