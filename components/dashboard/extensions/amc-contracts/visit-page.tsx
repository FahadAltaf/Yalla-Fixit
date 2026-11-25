"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, ClipboardList, FileSignature, FileText, FileWarning, History, ListChecks, MessageCircle, PhoneCall, ShieldCheck, UserRound, Wrench } from "lucide-react";

import { SectionCard, StatCard, StatCardGrid, SubHeading } from "@/components/dashboard/shared/kaizen";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FSM_QUOTATION_SKIP_LABELS } from "@/lib/amc/fsm-quotation";
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
  useCallOutActions,
  useCallOutWorkDialogs,
  type CallOutWorking,
} from "./call-out-sections";
import { FactTile, HeaderActionsSlot, PanelSurface, shortDateTime } from "./call-out-shared";
import { formatContractDate } from "./contract-status";
import { DetailHeaderCard, DetailHeaderSkeleton, DetailToolbar, shortPlace } from "./detail-header";
import { DetailList } from "./enquiries/enquiry-ui";
import { JobSheetPanel } from "./job-sheet-panel";
import { fieldJobSheetCalls } from "@/modules/amc-contracts/job-sheets-service";

/* A call out's job sheet (18 Nov 2026): the planned visit's panel on the call out's calls. */
const CALL_OUT_SHEET = fieldJobSheetCalls("call_out");
import { HistoryCard, type HistoryEntry } from "./history-card";
import { useUrlTab } from "./profile/use-url-tab";
import { useAmcData } from "./use-amc-data";
import { AccessSection, AssignmentSection, ConfirmationSection, StartVisitAction, type VisitWorking } from "./visit-sections";
import { channelLabel, slotLabel } from "./visit-status";
import { FieldStartAction, FieldWorkAccessCard, useFieldWork } from "./field-work-panels";
import { ChargeCard } from "./visit-charge";

const TABS = ["overview", "crew", "client", "access", "services", "job_sheet", "findings", "photos", "works", "history"] as const;
type Tab = (typeof TABS)[number];

