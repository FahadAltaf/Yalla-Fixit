"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { CheckCircle2, ClipboardCheck, Copy, Database, ExternalLink, FileText, Hammer, ImagePlus, Plus, Save, Send, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { ActionDialogContent, ErrorState, FieldsSkeleton, SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import DateTimeSelect from "@/components/ui/date-time-select";
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
import { PLANNABLE_STATUSES, type VisitStatus } from "@/lib/amc/ppm";
import {
  jobSheetsService,
  type JobSheetInput,
  type JobSheetResponse,
  type PhotoKind,
  type ReportOutcome,
  type ReportState,
} from "@/modules/amc-contracts/job-sheets-service";

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
  checklist: Array<{ key: string; lineId: string | null; assetId: string | null; label: string; result: CheckResult; note: string }>;
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
        .map((c) => ({ lineId: c.lineId, assetId: c.assetId, label: c.label.trim(), result: c.result, note: c.note.trim() || null })),
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

type Prepared = { message: string; whatsapp: string | null };

/**
 * A visit's job sheet (Phase 10: DEV-402, 403, 404): what the crew did,
 * trade by trade, with the checklist, photos and what is left; then the
 * supervisor returns it or closes the visit, which sends the service
 * report. Loads its own data; `canEdit` and `canReview` from the route
 * decide what is offered, and the route checks again.
 */
export function JobSheetPanel({ visitId, onChanged }: { visitId: string; onChanged?: () => unknown }) {
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
    jobSheetsService.jobSheet(visitId).then(
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
  }, [visitId, attempt]);

  /* After a change: the sheet again (a fresh form only when the sheet itself changed), then the screen behind. */
  const refresh = async (resetForm: boolean) => {
    try {
      const data = await jobSheetsService.jobSheet(visitId);
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
      <Alert className="border-warning/30 bg-warning/5 items-start p-4">
        <Database className="text-warning" />
        <AlertTitle>Job sheets need a database update</AlertTitle>
        <AlertDescription>
          The job sheet tables are not on this database yet (migration 20261012110000). Ask an admin to apply it; until then visits are
          closed as before.
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <SheetBody
      key={current.formKey}
      visitId={visitId}
      data={current.data}
      refresh={refresh}
      prepared={prepared?.id === visitId ? prepared.value : null}
      setPrepared={(value) => setPrepared(value ? { id: visitId, value } : null)}
    />
  );
}

type Working = "save" | "photo" | "resend" | null;

