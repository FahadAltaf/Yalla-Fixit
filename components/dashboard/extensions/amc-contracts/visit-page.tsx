"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, ClipboardList, FileSignature, History, ListChecks, MessageCircle, PhoneCall, ShieldCheck } from "lucide-react";

import { SectionCard, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ErrorState, SectionSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TRADE_LABELS } from "@/lib/amc/client-profile";
import { CALL_OUT_PRIORITY_LABELS } from "@/lib/amc/call-outs";
import { FIELD_VISIT_KIND_LABELS, FIELD_VISIT_STAGE_LABELS, fieldVisitHref, type FieldVisitStage } from "@/lib/amc/field-visits";
import { amcRefresh } from "@/lib/amc/http-cache";
import { ACCESS_STATUS_LABELS, CONFIRMATION_LABELS } from "@/lib/amc/visits";
import { cn } from "@/lib/utils";
import { callOutsService } from "@/modules/amc-contracts/call-outs-service";
import { fieldVisitsService, type FieldVisitHistoryItem, type FieldVisitRow } from "@/modules/amc-contracts/field-visits-service";
import { visitsService } from "@/modules/amc-contracts/visits-service";

import {
  CallOutCrewSection,
  CallOutFindingsSection,
  CallOutNotices,
  CallOutPhotosSection,
  CallOutWorksSection,
  useCallOutActions,
  useCallOutWorkDialogs,
  type CallOutWorking,
} from "./call-out-sections";
import { CoverageBadge, PanelSurface, shortDateTime } from "./call-out-shared";
import { formatContractDate } from "./contract-status";
import { DetailHeaderCard, DetailHeaderSkeleton, DetailToolbar, shortPlace } from "./detail-header";
import { DetailList } from "./enquiries/enquiry-ui";
import { JobSheetPanel } from "./job-sheet-panel";
import { HistoryCard, type HistoryEntry } from "./history-card";
import { useUrlTab } from "./profile/use-url-tab";
import { useAmcData } from "./use-amc-data";
import { AccessSection, AssignmentSection, ConfirmationSection, type VisitWorking } from "./visit-sections";
import { channelLabel, slotLabel } from "./visit-status";

const TABS = ["overview", "crew", "client", "access", "job_sheet", "findings", "photos", "works", "history"] as const;
type Tab = (typeof TABS)[number];

/* The tabs each kind of visit has, in order. */
const KIND_TABS: Record<"ppm" | "call_out", readonly Tab[]> = {
  ppm: ["overview", "crew", "client", "access", "job_sheet", "history"],
  call_out: ["overview", "crew", "findings", "photos", "works", "history"],
};

const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  crew: "Crew & time",
  client: "Client",
  access: "Access",
  job_sheet: "Job sheet",
  findings: "Findings",
  photos: "Photos",
  works: "Additional work",
  history: "History",
};

const STAGE_TONES: Record<FieldVisitStage, string> = {
  to_plan: "bg-mist text-ink-soft",
  planned: "bg-brand-50 text-brand",
  confirmed: "bg-success/10 text-success",
  in_progress: "bg-warning/10 text-warning",
  review: "bg-warning/10 text-warning",
  done: "bg-success/10 text-success",
  cancelled: "bg-mist text-ink-soft",
};


const muted = (text: string) => <span className="text-muted-foreground">{text}</span>;

function whenText(v: FieldVisitRow) {
  if (v.scheduledStart) return slotLabel(v.scheduledStart, v.scheduledEnd);
  return `${formatContractDate(v.day)} (no slot yet)`;
}

type Loaded<T> = { data: T | null; error: string | null; loading: boolean; reload: () => void };
type PpmData = Awaited<ReturnType<typeof visitsService.visit>>;
type CallOutData = Awaited<ReturnType<typeof callOutsService.callOut>>;

/**
 * One AMC visit on its own page, as a Snagging job: the header with what it
 * is, where it stands and what can be done, then tabs that load when first
 * opened and stay mounted (?tab=…), so a half-filled form survives a switch.
 *
 * A planned visit: Overview, Crew & time, Client (confirmation), Access, Job
 * sheet, History. A call out: Overview, Crew & time (schedule and
 * attendance), Findings, Photos, Additional work, History; closing,
 * cancelling and flagging misuse are header actions. Additional work and site
 * visits have pages of their own (they are sent on there).
 */
