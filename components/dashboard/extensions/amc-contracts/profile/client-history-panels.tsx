"use client";

import Link from "next/link";
import { CalendarClock, CalendarDays, ExternalLink, FileText, History, Receipt, Siren, Wrench, type LucideIcon } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/data-table";
import { SectionCard, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ErrorState, ListSkeleton, StatGridSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { Money } from "@/components/ui/money";
import type { AdditionalWorkStatus, CallOutStatus } from "@/lib/amc/call-outs";
import { VISIT_STATUS_LABELS, type VisitStatus } from "@/lib/amc/ppm";
import { clientHistoryService, type ClientScheduleVisit, type ServiceHistoryEntry } from "@/modules/amc-contracts/client-history-service";

import { CallOutStatusBadge, WorkStatusBadge } from "../call-out-shared";
import { formatContractDate } from "../contract-status";
import { useAmcData } from "../use-amc-data";
import { slotLabel, visitStatusTone } from "../visit-status";
import { TruncatedText } from "@/components/ui/truncated-text";

/**
 * The client page's history across all their contracts (BRD 5.9): the PPM
 * schedule, the service history (visits done, call outs, additional work)
 * and the additional-work totals. Each loads on its own when its tab opens.
 */

const contractHref = (contractId: string, tab?: string) => `/extensions/amc-contracts/${contractId}${tab ? `?tab=${tab}` : ""}`;
/* A visit that is over: delivered, partly delivered or closed as not done. */
const PAST_STATUSES = ["completed", "completed_with_additional_work", "partially_completed", "not_completed"];
const noop = () => undefined;

function VisitStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="secondary" className={`border-0 font-medium ${visitStatusTone(status as VisitStatus)}`}>
      {VISIT_STATUS_LABELS[status as VisitStatus] ?? status.replace(/_/g, " ")}
    </Badge>
  );
}

