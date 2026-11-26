"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, ChevronDown, CircleDashed, LogIn, Package, Timer, ClipboardCheck, Database, Download, Eye, ExternalLink, FileText, Hammer, ImagePlus, Plus, Save, Send, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, FieldsSkeleton, SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import DateTimeSelect from "@/components/ui/date-time-select";
import { EmptyState } from "@/components/ui/empty-state";
import { TRADE_LABELS, TRADES } from "@/lib/amc/client-profile";
import {
  LINE_OUTCOME_LABELS,
  LINE_OUTCOMES,
  OUTCOME_GROUP_KEYS,
  OUTCOME_GROUPS,
  REVIEW_REASON_LABELS,
  reviewReasons,
  submitProblems,
  type LineOutcome,
  type OutcomeGroup,
  type ReviewReason,
} from "@/lib/amc/job-sheets";
import { AMC_PHOTO_MAX_BYTES } from "@/lib/amc/photos";
import { HANDYMAN_TEAM_NOTE, formatMinutes } from "@/lib/amc/handyman-hours";
import { FSM_QUOTATION_SKIPS, FSM_QUOTATION_SKIP_LABELS, chargeableHandymanHours, type FsmQuotationSkip, type FsmQuotationSkipKind } from "@/lib/amc/fsm-quotation";
import { callOutsService } from "@/modules/amc-contracts/call-outs-service";
import { additionalWorksService } from "@/modules/amc-contracts/additional-works-service";
import { PLANNABLE_STATUSES, type VisitStatus } from "@/lib/amc/ppm";
import { cn } from "@/lib/utils";
import {
  jobSheetsService,
  type JobSheetCalls,
  type JobSheetInput,
  type JobSheetResponse,
  type PhotoKind,
  type ReportState,
} from "@/modules/amc-contracts/job-sheets-service";

import { HeaderActionsSlot, Panel, PanelEmpty } from "./call-out-shared";
import { SendChannelNote, SendChannelToggle, SendDialog, SendResultDialog, announceSend } from "./send-options";
import { ServiceReportViewer, downloadServiceReport, serviceReportPdfBase64 } from "./service-report-viewer";
import type { SendChannel, SendResult } from "@/lib/amc/send-channels";
import { createPortal } from "react-dom";
import { formatDateTime } from "./contract-status";
import { useDialog } from "./profile/use-dialog";
import { RaiseAdditionalWorkDialog } from "./raise-additional-work-dialog";

/* ------------------------------------------------------------------ */
/* Labels and tones                                                    */
/* ------------------------------------------------------------------ */

type SheetStatus = JobSheetResponse["sheet"]["status"];

const SHEET_STATUS: Record<NonNullable<SheetStatus> | "none", { label: string; tone: string }> = {
  none: { label: "Not started", tone: "bg-mist text-ink-soft" },
  draft: { label: "Draft", tone: "bg-mist text-ink-soft" },
  submitted: { label: "Submitted", tone: "bg-brand-50 text-brand" },
  returned: { label: "Returned", tone: "bg-warning/10 text-warning" },
  closed: { label: "Closed", tone: "bg-success/10 text-success" },
};

const REPORT_STATE: Record<NonNullable<ReportState>, { label: string; tone: string }> = {
  sent: { label: "Report sent", tone: "bg-success/10 text-success" },
  on_time: { label: "Report on time", tone: "bg-brand-50 text-brand" },
  at_risk: { label: "Report at risk", tone: "bg-warning/10 text-warning" },
  late: { label: "Report late", tone: "bg-danger/10 text-danger" },
};

const OUTCOME_TONE: Record<LineOutcome, string> = {
  completed: "bg-success/10 text-success",
  partially_completed: "bg-warning/10 text-warning",
  not_completed: "bg-danger/10 text-danger",
};

const CHECK_RESULTS = ["ok", "attention", "fault", "not_applicable"] as const;
type CheckResult = (typeof CHECK_RESULTS)[number];
const CHECK_LABELS: Record<CheckResult, string> = { ok: "OK", attention: "Needs attention", fault: "Fault", not_applicable: "Not applicable" };
const CHECK_TONE: Record<CheckResult, string> = {
  ok: "bg-success/10 text-success",
  attention: "bg-warning/10 text-warning",
  fault: "bg-danger/10 text-danger",
  not_applicable: "bg-mist text-ink-soft",
};

const PHOTO_KINDS = ["before", "after", "fault", "other"] as const satisfies readonly PhotoKind[];
const PHOTO_LABELS: Record<PhotoKind, string> = { before: "Before", after: "After", fault: "Fault", other: "Other" };

/* A job sheet is filled in while the visit is still to do or in progress (as the route). */
const EDITABLE_VISIT: readonly VisitStatus[] = [...PLANNABLE_STATUSES, "in_progress"];
const NONE = "__none";

const tradeLabel = (t: string | null) => (t ? (TRADE_LABELS[t as (typeof TRADES)[number]] ?? t) : null);
const isCheckResult = (r: string): r is CheckResult => (CHECK_RESULTS as readonly string[]).includes(r);
const isPhotoKind = (k: string): k is PhotoKind => (PHOTO_KINDS as readonly string[]).includes(k);
const newKey = () => `new-${Math.random().toString(36).slice(2)}`;

/** An ISO timestamp as a datetime-local value, in the browser's time. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : format(d, "yyyy-MM-dd'T'HH:mm");
}
function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/* ------------------------------------------------------------------ */
/* Form state                                                          */
/* ------------------------------------------------------------------ */

type LineState = { outcome: LineOutcome | null; group: OutcomeGroup | null; reason: string | null };

interface FormState {
  arrivedAt: string;
  completedAt: string;
  lines: Record<string, LineState>;
  /* category: the technician's own grouping from the phone, kept as it is when the office saves. */
  checklist: Array<{ key: string; lineId: string | null; assetId: string | null; label: string; category: string | null; result: CheckResult; note: string }>;
  faults: string;
  consumables: Array<{ key: string; item: string; quantity: string; unit: string }>;
  additionalWork: Array<{ key: string; description: string; trade: string | null }>;
  pendingWorks: Array<{ key: string; description: string; reason: string }>;
  qualityConcern: boolean;
  qualityNote: string;
  clientSignatureName: string;
  notes: string;
}

function initialForm(data: JobSheetResponse): FormState {
  const s = data.sheet;
  return {
    arrivedAt: toLocalInput(s.arrivedAt),
    completedAt: toLocalInput(s.completedAt),
    lines: Object.fromEntries(data.lines.map((l) => [l.id, { outcome: l.outcome, group: l.outcomeGroup, reason: l.outcomeReason }])),
    checklist: data.checklist.map((c, i) => ({
      key: `c${i}`,
      lineId: c.lineId,
      assetId: c.assetId,
      label: c.label,
      category: c.category ?? null,
      result: isCheckResult(c.result) ? c.result : "ok",
      note: c.note ?? "",
    })),
    faults: s.faults ?? "",
    consumables: s.consumables.map((c, i) => ({ key: `m${i}`, item: c.item, quantity: String(c.quantity), unit: c.unit ?? "" })),
    additionalWork: s.additionalWork.map((a, i) => ({ key: `a${i}`, description: a.description, trade: a.trade })),
    pendingWorks: s.pendingWorks.map((p, i) => ({ key: `p${i}`, description: p.description, reason: p.reason })),
    qualityConcern: s.qualityConcern,
    qualityNote: s.qualityNote ?? "",
    clientSignatureName: s.clientSignatureName ?? "",
    notes: s.notes ?? "",
  };
}

const needsReason = (outcome: LineOutcome | null) => outcome === "partially_completed" || outcome === "not_completed";

/** What the route accepts, or why the form cannot be sent yet. */
function buildInput(form: FormState, data: JobSheetResponse): { input: JobSheetInput; error: null } | { input: null; error: string } {
  const consumables = form.consumables.filter((c) => c.item.trim() || c.quantity.trim() || c.unit.trim());
  if (consumables.some((c) => !c.item.trim() || !(Number(c.quantity) > 0))) {
    return { input: null, error: "Each consumable needs an item and a quantity above 0." };
  }
  const additionalWork = form.additionalWork.filter((a) => a.description.trim());
  if (additionalWork.some((a) => a.description.trim().length < 3)) return { input: null, error: "Describe each additional work in a few words." };
  const pendingWorks = form.pendingWorks.filter((p) => p.description.trim() || p.reason.trim());
  if (pendingWorks.some((p) => p.description.trim().length < 3)) return { input: null, error: "Describe each pending work in a few words." };
  const arrivedAt = fromLocalInput(form.arrivedAt);
  const completedAt = fromLocalInput(form.completedAt);
  return {
    error: null,
    input: {
      arrivedAt,
      completedAt,
      technicianIds: data.sheet.technicianIds,
      faults: form.faults.trim() || null,
      consumables: consumables.map((c) => ({ item: c.item.trim(), quantity: Number(c.quantity), unit: c.unit.trim() || null })),
      additionalWork: additionalWork.map((a) => ({ description: a.description.trim(), trade: a.trade })),
      pendingWorks: pendingWorks.map((p) => ({ description: p.description.trim(), reason: p.reason.trim() })),
      qualityConcern: form.qualityConcern,
      qualityNote: form.qualityConcern ? form.qualityNote.trim() || null : null,
      clientSignatureName: form.clientSignatureName.trim() || null,
      notes: form.notes.trim() || null,
      lines: data.lines.map((l) => {
        const s = form.lines[l.id] ?? { outcome: null, group: null, reason: null };
        const explained = needsReason(s.outcome);
        return { lineId: l.id, outcome: s.outcome, outcomeGroup: explained ? s.group : null, outcomeReason: explained ? s.reason : null };
      }),
      checklist: form.checklist
        .filter((c) => c.label.trim())
        .map((c) => ({ lineId: c.lineId, assetId: c.assetId, label: c.label.trim(), category: c.category, result: c.result, note: c.note.trim() || null })),
    },
  };
}