export function VisitPage({ id }: { id: string }) {
  const router = useRouter();
  /* Stamped when it arrives, for the toolbar's "Updated" time. */
  const header = useAmcData(async () => ({ ...(await fieldVisitsService.visit(id)), fetchedAt: Date.now() }), `field-visit:${id}`);
  const v = header.data?.visit ?? null;
  const kind = v?.kind === "ppm" || v?.kind === "call_out" ? v.kind : null;
  const ppm = useAmcData(() => (kind === "ppm" ? visitsService.visit(id) : Promise.resolve(null)), kind === "ppm" ? `visit:${id}` : "visit:none");
  const callOut = useAmcData(() => (kind === "call_out" ? callOutsService.callOut(id) : Promise.resolve(null)), kind === "call_out" ? `call-out:${id}` : "call-out:none");
  const { tab, setTab, isOpened } = useUrlTab<Tab>(TABS, "overview");
  const history = useAmcData(() => (isOpened("history") ? fieldVisitsService.history(id) : Promise.resolve(null)), isOpened("history") ? `field-visit-history:${id}` : "history:none");
  /* One action at a time on the page (a send, a save, a search). */
  const [visitWorking, setVisitWorking] = useState<VisitWorking>(null);
  const [callOutWorking, setCallOutWorking] = useState<CallOutWorking>(null);
  const busy = visitWorking !== null || callOutWorking !== null;

  /* Additional work and site visits have pages of their own. */
  useEffect(() => {
    if (v && (v.kind === "additional_work" || v.kind === "site_visit")) router.replace(fieldVisitHref(v));
  }, [v, router]);

  /* The job sheet reads its own record: told to read it again with everything else. */
  const [sheetVersion, setSheetVersion] = useState(0);
  const reloadAll = () => {
    setSheetVersion((n) => n + 1);
    header.reload();
    ppm.reload();
    callOut.reload();
    history.reload();
  };
  /* After a change in a tab: everything the page shows is read again (the header's stage, the tab, the history). */
  const changed = async () => reloadAll();
  const refresh = () => amcRefresh(reloadAll);

  const callOutActions = useCallOutActions(callOut.data, changed, busy);
  const works = useCallOutWorkDialogs(callOut.data, changed);

  const tabs = kind ? KIND_TABS[kind] : (["overview", "history"] as const);
  /* A tab in the link this kind does not have (?tab=photos on a planned visit) shows the overview. */
  const shown: Tab = tabs.includes(tab) ? tab : "overview";
  const notFound = header.error && /not found/i.test(header.error);

  const panel = (value: Tab, children: ReactNode) =>
    tabs.includes(value) && (isOpened(value) || shown === value) ? (
      <TabsContent value={value} forceMount className="mt-4 flex flex-col gap-4 data-[state=inactive]:hidden">
        {children}
      </TabsContent>
    ) : null;

  /* A tab's body once the kind's own record is in; its error or a skeleton before. */
  const withPpm = (render: (d: PpmData) => ReactNode) =>
    ppm.error ? <ErrorState title="Could not load the visit's details" message={ppm.error} onRetry={ppm.reload} /> : ppm.data ? render(ppm.data) : <SectionSkeleton />;
  const withCallOut = (render: (d: CallOutData) => ReactNode) =>
    callOut.error ? (
      <ErrorState title="Could not load the call out's details" message={callOut.error} onRetry={callOut.reload} />
    ) : callOut.data ? (
      render(callOut.data)
    ) : (
      <SectionSkeleton />
    );

  const ppmProps = (d: PpmData) => ({ visit: d.visit, canEdit: d.canEdit, working: visitWorking, setWorking: setVisitWorking, changed });
  const callOutProps = (d: CallOutData) => ({ data: d, working: callOutWorking, setWorking: setCallOutWorking, changed });

  if (notFound) {
    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        <DetailToolbar backHref="/extensions/amc-contracts/visits" backLabel="Visits" />
        <Card className="p-0">
          <EmptyState
            icon={<CalendarClock className="size-6" />}
            title="This visit could not be found"
            description="It may have been removed from its contract's schedule, or you may not have access to it."
            action={{ label: "Back to visits", onClick: () => router.push("/extensions/amc-contracts/visits"), variant: "outline" }}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <DetailToolbar
        backHref="/extensions/amc-contracts/visits"
        backLabel="Visits"
        fetchedAt={header.data?.fetchedAt ?? null}
        refreshing={header.reloading || ppm.reloading || callOut.reloading || history.reloading}
        onRefresh={refresh}
      />

      {header.error ? (
        <ErrorState title="Could not load the visit" message={header.error} onRetry={header.reload} />
      ) : !v ? (
        <DetailHeaderSkeleton />
      ) : (
        <DetailHeaderCard
          badges={
            <>
              <Badge variant="outline">{FIELD_VISIT_KIND_LABELS[v.kind]}</Badge>
              <Badge variant="outline" className="tabular-nums">
                {v.ref}
              </Badge>
              {v.priority === "emergency" ? (
                <Badge variant="secondary" className="bg-danger/10 text-danger border-0 font-medium">
                  Emergency
                </Badge>
              ) : null}
              {v.late ? (
                <Badge variant="secondary" className="bg-danger/10 text-danger border-0 font-medium">
                  Overdue
                </Badge>
              ) : null}
            </>
          }
          title={v.customerName || "Visit"}
          status={
            <span className="flex items-center gap-2">
              <Badge variant="secondary" className={cn("border-0 font-medium", STAGE_TONES[v.stage])}>
                {FIELD_VISIT_STAGE_LABELS[v.stage]}
              </Badge>
              <span className="text-muted-foreground text-sm">{v.statusLabel}</span>
            </span>
          }
          subline={[shortPlace(v.propertyLabel), whenText(v), v.crew.length ? `${v.crew[0].name}${v.crew.length > 1 ? ` +${v.crew.length - 1}` : ""}` : "No crew yet"].filter(Boolean).join(" · ")}
          actions={
            <>
              {v.contractId ? (
                <Button asChild variant="outline">
                  <Link href={`/extensions/amc-contracts/${v.contractId}`}>
                    <FileSignature className="size-4" />
                    Open contract
                  </Link>
                </Button>
              ) : null}
              {kind === "call_out" ? callOutActions.buttons : null}
            </>
          }
        />
      )}

      {kind === "call_out" && callOut.data ? <CallOutNotices callOut={callOut.data.callOut} /> : null}

      {v ? (
        <PanelSurface.Provider value="card">
          <Tabs value={shown} onValueChange={setTab}>
            <TabsList className="h-auto w-full flex-wrap justify-start gap-1 group-data-horizontal/tabs:h-auto">
              {tabs.map((t) => (
                <TabsTrigger key={t} value={t}>
                  {TAB_LABELS[t]}
                  {t === "photos" && callOut.data?.photos.length ? <span className="text-muted-foreground ml-1 tabular-nums">({callOut.data.photos.length})</span> : null}
                  {t === "works" && callOut.data?.additionalWorks.length ? (
                    <span className="text-muted-foreground ml-1 tabular-nums">({callOut.data.additionalWorks.length})</span>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>

            {panel("overview", kind === "ppm" ? <PpmOverview v={v} data={ppm} onTab={setTab} /> : kind === "call_out" ? <CallOutOverview v={v} data={callOut} onTab={setTab} /> : <SectionSkeleton />)}

            {/* Planned visit */}
            {kind === "ppm" ? (
              <>
                {panel("crew", withPpm((d) => <AssignmentSection {...ppmProps(d)} />))}
                {panel("client", withPpm((d) => <ConfirmationSection {...ppmProps(d)} />))}
                {panel("access", withPpm((d) => <AccessSection {...ppmProps(d)} />))}
                {panel("job_sheet", <JobSheetPanel visitId={id} onChanged={changed} readOnly refreshKey={sheetVersion} />)}
              </>
            ) : null}

            {/* Call out */}
            {kind === "call_out" ? (
              <>
                {panel("crew", withCallOut((d) => <CallOutCrewSection {...callOutProps(d)} />))}
                {panel("findings", withCallOut((d) => <CallOutFindingsSection {...callOutProps(d)} onRaise={works.raise} />))}
                {panel("photos", withCallOut((d) => <CallOutPhotosSection data={d} working={callOutWorking} changed={changed} />))}
                {panel("works", withCallOut((d) => <CallOutWorksSection data={d} onRaise={works.raise} onOpen={works.open} />))}
              </>
            ) : null}

            {panel("history", <HistoryPanel data={history} />)}
          </Tabs>
        </PanelSurface.Provider>
      ) : null}

      {callOutActions.dialog}
      {works.dialogs}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Overview: planned visit                                              */
/* ------------------------------------------------------------------ */

const shortDay = (iso: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Dubai" }).format(new Date(iso));
const hhmm = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }).format(new Date(iso));
const slotHours = (start: string, end: string | null) => (end ? `${hhmm(start)}–${hhmm(end)}` : hhmm(start));
const dayOnly = (d: string) => shortDay(`${d}T12:00:00Z`);
const hours = (minutes: number) => `${Math.round(minutes / 6) / 10} h`;

/** The services on a visit, one line each: what, its trade and how many units. */
function ServicesList({ lines }: { lines: Array<{ id: string; label: string; trade: string; units: number }> }) {
  if (!lines.length) return muted("None");
  return (
    <span className="flex flex-col items-end gap-0.5">
      {lines.map((l) => (
        <span key={l.id}>
          {l.label}
          <span className="text-muted-foreground font-normal">
            {" "}
            · {TRADE_LABELS[l.trade as keyof typeof TRADE_LABELS] ?? l.trade} · {l.units} {l.units === 1 ? "unit" : "units"}
          </span>
        </span>
      ))}
    </span>
  );
}

function PpmOverview({ v, data, onTab }: { v: FieldVisitRow; data: Loaded<PpmData>; onTab: (tab: Tab) => void }) {
  if (data.error) return <ErrorState title="Could not load the visit's details" message={data.error} onRetry={data.reload} />;
  const d = data.data?.visit;
  if (!d) return <SectionSkeleton />;
  const confirmation = (d.clientConfirmation ?? "pending") as keyof typeof CONFIRMATION_LABELS;
  const confirmed = d.clientConfirmation === "confirmed";
  const lead = v.crew.find((c) => c.lead) ?? v.crew[0];
  return (
    <>
      {/* The four answers somebody opens a visit for, each opening its tab. */}
      <StatCardGrid columns={4}>
        <StatCard
          label="When"
          value={v.scheduledStart ? shortDay(v.scheduledStart) : dayOnly(d.targetDate)}
          headline={v.scheduledStart ? slotHours(v.scheduledStart, v.scheduledEnd) : "No time set yet"}
          caption={`Window ${formatContractDate(d.windowStart)} – ${formatContractDate(d.windowEnd)}`}
          tone={v.late ? "bad" : v.scheduledStart ? "progress" : "neutral"}
          onSelect={() => onTab("crew")}
          selectLabel="Open crew and time"
        />
        <StatCard
          label="Crew"
          value={v.crew.length ? (lead?.name ?? "—") : "Not assigned"}
          headline={v.crew.length > 1 ? `+${v.crew.length - 1} more` : v.crew.length ? "Lead technician" : "Find a crew on Crew & time"}
          caption={`Needs ${hours(d.need.durationMinutes)}, ${d.need.headcount} ${d.need.headcount === 1 ? "person" : "people"}`}
          tone={v.crew.length ? "good" : "neutral"}
          onSelect={() => onTab("crew")}
          selectLabel="Open crew and time"
        />
        <StatCard
          label="Client"
          value={d.clientConfirmation ? (CONFIRMATION_LABELS[confirmation] ?? confirmation) : "Not requested yet"}
          headline={d.confirmedAt ? `Confirmed ${shortDateTime(d.confirmedAt)}` : `${d.attemptState.tried} of ${d.rule.attemptCount} attempts${d.attemptState.exhausted ? ", used up" : ""}`}
          caption={d.attempts.length ? `Last by ${channelLabel(d.attempts[d.attempts.length - 1].channel)}` : "Not contacted yet"}
          tone={confirmed ? "good" : d.attemptState.exhausted ? "bad" : "review"}
          onSelect={() => onTab("client")}
          selectLabel="Open the client confirmation"
        />
        <StatCard
          label="Access"
          value={d.accessStatus ? ACCESS_STATUS_LABELS[d.accessStatus] : "Not set"}
          headline={d.accessValidUntil ? `Valid until ${formatContractDate(d.accessValidUntil)}` : d.accessRules.length ? `${d.accessRules.length} property ${d.accessRules.length === 1 ? "rule" : "rules"}` : "No property rules"}
          caption={d.accessDocumentId ? "Pass on file" : "No pass on file"}
          tone={d.accessStatus === "approved" || d.accessStatus === "not_required" ? "good" : d.accessStatus === "rejected" || d.accessStatus === "expired" ? "bad" : "review"}
          onSelect={() => onTab("access")}
          selectLabel="Open the access"
        />
      </StatCardGrid>

      <SectionCard title="Visit details" description="What the crew does, for which contract, and when it may be done." icon={<ListChecks />} bodyClassName="px-5 pb-4">
        <DetailList
          rows={[
            { label: "Services", value: <ServicesList lines={d.lines} /> },
            {
              label: "Contract",
              value: v.contractId ? (
                <Link href={`/extensions/amc-contracts/${v.contractId}`} className="text-brand hover:underline">
                  {v.contractNumber ?? "Open"}
                </Link>
              ) : (
                muted("—")
              ),
            },
            { label: "Property", value: v.propertyLabel || muted("—") },
            { label: "Service window", value: `${formatContractDate(d.windowStart)} – ${formatContractDate(d.windowEnd)}` },
            { label: "Target date", value: formatContractDate(d.targetDate) },
            ...(d.originalTargetDate && d.originalTargetDate !== d.targetDate ? [{ label: "Originally", value: formatContractDate(d.originalTargetDate) }] : []),
            ...(d.assignmentNote ? [{ label: "Why this crew", value: d.assignmentNote }] : []),
            ...(d.statusReason ? [{ label: "Reason", value: d.statusReason }] : []),
          ]}
        />
      </SectionCard>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Overview: call out                                                   */
/* ------------------------------------------------------------------ */

const SLA_LABEL: Record<string, string> = { on_track: "On track", at_risk: "At risk", missed: "Missed", met: "Met" };

function CallOutOverview({ v, data, onTab }: { v: FieldVisitRow; data: Loaded<CallOutData>; onTab: (tab: Tab) => void }) {
  if (data.error) return <ErrorState title="Could not load the call out's details" message={data.error} onRetry={data.reload} />;
  const d = data.data;
  if (!d) return <SectionSkeleton />;
  const c = d.callOut;
  const a = d.allowance;
  const due = c.attendDueAt ?? c.scheduleDueAt;
  const lead = v.crew.find((x) => x.lead) ?? v.crew[0];
  return (
    <>
      <StatCardGrid columns={4}>
        <StatCard
          label="Deadline"
          value={c.slaState ? (SLA_LABEL[c.slaState] ?? c.slaState) : "—"}
          headline={due ? `${c.attendDueAt ? "Attend" : "Visit"} by ${shortDateTime(due)}` : "No deadline"}
          caption={`${CALL_OUT_PRIORITY_LABELS[c.priority]} · reported ${shortDateTime(c.reportedAt)}`}
          tone={c.slaState === "missed" ? "bad" : c.slaState === "at_risk" ? "review" : c.slaState === "met" ? "good" : "progress"}
        />
        <StatCard
          label="Coverage"
          value={c.coverage === "covered" ? "Covered" : "Chargeable"}
          headline={c.coverageOverrideReason ? "Booked as covered (goodwill)" : !a ? "No allowance on this contract" : a.unlimited ? "Unlimited allowance" : a.included === null ? "Included, not counted" : `${a.remaining} of ${a.included} left`}
          caption={a && !a.unlimited ? `${a.used} used${a.reserved ? `, ${a.reserved} booked` : ""}` : undefined}
          tone={c.coverage === "covered" ? "good" : "review"}
        />
        <StatCard
          label="Crew"
          value={v.crew.length ? (lead?.name ?? "—") : "Not assigned"}
          headline={v.scheduledStart ? `${shortDay(v.scheduledStart)}, ${slotHours(v.scheduledStart, v.scheduledEnd)}` : "No slot yet"}
          caption={c.attendedAt ? `Attended ${shortDateTime(c.attendedAt)}` : v.crew.length > 1 ? `+${v.crew.length - 1} more` : undefined}
          tone={c.attendedAt ? "good" : v.crew.length ? "progress" : "neutral"}
          onSelect={() => onTab("crew")}
          selectLabel="Open crew and time"
        />
        <StatCard
          label="Findings"
          value={c.resolution ? "Resolved" : c.diagnosis ? "Diagnosed" : "Not yet"}
          headline={d.additionalWorks.length ? `${d.additionalWorks.length} additional work` : "No additional work"}
          caption={c.partsNeeded ? `Parts: ${c.partsNeeded}` : undefined}
          tone={c.resolution ? "good" : c.diagnosis ? "progress" : "neutral"}
          onSelect={() => onTab("findings")}
          selectLabel="Open the findings"
        />
      </StatCardGrid>

      <SectionCard title="Call out details" description="What the client reported, who to meet on site and why it is covered or not." icon={<PhoneCall />} bodyClassName="px-5 pb-4">
        <DetailList
          rows={[
            { label: "Issue", value: <span className="whitespace-pre-wrap">{c.issue}</span> },
            { label: "Trade", value: c.trade ? (TRADE_LABELS[c.trade as keyof typeof TRADE_LABELS] ?? c.trade) : muted("Not set") },
            { label: "Reported", value: `${shortDateTime(c.reportedAt)} · ${channelLabel(c.channel)}` },
            ...(d.loggedInTime !== null ? [{ label: "Logged in time", value: d.loggedInTime ? "Yes" : <span className="text-danger">No, logged late</span> }] : []),
            ...(c.onSiteContactName || c.onSiteContactPhone ? [{ label: "On-site contact", value: [c.onSiteContactName, c.onSiteContactPhone].filter(Boolean).join(" · ") }] : []),
            {
              label: "Contract",
              value: v.contractId ? (
                <Link href={`/extensions/amc-contracts/${v.contractId}`} className="text-brand hover:underline">
                  {v.contractNumber ?? "Open"}
                </Link>
              ) : (
                muted("—")
              ),
            },
            { label: "Coverage", value: <CoverageBadge coverage={c.coverage} reserved={c.reserved} /> },
            /* Booked as covered against the check (goodwill): say so, then what the check said. */
            ...(c.coverageOverrideReason ? [{ label: "Booked as covered", value: <span className="text-warning font-medium">{c.coverageOverrideReason}</span> }] : []),
            ...(c.coverageReasons.length ? [{ label: c.coverageOverrideReason ? "The check said" : "Why", value: c.coverageReasons.join(" ") }] : []),
            ...(c.diagnosis ? [{ label: "Diagnosis", value: c.diagnosis }] : []),
            ...(c.resolution ? [{ label: "Resolution", value: c.resolution }] : []),
          ]}
        />
      </SectionCard>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* History                                                              */
/* ------------------------------------------------------------------ */

const HISTORY_ICONS: Record<FieldVisitHistoryItem["type"], typeof History> = {
  status: ShieldCheck,
  schedule: CalendarClock,
  attempt: MessageCircle,
  review: ClipboardList,
  event: History,
};

/** The History tab of the visit, additional work and site visit pages, as a Snagging job's Activity. */
export function HistoryPanel({
  data,
  description = "Everything that happened to this visit: status changes, date moves, confirmation attempts and job sheet decisions.",
}: {
  data: { data: { history: FieldVisitHistoryItem[] } | null; error: string | null; reload: () => void };
  description?: string;
}) {
  const entries = useMemo<HistoryEntry[] | null>(
    () =>
      data.data?.history.map((item, i) => {
        const Icon = HISTORY_ICONS[item.type];
        return {
          key: `${item.at}-${i}`,
          icon: <Icon aria-hidden />,
          title: item.title,
          actor: item.actorLabel ?? (item.origin === "database" || item.origin === "system" ? "Automatic" : null),
          detail: item.detail,
          at: item.at,
        };
      }) ?? null,
    [data.data],
  );
  return (
    <HistoryCard
      description={description}
      entries={entries}
      error={data.error}
      onRetry={data.reload}
      emptyDescription="Status changes, date moves, attempts to reach the client and job sheet decisions appear here as they happen."
    />
  );
}
