"use client";

import Link from "next/link";
import { CalendarClock, CalendarDays, ExternalLink, FileText, History, Receipt, Siren, Wrench } from "lucide-react";

import { SectionCard, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ErrorState, ListSkeleton, StatGridSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Money } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AdditionalWorkStatus, CallOutStatus } from "@/lib/amc/call-outs";
import { VISIT_STATUS_LABELS, type VisitStatus } from "@/lib/amc/ppm";
import { clientHistoryService, type ClientScheduleVisit, type ServiceHistoryEntry } from "@/modules/amc-contracts/client-history-service";

import { CallOutStatusBadge, WorkStatusBadge } from "../call-out-shared";
import { formatContractDate } from "../contract-status";
import { useAmcData } from "../use-amc-data";
import { slotLabel, visitStatusTone } from "../visit-status";

/**
 * The client page's history across all their contracts (BRD 5.9): the PPM
 * schedule, the service history (visits done, call outs, additional work)
 * and the additional-work totals. Each loads on its own when its tab opens.
 */

const contractHref = (contractId: string, tab?: string) => `/extensions/amc-contracts/${contractId}${tab ? `?tab=${tab}` : ""}`;
/* A visit that is over: delivered, partly delivered or closed as not done. */
const PAST_STATUSES = ["completed", "completed_with_additional_work", "partially_completed", "not_completed"];

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
      {propertyLabel ? <div className="text-muted-foreground max-w-[240px] truncate text-xs">{propertyLabel}</div> : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Schedule                                                            */
/* ------------------------------------------------------------------ */

function ScheduleTable({ visits }: { visits: ClientScheduleVisit[] }) {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[860px]">
        <TableHeader className="[&_th]:text-muted-foreground">
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-5">Visit</TableHead>
            <TableHead>Contract</TableHead>
            <TableHead>Window</TableHead>
            <TableHead>Booked for</TableHead>
            <TableHead className="pr-5">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visits.map((v) => (
            <TableRow key={v.id} className="h-14">
              <TableCell className="pl-5">
                <div className="font-medium">PPM visit {v.visitNo}</div>
                {v.services.length ? <div className="text-muted-foreground max-w-[260px] truncate text-xs">{v.services.join(", ")}</div> : null}
              </TableCell>
              <TableCell>
                <ContractCell contractId={v.contractId} contractNumber={v.contractNumber} propertyLabel={v.propertyLabel} tab="schedule" />
              </TableCell>
              <TableCell className="tabular-nums">
                {formatContractDate(v.windowStart)} to {formatContractDate(v.windowEnd)}
                <div className="text-muted-foreground text-xs">Target {formatContractDate(v.targetDate)}</div>
              </TableCell>
              <TableCell className="tabular-nums">{v.scheduledStart ? slotLabel(v.scheduledStart, null) : <span className="text-muted-foreground">Not booked</span>}</TableCell>
              <TableCell className="pr-5">
                <div className="flex flex-wrap items-center gap-1">
                  <VisitStatusBadge status={v.status} />
                  {v.overdue ? (
                    <Badge variant="secondary" className="bg-danger/10 text-danger border-0 font-medium">
                      Overdue
                    </Badge>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
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
    ) : list.length === 0 ? (
      empty
    ) : (
      <ScheduleTable visits={list} />
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

const KIND: Record<ServiceHistoryEntry["kind"], { label: string; icon: React.ReactNode }> = {
  visit: { label: "PPM visit", icon: <CalendarDays className="size-4" aria-hidden /> },
  call_out: { label: "Call out", icon: <Siren className="size-4" aria-hidden /> },
  additional_work: { label: "Additional work", icon: <Wrench className="size-4" aria-hidden /> },
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
      ) : entries.length === 0 ? (
        <EmptyState icon={<History className="size-5" />} title="No service yet" description="Completed visits, call outs and additional work for this client appear here." />
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[920px]">
            <TableHeader className="[&_th]:text-muted-foreground">
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5">What</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Contract</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="w-12 pr-5" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={`${e.kind}-${e.id}`} className="h-14">
                  <TableCell className="pl-5">
                    <div className="flex items-center gap-3">
                      <span className="bg-muted/50 text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md border" title={KIND[e.kind].label}>
                        {KIND[e.kind].icon}
                      </span>
                      <div className="min-w-0">
                        <Link href={entryHref(e)} className="font-medium hover:underline">
                          {e.title}
                        </Link>
                        <div className="text-muted-foreground text-xs">{KIND[e.kind].label}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="tabular-nums">{formatContractDate(e.date)}</TableCell>
                  <TableCell>
                    <ContractCell contractId={e.contractId} contractNumber={e.contractNumber} propertyLabel={e.propertyLabel} />
                  </TableCell>
                  <TableCell>
                    <div className="text-muted-foreground line-clamp-2 max-w-[300px] text-sm">{e.detail || "—"}</div>
                  </TableCell>
                  <TableCell>
                    <EntryStatus entry={e} />
                  </TableCell>
                  <TableCell className="text-right">{e.amount !== null ? <Money value={e.amount} className="text-sm" /> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="pr-5">
                    {e.kind === "visit" && e.hasReport ? (
                      <Button asChild variant="ghost" size="sm">
                        <a href={clientHistoryService.visitReportUrl(e.id)} target="_blank" rel="noopener noreferrer">
                          <FileText className="size-4" />
                          Report
                          <ExternalLink className="size-3" aria-hidden />
                        </a>
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
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