function SheetBody({
  visitId,
  data,
  refresh,
  prepared,
  setPrepared,
}: {
  visitId: string;
  data: JobSheetResponse;
  refresh: (resetForm: boolean) => Promise<void>;
  prepared: Prepared | null;
  setPrepared: (value: Prepared | null) => void;
}) {
  const [form, setForm] = useState<FormState>(() => initialForm(data));
  const [working, setWorking] = useState<Working>(null);
  const [dialog, setDialog] = useState<"return" | "close" | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();
  /* Additional work found on a submitted or closed sheet is raised for quoting (Phase 11). */
  const raising = useDialog<JobSheetResponse["sheet"]["additionalWork"][number]>();
  const ids = { arrived: useId(), completed: useId(), faults: useId(), signature: useId(), quality: useId(), qualityNote: useId(), notes: useId() };

  const { visit: v, sheet } = data;
  const status = sheet.status;
  const editableStatus = status === null || status === "draft" || status === "returned";
  const editable = data.canEdit && editableStatus && EDITABLE_VISIT.includes(v.status);
  const busy = working !== null;
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
        await jobSheetsService.save(visitId, built.input);
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
        const result = await jobSheetsService.submit(visitId, built.input);
        toast.success(
          "Submitted for review",
          result.reviewReasons.length ? { description: `Needs a close look: ${result.reviewReasons.map((r) => REVIEW_REASON_LABELS[r]).join(", ")}.` } : undefined,
        );
        await refresh(true);
      },
    });
  };

  const showReport = (report: { outcome: ReportOutcome; message: string; whatsapp: string | null }) => {
    if (report.outcome === "sent") toast.success("Service report emailed to the client");
    else if (report.outcome === "no_recipient") toast.warning("The client has no email address on file: send the report by WhatsApp.");
    else toast.error("The service report email could not be sent. Resend it, or send it by WhatsApp.");
    setPrepared(report.message || report.whatsapp ? { message: report.message, whatsapp: report.whatsapp } : null);
  };

  const resend = () =>
    void run(
      "resend",
      async () => {
        const report = await jobSheetsService.resendReport(visitId);
        showReport(report);
        await refresh(true);
      },
      "Could not send the service report.",
    );

  return (
    <div className="grid gap-4">
      <SheetHeader data={data} />

      {status === "returned" && sheet.reviewComment ? (
        <Alert className="border-warning/30 bg-warning/5 items-start p-4">
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

      {prepared ? <PreparedReport prepared={prepared} onDismiss={() => setPrepared(null)} /> : null}

      {!editable && status === null ? (
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
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <Fact label="Arrived">{sheet.arrivedAt ? formatDateTime(sheet.arrivedAt) : <Muted>—</Muted>}</Fact>
                <Fact label="Completed">{sheet.completedAt ? formatDateTime(sheet.completedAt) : <Muted>—</Muted>}</Fact>
              </dl>
            )}
          </Panel>

          <TradesSection data={data} form={form} editable={editable} setLine={setLine} />

          <ChecklistSection data={data} form={form} editable={editable} setChecklist={(rows) => set("checklist", rows)} />

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
              <dl className="grid gap-2 text-sm">
                <Fact label="Quality concern">
                  {sheet.qualityConcern ? <span className="text-warning">Yes{sheet.qualityNote ? `: ${sheet.qualityNote}` : ""}</span> : "No"}
                </Fact>
                <Fact label="Signed by the client">{sheet.clientSignatureName ?? <Muted>Not signed</Muted>}</Fact>
                <Fact label="Notes">{sheet.notes ? <span className="whitespace-pre-wrap">{sheet.notes}</span> : <Muted>—</Muted>}</Fact>
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
      ) : status === "closed" && data.canReview && (v.reportDocumentId || v.status !== "not_completed") ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-muted-foreground text-sm">
            {v.reportSentAt
              ? `The service report was emailed ${formatDateTime(v.reportSentAt)}.`
              : v.reportDocumentId
                ? "The service report has not reached the client by email yet."
                : "The service report was not made when the visit closed."}
          </p>
          <SubmitButton variant="outline" pending={working === "resend"} pendingLabel="Sending…" disabled={busy} icon={<Send className="size-4" />} onClick={resend}>
            {v.reportDocumentId ? "Resend report" : "Send report"}
          </SubmitButton>
        </div>
      ) : null}

      <ReturnDialog
        open={dialog === "return"}
        onOpenChange={(open) => !open && setDialog(null)}
        onReturn={async (comment) => {
          await jobSheetsService.returnSheet(visitId, comment);
          toast.success("Job sheet returned");
          setDialog(null);
          await refresh(true);
        }}
      />
      <CloseDialog
        open={dialog === "close"}
        onOpenChange={(open) => !open && setDialog(null)}
        data={data}
        onClose={async (comment) => {
          const result = await jobSheetsService.close(visitId, comment);
          toast.success(`Visit ${v.visitNo} closed`, result.remainderVisitId ? { description: "The remaining trade was planned on a new visit." } : undefined);
          if (result.report) showReport(result.report);
          else toast.warning("The visit is closed, but the service report could not be prepared.");
          setDialog(null);
          await refresh(true);
        }}
      />
      <RaiseAdditionalWorkDialog
        key={raising.key}
        open={raising.open}
        onOpenChange={raising.onOpenChange}
        contractId={v.contractId}
        source="visit"
        visitId={visitId}
        initialFinding={raising.target?.description}
        initialTrade={raising.target?.trade}
        initialTechnicianId={v.technicianIds[0] ?? sheet.technicianIds[0] ?? null}
        context={`visit ${v.visitNo}`}
      />
      {confirmDialog}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

