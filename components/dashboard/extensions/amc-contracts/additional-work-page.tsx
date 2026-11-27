"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, FileSignature, Hammer, SquarePen, XCircle } from "lucide-react";

import { SectionCard, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, SectionSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Money } from "@/components/ui/money";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WORK_RISK_LABELS } from "@/lib/amc/call-outs";
import { TRADE_LABELS } from "@/lib/amc/client-profile";
import { FIELD_VISIT_STAGE_LABELS, visitPageHref, type FieldVisitStage } from "@/lib/amc/field-visits";
import { amcRefresh } from "@/lib/amc/http-cache";
import { CHARGE_STATUS_LABELS, PAYMENT_TIMING_LABELS } from "@/lib/amc/visit-charges";
import type { Trade } from "@/lib/amc/visits";
import { cn } from "@/lib/utils";
import { additionalWorksService, type AdditionalWorkResponse } from "@/modules/amc-contracts/additional-works-service";
import { fieldVisitsService, type FieldVisitRow } from "@/modules/amc-contracts/field-visits-service";
import { fieldJobSheetCalls } from "@/modules/amc-contracts/job-sheets-service";

import {
  WorkFindingSection,
  WorkScheduleSection,
  useWorkActions,
  workLocked,
  workSourceLabel,
  type WorkWorking,
} from "./additional-work-sections";
import { HeaderActionsSlot, Muted, PanelSurface, RiskBadge, WorkStatusBadge, shortDateTime } from "./call-out-shared";
import { formatContractDate, formatDateTime } from "./contract-status";
import { DetailHeaderCard, DetailHeaderSkeleton, DetailToolbar, shortPlace } from "./detail-header";
import { DetailList } from "./enquiries/enquiry-ui";
import { FieldStartAction, FieldWorkAccessCard, useFieldWork, type FieldWork } from "./field-work-panels";
import { JobSheetPanel } from "./job-sheet-panel";
import { useTechnicianName } from "./people-pickers";
import { useUrlTab } from "./profile/use-url-tab";
import { useAmcData } from "./use-amc-data";
import { ChargeCard } from "./visit-charge";
import { QuotationCard } from "./quotation-card";
import { HistoryPanel } from "./visit-page";
import { slotLabel } from "./visit-status";

/* The work's job sheet (18 Nov 2026): the planned visit's panel on the work's calls. */
const WORK_SHEET = fieldJobSheetCalls("additional_work");

/*
  The tabs, as a call out's (19 Nov 2026): Overview, Crew & time, Client,
  Access, Services, Job sheet, History, at every status, as a call out has
  them from the moment it is logged. The old Finding, Quotation, Parties and
  Photos tabs live on in links: the finding is on the overview, the
  quotation and its parties under Services, the photos on the job sheet.
*/
const TABS = ["overview", "crew", "access", "services", "job_sheet", "history", "client", "finding", "quotation", "parties", "photos"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  crew: "Crew & time",
  client: "Client",
  access: "Access",
  services: "Services",
  job_sheet: "Job sheet",
  history: "History",
  finding: "Finding",
  quotation: "Quotation",
  parties: "Parties",
  photos: "Photos",
};
/* Exactly a call out's tabs (19 Nov 2026): no Client tab, the client is not asked to confirm. */
const WORK_TABS: readonly Tab[] = ["overview", "crew", "access", "services", "job_sheet", "history"];

const STAGE_TONES: Record<FieldVisitStage, string> = {
  to_plan: "bg-mist text-ink-soft",
  planned: "bg-brand-50 text-brand",
  confirmed: "bg-success/10 text-success",
  in_progress: "bg-warning/10 text-warning",
  review: "bg-warning/10 text-warning",
  done: "bg-success/10 text-success",
  cancelled: "bg-mist text-ink-soft",
};

const LIST = "/extensions/amc-contracts/additional-works";
const VISIT_STATUSES = ["approved", "scheduled", "completed", "invoiced", "paid"];

const shortDay = (iso: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Dubai" }).format(new Date(iso));
const hhmm = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }).format(new Date(iso));
const slotHours = (start: string, end: string | null) => (end ? `${hhmm(start)}–${hhmm(end)}` : hhmm(start));