function ContractCell({ contractId, contractNumber, propertyLabel, tab }: { contractId: string; contractNumber: string; propertyLabel: string; tab?: string }) {
  return (
    <>
      <Link href={contractHref(contractId, tab)} className="font-medium tabular-nums hover:underline">
        {contractNumber || "Contract"}
      </Link>
      {propertyLabel ? <TruncatedText className="text-muted-foreground max-w-[240px] text-xs">{propertyLabel}</TruncatedText> : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Schedule                                                            */
/* ------------------------------------------------------------------ */

/* The schedule list: what the visit covers, its contract, window, booking and status. */
const SCHEDULE_COLUMNS: ColumnDef<ClientScheduleVisit>[] = [
  {
    id: "visit",
    header: "Visit",
    cell: ({ row }) => <IdentityCell title={`PPM visit ${row.original.visitNo}`} subtitle={row.original.services.join(", ") || null} icon={CalendarDays} />,
  },
  {
    id: "contract",
    header: "Contract",
    cell: ({ row }) => <ContractCell contractId={row.original.contractId} contractNumber={row.original.contractNumber} propertyLabel={row.original.propertyLabel} tab="schedule" />,
  },
  {
    id: "window",
    header: "Window",
    cell: ({ row }) => (
      <div className="tabular-nums">
        {formatContractDate(row.original.windowStart)} to {formatContractDate(row.original.windowEnd)}
        <div className="text-muted-foreground text-xs">Target {formatContractDate(row.original.targetDate)}</div>
      </div>
    ),
  },
  {
    id: "bookedFor",
    header: "Booked for",
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.scheduledStart ? slotLabel(row.original.scheduledStart, null) : <span className="text-muted-foreground">Not booked</span>}</span>
    ),
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => (
      <div className="flex flex-wrap items-center gap-1">
        <VisitStatusBadge status={row.original.status} />
        {row.original.overdue ? (
          <Badge variant="secondary" className="bg-danger/10 text-danger border-0 font-medium">
            Overdue
          </Badge>
        ) : null}
      </div>
    ),
  },
];

function ScheduleTable({ visits, empty }: { visits: ClientScheduleVisit[]; empty: React.ReactNode }) {
  return (
    <DataTable
      columns={SCHEDULE_COLUMNS}
      data={visits}
      loading={false}
      rowCount={visits.length}
      pageSize={500}
      currentPage={0}
      onPageChange={noop}
      onPageSizeChange={noop}
      onGlobalFilterChange={noop}
      emptyState={empty}
    />
  );
}

/** The client's planned visits across their contracts: what is coming first, then what is done. */
export function ClientSchedulePanel({ customerId }: { customerId: string }) {
  const { data, error, loading, reload } = useAmcData(() => clientHistoryService.schedule(customerId), `client-schedule|${customerId}`);
  const visits = data?.visits ?? [];
  const upcoming = visits.filter((v) => !PAST_STATUSES.includes(v.status)).sort((a, b) => a.targetDate.localeCompare(b.targetDate));
  const past = visits.filter((v) => PAST_STATUSES.includes(v.status)).sort((a, b) => b.targetDate.localeCompare(a.targetDate));
  const overdue = upcoming.filter((v) => v.overdue).length;

  const body = (list: ClientScheduleVisit[], empty: React.ReactNode) =>
    error ? (
      <div className="p-5">
        <ErrorState title="Could not load the schedule" message={error} onRetry={reload} />
      </div>
    ) : loading ? (
      <ListSkeleton rows={3} />
    ) : (
      <ScheduleTable visits={list} empty={empty} />
    );

  return (
    <>
      <SectionCard
        title="Upcoming visits"
        description={
          overdue
            ? `${overdue} ${overdue === 1 ? "visit is" : "visits are"} past the window and not done. Open the contract's schedule to book them.`
            : "Planned PPM visits across the client's contracts, soonest first."
        }
        icon={<CalendarClock />}
        bodyClassName="border-t"
      >
        {body(upcoming, <EmptyState icon={<CalendarClock className="size-5" />} title="Nothing planned" description="Visits appear here once a contract's PPM schedule is generated." />)}
      </SectionCard>
      <SectionCard title="Past visits" description="Visits that are over, latest first. The service history has what was done on each." icon={<CalendarDays />} bodyClassName="border-t">
        {body(past, <EmptyState icon={<CalendarDays className="size-5" />} title="No visits done yet" description="Completed visits move here from the list above." />)}
      </SectionCard>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Service history                                                     */
/* ------------------------------------------------------------------ */

const KIND: Record<ServiceHistoryEntry["kind"], { label: string; icon: LucideIcon }> = {
  visit: { label: "PPM visit", icon: CalendarDays },
  call_out: { label: "Call out", icon: Siren },
  additional_work: { label: "Additional work", icon: Wrench },
};

function entryHref(e: ServiceHistoryEntry): string {
  if (e.kind === "call_out") return `/extensions/amc-contracts/call-outs?open=${e.id}`;
  if (e.kind === "additional_work") return `/extensions/amc-contracts/additional-works?open=${e.id}`;
  return contractHref(e.contractId, "schedule");
}

function EntryStatus({ entry }: { entry: ServiceHistoryEntry }) {
  if (entry.kind === "call_out") return <CallOutStatusBadge status={entry.status as CallOutStatus} />;
  if (entry.kind === "additional_work") return <WorkStatusBadge status={entry.status as AdditionalWorkStatus} />;
  return <VisitStatusBadge status={entry.status} />;
}

/* The service list; the title still links to the visit, call out or work. */
const SERVICE_COLUMNS: ColumnDef<ServiceHistoryEntry>[] = [
  {
    id: "what",
    header: "What",
    cell: ({ row }) => (
      <Link href={entryHref(row.original)} className="inline-block [&:hover_.font-medium]:underline">
        <IdentityCell title={row.original.title} subtitle={KIND[row.original.kind].label} icon={KIND[row.original.kind].icon} />
      </Link>
    ),
  },
  {
    id: "date",
    header: "Date",
    cell: ({ row }) => <span className="tabular-nums">{formatContractDate(row.original.date)}</span>,
  },
  {
    id: "contract",
    header: "Contract",
    cell: ({ row }) => <ContractCell contractId={row.original.contractId} contractNumber={row.original.contractNumber} propertyLabel={row.original.propertyLabel} />,
  },
  {
    id: "detail",
    header: "Detail",
    cell: ({ row }) => <TruncatedText text={row.original.detail || "—"} className="text-muted-foreground max-w-[300px] text-sm" />,
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => <EntryStatus entry={row.original} />,
  },
  {
    id: "amount",
    header: "Amount",
    cell: ({ row }) => (row.original.amount !== null ? <Money value={row.original.amount} className="text-sm" /> : <span className="text-muted-foreground">—</span>),
  },
  {
    id: "report",
    header: "",
    cell: ({ row }) =>
      row.original.kind === "visit" && row.original.hasReport ? (
        <Button asChild variant="ghost" size="sm">
          <a href={clientHistoryService.visitReportUrl(row.original.id)} target="_blank" rel="noopener noreferrer">
            <FileText className="size-4" />
            Report
            <ExternalLink className="size-3" aria-hidden />
          </a>
        </Button>
      ) : null,
  },
];

/** Visits done, call outs and additional work across the client's contracts, newest first. */
export function ServiceHistoryPanel({ customerId }: { customerId: string }) {
  const { data, error, loading, reload } = useAmcData(() => clientHistoryService.service(customerId), `client-service|${customerId}`);
  const entries = data?.entries ?? [];

  return (
    <SectionCard
      title="Service history"
      description="Visits done, call outs and additional work across the client's contracts, newest first."
      icon={<History />}
      bodyClassName="border-t"
    >
      {error ? (
        <div className="p-5">
          <ErrorState title="Could not load the service history" message={error} onRetry={reload} />
        </div>
      ) : loading ? (
        <ListSkeleton rows={4} />
      ) : (
        <DataTable
          columns={SERVICE_COLUMNS}
          data={entries}
          loading={false}
          rowCount={entries.length}
          pageSize={500}
          currentPage={0}
          onPageChange={noop}
          onPageSizeChange={noop}
          onGlobalFilterChange={noop}
          emptyState={<EmptyState icon={<History className="size-5" />} title="No service yet" description="Completed visits, call outs and additional work for this client appear here." />}
        />
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Additional-work totals                                              */
/* ------------------------------------------------------------------ */

/** The client's additional work across their contracts (BRD 5.14 roll-up): raised, quoted, approved, invoiced, paid. */
export function AdditionalWorkTotalsCard({ customerId }: { customerId: string }) {
  const { data, error, loading, reload } = useAmcData(() => clientHistoryService.additionalWork(customerId), `client-aw|${customerId}`);

  return (
    <SectionCard
      title="Additional work"
      description="Work found on visits and call outs outside the contract, across all the client's contracts. Amounts in AED, incl. VAT."
      icon={<Receipt />}
      bodyClassName="px-5 pb-5"
      action={
        <Button asChild size="sm" variant="outline">
          <Link href="/extensions/amc-contracts/additional-works">Open additional works</Link>
        </Button>
      }
    >
      {error ? (
        <ErrorState title="Could not load the additional-work totals" message={error} onRetry={reload} />
      ) : loading || !data ? (
        <StatGridSkeleton count={5} />
      ) : (
        <StatCardGrid columns={5}>
          <StatCard label="Raised" value={data.count} headline={data.count === 1 ? "1 item" : `${data.count} items`} caption={data.rejected > 0 ? `AED ${data.rejected.toLocaleString("en-AE", { minimumFractionDigits: 2 })} rejected` : "Every status"} />
          <StatCard label="Quoted" value={<Money value={data.quoted} className="text-xl" />} headline="Shared with the client" />
          <StatCard label="Approved" value={<Money value={data.approved} className="text-xl" />} headline="Client said yes" tone={data.approved > 0 ? "good" : "neutral"} />
          <StatCard label="Invoiced" value={<Money value={data.invoiced} className="text-xl" />} headline="Invoiced or paid" />
          <StatCard
            label="Paid"
            value={<Money value={data.paid} className="text-xl" />}
            headline={data.invoiced > data.paid ? "Some still to collect" : "Nothing to collect"}
            tone={data.invoiced > data.paid ? "progress" : "neutral"}
          />
        </StatCardGrid>
      )}
    </SectionCard>
  );
}