/** The same rules the route applies on submit, so the screen can say what is missing before it is sent. */
function sheetChecks(form: FormState, data: JobSheetResponse) {
  const lines = data.lines.map((l) => form.lines[l.id] ?? { outcome: null, group: null, reason: null });
  const pendingWorks = form.pendingWorks.filter((p) => p.description.trim() || p.reason.trim());
  const facts = {
    pendingWorks,
    qualityConcern: form.qualityConcern,
    additionalWork: form.additionalWork.filter((a) => a.description.trim()),
    lines: lines.map((l) => ({ outcome: l.outcome })),
    photos: data.photos.map((p) => ({ kind: isPhotoKind(p.kind) ? p.kind : "other" })),
    clientSignatureName: form.clientSignatureName.trim() || null,
  };
  const linesExplained = lines.every((l) => !l.outcome || l.outcome === "completed" || l.outcome === "partially_completed" || Boolean(l.group));
  return {
    problems: submitProblems({ ...facts, arrivedAt: fromLocalInput(form.arrivedAt), completedAt: fromLocalInput(form.completedAt), linesExplained }),
    reasons: reviewReasons(facts),
  };
}

/* ------------------------------------------------------------------ */
/* The panel                                                           */
/* ------------------------------------------------------------------ */

/* A report handed to the coordinator to send (WhatsApp or a link), after closing. */
type Prepared = { channel: SendChannel; result: SendResult };

/**
 * A visit's job sheet (Phase 10: DEV-402, 403, 404): what the crew did,
 * trade by trade, with the checklist, photos and what is left; then the
 * supervisor returns it or closes the visit, which sends the service
 * report. Loads its own data; `canEdit` and `canReview` from the route
 * decide what is offered, and the route checks again.
 */