function SheetHeader({ data }: { data: JobSheetResponse }) {
  const { visit: v, sheet } = data;
  const status = SHEET_STATUS[sheet.status ?? "none"];
  const report = v.reportState ? REPORT_STATE[v.reportState] : null;
  const showReasons = sheet.status === "submitted" || sheet.status === "closed";

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border px-4 py-3">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className={`border-0 font-medium ${status.tone}`}>
            {status.label}
          </Badge>
          {showReasons ? <ReviewReasonBadges reasons={sheet.reviewReasons} /> : null}
          {report ? (
            <Badge
              variant="secondary"
              className={`border-0 font-medium ${report.tone}`}
              title={v.reportDueAt && v.reportState !== "sent" ? `Due ${formatDateTime(v.reportDueAt)}` : undefined}
            >
              {report.label}
            </Badge>
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs">
          {[
            sheet.submittedAt ? `Submitted ${formatDateTime(sheet.submittedAt)}` : null,
            sheet.returnCount ? `Returned ${sheet.returnCount} ${sheet.returnCount === 1 ? "time" : "times"}` : null,
            v.reportState && v.reportState !== "sent" && v.reportDueAt ? `Report due ${formatDateTime(v.reportDueAt)}` : null,
            v.reportSentAt ? `Report sent ${formatDateTime(v.reportSentAt)}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "Filled in by the crew, then reviewed by a supervisor who closes the visit."}
        </p>
      </div>
      {v.reportDocumentId ? (
        <Button size="sm" variant="outline" asChild>
          <a href={jobSheetsService.reportHref(v.id)} target="_blank" rel="noopener noreferrer">
            <FileText className="size-3.5" />
            Service report
          </a>
        </Button>
      ) : null}
    </div>
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

function PreparedReport({ prepared, onDismiss }: { prepared: Prepared; onDismiss: () => void }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prepared.message);
      toast.success("Message copied");
    } catch {
      toast.error("Could not copy the message.");
    }
  };
  return (
    <div className="border-brand/30 bg-brand-50 grid gap-3 rounded-lg border px-4 py-3">
      <p className="text-sm font-medium">The service report by WhatsApp</p>
      {prepared.message ? <p className="text-sm whitespace-pre-wrap">{prepared.message}</p> : null}
      {!prepared.whatsapp ? <p className="text-muted-foreground text-xs">The client has no phone number on file: copy the message and send it yourself.</p> : null}
      <div className="flex flex-wrap gap-2">
        {prepared.whatsapp ? (
          <Button size="sm" variant="outline" asChild>
            <a href={prepared.whatsapp} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-3.5" />
              Send on WhatsApp
            </a>
          </Button>
        ) : null}
        {prepared.message ? (
          <Button size="sm" variant="outline" onClick={() => void copy()}>
            <Copy className="size-3.5" />
            Copy text
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
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
    <Panel title="Trades" description="Each service on this visit and how it went. Not completed, or only partly, needs its reason.">
      {data.lines.length === 0 ? (
        <p className="text-muted-foreground text-sm">This visit has no services.</p>
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
  const add = () => setChecklist([...rows, { key: newKey(), lineId: null, assetId: null, label: "", result: "ok", note: "" }]);
  const addAssets = () =>
    setChecklist([
      ...rows,
      ...data.assets
        .filter((a) => !rows.some((r) => r.assetId === a.id))
        .map((a) => ({ key: newKey(), lineId: null, assetId: a.id, label: a.label || tradeLabel(a.trade) || "Asset", result: "ok" as const, note: "" })),
    ]);

  if (!editable) {
    return (
      <Panel title="Checklist" description="What the crew checked, item by item.">
        {data.checklist.length === 0 ? (
          <p className="text-muted-foreground text-sm">No checklist items.</p>
        ) : (
          <ul className="divide-y text-sm">
            {data.checklist.map((c) => {
              const result = isCheckResult(c.result) ? c.result : null;
              return (
                <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="font-medium">{c.label}</span>
                    {assetLabel(c.assetId) ? <span className="text-muted-foreground"> · {assetLabel(c.assetId)}</span> : null}
                    {c.note ? <span className="text-muted-foreground block text-xs">{c.note}</span> : null}
                  </span>
                  <Badge variant="secondary" className={`border-0 font-medium ${result ? CHECK_TONE[result] : "bg-mist text-ink-soft"}`}>
                    {result ? CHECK_LABELS[result] : c.result}
                  </Badge>
                </li>
              );
            })}
          </ul>
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
  const [kind, setKind] = useState<PhotoKind>("before");
  const input = useRef<HTMLInputElement>(null);
  const kindId = useId();

  const done = data.lines.some((l) => {
    const outcome = editable ? form.lines[l.id]?.outcome : l.outcome;
    return outcome === "completed" || outcome === "partially_completed";
  });
  const missing = done ? (["before", "after"] as const).filter((k) => !data.photos.some((p) => p.kind === k)) : [];

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
        await jobSheetsService.addPhoto(visitId, { file, kind });
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
        await jobSheetsService.removePhoto(visitId, photoId);
        toast.success("Photo removed");
        await refresh(false);
      },
    });

  return (
    <Panel title="Photos" description="A completed trade needs before and after photos, or the supervisor must review it for missing evidence.">
      {missing.length ? (
        <p className="text-warning text-xs">
          No {missing.map((k) => PHOTO_LABELS[k].toLowerCase()).join(" or ")} photo yet: the supervisor will review it for missing evidence.
        </p>
      ) : null}
      {data.photos.length === 0 ? (
        <p className="text-muted-foreground text-sm">No photos yet.</p>
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
              <Badge variant="secondary" className="bg-background/90 text-foreground absolute bottom-1.5 left-1.5 border-0 font-medium">
                {isPhotoKind(p.kind) ? PHOTO_LABELS[p.kind] : p.kind}
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
        <ReadList items={saved.map((c) => `${c.item} × ${c.quantity}${c.unit ? ` ${c.unit}` : ""}`)} empty="None used." />
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
      {!editable && onRaise && saved.length ? (
        <ul className="grid gap-1.5 text-sm">
          {saved.map((a, i) => (
            <li key={i} className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                {a.description}
                {a.trade ? <span className="text-muted-foreground"> ({tradeLabel(a.trade)})</span> : null}
              </span>
              <Button size="sm" variant="ghost" className="h-7 shrink-0 px-2" onClick={() => onRaise(a)}>
                <Hammer className="size-3.5" />
                Raise as additional work
              </Button>
            </li>
          ))}
        </ul>
      ) : !editable ? (
        <ReadList items={saved.map((a) => `${a.description}${a.trade ? ` (${tradeLabel(a.trade)})` : ""}`)} empty="None found." />
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
        <ReadList items={saved.map((p) => `${p.description}${p.reason ? ` (${p.reason})` : ""}`)} empty="Nothing pending." />
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
  onClose: (comment: string | null) => Promise<void>;
}) {
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState(false);
  const id = useId();
  const remaining = data.lines.filter((l) => l.outcome !== "completed");
  const reasons = data.sheet.reviewReasons;

  const send = async () => {
    setPending(true);
    try {
      await onClose(comment.trim() || null);
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
          <DialogTitle>Close visit {data.visit.visitNo}</DialogTitle>
          <DialogDescription>
            Closing consumes the visit from the contract, plans any trade not completed on a new visit, and emails the service report to the client.
            It cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 text-sm">
          {remaining.length ? (
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
        <Field id={id} label="Comment (optional)">
          <Textarea id={id} rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <SubmitButton pending={pending} pendingLabel="Closing…" icon={<CheckCircle2 className="size-4" />} onClick={() => void send()}>
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

function Panel({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="grid gap-3 rounded-lg border px-4 py-4">
      <div>
        <p className="text-sm font-medium">{title}</p>
        {description ? <p className="text-muted-foreground mt-0.5 text-xs">{description}</p> : null}
      </div>
      {children}
    </div>
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

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground font-normal">{children}</span>;
}

function ReadText({ value }: { value: string | null }) {
  return value ? <p className="text-sm whitespace-pre-wrap">{value}</p> : <p className="text-muted-foreground text-sm">None.</p>;
}

function ReadList({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="text-muted-foreground text-sm">{empty}</p>;
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