/**
 * One additional work on its own page, laid out exactly as a call out's
 * (19 Nov 2026): the header with its stage, place, time and crew and what
 * can be done, then Overview, Crew & time, Client, Access, Services, Job
 * sheet and History, loaded when first opened and kept mounted (?tab=…),
 * at every status. Before approval the commercial steps (share, approve,
 * reject) are in the header and each tab says what waits for approval.
 */
export function AdditionalWorkPage({ id }: { id: string }) {
  const router = useRouter();
  const work = useAmcData(async () => ({ ...(await additionalWorksService.work(id)), fetchedAt: Date.now() }), `additional-work:${id}`);
  const { tab, setTab, isOpened } = useUrlTab<Tab>(TABS, "overview");
  const history = useAmcData(() => (isOpened("history") ? additionalWorksService.history(id) : Promise.resolve(null)), isOpened("history") ? `additional-work-history:${id}` : "history:none");
  const [working, setWorking] = useState<WorkWorking>(null);
  const data = work.data;
  const w = data?.work ?? null;

  /* Its stage, crew, access, client confirmation, start and job sheet, as a call out's, from the moment it is raised (19 Nov 2026). */
  const fieldWork = useFieldWork(w ? "additional_work" : null, id);
  /* Its row in AMC -> Visits (every additional work after migration 20261119100000; only approved ones before). */
  const row = useAmcData(() => (w ? fieldVisitsService.visit(id).catch(() => null) : Promise.resolve(null)), w ? `field-visit:${id}` : "field-visit:none");
  const v = row.data?.visit ?? null;
  /* Where the job sheet puts its Return / Close / report buttons; the sheet is read again with everything else. */
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const [sheetVersion, setSheetVersion] = useState(0);
  const reloadAll = () => {
    setSheetVersion((n) => n + 1);
    work.reload();
    fieldWork.reload();
    row.reload();
    history.reload();
  };
  const changed = async () => reloadAll();
  const refresh = () => amcRefresh(reloadAll);
  const actions = useWorkActions(data, changed, working !== null);
  const notFound = work.error && /not found/i.test(work.error);

  const tabs = WORK_TABS;
  /* Old links: the finding on the overview, the quotation and parties under Services, the photos on the job sheet. */
  const wanted: Tab = tab === "finding" || tab === "client" ? "overview" : tab === "quotation" || tab === "parties" ? "services" : tab === "photos" ? "job_sheet" : tab;
  const shown: Tab = tabs.includes(wanted) ? wanted : "overview";

  /* The crew submitted its job sheet: awaiting the supervisor's review, as a call out's. */
  const crewSubmitted = fieldWork.data?.sheetStatus === "submitted";
  const stage: FieldVisitStage | null = v ? (crewSubmitted ? "review" : v.stage) : null;
  /* Once started, in review or done, the job sheet is mounted hidden, so its Return / Close / report buttons are in the header from any tab. */
  const sheetActive = Boolean(fieldWork.data?.startedAt) || stage === "review" || stage === "done" || ["completed", "invoiced", "paid"].includes(w?.status ?? "");
  const panel = (value: Tab, children: ReactNode) =>
    tabs.includes(value) && (isOpened(value) || shown === value || (value === "job_sheet" && sheetActive)) ? (
      <TabsContent value={value} forceMount className="mt-4 flex flex-col gap-4 data-[state=inactive]:hidden">
        {children}
      </TabsContent>
    ) : null;
  const withWork = (render: (d: AdditionalWorkResponse) => ReactNode) => (data ? render(data) : <SectionSkeleton />);
  const props = (d: AdditionalWorkResponse) => ({ data: d, working, setWorking, changed });

  if (notFound) {
    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        <DetailToolbar backHref={LIST} backLabel="Additional work" />
        <Card className="p-0">
          <EmptyState
            icon={<Hammer className="size-6" />}
            title="This additional work could not be found"
            description="It may have been removed, or you may not have access to it."
            action={{ label: "Back to additional work", onClick: () => router.push(LIST), variant: "outline" }}
          />
        </Card>
      </div>
    );
  }

  const sourceHref = w?.source === "visit" && w.visitId ? visitPageHref(w.visitId) : w?.source === "call_out" && w.callOutId ? visitPageHref(w.callOutId) : null;
  const when = (d: AdditionalWorkResponse) =>
    d.slot.scheduledStart ? slotLabel(d.slot.scheduledStart, d.slot.scheduledEnd) : d.work.scheduledFor ? `${formatContractDate(d.work.scheduledFor)} (no slot yet)` : null;
  const crewText = v ? (v.crew.length ? `${v.crew[0].name}${v.crew.length > 1 ? ` +${v.crew.length - 1}` : ""}` : "No crew yet") : null;

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <DetailToolbar
        backHref={LIST}
        backLabel="Additional work"
        fetchedAt={data?.fetchedAt ?? null}
        refreshing={work.reloading || row.reloading || history.reloading}
        onRefresh={refresh}
      />

      {work.error ? (
        <ErrorState title="Could not load the additional work" message={work.error} onRetry={work.reload} />
      ) : !w || !data ? (
        <DetailHeaderSkeleton />
      ) : (
        <DetailHeaderCard
          badges={
            <>
              <Badge variant="outline">Additional work</Badge>
              <Badge variant="outline" className="tabular-nums">
                {w.workNo}
              </Badge>
              <RiskBadge risk={w.risk} />
              {v?.late ? (
                <Badge variant="secondary" className="bg-danger/10 text-danger border-0 font-medium">
                  Overdue
                </Badge>
              ) : null}
            </>
          }
          title={w.customerName || "Additional work"}
          status={
            /* A visit's stage once approved, as a call out's; the quotation's status before. */
            <span className="flex items-center gap-2">
              {stage ? (
                <Badge variant="secondary" className={cn("border-0 font-medium", STAGE_TONES[stage])}>
                  {FIELD_VISIT_STAGE_LABELS[stage]}
                </Badge>
              ) : (
                <WorkStatusBadge status={w.status} />
              )}
              <span className="text-muted-foreground text-sm">{crewSubmitted ? "Submitted by the crew" : v ? v.statusLabel : workSourceLabel(w)}</span>
            </span>
          }
          subline={[shortPlace(w.propertyLabel), when(data) ?? "No slot yet", crewText ?? (w.totals.total ? `AED ${w.totals.total.toLocaleString("en-AE", { minimumFractionDigits: 2 })}` : "Not quoted yet")]
            .filter(Boolean)
            .join(" · ")}
          actions={
            <>
              <Button asChild variant="outline">
                <Link href={`/extensions/amc-contracts/${w.contractId}`}>
                  <FileSignature className="size-4" />
                  Open contract
                </Link>
              </Button>
              {sourceHref ? (
                <Button asChild variant="outline">
                  <Link href={sourceHref}>
                    <ExternalLink className="size-4" />
                    Open {w.source === "visit" ? "visit" : "call out"}
                  </Link>
                </Button>
              ) : null}
              {actions.buttons}
              <span ref={setHeaderSlot} className="contents" />
              {/* Start visit at every status, as a call out's (19 Nov 2026): the dialog says what is missing, first the client's approval. */}
              {w ? (
                <FieldStartAction
                  kind="additional_work"
                  id={id}
                  fw={fieldWork}
                  status={w.status}
                  canEdit={data.canEdit}
                  onTab={(t) => setTab(t === "payment" ? "services" : t)}
                  onChanged={changed}
                  disabled={working !== null}
                />
              ) : null}
            </>
          }
        />
      )}

      {actions.notice}
      {w?.status === "rejected" ? (
        <Alert variant="danger">
          <XCircle />
          <AlertTitle>Rejected{w.rejectedAt ? ` ${formatDateTime(w.rejectedAt)}` : ""}</AlertTitle>
          <AlertDescription>
            <p className="whitespace-pre-wrap">{w.rejectionReason ?? "No reason given."}</p>
          </AlertDescription>
        </Alert>
      ) : null}

      {w ? (
        <HeaderActionsSlot.Provider value={headerSlot}>
          <PanelSurface.Provider value="card">
            <Tabs value={shown} onValueChange={setTab}>
              <TabsList className="h-auto w-full flex-wrap justify-start gap-1 group-data-horizontal/tabs:h-auto">
                {tabs.map((t) => (
                  <TabsTrigger key={t} value={t}>
                    {TAB_LABELS[t]}
                  </TabsTrigger>
                ))}
              </TabsList>

              {panel("overview", withWork((d) => <WorkOverview data={d} v={v} fw={fieldWork} working={working} setWorking={setWorking} changed={changed} onTab={setTab} />))}
              {panel("crew", withWork((d) => <WorkScheduleSection {...props(d)} />))}
              {panel("access", <FieldWorkAccessCard kind="additional_work" id={id} fw={fieldWork} onChanged={changed} />)}
              {/* Exactly a call out's Services tab (19 Nov 2026): the services and their price, each charged or free; they are the quotation the client approves. */}
              {panel(
                "services",
                <div className="grid gap-4">
                  <ChargeCard kind="additional_work" id={id} onChanged={changed} refreshKey={sheetVersion} />
                  {/* The quotation the client approves on a link, as Snagging's (27 Nov 2026). */}
                  <QuotationCard kind="additional_work" id={id} onChanged={changed} refreshKey={sheetVersion} />
                </div>,
              )}
              {/* Exactly the planned visit's and the call out's Job sheet tab (18 Nov 2026). */}
              {/* Exactly the call out's Job sheet tab: its photos are the crew's, on the sheet (no separate photos card, 19 Nov 2026). */}
              {panel("job_sheet", <JobSheetPanel visitId={id} calls={WORK_SHEET} onChanged={changed} readOnly refreshKey={sheetVersion} />)}
              {panel("history", <HistoryPanel data={history} description="Everything that happened to this work, newest first: each step from the finding to the payment, and who took it." />)}
            </Tabs>
          </PanelSurface.Provider>
        </HeaderActionsSlot.Provider>
      ) : null}

      {actions.dialogs}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Overview, as a call out's                                            */