export function JobSheetPanel({
  visitId,
  onChanged,
  readOnly = false,
  refreshKey = 0,
  calls = jobSheetsService,
  photos = null,
}: {
  /** The planned visit's id, or the call out's / additional work's with `calls`. */
  visitId: string;
  /** A call out's or additional work's sheet (fieldJobSheetCalls); a planned visit's when left out. */
  calls?: JobSheetCalls;
  /** The record's own photos card, in place of the sheet's photos (a call out's, an additional work's). */
  photos?: ReactNode;
  onChanged?: () => unknown;
  /** Bumped by the page (Refresh, a change elsewhere on it): the sheet is read again. */
  refreshKey?: number;
  /**
   * The visit page (11 Nov 2026): the crew fills the sheet in on the mobile
   * app, as a Snagging inspection, so the portal only shows it, as a summary
   * and rows, and keeps the supervisor's review (return, close, the report).
   */
  readOnly?: boolean;
}) {
  const [state, setState] = useState<{ id: string | null; data: JobSheetResponse | null; error: string | null; formKey: number }>({
    id: null,
    data: null,
    error: null,
    formKey: 0,
  });
  const [attempt, setAttempt] = useState(0);
  /* The service report's WhatsApp text, kept here so it outlives the form's remount after a close. */
  const [prepared, setPrepared] = useState<{ id: string; value: Prepared } | null>(null);

  useEffect(() => {
    let stale = false;
    calls.jobSheet(visitId).then(
      (data) => !stale && setState((s) => ({ id: visitId, data, error: null, formKey: s.formKey + 1 })),
      (e) =>
        !stale &&
        setState((s) => ({
          id: visitId,
          data: s.id === visitId ? s.data : null,
          error: e instanceof Error ? e.message : "Could not load the job sheet.",
          formKey: s.formKey,
        })),
    );
    return () => {
      stale = true;
    };
  }, [visitId, attempt, refreshKey, calls]);

  /* After a change: the sheet again (a fresh form only when the sheet itself changed), then the screen behind. */
  const refresh = async (resetForm: boolean) => {
    try {
      const data = await calls.jobSheet(visitId);
      setState((s) => ({ id: visitId, data, error: null, formKey: resetForm ? s.formKey + 1 : s.formKey }));
    } catch {
      /* The change itself went through; the next open fetches again. */
    }
    await onChanged?.();
  };

  const current = state.id === visitId ? state : { data: null, error: null, formKey: 0 };

  if (!current.data) {
    return current.error ? (
      <ErrorState title="Could not load the job sheet" message={current.error} onRetry={() => setAttempt((n) => n + 1)} />
    ) : (
      <FieldsSkeleton columns={2} className="p-0" />
    );
  }
  if (!current.data.migrated) {
    return (
      <Alert variant="warning">
        <Database className="text-warning" />
        <AlertTitle>Job sheets need a database update</AlertTitle>
        <AlertDescription>
          {current.data.visit.kind === "call_out" || current.data.visit.kind === "additional_work"
            ? "Job sheets for call outs and additional work are not on this database yet (migration 20261118100000). Ask an admin to apply it."
            : "The job sheet tables are not on this database yet (migration 20261012110000). Ask an admin to apply it; until then visits are closed as before."}
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <SheetCalls.Provider value={calls}>
    <SheetPhotos.Provider value={photos}>
    <SheetBody
      key={current.formKey}
      readOnly={readOnly}
      visitId={visitId}
      data={current.data}
      refresh={refresh}
      prepared={prepared?.id === visitId ? prepared.value : null}
      setPrepared={(value) => setPrepared(value ? { id: visitId, value } : null)}
    />
    </SheetPhotos.Provider>
    </SheetCalls.Provider>
  );
}

type Working = "save" | "photo" | "resend" | null;

/* The calls behind the sheet: a planned visit's by default; a call out's or additional work's when the page gives them (18 Nov 2026). */
const SheetCalls = createContext<JobSheetCalls>(jobSheetsService);
/* A call out's or additional work's own photos card (with the office's Add photo), shown in place of the sheet's (18 Nov 2026). */
const SheetPhotos = createContext<ReactNode | null>(null);
/* "Visit 3", "Call out CO-12". */
const sheetName = (v: JobSheetResponse["visit"]) => (v.label ? v.label.charAt(0).toUpperCase() + v.label.slice(1) : `Visit ${v.visitNo}`);

/* Into the page header's buttons when the page has a header slot; nothing otherwise. */
function HeaderPortal({ children }: { children: ReactNode }) {
  const slot = useContext(HeaderActionsSlot);
  return slot && children ? createPortal(children, slot) : null;
}

function SheetBody({
  readOnly,
  visitId,
  data,
  refresh,
  prepared,
  setPrepared,
}: {
  readOnly: boolean;
  visitId: string;
  data: JobSheetResponse;
  refresh: (resetForm: boolean) => Promise<void>;
  prepared: Prepared | null;
  setPrepared: (value: Prepared | null) => void;
}) {
  const sheetCalls = useContext(SheetCalls);
  const photosSlot = useContext(SheetPhotos);
  const [form, setForm] = useState<FormState>(() => initialForm(data));
  const [working, setWorking] = useState<Working>(null);
  const [dialog, setDialog] = useState<"return" | "close" | "send" | "mark_sent" | null>(null);
  /* The service report on screen, as the proposal and the contract (18 Nov 2026). */
  const [viewingReport, setViewingReport] = useState(false);
  const loadReportFacts = () => sheetCalls.reportFacts(visitId);
  const downloadReport = () => downloadServiceReport(loadReportFacts);
  const { confirm, dialog: confirmDialog } = useConfirm();
  /* Additional work found on a submitted or closed sheet is raised for quoting (Phase 11). */
  const raising = useDialog<JobSheetResponse["sheet"]["additionalWork"][number]>();
  const ids = { arrived: useId(), completed: useId(), faults: useId(), signature: useId(), quality: useId(), qualityNote: useId(), notes: useId() };

  const { visit: v, sheet } = data;
  const status = sheet.status;
  const editableStatus = status === null || status === "draft" || status === "returned";
  const editable = !readOnly && data.canEdit && editableStatus && EDITABLE_VISIT.includes(v.status);
  const busy = working !== null;
  /* The page header, where the review and report buttons go (17 Nov 2026). */
  const headerSlot = useContext(HeaderActionsSlot);
  const checks = editable ? sheetChecks(form, data) : null;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setLine = (lineId: string, next: Partial<LineState>) =>
    setForm((f) => ({ ...f, lines: { ...f.lines, [lineId]: { ...(f.lines[lineId] ?? { outcome: null, group: null, reason: null }), ...next } } }));

  const run = async (kind: Exclude<Working, null>, fn: () => Promise<void>, fallback: string) => {
    setWorking(kind);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : fallback);
    } finally {
      setWorking(null);
    }
  };

  const save = () => {
    const built = buildInput(form, data);
    if (built.error !== null) return void toast.error(built.error);
    void run(
      "save",
      async () => {
        await sheetCalls.save(visitId, built.input);
        toast.success("Job sheet saved");
        await refresh(true);
      },
      "Could not save the job sheet.",
    );
  };

  /* The confirmation runs the submit itself, so it stays open (with the reason) if the route refuses. */
  const submit = () => {
    const built = buildInput(form, data);
    if (built.error !== null) return void toast.error(built.error);
    void confirm({
      title: "Submit the job sheet for review?",
      description:
        "A supervisor checks it and either returns it to you or closes the visit. Until then it cannot be changed, and neither can its photos.",
      confirmText: "Submit for review",
      action: async () => {
        const result = await sheetCalls.submit(visitId, built.input);
        toast.success(
          "Submitted for review",
          result.reviewReasons.length ? { description: `Needs a close look: ${result.reviewReasons.map((r) => REVIEW_REASON_LABELS[r]).join(", ")}.` } : undefined,
        );
        await refresh(true);
      },
    });
  };

  /* The report after closing: an email is announced; WhatsApp or a link is shown to send (17 Nov 2026). */
  const showReport = (channel: SendChannel, report: SendResult) => {
    if (announceSend(channel, report, "Service report")) setPrepared({ channel, result: report });
  };

  /* WhatsApp, email or a link to copy, like every send (17 Nov 2026). */
  const resend = () => setDialog("send");

  return (
    <div className="grid gap-4">
      {readOnly ? <SheetStats data={data} /> : null}
      {/* No status strip (17 Nov 2026): the stat cards say where it stands; the report link is in the page header. */}
      <HeaderPortal>
        {/*
          The report once the crew submitted (18 Nov 2026): viewed as the
          client receives it, or downloaded as the branded PDF -- the same
          design as the proposal and the contract.
        */}
        {status === "submitted" || status === "closed" ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <FileText className="size-4" />
                Service report
                <ChevronDown className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => setViewingReport(true)}>
                <Eye className="size-4" />
                View report
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void downloadReport()}>
                <Download className="size-4" />
                Download PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </HeaderPortal>
      <ServiceReportViewer
        open={viewingReport}
        onOpenChange={setViewingReport}
        loadFacts={loadReportFacts}
        cacheKey={`${visitId}|${status ?? ""}|${sheet.reviewedAt ?? ""}`}
        onSend={
          status === "closed" && data.canReview
            ? () => {
                setViewingReport(false);
                setDialog("send");
              }
            : undefined
        }
      />

      {status === "returned" && sheet.reviewComment ? (
        <Alert variant="warning">
          <Undo2 className="text-warning" />
          <AlertTitle>Returned by the supervisor{sheet.returnCount > 1 ? ` (${sheet.returnCount} times)` : ""}</AlertTitle>
          <AlertDescription>
            <p className="whitespace-pre-wrap">{sheet.reviewComment}</p>
          </AlertDescription>
        </Alert>
      ) : null}
      {status === "closed" && sheet.reviewComment ? (
        <div className="rounded-lg border px-4 py-3 text-sm">
          <p className="text-muted-foreground text-xs">Supervisor&apos;s note{sheet.reviewedAt ? ` · ${formatDateTime(sheet.reviewedAt)}` : ""}</p>
          <p className="mt-1 whitespace-pre-wrap">{sheet.reviewComment}</p>
        </div>
      ) : null}

      {/* 25 Nov 2026: closed without the FSM quotation number: why, and the number added once it is ready. */}
      {status === "closed" && data.fsmQuotation?.migrated && (data.fsmQuotation.skip || data.fsmQuotation.outstanding) && (v.kind === "call_out" || v.kind === "additional_work") ? (
        <FsmQuotationCard kind={v.kind} id={visitId} state={data.fsmQuotation} canEdit={data.canEdit || data.canReview} onSaved={() => refresh(false)} />
      ) : null}

      <SendResultDialog sent={prepared} onClose={() => setPrepared(null)} download={downloadReport} />

      {readOnly && status === null ? (
        <Card className="p-0">
          <EmptyState
            icon={<ClipboardCheck className="size-6" />}
            title="No job sheet yet"
            description="The crew fills it in on the mobile app during the visit: arrival and finish, how each service went, the checklist, photos and the client's sign-off. It shows here as they go, and comes to the supervisor for review when they submit it."
          />
        </Card>
      ) : null}
      {readOnly && status === null && photosSlot ? photosSlot : null}
      {readOnly && status === null ? null : !editable && status === null ? (
        <p className="text-muted-foreground rounded-lg border px-4 py-6 text-center text-sm">
          {data.canEdit
            ? "No job sheet was filled in, and this visit can no longer take one."
            : "No job sheet has been filled in for this visit yet."}
        </p>
      ) : (
        <>
          <Panel title="Times" description="When the crew arrived and finished. The 48-hour report clock runs from completion.">
            {editable ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id={ids.arrived} label="Arrived">
                  <DateTimeSelect id={ids.arrived} value={form.arrivedAt} onChange={(value) => set("arrivedAt", value)} />
                </Field>
                <Field id={ids.completed} label="Completed">
                  <DateTimeSelect id={ids.completed} value={form.completedAt} onChange={(value) => set("completedAt", value)} />
                </Field>
              </div>
            ) : (
              <TimeTiles arrivedAt={sheet.arrivedAt} completedAt={sheet.completedAt} />
            )}
          </Panel>

          <TradesSection data={data} form={form} editable={editable} setLine={setLine} />

          <ChecklistSection data={data} form={form} editable={editable} setChecklist={(rows) => set("checklist", rows)} />

          {photosSlot ?? (
          <PhotosSection
            visitId={visitId}
            data={data}
            form={form}
            editable={editable}
            busy={busy}
            setWorking={setWorking}
            working={working}
            confirm={confirm}
            refresh={refresh}
          />
          )}

          <Panel title="Faults found" description="Anything wrong the crew noticed, whether or not it was fixed.">
            {editable ? (
              <Textarea id={ids.faults} aria-label="Faults found" rows={3} maxLength={4000} value={form.faults} onChange={(e) => set("faults", e.target.value)} />
            ) : (
              <ReadText value={sheet.faults} />
            )}
          </Panel>

          <ConsumablesSection form={form} editable={editable} rows={sheet.consumables} setRows={(rows) => set("consumables", rows)} />
          <AdditionalWorkSection
            form={form}
            editable={editable}
            rows={sheet.additionalWork}
            setRows={(rows) => set("additionalWork", rows)}
            onRaise={data.canEdit && (status === "submitted" || status === "closed") ? raising.show : undefined}
          />
          <PendingWorksSection form={form} editable={editable} rows={sheet.pendingWorks} setRows={(rows) => set("pendingWorks", rows)} />

          <Panel title="Quality and sign-off" description="A quality concern always goes to the supervisor for a close look.">
            {editable ? (
              <>
                <div className="flex items-center gap-3">
                  <Switch id={ids.quality} checked={form.qualityConcern} onCheckedChange={(on) => set("qualityConcern", on)} />
                  <Label htmlFor={ids.quality} className="font-normal">
                    Quality concern
                  </Label>
                </div>
                {form.qualityConcern ? (
                  <Field id={ids.qualityNote} label="What is the concern?">
                    <Textarea id={ids.qualityNote} rows={2} maxLength={2000} value={form.qualityNote} onChange={(e) => set("qualityNote", e.target.value)} />
                  </Field>
                ) : null}
                <Field id={ids.signature} label="Client signature (name)" hint="The client's name, as they signed. It proves the visit was delivered.">
                  <Input
                    id={ids.signature}
                    maxLength={200}
                    value={form.clientSignatureName}
                    onChange={(e) => set("clientSignatureName", e.target.value)}
                  />
                </Field>
                <Field id={ids.notes} label="Notes">
                  <Textarea id={ids.notes} rows={3} maxLength={4000} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
                </Field>
              </>
            ) : (
              /* Long text stacked under its label, not squeezed into a right-aligned row (18 Nov 2026). */
              <dl className="grid gap-4 text-sm">
                <LongFact label="Quality concern">
                  {sheet.qualityConcern ? (
                    <Alert variant="warning">
                      <AlertTriangle />
                      <AlertTitle>Raised by the crew</AlertTitle>
                      {sheet.qualityNote ? <AlertDescription className="whitespace-pre-wrap">{sheet.qualityNote}</AlertDescription> : null}
                    </Alert>
                  ) : (
                    <span className="font-medium">None</span>
                  )}
                </LongFact>
                <Fact label="Signed by the client">{sheet.clientSignatureName ?? <Muted>Not signed</Muted>}</Fact>
                <LongFact label="Notes">
                  {sheet.notes ? <p className="bg-muted/30 rounded-lg border px-3 py-2.5 leading-relaxed whitespace-pre-wrap">{sheet.notes}</p> : <Muted>None</Muted>}
                </LongFact>
              </dl>
            )}
          </Panel>
        </>
      )}

      {/* Actions */}
      {editable ? (
        <div className="grid gap-3 border-t pt-4">
          {checks && checks.problems.length ? (
            <div className="text-muted-foreground text-sm">
              <p className="text-foreground font-medium">Before you can submit</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {checks.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ) : checks && checks.reasons.length ? (
            <p className="text-muted-foreground text-sm">
              The supervisor will look closely at: {checks.reasons.map((r) => REVIEW_REASON_LABELS[r].toLowerCase()).join(", ")}.
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <SubmitButton variant="outline" pending={working === "save"} pendingLabel="Saving…" disabled={busy} icon={<Save className="size-4" />} onClick={save}>
              Save draft
            </SubmitButton>
            <SubmitButton disabled={busy || Boolean(checks?.problems.length)} icon={<Send className="size-4" />} onClick={submit}>
              Submit for review
            </SubmitButton>
          </div>
        </div>
      ) : status === "submitted" && headerSlot ? (
        data.canReview ? (
          createPortal(
            <>
              <Button variant="outline" disabled={busy} onClick={() => setDialog("return")}>
                <Undo2 className="size-4" />
                Return
              </Button>
              <Button disabled={busy} onClick={() => setDialog("close")}>
                <CheckCircle2 className="size-4" />
                Close visit
              </Button>
            </>,
            headerSlot,
          )
        ) : null
      ) : status === "closed" && headerSlot && data.canReview ? (
        /* A report on every close, a visit not completed included (DEV-404). */
        createPortal(
          <>
            {v.reportDocumentId && !v.reportSentAt ? (
              <Button variant="outline" disabled={busy} onClick={() => setDialog("mark_sent")}>
                <CheckCircle2 className="size-4" />
                Mark report sent
              </Button>
            ) : null}
            <SubmitButton variant="outline" pending={working === "resend"} pendingLabel="Sending…" disabled={busy} icon={<Send className="size-4" />} onClick={resend}>
              {v.reportDocumentId ? "Resend report" : "Send report"}
            </SubmitButton>
          </>,
          headerSlot,
        )
      ) : status === "submitted" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-muted-foreground text-sm">
            Submitted{sheet.submittedAt ? ` ${formatDateTime(sheet.submittedAt)}` : ""}.{" "}
            {data.canReview ? "Return it with what needs fixing, or close the visit." : "Waiting for a supervisor's review."}
          </p>
          {data.canReview ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy} onClick={() => setDialog("return")}>
                <Undo2 className="size-4" />
                Return
              </Button>
              <Button disabled={busy} onClick={() => setDialog("close")}>
                <CheckCircle2 className="size-4" />
                Close visit
              </Button>
            </div>
          ) : null}
        </div>
      ) : status === "closed" && data.canReview ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-muted-foreground text-sm">
            {v.reportSentAt
              ? `The service report reached the client ${formatDateTime(v.reportSentAt)}.`
              : v.reportDocumentId
                ? "The service report has not reached the client yet: email it, or mark it sent once you sent it by WhatsApp."
                : "The service report was not made when the visit closed."}
          </p>
          <div className="flex flex-wrap gap-2">
            {v.reportDocumentId && !v.reportSentAt ? (
              <Button variant="outline" disabled={busy} onClick={() => setDialog("mark_sent")}>
                <CheckCircle2 className="size-4" />
                Mark report sent
              </Button>
            ) : null}
            <SubmitButton variant="outline" pending={working === "resend"} pendingLabel="Sending…" disabled={busy} icon={<Send className="size-4" />} onClick={resend}>
              {v.reportDocumentId ? "Resend report" : "Send report"}
            </SubmitButton>
          </div>
        </div>
      ) : null}

      <ReturnDialog
        open={dialog === "return"}
        onOpenChange={(open) => !open && setDialog(null)}
        onReturn={async (comment) => {
          await sheetCalls.returnSheet(visitId, comment);
          toast.success("Job sheet returned");
          setDialog(null);
          await refresh(true);
        }}
      />
      <CloseDialog
        open={dialog === "close"}
        onOpenChange={(open) => !open && setDialog(null)}
        data={data}
        onClose={async (comment, send, fsmQuotationNo, hoursUsed, fsmQuotationSkip) => {
          /* The branded PDF, as the viewer shows it, when a report goes out; else the server prints its own. */
          /* A report on every close (DEV-404). */
          const pdf = await serviceReportPdfBase64(loadReportFacts);
          const result = await sheetCalls.close(visitId, comment, send, pdf, fsmQuotationNo, hoursUsed, fsmQuotationSkip);
          toast.success(`${sheetName(v)} closed`, result.remainderVisitId ? { description: "The remaining trade was planned on a new visit." } : undefined);
          if (result.report) showReport(send, result.report);
          else toast.warning("The visit is closed, but the service report could not be prepared.");
          setDialog(null);
          await refresh(true);
        }}
      />
      <SendDialog
        open={dialog === "send"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={v.reportDocumentId ? "Send the service report again" : "Send the service report"}
        what="the service report"
        noun="Service report"
        download={downloadReport}
        onSend={async (channel) => sheetCalls.resendReport(visitId, channel, await serviceReportPdfBase64(loadReportFacts))}
        onDone={() => refresh(true)}
      />
      <MarkReportSentDialog
        open={dialog === "mark_sent"}
        onOpenChange={(open) => !open && setDialog(null)}
        onSave={async (channel, note) => {
          await sheetCalls.markReportSent(visitId, channel, note);
          toast.success("Service report marked sent");
          setDialog(null);
          await refresh(true);
        }}
      />
      <RaiseAdditionalWorkDialog
        key={raising.key}
        open={raising.open}
        onOpenChange={raising.onOpenChange}
        contractId={v.contractId}
        source={v.kind === "call_out" ? "call_out" : v.kind === "additional_work" ? "manual" : "visit"}
        visitId={v.kind === "call_out" || v.kind === "additional_work" ? null : visitId}
        callOutId={v.kind === "call_out" ? visitId : null}
        initialFinding={raising.target?.description}
        initialTrade={raising.target?.trade}
        initialTechnicianId={v.technicianIds[0] ?? sheet.technicianIds[0] ?? null}
        context={v.label ?? `visit ${v.visitNo}`}
      />
      {confirmDialog}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

/** The sheet at a glance, as a Snagging job's figures: where it stands, services done, the checklist, the photos. */
function SheetStats({ data }: { data: JobSheetResponse }) {
  const { sheet, lines, checklist, photos } = data;
  const status = SHEET_STATUS[sheet.status ?? "none"];
  const done = lines.filter((l) => l.outcome === "completed").length;
  const partly = lines.filter((l) => l.outcome === "partially_completed").length;
  const notDone = lines.filter((l) => l.outcome === "not_completed").length;
  const recorded = done + partly + notDone;
  const ok = checklist.filter((c) => c.result === "ok").length;
  const flagged = checklist.filter((c) => c.result === "fault" || c.result === "attention").length;
  const before = photos.filter((p) => p.kind === "before").length;
  const after = photos.filter((p) => p.kind === "after").length;
  return (
    <StatCardGrid columns={4}>
      <StatCard
        label="Job sheet"
        value={status.label}
        headline={sheet.submittedAt ? `Submitted ${formatDateTime(sheet.submittedAt)}` : sheet.status ? "Being filled in" : "Not started on the app"}
        caption={sheet.returnCount ? `Returned ${sheet.returnCount} ${sheet.returnCount === 1 ? "time" : "times"}` : "Filled in by the crew on the mobile app"}
        tone={sheet.status === "closed" ? "good" : sheet.status === "returned" ? "bad" : sheet.status === "submitted" ? "review" : "neutral"}
      />
      <StatCard
        label="Services done"
        value={`${done} / ${lines.length}`}
        headline={!recorded ? "Nothing recorded yet" : partly || notDone ? [partly ? `${partly} partly` : null, notDone ? `${notDone} not done` : null].filter(Boolean).join(", ") : "All completed"}
        tone={!lines.length || !recorded ? "neutral" : done === lines.length ? "good" : notDone ? "bad" : "progress"}
      />
      <StatCard
        label="Checklist"
        value={checklist.length ? `${ok} / ${checklist.length}` : "0"}
        headline={!checklist.length ? "No checks yet" : flagged ? `${flagged} need attention` : "All OK"}
        tone={!checklist.length ? "neutral" : flagged ? "bad" : "good"}
      />
      <StatCard
        label="Photos"
        value={photos.length}
        headline={!photos.length ? "None yet" : before || after ? `${before} before · ${after} after` : "From the mobile app"}
        caption={photos.length ? `${photos.length} photo${photos.length === 1 ? "" : "s"}` : undefined}
        tone={photos.length ? "good" : "neutral"}
      />
    </StatCardGrid>
  );
}

/* Times and dates in Dubai, whatever the viewer's computer is set to. */
const dubaiTime = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }).format(new Date(iso));
const dubaiDay = (iso: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" }).format(new Date(iso));
const dubaiShort = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }).format(new Date(iso));