/* The tabs each kind of visit has, in order. */
const KIND_TABS: Record<"ppm" | "call_out", readonly Tab[]> = {
  ppm: ["overview", "crew", "client", "access", "job_sheet", "history"],
  /* Access and Start visit as a planned visit (17 Nov 2026); no client confirmation: the client called. */
  /* Photos and additional work are part of the job sheet, as a planned visit's (18 Nov 2026). */
  call_out: ["overview", "crew", "access", "services", "job_sheet", "findings", "history"],
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
  services: "Services",
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

/** Text as separate items: one per line, without the bullet, dash or number it started with. */
function textLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[\u2022\u2023\u25e6\u2043\u2219*\-\u2013\u2014]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

/**
 * A handyman job's team-hours as one bar (25 Nov 2026): the hours from the
 * free handyman hours in green, the chargeable ones beyond them in amber,
 * the total on the right and what is left of the free hours under it.
 */
function HandymanHoursBar({
  hm,
  allowance,
}: {
  hm: { teams: number; fromCrew: boolean; hoursUsed: number | null; hoursChargeable: number | null };
  allowance: { unlimited: boolean; remaining: number | null; included: number | null } | null;
}) {
  const used = hm.hoursUsed;
  const charged = used === null ? 0 : Math.min(used, Math.max(0, hm.hoursChargeable ?? 0));
  const free = used === null ? 0 : used - charged;
  const pct = (n: number) => (used ? `${(n / used) * 100}%` : "0%");
  const left = allowance ? (allowance.unlimited ? "Unlimited free hours on this contract" : `${allowance.remaining ?? 0} of ${allowance.included ?? 0} free hours left now`) : null;
  return (
    <div className="grid gap-3 rounded-lg border px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Handyman hours</p>
          <p className="text-muted-foreground text-xs">
            {hm.teams} team{hm.teams === 1 ? "" : "s"} ({hm.fromCrew ? "one per technician" : "counted from the crew"}, each with a helper), in team-hours
          </p>
        </div>
        <div className="text-right">
          <p className="text-xl leading-none font-semibold tabular-nums">{used === null ? "—" : `${used} h`}</p>
          <p className="text-muted-foreground mt-1 text-xs">{used === null ? "Recorded at closing" : "used"}</p>
        </div>
      </div>
      <div
        className="bg-muted flex h-2.5 overflow-hidden rounded-full"
        role="img"
        aria-label={used === null ? "No hours recorded yet" : `${free} hours from the free hours, ${charged} chargeable`}
      >
        {used ? (
          <>
            <span className="bg-success h-full" style={{ width: pct(free) }} />
            <span className="bg-warning h-full" style={{ width: pct(charged) }} />
          </>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span className="bg-success size-2 rounded-full" />
          <span className="font-medium tabular-nums">{used === null ? "—" : `${free} h`}</span>
          <span className="text-muted-foreground">from the free hours</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="bg-warning size-2 rounded-full" />
          <span className={cn("font-medium tabular-nums", charged > 0 && "text-warning")}>{used === null ? "—" : `${charged} h`}</span>
          <span className="text-muted-foreground">chargeable</span>
        </span>
        {left ? <span className="text-muted-foreground sm:ml-auto">{left}</span> : null}
      </div>
    </div>
  );
}

/**
 * What is owed for Finance (25 Nov 2026): the FSM quotation number needed
 * (before closing, or to follow after it), or why there is none.
 */
function FsmQuotationNotice({
  state,
  closed,
  onOpen,
}: {
  state: { migrated: boolean; value: string | null; required: boolean; skip?: { kind: "not_chargeable" | "later"; reason: string | null } | null; outstanding?: boolean } | null;
  closed: boolean;
  onOpen: () => void;
}) {
  if (!state?.migrated) return null;
  if (state.value) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <FileText className="size-4" />
        FSM quotation <span className="text-foreground font-medium">{state.value}</span>
      </p>
    );
  }
  if (state.skip?.kind === "not_chargeable") {
    return (
      <Alert>
        <FileText />
        <AlertTitle>Not chargeable: no FSM quotation</AlertTitle>
        {state.skip.reason ? <AlertDescription>{state.skip.reason}</AlertDescription> : null}
      </Alert>
    );
  }
  if (!state.outstanding) return null;
  return (
    <Alert variant="warning">
      <FileWarning />
      <AlertTitle>{state.skip?.kind === "later" ? FSM_QUOTATION_SKIP_LABELS.later : closed ? "FSM quotation number needed" : "FSM quotation number needed to close"}</AlertTitle>
      <AlertDescription>
        <p>
          {state.skip?.kind === "later" && state.skip.reason ? `${state.skip.reason}. ` : ""}
          Prepare the quotation in Zoho FSM and record its number: Finance cannot record the revenue or issue the tax invoice without it.
        </p>
        <Button size="sm" variant="outline" className="mt-1" onClick={onOpen}>
          {closed ? "Add the number" : "Open the job sheet"}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

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
  /* A call out's access and start (17 Nov 2026). */
  const fieldWork = useFieldWork(kind === "call_out" ? "call_out" : null, id);
  /* Where the job sheet puts its Return / Close visit / report buttons. */
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
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
    fieldWork.reload();
    history.reload();
  };
  /* After a change in a tab: everything the page shows is read again (the header's stage, the tab, the history). */
  const changed = async () => reloadAll();
  const refresh = () => amcRefresh(reloadAll);

  const callOutActions = useCallOutActions(callOut.data, changed, busy, Boolean(fieldWork.data?.startedAt));
  const works = useCallOutWorkDialogs(callOut.data);

  /* The call out's old Findings record (before the job sheet, 18 Nov 2026) shows only when one was kept, read only. */
  /* A call out started by the office is recorded on its job sheet; only one from before that keeps its Findings. */
  const oldFindings = Boolean(callOut.data && (callOut.data.callOut.diagnosis || callOut.data.callOut.resolution) && fieldWork.data && !fieldWork.data.startedAt);
  const tabs: readonly Tab[] = kind ? KIND_TABS[kind].filter((t) => t !== "findings" || oldFindings) : ["overview", "history"];
  /* A tab in the link this kind does not have (?tab=photos on a planned visit) shows the overview. */
  /* Old links to the Photos or Additional work tab open the job sheet, where they now are. */
  const wanted: Tab = kind === "call_out" && (tab === "photos" || tab === "works") ? "job_sheet" : tab;
  const shown: Tab = tabs.includes(wanted) ? wanted : "overview";
  const notFound = header.error && /not found/i.test(header.error);

  /*
    A call out's job sheet submitted by the crew (18 Nov 2026): awaiting the
    supervisor's review, whatever the visits list says yet.
  */
  const crewSubmitted = kind === "call_out" && fieldWork.data?.sheetStatus === "submitted";
  const stage = crewSubmitted ? "review" : v?.stage;
  /* The job sheet is mounted (hidden) once started, in review or done, so its Return / Close buttons are in the header from any tab. */
  const sheetActive = inReviewOrDone(stage) || (kind === "call_out" && Boolean(fieldWork.data?.startedAt));
  const panel = (value: Tab, children: ReactNode) =>
    tabs.includes(value) && (isOpened(value) || shown === value || (value === "job_sheet" && sheetActive)) ? (
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
              <Badge variant="secondary" className={cn("border-0 font-medium", STAGE_TONES[crewSubmitted ? "review" : v.stage])}>
                {FIELD_VISIT_STAGE_LABELS[crewSubmitted ? "review" : v.stage]}
              </Badge>
              {/* The status in words only when it says more than the badge ("Confirmed" twice, 23 Nov 2026). */}
              {(() => {
                const words = crewSubmitted ? "Submitted by the crew" : v.statusLabel;
                const badge = FIELD_VISIT_STAGE_LABELS[crewSubmitted ? "review" : v.stage];
                return words && words.trim().toLowerCase() !== badge.trim().toLowerCase() ? <span className="text-muted-foreground text-sm">{words}</span> : null;
              })()}
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
              <span ref={setHeaderSlot} className="contents" />
              {/* The office starts a planned visit; until then the phone keeps its job sheet shut (17 Nov 2026). */}
              {kind === "ppm" && ppm.data ? <StartVisitAction {...ppmProps(ppm.data)} onTab={setTab} /> : null}
              {kind === "call_out" ? <FieldStartAction kind="call_out" id={id} fw={fieldWork} status={callOut.data?.callOut.status} canEdit={callOut.data?.canEdit} onTab={(t) => setTab(t === "payment" ? "services" : t)} onChanged={changed} disabled={busy} /> : null}
            </>
          }
        />
      )}

      {kind === "call_out" && callOut.data ? <CallOutNotices callOut={callOut.data.callOut} /> : null}

      {v ? (
        <HeaderActionsSlot.Provider value={headerSlot}>
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

            {panel(
              "overview",
              kind === "ppm" ? (
                <PpmOverview v={v} data={ppm} onTab={setTab} />
              ) : kind === "call_out" ? (
                /* The additional work card is hidden from the overview (18 Nov 2026). */
                <CallOutOverview v={v} data={callOut} onTab={setTab} />
              ) : (
                <SectionSkeleton />
              ),
            )}

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
                {panel("access", <FieldWorkAccessCard kind="call_out" id={id} fw={fieldWork} onChanged={changed} />)}
                {/* The services done and their price, from the rate card, charged or free; paid before or after the visit (18 Nov 2026). */}
                {panel("services", <ChargeCard kind="call_out" id={id} coverage={callOut.data?.callOut.coverage ?? null} onChanged={changed} refreshKey={sheetVersion} />)}
                {/* Exactly the planned visit's Job sheet tab (18 Nov 2026): its photos are the crew's, from the phone. */}
                {panel("job_sheet", <JobSheetPanel visitId={id} calls={CALL_OUT_SHEET} onChanged={changed} readOnly refreshKey={sheetVersion} />)}
                {oldFindings ? panel("findings", withCallOut((d) => <CallOutFindingsSection {...callOutProps({ ...d, canEdit: false })} onRaise={works.raise} />)) : null}
              </>
            ) : null}

            {panel("history", <HistoryPanel data={history} />)}
          </Tabs>
        </PanelSurface.Provider>
        </HeaderActionsSlot.Provider>
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