/* ------------------------------------------------------------------ */

const SHEET_STATE: Record<string, { label: string; tone: "good" | "review" | "progress" | "neutral" }> = {
  closed: { label: "Closed", tone: "good" },
  submitted: { label: "Awaiting review", tone: "review" },
  returned: { label: "Returned to the crew", tone: "review" },
  draft: { label: "Being filled in", tone: "progress" },
};

function WorkOverview({
  data,
  v,
  fw,
  working,
  setWorking,
  changed,
  onTab,
}: {
  data: AdditionalWorkResponse;
  v: FieldVisitRow | null;
  fw: FieldWork | null;
  working: WorkWorking;
  setWorking: (w: WorkWorking) => void;
  changed: () => Promise<void>;
  onTab: (tab: Tab) => void;
}) {
  const { work: w, slot, photos } = data;
  const technicianName = useTechnicianName();
  const [editing, setEditing] = useState(false);
  const quoted = w.quotationLines.length > 0;
  const approved = VISIT_STATUSES.includes(w.status);
  const charge = fw?.data?.charge ?? null;
  const sheet = fw?.data?.sheetStatus ?? null;
  const started = Boolean(fw?.data?.startedAt);
  const leadId = slot.leadTechnicianId ?? slot.technicianIds[0] ?? null;
  const lead = v ? (v.crew.find((c) => c.lead) ?? v.crew[0])?.name : leadId ? technicianName(leadId) : null;
  const crewCount = v ? v.crew.length : slot.technicianIds.length;
  const sheetState = sheet ? SHEET_STATE[sheet] : null;
  const canEditFinding = data.canEdit && !workLocked(w);

  return (
    <>
      {/* Four answers, each opening its tab, as a call out's overview. */}
      <StatCardGrid columns={4}>
        <StatCard
          label="Approval"
          value={w.status === "rejected" ? "Rejected" : approved ? "Approved" : w.sharedAt ? "Shared" : quoted ? "Ready to share" : "Not quoted"}
          headline={w.approvedAt ? `Approved ${shortDateTime(w.approvedAt)}` : w.sharedAt ? `Shared ${shortDateTime(w.sharedAt)}` : quoted ? "Share the quotation with the client" : "Prepare it on Services"}
          caption={`${WORK_RISK_LABELS[w.risk]} risk · raised ${shortDateTime(w.createdAt)}`}
          tone={approved ? "good" : w.status === "rejected" ? "bad" : w.sharedAt ? "review" : "neutral"}
          onSelect={() => onTab("services")}
          selectLabel="Open the services and quotation"
        />
        <StatCard
          label="Price"
          value={quoted ? <Money value={w.totals.total} /> : "Not quoted"}
          headline={
            charge
              ? `${CHARGE_STATUS_LABELS[charge.status]}${charge.paymentTiming ? ` · ${PAYMENT_TIMING_LABELS[charge.paymentTiming].toLowerCase()}` : ""}`
              : quoted
                ? "Chargeable, VAT included"
                : "No services yet"
          }
          caption={`${w.quotationLines.length} ${w.quotationLines.length === 1 ? "line" : "lines"}`}
          tone={charge?.status === "paid" ? "good" : quoted ? "review" : "neutral"}
          onSelect={() => onTab("services")}
          selectLabel="Open the services and quotation"
        />
        <StatCard
          label="Crew"
          value={crewCount ? (lead ?? "—") : "Not assigned"}
          headline={slot.scheduledStart ? `${shortDay(slot.scheduledStart)}, ${slotHours(slot.scheduledStart, slot.scheduledEnd)}` : approved ? "No slot yet" : "After the client approves"}
          caption={w.completedAt ? `Completed ${shortDateTime(w.completedAt)}` : crewCount > 1 ? `+${crewCount - 1} more` : undefined}
          tone={w.completedAt ? "good" : crewCount ? "progress" : "neutral"}
          onSelect={() => onTab("crew")}
          selectLabel="Open crew and time"
        />
        <StatCard
          label="Job sheet"
          value={sheetState?.label ?? (started ? "Started" : "Not started")}
          headline={photos.length ? `${photos.length} ${photos.length === 1 ? "photo" : "photos"}` : "No photos yet"}
          caption={started ? undefined : approved ? "Start the visit to open it on the phone" : "Opens once approved and started"}
          tone={sheetState?.tone ?? (started ? "progress" : "neutral")}
          onSelect={() => onTab("job_sheet")}
          selectLabel="Open the job sheet"
        />
      </StatCardGrid>

      <SectionCard
        title="Additional work details"
        description="What was found, where, how serious it is, and the commercial record."
        icon={<Hammer />}
        bodyClassName="px-5 pb-4"
        action={
          canEditFinding ? (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <SquarePen className="size-4" />
              Edit finding
            </Button>
          ) : null
        }
      >
        <DetailList
          rows={[
            { label: "Trade", value: w.trade ? (TRADE_LABELS[w.trade as Trade] ?? w.trade) : <Muted>Not set</Muted> },
            { label: "Risk", value: WORK_RISK_LABELS[w.risk] },
            { label: "Found on", value: workSourceLabel(w) },
            ...(w.technicianId ? [{ label: "Found by", value: technicianName(w.technicianId) ?? "—" }] : []),
            { label: "Raised", value: shortDateTime(w.createdAt) },
            {
              label: "Contract",
              value: (
                <Link href={`/extensions/amc-contracts/${w.contractId}`} className="text-brand hover:underline">
                  {w.contractNumber || "Open"}
                </Link>
              ),
            },
            ...(w.approvalEvidence ? [{ label: "Approval", value: w.approvalEvidence }] : []),
            ...(w.completedAt ? [{ label: "Completed", value: shortDateTime(w.completedAt) }] : []),
            ...(w.invoiceNumber ? [{ label: "Invoice", value: w.invoiceNumber }] : []),
            ...(w.paymentReference ? [{ label: "Payment reference", value: w.paymentReference }] : []),
          ]}
        />
        {/* The finding in full, under its label, as a call out's diagnosis. */}
        <div className="mt-2 grid gap-1 border-t pt-4">
          <p className="text-muted-foreground text-sm">Finding</p>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{w.finding}</p>
        </div>
      </SectionCard>


      <Dialog open={editing} onOpenChange={(next) => working === null && setEditing(next)}>
        <ActionDialogContent busy={working !== null} className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit the finding</DialogTitle>
            <DialogDescription>The technical finding, kept apart from the quotation, and who found it.</DialogDescription>
          </DialogHeader>
          <PanelSurface.Provider value="box">
            <WorkFindingSection
              data={data}
              working={working}
              setWorking={setWorking}
              changed={async () => {
                await changed();
                setEditing(false);
              }}
            />
          </PanelSurface.Provider>
        </ActionDialogContent>
      </Dialog>
    </>
  );
}