/** When the crew arrived and finished, and how long they were on site: three tiles, the time large and the day under it. */
function TimeTiles({ arrivedAt, completedAt }: { arrivedAt: string | null; completedAt: string | null }) {
  const minutes = arrivedAt && completedAt ? Math.round((Date.parse(completedAt) - Date.parse(arrivedAt)) / 60_000) : null;
  const duration = minutes !== null && minutes >= 0 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min` : null;
  const tiles: Array<{ label: string; icon: ReactNode; value: string | null; sub: string | null; empty: string }> = [
    { label: "Arrived", icon: <LogIn />, value: arrivedAt ? dubaiTime(arrivedAt) : null, sub: arrivedAt ? dubaiDay(arrivedAt) : null, empty: "Not yet" },
    { label: "Completed", icon: <CheckCircle2 />, value: completedAt ? dubaiTime(completedAt) : null, sub: completedAt ? dubaiDay(completedAt) : null, empty: "Not yet" },
    {
      label: "Time on site",
      icon: <Timer />,
      value: duration,
      sub: completedAt ? "The 48-hour report clock runs from completion" : "Counted once the crew finishes",
      empty: "—",
    },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {tiles.map((tile) => (
        <div key={tile.label} className="bg-muted/30 flex items-start gap-3 rounded-lg border px-4 py-3">
          <span className="bg-background text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md border [&_svg]:size-4">{tile.icon}</span>
          <div className="min-w-0">
            <div className="text-muted-foreground text-xs">{tile.label}</div>
            <div className={cn("text-xl font-semibold tabular-nums", !tile.value && "text-muted-foreground text-base font-medium")}>{tile.value ?? tile.empty}</div>
            {tile.sub ? <div className="text-muted-foreground text-xs">{tile.sub}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

const PHOTO_KIND_TONE: Record<string, string> = {
  before: "bg-card/90 text-foreground",
  after: "bg-success text-white",
  fault: "bg-danger text-white",
  other: "bg-card/90 text-foreground",
};

/**
 * The visit's photos in one grid, each a card with its kind on the photo,
 * its caption and when it was taken; the pills above narrow it to one kind
 * (Before, After, Fault), with how many of each.
 */
/* Every photo at once (18 Nov 2026): no filter tabs; each photo carries its category. */
function PhotoGroups({ photos }: { photos: JobSheetResponse["photos"] }) {
  const kindOf = (p: JobSheetResponse["photos"][number]) => (isPhotoKind(p.kind) ? p.kind : "other");
  const shown = photos;
  return (
    <div className="grid gap-4">
      <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {shown.map((p) => {
          const k = kindOf(p);
          return (
            <li key={p.id} className="group bg-card overflow-hidden rounded-xl border shadow-xs">
              {p.url ? (
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="relative block overflow-hidden" title="Open the full photo">
                  {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimisable */}
                  <img
                    src={p.url}
                    alt={p.caption ?? `${PHOTO_LABELS[k]} photo`}
                    className="aspect-[4/3] w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                    loading="lazy"
                  />
                  {/* The category the crew chose on the phone, where there is one. */}
                  <span className={cn("absolute top-2 left-2 rounded-md px-2 py-0.5 text-xs font-medium shadow-sm", PHOTO_KIND_TONE[k])}>{p.category ?? PHOTO_LABELS[k]}</span>
                  <span className="bg-card/90 text-foreground absolute top-2 right-2 rounded-md p-1 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                    <ExternalLink className="size-3.5" />
                  </span>
                </a>
              ) : (
                <div className="bg-muted text-muted-foreground flex aspect-[4/3] items-center justify-center text-xs">Unavailable</div>
              )}
              <div className="grid gap-0.5 px-3 py-2.5">
                <p className="truncate text-sm font-medium" title={p.caption ?? undefined}>
                  {p.caption || `${PHOTO_LABELS[k]} photo`}
                </p>
                <p className="text-muted-foreground text-xs">{dubaiShort(p.createdAt)}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Rows with an icon, a title, a line under it and a status on the right (as Snagging's areas). */
function RowList({ children }: { children: ReactNode }) {
  return <ul className="divide-y overflow-hidden rounded-lg border">{children}</ul>;
}

function Row({ icon, title, subtitle, trailing }: { icon: ReactNode; title: ReactNode; subtitle?: ReactNode; trailing?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="bg-muted/50 text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md border [&_svg]:size-4">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        {subtitle ? <div className="text-muted-foreground truncate text-sm">{subtitle}</div> : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </li>
  );
}

/** Why a submitted sheet needs a close look; "Routine" when nothing stands out. */
export function ReviewReasonBadges({ reasons }: { reasons: ReviewReason[] }) {
  if (!reasons.length) {
    return (
      <Badge variant="secondary" className="bg-mist text-ink-soft border-0 font-medium">
        Routine
      </Badge>
    );
  }
  return (
    <>
      {reasons.map((r) => (
        <Badge key={r} variant="secondary" className="bg-warning/10 text-warning border-0 font-medium">
          {REVIEW_REASON_LABELS[r] ?? r}
        </Badge>
      ))}
    </>
  );
}

/** The 48-hour report clock as a badge, or a dash when it has not started. */
export function ReportClockBadge({ state }: { state: ReportState }) {
  if (!state) return <Muted>—</Muted>;
  const r = REPORT_STATE[state];
  return (
    <Badge variant="secondary" className={`border-0 font-medium ${r.tone}`}>
      {r.label}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* Trades                                                              */
/* ------------------------------------------------------------------ */

function TradesSection({
  data,
  form,
  editable,
  setLine,
}: {
  data: JobSheetResponse;
  form: FormState;
  editable: boolean;
  setLine: (lineId: string, next: Partial<LineState>) => void;
}) {
  const base = useId();
  return (
    <Panel title="Services" description="Each service on this visit and how it went. Not completed, or only partly, needs its reason.">
      {data.lines.length === 0 ? (
        <PanelEmpty icon={<ClipboardCheck />} title="No services on this visit" description="The contract's services for this visit show here, with how each one went." />
      ) : !editable ? (
        <RowList>
          {data.lines.map((l) => (
            <Row
              key={l.id}
              icon={l.outcome === "completed" ? <CheckCircle2 className="text-success" /> : l.outcome ? <AlertTriangle className="text-warning" /> : <CircleDashed />}
              title={
                <>
                  {l.serviceLabel}
                  {l.retry ? <span className="text-muted-foreground font-normal"> · retry</span> : null}
                </>
              }
              subtitle={l.outcomeGroup ? `${OUTCOME_GROUPS[l.outcomeGroup]?.label ?? l.outcomeGroup}${l.outcomeReason ? `: ${l.outcomeReason}` : ""}` : l.outcome ? null : "Not recorded yet"}
              trailing={
                <Badge variant="secondary" className={`border-0 font-medium ${l.outcome ? OUTCOME_TONE[l.outcome] : "bg-mist text-ink-soft"}`}>
                  {l.outcome ? LINE_OUTCOME_LABELS[l.outcome] : "Waiting"}
                </Badge>
              }
            />
          ))}
        </RowList>
      ) : (
        <div className="grid gap-3">
          {data.lines.map((l) => {
            const s = form.lines[l.id] ?? { outcome: null, group: null, reason: null };
            const outcome = editable ? s.outcome : l.outcome;
            const group = editable ? s.group : l.outcomeGroup;
            const reason = editable ? s.reason : l.outcomeReason;
            const ids = { outcome: `${base}-${l.id}-o`, group: `${base}-${l.id}-g`, reason: `${base}-${l.id}-r` };
            return (
              <div key={l.id} className="grid gap-3 rounded-lg border px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    {l.serviceLabel}
                    {l.retry ? (
                      <Badge variant="secondary" className="bg-brand-50 text-brand border-0 font-medium">
                        Retry
                      </Badge>
                    ) : null}
                  </span>
                  {!editable ? (
                    outcome ? (
                      <Badge variant="secondary" className={`border-0 font-medium ${OUTCOME_TONE[outcome]}`}>
                        {LINE_OUTCOME_LABELS[outcome]}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-mist text-ink-soft border-0 font-medium">
                        No outcome
                      </Badge>
                    )
                  ) : null}
                </div>
                {editable ? (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field id={ids.outcome} label="Outcome">
                      <Select
                        value={outcome ?? ""}
                        onValueChange={(o) => {
                          const next = o as LineOutcome;
                          /* Partly done defaults to its own group; the crew can still pick another. */
                          if (next === "partially_completed" && !s.group) setLine(l.id, { outcome: next, group: "partial", reason: "Partial completion" });
                          else setLine(l.id, { outcome: next });
                        }}
                      >
                        <SelectTrigger id={ids.outcome} className="w-full">
                          <SelectValue placeholder="Choose" />
                        </SelectTrigger>
                        <SelectContent>
                          {LINE_OUTCOMES.map((o) => (
                            <SelectItem key={o} value={o}>
                              {LINE_OUTCOME_LABELS[o]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    {needsReason(outcome) ? (
                      <>
                        <Field id={ids.group} label="Reason group">
                          <Select
                            value={group ?? ""}
                            onValueChange={(g) => {
                              const next = g as OutcomeGroup;
                              const reasons = OUTCOME_GROUPS[next].reasons as readonly string[];
                              setLine(l.id, { group: next, reason: reasons.length === 1 ? reasons[0] : null });
                            }}
                          >
                            <SelectTrigger id={ids.group} className="w-full">
                              <SelectValue placeholder="Choose" />
                            </SelectTrigger>
                            <SelectContent>
                              {OUTCOME_GROUP_KEYS.map((g) => (
                                <SelectItem key={g} value={g}>
                                  {OUTCOME_GROUPS[g].label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field id={ids.reason} label="Reason">
                          <Select value={reason ?? ""} disabled={!group} onValueChange={(r) => setLine(l.id, { reason: r })}>
                            <SelectTrigger id={ids.reason} className="w-full">
                              <SelectValue placeholder={group ? "Choose" : "Pick a group first"} />
                            </SelectTrigger>
                            <SelectContent>
                              {(group ? (OUTCOME_GROUPS[group].reasons as readonly string[]) : []).map((r) => (
                                <SelectItem key={r} value={r}>
                                  {r}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                      </>
                    ) : null}
                  </div>
                ) : group ? (
                  <p className="text-muted-foreground text-sm">
                    {OUTCOME_GROUPS[group]?.label ?? group}
                    {reason ? `: ${reason}` : ""}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Checklist                                                           */
/* ------------------------------------------------------------------ */

function ChecklistSection({
  data,
  form,
  editable,
  setChecklist,
}: {
  data: JobSheetResponse;
  form: FormState;
  editable: boolean;
  setChecklist: (rows: FormState["checklist"]) => void;
}) {
  const base = useId();
  const assetLabel = (id: string | null) => (id ? (data.assets.find((a) => a.id === id)?.label ?? null) : null);
  const rows = form.checklist;
  const update = (key: string, next: Partial<FormState["checklist"][number]>) => setChecklist(rows.map((r) => (r.key === key ? { ...r, ...next } : r)));
  const add = () => setChecklist([...rows, { key: newKey(), lineId: null, assetId: null, label: "", category: null, result: "ok", note: "" }]);
  const addAssets = () =>
    setChecklist([
      ...rows,
      ...data.assets
        .filter((a) => !rows.some((r) => r.assetId === a.id))
        .map((a) => ({ key: newKey(), lineId: null, assetId: a.id, label: a.label || tradeLabel(a.trade) || "Asset", category: null, result: "ok" as const, note: "" })),
    ]);

  if (!editable) {
    return (
      <Panel title="Checklist" description="What the crew checked, item by item.">
        {data.checklist.length === 0 ? (
          <PanelEmpty icon={<ClipboardCheck />} title="No checks yet" description="The crew goes through the checklist on the mobile app, item by item, and each result shows here." />
        ) : (
          <RowList>
            {data.checklist.map((c) => {
              const result = isCheckResult(c.result) ? c.result : null;
              return (
                <Row
                  key={c.id}
                  icon={result === "ok" ? <CheckCircle2 className="text-success" /> : result === "fault" || result === "attention" ? <AlertTriangle className="text-warning" /> : <CircleDashed />}
                  title={c.label}
                  subtitle={[c.category, assetLabel(c.assetId), c.note].filter(Boolean).join(" · ") || null}
                  trailing={
                    <Badge variant="secondary" className={`border-0 font-medium ${result ? CHECK_TONE[result] : "bg-mist text-ink-soft"}`}>
                      {result ? CHECK_LABELS[result] : c.result}
                    </Badge>
                  }
                />
              );
            })}
          </RowList>
        )}
      </Panel>
    );
  }

  return (
    <Panel title="Checklist" description="What the crew checked, item by item, optionally against one of the property's assets.">
      {rows.length === 0 ? <p className="text-muted-foreground text-sm">No checklist items yet.</p> : null}
      {rows.map((r, i) => {
        const id = `${base}-${r.key}`;
        return (
          <div key={r.key} className="grid gap-2 rounded-lg border px-3 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem_auto] sm:items-end">
            <Field id={`${id}-label`} label="Item">
              <Input id={`${id}-label`} maxLength={300} value={r.label} onChange={(e) => update(r.key, { label: e.target.value })} />
            </Field>
            {data.assets.length ? (
              <Field id={`${id}-asset`} label="Asset (optional)">
                <Select value={r.assetId ?? NONE} onValueChange={(a) => update(r.key, { assetId: a === NONE ? null : a })}>
                  <SelectTrigger id={`${id}-asset`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No asset</SelectItem>
                    {data.assets.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.label || tradeLabel(a.trade)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : (
              <Field id={`${id}-note`} label="Note (optional)">
                <Input id={`${id}-note`} maxLength={1000} value={r.note} onChange={(e) => update(r.key, { note: e.target.value })} />
              </Field>
            )}
            <Field id={`${id}-result`} label="Result">
              <Select value={r.result} onValueChange={(res) => update(r.key, { result: res as CheckResult })}>
                <SelectTrigger id={`${id}-result`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHECK_RESULTS.map((res) => (
                    <SelectItem key={res} value={res}>
                      {CHECK_LABELS[res]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <RemoveButton label={`Remove checklist item ${i + 1}`} onClick={() => setChecklist(rows.filter((x) => x.key !== r.key))} />
            {data.assets.length ? (
              <div className="sm:col-span-4">
                <Field id={`${id}-note`} label="Note (optional)">
                  <Input id={`${id}-note`} maxLength={1000} value={r.note} onChange={(e) => update(r.key, { note: e.target.value })} />
                </Field>
              </div>
            ) : null}
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={add}>
          <Plus className="size-3.5" />
          Add item
        </Button>
        {data.assets.some((a) => !rows.some((r) => r.assetId === a.id)) ? (
          <Button size="sm" variant="ghost" onClick={addAssets}>
            <ClipboardCheck className="size-3.5" />
            Add a row per asset
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Photos                                                              */
/* ------------------------------------------------------------------ */

function PhotosSection({
  visitId,
  data,
  form,
  editable,
  busy,
  working,
  setWorking,
  confirm,
  refresh,
}: {
  visitId: string;
  data: JobSheetResponse;
  form: FormState;
  editable: boolean;
  busy: boolean;
  working: Working;
  setWorking: (w: Working) => void;
  confirm: ReturnType<typeof useConfirm>["confirm"];
  refresh: (resetForm: boolean) => Promise<void>;
}) {
  const sheetCalls = useContext(SheetCalls);
  const [kind, setKind] = useState<PhotoKind>("before");
  const input = useRef<HTMLInputElement>(null);
  const kindId = useId();

  const done = data.lines.some((l) => {
    const outcome = editable ? form.lines[l.id]?.outcome : l.outcome;
    return outcome === "completed" || outcome === "partially_completed";
  });
  /* Any photo is evidence (lib/amc/job-sheets reviewReasons): the app files photos by category, not before / after. */
  const noPhoto = done && data.photos.length === 0;

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setWorking("photo");
    try {
      let added = 0;
      for (const file of Array.from(files)) {
        if (file.size > AMC_PHOTO_MAX_BYTES) {
          toast.error(`${file.name} is larger than 10 MB.`);
          continue;
        }
        await sheetCalls.addPhoto(visitId, { file, kind });
        added += 1;
      }
      if (added) toast.success(added === 1 ? "Photo added" : `${added} photos added`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add the photo.");
    } finally {
      if (input.current) input.current.value = "";
      await refresh(false);
      setWorking(null);
    }
  };

  const remove = (photoId: string) =>
    void confirm({
      title: "Remove this photo?",
      description: "It is removed from the job sheet.",
      confirmText: "Remove",
      variant: "destructive",
      action: async () => {
        await sheetCalls.removePhoto(visitId, photoId);
        toast.success("Photo removed");
        await refresh(false);
      },
    });

  return (
    <Panel title="Photos" description="Work done needs at least one photo, or the supervisor must review it for missing evidence.">
      {noPhoto ? <p className="text-warning text-xs">No photo yet: the supervisor will review it for missing evidence.</p> : null}
      {data.photos.length === 0 ? (
        <PanelEmpty icon={<ImagePlus />} title="No photos yet" description="The crew takes photos on the mobile app, each with a category and a description; they show here." />
      ) : !editable ? (
        <PhotoGroups photos={data.photos} />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {data.photos.map((p) => (
            <li key={p.id} className="relative overflow-hidden rounded-lg border">
              {p.url ? (
                <a href={p.url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimisable */}
                  <img src={p.url} alt={p.caption ?? `${PHOTO_LABELS[p.kind as PhotoKind] ?? "Visit"} photo`} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                </a>
              ) : (
                <div className="bg-muted text-muted-foreground flex aspect-[4/3] items-center justify-center text-xs">Unavailable</div>
              )}
              <Badge variant="secondary" className="bg-card/90 text-foreground absolute bottom-1.5 left-1.5 border-0 font-medium">
                {p.category ?? (isPhotoKind(p.kind) ? PHOTO_LABELS[p.kind] : p.kind)}
              </Badge>
              {editable ? (
                <Button
                  size="icon"
                  variant="secondary"
                  className="absolute top-1.5 right-1.5 size-7 opacity-90"
                  aria-label="Remove photo"
                  disabled={busy}
                  onClick={() => remove(p.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
              {p.caption ? <p className="text-muted-foreground truncate px-2 py-1 text-xs">{p.caption}</p> : null}
            </li>
          ))}
        </ul>
      )}
      {editable ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-2">
            <Label htmlFor={kindId}>Photo of</Label>
            <Select value={kind} onValueChange={(k) => setKind(k as PhotoKind)}>
              <SelectTrigger id={kindId} className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PHOTO_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {PHOTO_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => void add(e.target.files)} />
          <SubmitButton
            variant="outline"
            pending={working === "photo"}
            pendingLabel="Uploading…"
            disabled={busy}
            icon={<ImagePlus className="size-4" />}
            onClick={() => input.current?.click()}
          >
            Add photos
          </SubmitButton>
          <p className="text-muted-foreground w-full text-xs">JPEG, PNG or WebP, up to 10 MB each. Stored privately.</p>
        </div>
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Lists: consumables, additional work, pending works                  */
/* ------------------------------------------------------------------ */

function ConsumablesSection({
  form,
  editable,
  rows: saved,
  setRows,
}: {
  form: FormState;
  editable: boolean;
  rows: JobSheetResponse["sheet"]["consumables"];
  setRows: (rows: FormState["consumables"]) => void;
}) {
  const base = useId();
  const rows = form.consumables;
  const update = (key: string, next: Partial<FormState["consumables"][number]>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...next } : r)));
  return (
    <Panel title="Consumables" description="Materials used on the visit.">
      {!editable ? (
        saved.length ? (
          <RowList>
            {saved.map((c, i) => (
              <Row
                key={i}
                icon={<Package />}
                title={c.item}
                trailing={
                  <span className="text-sm font-medium tabular-nums">
                    {c.quantity}
                    {c.unit ? <span className="text-muted-foreground font-normal"> {c.unit}</span> : null}
                  </span>
                }
              />
            ))}
          </RowList>
        ) : (
          <ReadList items={[]} empty="No materials used." />
        )
      ) : (
        <>
          {rows.map((r, i) => (
            <div key={r.key} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_auto] sm:items-end">
              <Field id={`${base}-${r.key}-item`} label="Item">
                <Input id={`${base}-${r.key}-item`} maxLength={200} value={r.item} onChange={(e) => update(r.key, { item: e.target.value })} />
              </Field>
              <Field id={`${base}-${r.key}-qty`} label="Quantity">
                <Input
                  id={`${base}-${r.key}-qty`}
                  type="number"
                  min={0}
                  step="any"
                  value={r.quantity}
                  onChange={(e) => update(r.key, { quantity: e.target.value })}
                />
              </Field>
              <Field id={`${base}-${r.key}-unit`} label="Unit">
                <Input id={`${base}-${r.key}-unit`} maxLength={20} placeholder="pcs, m, L" value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value })} />
              </Field>
              <RemoveButton label={`Remove consumable ${i + 1}`} onClick={() => setRows(rows.filter((x) => x.key !== r.key))} />
            </div>
          ))}
          <AddButton onClick={() => setRows([...rows, { key: newKey(), item: "", quantity: "1", unit: "" }])}>Add consumable</AddButton>
        </>
      )}
    </Panel>
  );
}

function AdditionalWorkSection({
  form,
  editable,
  rows: saved,
  setRows,
  onRaise,
}: {
  form: FormState;
  editable: boolean;
  rows: JobSheetResponse["sheet"]["additionalWork"];
  setRows: (rows: FormState["additionalWork"]) => void;
  /** Offered on a submitted or closed sheet: raise a row as additional work. */
  onRaise?: (row: JobSheetResponse["sheet"]["additionalWork"][number]) => void;
}) {
  const base = useId();
  const rows = form.additionalWork;
  const update = (key: string, next: Partial<FormState["additionalWork"][number]>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...next } : r)));
  return (
    <Panel title="Additional work found" description="Work outside the contract the crew noticed. It is quoted to the client separately.">
      {!editable && saved.length ? (
        <RowList>
          {saved.map((a, i) => (
            <Row
              key={i}
              icon={<Hammer />}
              title={a.description}
              subtitle={a.trade ? tradeLabel(a.trade) : null}
              trailing={
                onRaise ? (
                  <Button size="sm" variant="outline" onClick={() => onRaise(a)}>
                    <Hammer className="size-3.5" />
                    Raise as additional work
                  </Button>
                ) : (
                  <Badge variant="secondary" className="bg-warning/10 text-warning border-0 font-medium">
                    To quote
                  </Badge>
                )
              }
            />
          ))}
        </RowList>
      ) : !editable ? (
        <ReadList items={[]} empty="Nothing outside the contract was found." />
      ) : (
        <>
          {rows.map((r, i) => (
            <div key={r.key} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
              <Field id={`${base}-${r.key}-desc`} label="Description">
                <Input id={`${base}-${r.key}-desc`} maxLength={1000} value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} />
              </Field>
              <Field id={`${base}-${r.key}-trade`} label="Trade">
                <Select value={r.trade ?? NONE} onValueChange={(t) => update(r.key, { trade: t === NONE ? null : t })}>
                  <SelectTrigger id={`${base}-${r.key}-trade`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not set</SelectItem>
                    {TRADES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {TRADE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <RemoveButton label={`Remove additional work ${i + 1}`} onClick={() => setRows(rows.filter((x) => x.key !== r.key))} />
            </div>
          ))}
          <AddButton onClick={() => setRows([...rows, { key: newKey(), description: "", trade: null }])}>Add additional work</AddButton>
        </>
      )}
    </Panel>
  );
}

function PendingWorksSection({
  form,
  editable,
  rows: saved,
  setRows,
}: {
  form: FormState;
  editable: boolean;
  rows: JobSheetResponse["sheet"]["pendingWorks"];
  setRows: (rows: FormState["pendingWorks"]) => void;
}) {
  const base = useId();
  const rows = form.pendingWorks;
  const update = (key: string, next: Partial<FormState["pendingWorks"][number]>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...next } : r)));
  return (
    <Panel title="Pending works" description="Contract work left to do, each with its reason. Pending works always go to the supervisor for a close look.">
      {!editable ? (
        saved.length ? (
          <RowList>
            {saved.map((p, i) => (
              <Row key={i} icon={<CircleDashed />} title={p.description} subtitle={p.reason || null} />
            ))}
          </RowList>
        ) : (
          <ReadList items={[]} empty="Nothing pending." />
        )
      ) : (
        <>
          {rows.map((r, i) => (
            <div key={r.key} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <Field id={`${base}-${r.key}-desc`} label="Description">
                <Input id={`${base}-${r.key}-desc`} maxLength={1000} value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} />
              </Field>
              <Field id={`${base}-${r.key}-reason`} label="Reason">
                <Input id={`${base}-${r.key}-reason`} maxLength={500} value={r.reason} onChange={(e) => update(r.key, { reason: e.target.value })} />
              </Field>
              <RemoveButton label={`Remove pending work ${i + 1}`} onClick={() => setRows(rows.filter((x) => x.key !== r.key))} />
            </div>
          ))}
          <AddButton onClick={() => setRows([...rows, { key: newKey(), description: "", reason: "" }])}>Add pending work</AddButton>
        </>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Review dialogs                                                      */
/* ------------------------------------------------------------------ */

function ReturnDialog({ open, onOpenChange, onReturn }: { open: boolean; onOpenChange: (open: boolean) => void; onReturn: (comment: string) => Promise<void> }) {
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState(false);
  const id = useId();
  const valid = comment.trim().length >= 3;

  const send = async () => {
    setPending(true);
    try {
      await onReturn(comment.trim());
      setComment("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not return the job sheet.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <ActionDialogContent busy={pending} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Return the job sheet</DialogTitle>
          <DialogDescription>It goes back to the crew to fix and submit again. Say what needs fixing; they are notified.</DialogDescription>
        </DialogHeader>
        <Field id={id} label="What needs fixing">
          <Textarea id={id} rows={4} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} autoFocus />
        </Field>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <SubmitButton pending={pending} pendingLabel="Returning…" disabled={!valid} icon={<Undo2 className="size-4" />} onClick={() => void send()}>
            Return
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

function CloseDialog({
  open,
  onOpenChange,
  data,
  onClose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: JobSheetResponse;
  onClose: (comment: string | null, send: SendChannel, fsmQuotationNo: string | null, hoursUsed: number | null, fsmQuotationSkip: FsmQuotationSkip | null) => Promise<void>;
}) {
  const [comment, setComment] = useState("");
  const [send, setSend] = useState<SendChannel>("email");
  /* DEV-508: a chargeable call out or additional work closes with its FSM quotation number. */
  const fsm = data.fsmQuotation?.migrated ? data.fsmQuotation : null;
  const [fsmNo, setFsmNo] = useState(fsm?.value ?? "");
  const [tried, setTried] = useState(false);
  /* DEV-495: a handyman job's team-hours, from the technician's time on site, whole hours. */
  const hm = data.handyman ?? null;
  const [hours, setHours] = useState(() => String(hm?.hoursUsed ?? hm?.suggestedHours ?? ""));
  const hoursNumber = Number(hours);
  const hoursMissing = Boolean(hm) && !(hours.trim() !== "" && Number.isInteger(hoursNumber) && hoursNumber >= 1 && hoursNumber <= 500);
  /* Hours beyond the free hours left are chargeable, so the number is needed: said here, not only when Close is refused (25 Nov 2026). */
  const overHours = hm && !hoursMissing ? chargeableHandymanHours(hoursNumber, hm.hoursLeft ?? null, hm.covered ?? true) : 0;
  const fsmRequired = Boolean(fsm && (fsm.required || overHours > 0));
  /* Closing without the number, with a reason: not chargeable after all, or the number follows (25 Nov 2026). */
  const [skipKind, setSkipKind] = useState<FsmQuotationSkipKind | null>(null);
  const [skipReason, setSkipReason] = useState("");
  const skipping = fsmRequired && !fsmNo.trim() && skipKind !== null;
  const skipReasonMissing = skipping && skipReason.trim().length < 3;
  const fsmMissing = fsmRequired && !fsmNo.trim() && !skipping;
  const skipId = useId();
  const hoursId = useId();
  const fsmId = useId();
  const [pending, setPending] = useState(false);
  /* A report on every close, a visit not completed included (DEV-404). */
  const reports = true;
  const id = useId();
  const remaining = data.lines.filter((l) => l.outcome !== "completed");
  const reasons = data.sheet.reviewReasons;

  const submit = async () => {
    setTried(true);
    if (hoursMissing) return void toast.error("Enter the hours used", { description: "The team-hours, rounded to the nearest whole hour; at least 1." });
    if (fsmMissing) return void toast.error("Enter the FSM quotation number", { description: "Or tick Not chargeable, or Quotation number later, and say why." });
    if (skipReasonMissing) return void toast.error("Say why it closes without the FSM quotation number");
    setPending(true);
    try {
      await onClose(
        comment.trim() || null,
        send,
        fsm && fsmNo.trim() && fsmNo.trim() !== (fsm.value ?? "") ? fsmNo.trim() : null,
        hm ? hoursNumber : null,
        skipping && skipKind ? { kind: skipKind, reason: skipReason.trim() } : null,
      );
      setComment("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not close the visit.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <ActionDialogContent busy={pending} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Close {data.visit.label ?? `visit ${data.visit.visitNo}`}</DialogTitle>
          <DialogDescription>
            {data.visit.kind === "call_out"
              ? "Closing closes the call out (its allowance is settled as covered or chargeable) and sends the service report to the client the way you pick. It cannot be undone."
              : data.visit.kind === "additional_work"
                ? "Closing marks the work completed, ready to invoice, and sends the service report to the client the way you pick. It cannot be undone."
                : "Closing consumes the visit from the contract, plans any trade not completed on a new visit, and sends the service report to the client the way you pick. It cannot be undone."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 text-sm">
          {data.visit.kind === "call_out" || data.visit.kind === "additional_work" ? (
            <p>
              {remaining.length
                ? data.visit.kind === "call_out"
                  ? "The work was not fully done: any further work goes through additional work."
                  : "The work was not fully done: raise what is left as new additional work."
                : "The work was completed."}
            </p>
          ) : remaining.length ? (
            <p>
              {remaining.length === 1 ? "1 trade was" : `${remaining.length} trades were`} not completed ({remaining.map((l) => l.serviceLabel).join(", ")}): planned
              again on a new visit, unless the no-show rule consumes it.
            </p>
          ) : (
            <p>Every trade was completed.</p>
          )}
          {reasons.length ? (
            <p className="text-warning">Check before closing: {reasons.map((r) => REVIEW_REASON_LABELS[r].toLowerCase()).join(", ")}.</p>
          ) : null}
        </div>
        {hm ? (
          <Field id={hoursId} label="Hours used (team-hours)">
            <Input
              id={hoursId}
              type="number"
              min={1}
              max={500}
              step={1}
              className="sm:w-32"
              value={hours}
              aria-invalid={(tried && hoursMissing) || undefined}
              onChange={(e) => setHours(e.target.value)}
            />
            {tried && hoursMissing ? <p role="alert" className="text-destructive text-xs">Enter the hours as a whole number, at least 1.</p> : null}
            <p className="text-muted-foreground text-xs">
              {hm.minutesOnSite !== null
                ? `The technician recorded ${formatMinutes(hm.minutesOnSite)} on site, with ${hm.teams} team${hm.teams === 1 ? "" : "s"}${hm.fromCrew ? " (one for each technician on the crew)" : ""}: ${hm.suggestedHours} hour${hm.suggestedHours === 1 ? "" : "s"} to the nearest whole hour. `
                : `${hm.teams} team${hm.teams === 1 ? "" : "s"}${hm.fromCrew ? " from the crew" : ""}; the technician's time on site is not on the job sheet. `}
              {HANDYMAN_TEAM_NOTE} A job counts at least 1 hour. The hours come off the free handyman hours; any beyond what is left are chargeable.
            </p>
          </Field>
        ) : null}
        {/* A handyman job may run over the free hours: the number can go in now (required then). */}
        {fsm && (fsmRequired || fsm.value || hm) ? (
          <Field id={fsmId} label={fsmRequired && !skipping ? "FSM quotation number" : "FSM quotation number (optional)"}>
            <Input
              id={fsmId}
              value={fsmNo}
              maxLength={40}
              placeholder="e.g. QT-00123"
              aria-invalid={(tried && fsmMissing) || undefined}
              onChange={(e) => setFsmNo(e.target.value)}
            />
            {tried && fsmMissing ? (
              <p role="alert" className="text-destructive text-xs">
                Enter the FSM quotation number, or tick one of the options below and say why.
              </p>
            ) : null}
            <p className="text-muted-foreground text-xs">
              {overHours > 0
                ? `${hoursNumber} hour${hoursNumber === 1 ? "" : "s"} used${hm?.covered === false ? " on a chargeable booking" : `, ${Math.max(0, hm?.hoursLeft ?? 0)} free hour${(hm?.hoursLeft ?? 0) === 1 ? "" : "s"} left`}: ${overHours} hour${overHours === 1 ? " is" : "s are"} chargeable. Prepare the quotation in Zoho FSM and enter its number: Finance needs it to record the revenue and issue the tax invoice.`
                : fsmRequired
                  ? data.visit.kind === "call_out"
                    ? "This call out is chargeable. Prepare the quotation in Zoho FSM (the client confirmed on WhatsApp) and enter its number: Finance needs it to record the revenue and issue the tax invoice."
                    : "Finance needs the FSM quotation number to record the revenue and issue the tax invoice. Enter the number of the quotation in Zoho FSM."
                  : "Only needed when something is chargeable: hours beyond the free handyman hours, parts or extra time."}
            </p>
          </Field>
        ) : null}
        {/* Without the number, with a reason (25 Nov 2026): one choice at a time. */}
        {fsmRequired && !fsmNo.trim() ? (
          <div className="grid gap-3 rounded-lg border px-4 py-3">
            <p className="text-sm font-medium">No quotation number yet?</p>
            {FSM_QUOTATION_SKIPS.map((k) => (
              <div key={k} className="flex items-start gap-3">
                <Checkbox
                  id={`${skipId}-${k}`}
                  className="mt-0.5"
                  checked={skipKind === k}
                  disabled={pending}
                  onCheckedChange={(on) => setSkipKind(on === true ? k : null)}
                />
                <div className="grid gap-0.5">
                  <Label htmlFor={`${skipId}-${k}`} className="font-normal">
                    {k === "not_chargeable" ? "Not chargeable" : "Add the quotation number later"}
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    {k === "not_chargeable"
                      ? "The client is not charged for this after all: no quotation is needed. Finance sees the reason."
                      : "The client is charged, but the quotation is not ready. Closing goes ahead; the number stays outstanding and is added on the job when it is."}
                  </p>
                </div>
              </div>
            ))}
            {skipKind ? (
              <Field id={`${skipId}-reason`} label="Reason (required)">
                <Textarea
                  id={`${skipId}-reason`}
                  rows={2}
                  maxLength={500}
                  value={skipReason}
                  aria-invalid={(tried && skipReasonMissing) || undefined}
                  placeholder={skipKind === "not_chargeable" ? "e.g. Goodwill: the overrun was caused by our crew, agreed with the manager" : "e.g. Quotation being prepared in FSM, number to follow tomorrow"}
                  onChange={(e) => setSkipReason(e.target.value)}
                />
                {tried && skipReasonMissing ? <p role="alert" className="text-destructive text-xs">Say why, in a few words.</p> : null}
                <p className="text-muted-foreground text-xs">Kept with the job and in its history, with your name.</p>
              </Field>
            ) : null}
          </div>
        ) : null}
        <Field id={id} label="Comment (optional)">
          <Textarea id={id} rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
        {reports ? (
          <div className="grid gap-2">
            <p className="text-sm font-medium">Send the service report by</p>
            <SendChannelToggle value={send} onChange={setSend} disabled={pending} />
            <SendChannelNote channel={send} contacts={{}} what="the service report" attach />
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <SubmitButton pending={pending} pendingLabel="Closing…" icon={<CheckCircle2 className="size-4" />} onClick={() => void submit()}>
            Close visit
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */


/**
 * DEV-404 (20 Nov 2026 review): a WhatsApp text or a copied link does not
 * reach the client by itself, so it does not stop the report's clock. Once
 * the coordinator has sent it, they say so here; it is logged with them.
 */
function MarkReportSentDialog({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (channel: "whatsapp" | "link" | "other", note: string | null) => Promise<void>;
}) {
  const [channel, setChannel] = useState<"whatsapp" | "link" | "other">("whatsapp");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const id = useId();
  const save = async () => {
    setPending(true);
    try {
      await onSave(channel, note.trim() || null);
      setNote("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not mark the report sent.");
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <ActionDialogContent busy={pending} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark the service report sent</DialogTitle>
          <DialogDescription>
            Only when it has reached the client: the 48-hour clock stops and your name is kept with it. An email sent from the portal marks itself.
          </DialogDescription>
        </DialogHeader>
        <Field id={`${id}-channel`} label="How it was sent">
          <Select value={channel} onValueChange={(value) => setChannel(value as typeof channel)}>
            <SelectTrigger id={`${id}-channel`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
              <SelectItem value="link">Link shared</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field id={`${id}-note`} label="Note (optional)">
          <Textarea id={`${id}-note`} rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Sent to the tenant's WhatsApp at 3 pm" />
        </Field>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <SubmitButton pending={pending} pendingLabel="Saving…" icon={<CheckCircle2 className="size-4" />} onClick={() => void save()}>
            Mark sent
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-w-0 content-start gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <div className="text-muted-foreground text-xs">{hint}</div> : null}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{children}</dd>
    </div>
  );
}

/** A label over a long value (a note, a concern), left-aligned and full width. */
function LongFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground font-normal">{children}</span>;
}

/* An empty section as the AMC empty box (17 Nov 2026): icon, words, dashed border -- not a bare line of grey text. */
function ReadEmpty({ text }: { text: string }) {
  return <EmptyState icon={<CircleDashed className="size-5" />} title={text} description="Nothing was recorded here on the visit." className="rounded-lg border border-dashed p-6" />;
}

function ReadText({ value }: { value: string | null }) {
  return value ? <p className="text-sm whitespace-pre-wrap">{value}</p> : <ReadEmpty text="None recorded" />;
}

function ReadList({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <ReadEmpty text={empty.replace(/\.$/, "")} />;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-danger justify-self-end" aria-label={label} onClick={onClick}>
      <Trash2 className="size-4" />
    </Button>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <div>
      <Button size="sm" variant="outline" onClick={onClick}>
        <Plus className="size-3.5" />
        {children}
      </Button>
    </div>
  );
}

/**
 * Closed without the FSM quotation number (25 Nov 2026): not chargeable
 * after all, or the number follows. Says which and why; while the number is
 * owed, it is entered here once the quotation is ready in Zoho FSM.
 */
function FsmQuotationCard({
  kind,
  id,
  state,
  canEdit,
  onSaved,
}: {
  kind: "call_out" | "additional_work";
  id: string;
  state: NonNullable<JobSheetResponse["fsmQuotation"]>;
  canEdit: boolean;
  onSaved: () => Promise<void> | void;
}) {
  const [number, setNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const inputId = useId();
  const notCharged = state.skip?.kind === "not_chargeable";
  const save = async () => {
    const value = number.trim();
    if (!value) return void toast.error("Enter the FSM quotation number");
    setSaving(true);
    try {
      if (kind === "call_out") await callOutsService.action(id, { action: "set_fsm_quotation", fsmQuotationNo: value });
      else await additionalWorksService.action(id, { action: "set_fsm_quotation", fsmQuotationNo: value });
      toast.success("FSM quotation number recorded");
      setNumber("");
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the number.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Alert variant={notCharged ? "default" : state.outstanding ? "warning" : "success"}>
      <FileText />
      <AlertTitle>
        {notCharged ? "Not chargeable: no FSM quotation" : state.outstanding ? "FSM quotation number to follow" : `FSM quotation ${state.value}`}
      </AlertTitle>
      <AlertDescription>
        {state.skip ? (
          <p>
            {FSM_QUOTATION_SKIP_LABELS[state.skip.kind]}
            {state.skip.at ? `, ${formatDateTime(state.skip.at)}` : ""}
            {state.skip.reason ? `: ${state.skip.reason}` : ""}
          </p>
        ) : null}
        {state.outstanding ? (
          canEdit ? (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <div className="grid gap-1">
                <Label htmlFor={inputId} className="text-xs">
                  FSM quotation number
                </Label>
                <Input id={inputId} className="w-48" maxLength={40} placeholder="e.g. QT-00123" value={number} onChange={(e) => setNumber(e.target.value)} />
              </div>
              <SubmitButton size="sm" pending={saving} pendingLabel="Saving…" icon={<CheckCircle2 className="size-4" />} onClick={() => void save()}>
                Record number
              </SubmitButton>
            </div>
          ) : (
            <p>Finance cannot record the revenue or issue the tax invoice until the number is added.</p>
          )
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