/* A visit in review or done has job sheet buttons for the header. */
const inReviewOrDone = (stage: string | undefined) => stage === "review" || stage === "done";

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

/*
  More than one service on a visit (a clubbed visit), as tiles (17 Nov
  2026): right-aligned lines in a label row read as one long sentence.
*/
function ServiceTiles({ lines }: { lines: Array<{ id: string; label: string; trade: string; units: number }> }) {
  return (
    <div className="mb-2 grid gap-2 pt-1">
      <p className="text-muted-foreground text-sm">
        Services <span className="tabular-nums">({lines.length})</span>
      </p>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {lines.map((l) => (
          <div key={l.id} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
            <span aria-hidden className="bg-muted/50 text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md border">
              <Wrench className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{l.label}</span>
              <span className="text-muted-foreground block text-xs">
                {TRADE_LABELS[l.trade as keyof typeof TRADE_LABELS] ?? l.trade} · <span className="tabular-nums">{l.units}</span> {l.units === 1 ? "unit" : "units"}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
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
          caption={`Needs ${d.need.headcount} ${d.need.headcount === 1 ? "person" : "people"}`}
          tone={v.crew.length ? "good" : "neutral"}
          onSelect={() => onTab("crew")}
          selectLabel="Open crew and time"
        />
        <StatCard
          label="Client"
          value={d.clientConfirmation ? (CONFIRMATION_LABELS[confirmation] ?? confirmation) : "Not requested yet"}
          headline={d.confirmedAt ? `Confirmed ${shortDateTime(d.confirmedAt)}` : `${d.attemptState.tried} of ${d.rule.attemptCount} requests sent${d.attemptState.exhausted ? ", used up" : ""}`}
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
        {d.lines.length > 1 ? <ServiceTiles lines={d.lines} /> : null}
        <DetailList
          rows={[
            ...(d.lines.length > 1 ? [] : [{ label: "Service", value: <ServicesList lines={d.lines} /> }]),
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
  const hm = d.handyman ?? null;
  const due = c.attendDueAt ?? c.scheduleDueAt;
  const lead = v.crew.find((x) => x.lead) ?? v.crew[0];
  return (
    <>
      <StatCardGrid columns={4}>
        <StatCard
          label="Deadline"
          value={c.slaState ? (SLA_LABEL[c.slaState] ?? c.slaState) : "—"}
          headline={due ? `${c.attendDueAt ? "Attend" : "Schedule"} by ${shortDateTime(due)}` : "No deadline"}
          caption={`${CALL_OUT_PRIORITY_LABELS[c.priority]} · reported ${shortDateTime(c.reportedAt)}`}
          tone={c.slaState === "missed" ? "bad" : c.slaState === "at_risk" ? "review" : c.slaState === "met" ? "good" : "progress"}
        />
        <StatCard
          label="Coverage"
          value={c.coverage === "covered" ? "Covered" : "Chargeable"}
          headline={c.coverageOverrideReason ? "Booked as covered (goodwill)" : !a ? "No allowance on this contract" : a.unlimited ? "Unlimited allowance" : a.included === null ? "Included, not counted" : `${a.remaining} of ${a.included}${hm ? " hours" : ""} left`}
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
          onSelect={() => onTab("job_sheet")}
          selectLabel="Open the findings"
        />
      </StatCardGrid>

      {/*
        Redesigned (25 Nov 2026, the user): the issue as the headline, the
        facts as tiles, coverage with the handyman hours and the FSM
        quotation in one block, and what the crew found as rows, as the job
        sheet reads. Not label-and-value lines across the whole width.
      */}
      <SectionCard title="Call out details" description="What the client reported, who to meet on site and why it is covered or not." icon={<PhoneCall />} bodyClassName="px-5 pb-5">
        <div className="grid gap-5">
          <div className="bg-muted/30 flex items-start gap-3 rounded-xl border px-4 py-4">
            <span className="bg-brand-50 text-brand border-brand/20 flex size-10 shrink-0 items-center justify-center rounded-lg border [&_svg]:size-5">
              <PhoneCall />
            </span>
            <div className="grid min-w-0 gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <SubHeading>Reported issue</SubHeading>
                <Badge variant="secondary" className={cn("border-0 font-medium", c.priority === "emergency" ? "bg-danger/10 text-danger" : "bg-mist text-ink-soft")}>
                  {CALL_OUT_PRIORITY_LABELS[c.priority]}
                </Badge>
              </div>
              <p className="text-lg leading-snug font-semibold whitespace-pre-wrap">{c.issue}</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <FactTile
              icon={<CalendarClock />}
              label="Reported"
              value={shortDateTime(c.reportedAt)}
              sub={
                <>
                  {channelLabel(c.channel)}
                  {d.loggedInTime === false ? <span className="text-danger"> · logged late</span> : d.loggedInTime ? " · logged in time" : ""}
                </>
              }
            />
            <FactTile icon={<Wrench />} label="Trade" value={c.trade ? (TRADE_LABELS[c.trade as keyof typeof TRADE_LABELS] ?? c.trade) : null} empty="Not set" />
            <FactTile icon={<UserRound />} label="On-site contact" value={c.onSiteContactName || c.onSiteContactPhone || null} sub={c.onSiteContactName && c.onSiteContactPhone ? c.onSiteContactPhone : null} empty="None given" />
            <FactTile
              icon={<FileText />}
              label="Contract"
              value={
                v.contractId ? (
                  <Link href={`/extensions/amc-contracts/${v.contractId}`} className="text-brand hover:underline">
                    {v.contractNumber ?? "Open"}
                  </Link>
                ) : null
              }
              empty="—"
            />
          </div>

          {/* No Coverage heading, badge or reason line here (25 Nov 2026, the user): the Coverage figure above says it. */}
          <div className="grid gap-3">
            {/* Booked as covered against the check (goodwill): still said, as it is a decision someone made. */}
            {c.coverageOverrideReason ? (
              <p className="text-sm">
                <span className="text-warning font-medium">Booked as covered: </span>
                {c.coverageOverrideReason}
              </p>
            ) : null}

            {/* DEV-495: a handyman job's team-hours as one bar: from the free hours, then chargeable. */}
            {hm ? <HandymanHoursBar hm={hm} allowance={a} /> : null}

            <FsmQuotationNotice state={d.fsmQuotation ?? null} closed={c.status === "closed"} onOpen={() => onTab("job_sheet")} />
          </div>

          {/* What the crew wrote (18 Nov 2026): in full; the diagnosis one finding a row. */}
          {c.diagnosis || c.resolution ? (
            <div className="grid gap-5">
              {c.diagnosis ? (
                <div className="grid gap-2">
                  <SubHeading>Diagnosis</SubHeading>
                  <ul className="divide-y overflow-hidden rounded-lg border">
                    {textLines(c.diagnosis).map((line, i) => (
                      <li key={i} className="flex items-start gap-3 px-4 py-3">
                        <span className="bg-muted/50 text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md border text-xs font-semibold tabular-nums">{i + 1}</span>
                        <span className="min-w-0 flex-1 pt-0.5 text-sm leading-relaxed">{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {c.resolution ? (
                <div className="grid gap-2">
                  <SubHeading>Resolution</SubHeading>
                  <p className="bg-muted/30 rounded-lg border px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">{c.resolution}</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
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
