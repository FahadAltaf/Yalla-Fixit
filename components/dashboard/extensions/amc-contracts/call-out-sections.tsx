"use client";

import { useId, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Ban, CalendarCheck, CheckCheck, ChevronRight, Flag, Users, Hammer, MapPinCheck, Plus, Save, Search, Trash2, Wrench } from "lucide-react";
import { toast } from "sonner";

import { SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TruncatedText } from "@/components/ui/truncated-text";
import DateSelect from "@/components/ui/date-select";
import TimeSelect from "@/components/ui/time-select";
import DateTimeSelect from "@/components/ui/date-time-select";
import { canMoveCallOut } from "@/lib/amc/call-outs";
import { additionalWorkPageHref } from "@/lib/amc/field-visits";
import { todayInDubai } from "@/lib/amc/contracts";
import {
  callOutsService,
  type CallOutDetailResponse,
  type CallOutPhotoKind,
  type CallOutRecord,
  type CallOutSuggestion,
} from "@/modules/amc-contracts/call-outs-service";

import {
  Field,
  Muted,
  Panel,
  PanelEmpty,
  PhotosPanel,
  RiskBadge,
  SectionDialog,
  SlaBadge,
  WorkStatusBadge,
  errorText,
  fromLocalInput,
  nowLocalInput,
  shortDateTime,
  useActionForm,
} from "./call-out-shared";
import { formatDateTime } from "./contract-status";
import { CrewPicker, crewOptions, crewSummary } from "./crew-picker";
import { useTechnicianName } from "./people-pickers";
import { useDialog } from "./profile/use-dialog";
import { RaiseAdditionalWorkDialog } from "./raise-additional-work-dialog";
import { slotDate, slotLabel, slotTime } from "./visit-status";

export type CallOutWorking = "suggest" | "schedule" | "attend" | "record" | null;

const PHOTO_KINDS = ["reported", "before", "after", "finding", "other"] as const satisfies readonly CallOutPhotoKind[];
const PHOTO_LABELS: Record<CallOutPhotoKind, string> = { reported: "Reported", before: "Before", after: "After", finding: "Finding", other: "Other" };

const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

/*
  The work on one call out (Phase 11: DEV-405, 406), as sections of its page
  (AMC -> Visits -> the call out): schedule the crew and record attendance,
  the findings (diagnosis, resolution, pending works), photos, and additional
  work raised from it. Closing, cancelling and flagging an emergency as
  misuse are the page's header actions. They were the tabs and footer of the
  call out's dialog. `canEdit` from the route decides what is offered; the
  route checks again.
*/

type CallOutData = CallOutDetailResponse;

/** Close, cancel and flag misuse: the buttons for the page's header, and the form each opens. */
export function useCallOutActions(data: CallOutData | null, changed: () => Promise<void>, disabled: boolean) {
  const actionForm = useActionForm();
  const c = data?.callOut ?? null;

  const post = async (action: Parameters<typeof callOutsService.action>[1], success: string) => {
    if (!c) return;
    await callOutsService.action(c.id, action);
    toast.success(success);
    await changed();
  };

  const askClose = () =>
    c &&
    actionForm.ask({
      title: `Close call out ${c.callOutNo}?`,
      description:
        c.coverage === "covered"
          ? "The visit was delivered: a covered call out uses its unit of the allowance. It stays open while its additional work is still open."
          : "The visit was delivered. It stays open while its additional work is still open.",
      fields: [{ key: "note", label: "Note", type: "textarea", maxLength: 1000 }],
      confirmText: "Close call out",
      icon: <CheckCheck className="size-4" />,
      submit: (v) => post({ action: "close", note: v.note || null }, `Call out ${c.callOutNo} closed`),
    });

  const askCancel = () =>
    c &&
    actionForm.ask({
      title: `Cancel call out ${c.callOutNo}?`,
      description: "Any booked unit of the allowance is released.",
      fields: [{ key: "reason", label: "Reason", type: "textarea", minLength: 3, maxLength: 500 }],
      confirmText: "Cancel call out",
      variant: "destructive",
      icon: <Ban className="size-4" />,
      submit: (v) => post({ action: "cancel", reason: v.reason }, `Call out ${c.callOutNo} cancelled`),
    });

  const askMisuse = () =>
    c &&
    actionForm.ask({
      title: "Flag misuse of the emergency line?",
      description: "Recorded on the call out and in the audit trail, for the account manager to raise with the client.",
      fields: [{ key: "note", label: "What happened", type: "textarea", minLength: 3, maxLength: 1000 }],
      confirmText: "Flag misuse",
      variant: "destructive",
      icon: <Flag className="size-4" />,
      submit: (v) => post({ action: "flag_misuse", note: v.note }, "Flagged as misuse"),
    });

  const buttons =
    c && data?.canEdit ? (
      <>
        {c.priority === "emergency" && !c.misuseFlag ? (
          <Button variant="ghost" className="text-danger hover:text-danger" disabled={disabled} onClick={askMisuse}>
            <Flag className="size-4" />
            Flag misuse
          </Button>
        ) : null}
        {canMoveCallOut(c.status, "cancelled") ? (
          <Button variant="outline" className="text-danger hover:text-danger" disabled={disabled} onClick={askCancel}>
            <Ban className="size-4" />
            Cancel call out
          </Button>
        ) : null}
        {canMoveCallOut(c.status, "closed") ? (
          <Button disabled={disabled} onClick={askClose}>
            <CheckCheck className="size-4" />
            Close call out
          </Button>
        ) : null}
      </>
    ) : null;

  return { buttons, dialog: actionForm.dialog };
}

/**
 * Raising additional work from the call out (a dialog), and opening one:
 * its own page (AMC -> Additional work -> the work), where a work just
 * raised is opened to be quoted.
 */
export function useCallOutWorkDialogs(data: CallOutData | null, changed: () => Promise<void>) {
  const raising = useDialog<true>();
  const router = useRouter();
  const open = (workId: string) => router.push(additionalWorkPageHref(workId));
  const c = data?.callOut ?? null;
  const dialogs = c ? (
    <>
      <RaiseAdditionalWorkDialog
        key={`raise-${raising.key}`}
        open={raising.open}
        onOpenChange={raising.onOpenChange}
        contractId={c.contractId}
        source="call_out"
        callOutId={c.id}
        initialFinding={[c.diagnosis, c.partsNeeded ? `Parts needed: ${c.partsNeeded}` : null].filter(Boolean).join("\n")}
        initialTrade={c.trade}
        initialTechnicianId={c.technicianIds[0] ?? null}
        context={`call out ${c.callOutNo}`}
        onRaised={async (w) => {
          await changed();
          open(w.id);
        }}
      />
    </>
  ) : null;
  return { raise: () => raising.show(true), open, dialogs };
}

/** Misuse flagged, or why it was cancelled: shown above the page's tabs. */
export function CallOutNotices({ callOut: c }: { callOut: CallOutRecord }) {
  return (
    <>
      {c.misuseFlag ? (
        <Alert variant="destructive" className="border-destructive/30 items-start p-4">
          <Flag />
          <AlertTitle>Misuse of the emergency line</AlertTitle>
          <AlertDescription>
            <p className="whitespace-pre-wrap">{c.misuseNote ?? "No note."}</p>
          </AlertDescription>
        </Alert>
      ) : null}
      {c.status === "cancelled" && c.statusReason ? (
        <Alert className="items-start p-4">
          <Ban />
          <AlertTitle>Cancelled{c.closedAt ? ` · ${formatDateTime(c.closedAt)}` : ""}</AlertTitle>
          <AlertDescription>
            <p className="whitespace-pre-wrap">{c.statusReason}</p>
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}

type PageSectionProps = { data: CallOutData; working: CallOutWorking; setWorking: (w: CallOutWorking) => void; changed: () => Promise<void> };

/** Crew and time: where it stands, then Schedule (or Reschedule) and Record attendance, each in a dialog. */
export function CallOutCrewSection({ data, working, setWorking, changed }: PageSectionProps) {
  const c = data.callOut;
  const technicianName = useTechnicianName();
  const [open, setOpen] = useState<"schedule" | "attend" | null>(null);
  const canSchedule = data.canEdit && canMoveCallOut(c.status, "scheduled");
  const canAttend = data.canEdit && canMoveCallOut(c.status, "attended");
  const due = c.attendDueAt ?? c.scheduleDueAt;
  return (
    <>
      <Panel
        title="Crew and time" icon={<Users />}
        description="When the crew goes, who goes, and when they arrived. Arrival settles the deadline."
        actions={
          canSchedule || canAttend ? (
            <>
              {canAttend ? (
                <Button variant={canSchedule ? "outline" : "default"} disabled={working !== null} onClick={() => setOpen("attend")}>
                  <MapPinCheck className="size-4" />
                  Record attendance
                </Button>
              ) : null}
              {canSchedule ? (
                <Button disabled={working !== null} onClick={() => setOpen("schedule")}>
                  <CalendarCheck className="size-4" />
                  {c.scheduledStart ? "Reschedule" : "Schedule the visit"}
                </Button>
              ) : null}
            </>
          ) : null
        }
      >
        <dl className="divide-y text-sm">
          <InfoRow label="Planned for">{c.scheduledStart ? slotLabel(c.scheduledStart, c.scheduledEnd) : <Muted>No time set yet</Muted>}</InfoRow>
          <InfoRow label="Crew">{c.technicianIds.length ? c.technicianIds.map((t) => technicianName(t)).join(", ") : <Muted>None yet</Muted>}</InfoRow>
          <InfoRow label="Deadline">
            <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
              <SlaBadge state={c.slaState} dueAt={null} withDue={false} />
              {due ? <span className="font-normal">{c.priority === "emergency" ? "attend" : "visit"} by {shortDateTime(due)}</span> : null}
            </span>
          </InfoRow>
          <InfoRow label="Attended">{c.attendedAt ? formatDateTime(c.attendedAt) : <Muted>Not yet</Muted>}</InfoRow>
        </dl>
        {!data.canEdit ? (
          <p className="text-muted-foreground text-sm">You can see this call out, but not change it.</p>
        ) : !canSchedule && !canAttend ? (
          <p className="text-muted-foreground text-sm">The visit is done; see Findings.</p>
        ) : null}
      </Panel>
      <ScheduleDialog callOut={c} open={open === "schedule"} onOpenChange={(next) => setOpen(next ? "schedule" : null)} working={working} setWorking={setWorking} changed={changed} />
      <AttendDialog callOut={c} open={open === "attend"} onOpenChange={(next) => setOpen(next ? "attend" : null)} working={working} setWorking={setWorking} changed={changed} />
    </>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{children}</dd>
    </div>
  );
}

/** What the crew found and did; parts or a long fix suggest raising additional work. */
export function CallOutFindingsSection({ data, working, setWorking, changed, onRaise }: PageSectionProps & { onRaise: () => void }) {
  const [suggestWork, setSuggestWork] = useState(false);
  return (
    <>
      {suggestWork ? (
        <Alert className="border-warning/30 bg-warning/5 items-start p-4">
          <AlertTriangle className="text-warning" />
          <AlertTitle>This looks like additional work</AlertTitle>
          <AlertDescription>
            <p>Parts are needed, or the fix takes longer than {data.minorFixHours} hours: quote it to the client as additional work.</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => {
                setSuggestWork(false);
                onRaise();
              }}
            >
              <Hammer className="size-4" />
              Raise additional work
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <RecordSection callOut={data.callOut} canEdit={data.canEdit} working={working} setWorking={setWorking} changed={changed} onSuggestWork={() => setSuggestWork(true)} />
    </>
  );
}

export function CallOutPhotosSection({ data, working, changed }: Omit<PageSectionProps, "setWorking">) {
  const c = data.callOut;
  return (
    <PhotosPanel
      description="What the client reported, before and after."
      photos={data.photos}
      kinds={PHOTO_KINDS}
      labels={PHOTO_LABELS}
      editable={data.canEdit}
      disabled={working !== null}
      upload={(file, kind) => callOutsService.addPhoto(c.id, { file, kind })}
      onUploaded={changed}
      remove={async (photoId) => {
        await callOutsService.removePhoto(c.id, photoId);
        await changed();
      }}
    />
  );
}

export function CallOutWorksSection({ data, onRaise, onOpen }: { data: CallOutData; onRaise: () => void; onOpen: (workId: string) => void }) {
  const c = data.callOut;
  const open = c.status !== "closed" && c.status !== "cancelled";
  return (
    <Panel
      title="Additional work"
      icon={<Hammer />}
      description="Work outside the contract found on this call out. The call out stays open until each is done or declined."
      actions={
        data.canEdit && open ? (
          <Button onClick={onRaise}>
            <Plus className="size-4" />
            Raise additional work
          </Button>
        ) : null
      }
    >
      {data.additionalWorks.length === 0 ? (
        <PanelEmpty icon={<Hammer />} title="No additional work" description="Work outside the contract found on this call out (parts, or a longer fix) is quoted to the client from here." />
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {data.additionalWorks.map((w) => (
            <li key={w.id}>
              <button type="button" className="hover:bg-muted/40 flex w-full items-center gap-3 px-4 py-3 text-left text-sm" onClick={() => onOpen(w.id)}>
                <span className="bg-muted/50 text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md border [&_svg]:size-4">
                  <Hammer />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{w.workNo}</span>
                    <WorkStatusBadge status={w.status} />
                    <RiskBadge risk={w.risk} />
                  </span>
                  <TruncatedText className="text-muted-foreground text-xs">{w.finding}</TruncatedText>
                </span>
                <span className="shrink-0">{w.total ? <Money value={w.total} /> : <Muted>Not quoted</Muted>}</span>
                <ChevronRight className="text-muted-foreground size-4 shrink-0" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** One action at a time: a failure is a toast, the form stays as it was. */
function useRun(setWorking: (w: CallOutWorking) => void) {
  return async (kind: Exclude<CallOutWorking, null>, fn: () => Promise<void>, fallback: string) => {
    setWorking(kind);
    try {
      await fn();
    } catch (e) {
      toast.error(errorText(e, fallback));
    } finally {
      setWorking(null);
    }
  };
}

type SectionProps = {
  callOut: CallOutRecord;
  canEdit: boolean;
  working: CallOutWorking;
  setWorking: (w: CallOutWorking) => void;
  changed: () => Promise<void>;
};

type DialogProps = Omit<SectionProps, "canEdit"> & { open: boolean; onOpenChange: (open: boolean) => void };

/* ------------------------------------------------------------------ */
/* Schedule                                                            */
/* ------------------------------------------------------------------ */

function ScheduleDialog({ callOut: c, open, onOpenChange, working, setWorking, changed }: DialogProps) {
  const run = useRun(setWorking);
  const placedMinutes = c.scheduledStart && c.scheduledEnd ? Math.round((Date.parse(c.scheduledEnd) - Date.parse(c.scheduledStart)) / 60_000) : null;
  const [date, setDate] = useState(() => (c.scheduledStart ? slotDate(c.scheduledStart) : todayInDubai()));
  const [time, setTime] = useState(() => (c.scheduledStart ? slotTime(c.scheduledStart) : "09:00"));
  const [duration, setDuration] = useState(String(placedMinutes ?? (c.priority === "emergency" ? 60 : 120)));
  const [suggestion, setSuggestion] = useState<{ key: string; data: CallOutSuggestion } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [override, setOverride] = useState("");
  const ids = { date: useId(), time: useId(), duration: useId(), override: useId() };

  const minutes = Number(duration);
  const validSlot = isIsoDate(date) && isTime(time) && Number.isInteger(minutes) && minutes >= 15 && minutes <= 720;
  const slotKey = `${date}|${time}|${minutes}`;
  const fresh = suggestion?.key === slotKey ? suggestion.data : null;
  const suggestedIds = fresh?.suggested.technicianIds ?? [];
  const differs = fresh !== null && !sameSet(picked, suggestedIds);
  /* The server refuses a crew other than the suggested one without a reason (when there was a suggestion). */
  const reasonRequired = differs && suggestedIds.length > 0;
  const reasonMissing = reasonRequired && override.trim().length < 3;
  const options = fresh ? crewOptions(fresh) : null;

  const find = () =>
    void run(
      "suggest",
      async () => {
        const data = await callOutsService.suggest(c.id, date, time, minutes);
        setSuggestion({ key: slotKey, data });
        setPicked(data.suggested.technicianIds);
        setOverride("");
        if (!data.fits.some((f) => f.blockers.length === 0)) toast.warning("Nobody competent is free at that time.");
      },
      "Could not find technicians.",
    );

  const save = () =>
    void run(
      "schedule",
      async () => {
        await callOutsService.action(c.id, {
          action: "schedule",
          date,
          time,
          durationMinutes: minutes,
          technicianIds: picked,
          overrideReason: differs && override.trim() ? override.trim() : null,
        });
        toast.success(c.scheduledStart ? `Call out ${c.callOutNo} rescheduled` : `Call out ${c.callOutNo} scheduled`);
        setSuggestion(null);
        onOpenChange(false);
        await changed();
      },
      "Could not schedule the call out.",
    );

  return (
    <SectionDialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={c.scheduledStart ? `Reschedule call out ${c.callOutNo}` : `Schedule call out ${c.callOutNo}`}
      description="Pick a day and time, then find who is competent for the trade and free. Blocked technicians show why."
      busy={working === "schedule"}
      submit={
        <SubmitButton
          pending={working === "schedule"}
          pendingLabel="Saving…"
          disabled={working !== null || !fresh || picked.length === 0 || picked.length > 10 || reasonMissing}
          icon={<CalendarCheck className="size-4" />}
          onClick={save}
        >
          {c.scheduledStart ? "Reschedule" : "Schedule"}
        </SubmitButton>
      }
    >
      {!c.trade ? <p className="text-warning text-xs">This call out has no trade, so nobody can be confirmed competent for it.</p> : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id={ids.date} label="Date">
          <DateSelect id={ids.date} value={date} onChange={setDate} />
        </Field>
        <Field id={ids.time} label="Start time">
          <TimeSelect id={ids.time} step={900} value={time} onChange={setTime} />
        </Field>
        <Field id={ids.duration} label="Duration (minutes)">
          <Input id={ids.duration} type="number" min={15} max={720} step={15} value={duration} onChange={(e) => setDuration(e.target.value)} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">
          {suggestion && !fresh
            ? "The day or time changed: find technicians again."
            : !validSlot
              ? "Enter a date, a start time and 15 to 720 minutes."
              : !fresh
                ? "Then choose the crew."
                : reasonMissing
                  ? "Say why this crew was chosen instead of the suggested one."
                  : crewSummary(picked)}
        </p>
        <SubmitButton variant="outline" pending={working === "suggest"} pendingLabel="Finding…" disabled={working !== null || !validSlot} icon={<Search className="size-4" />} onClick={find}>
          Find technicians
        </SubmitButton>
      </div>
      {options ? <CrewPicker options={options} picked={picked} onPickedChange={setPicked} disabled={working !== null} /> : null}
      {fresh && differs && picked.length ? (
        <Field
          id={ids.override}
          label={reasonRequired ? "Why this crew" : "Why this crew (optional)"}
          hint={reasonRequired ? "Not the suggested crew: say why. Needed to save." : "Say why, for the record."}
        >
          <Textarea id={ids.override} rows={2} maxLength={500} value={override} onChange={(e) => setOverride(e.target.value)} />
        </Field>
      ) : null}
    </SectionDialog>
  );
}

/* ------------------------------------------------------------------ */
/* Attend                                                              */
/* ------------------------------------------------------------------ */

function AttendDialog({ callOut: c, open, onOpenChange, working, setWorking, changed }: DialogProps) {
  const run = useRun(setWorking);
  const [attendedAt, setAttendedAt] = useState(() => nowLocalInput());
  const id = useId();
  const iso = fromLocalInput(attendedAt);
  const beforeCall = iso !== null && Date.parse(iso) < Date.parse(c.reportedAt);

  const save = () =>
    void run(
      "attend",
      async () => {
        if (!iso) return;
        await callOutsService.action(c.id, { action: "attend", attendedAt: iso });
        toast.success(`Call out ${c.callOutNo}: attendance recorded`);
        onOpenChange(false);
        await changed();
      },
      "Could not record the attendance.",
    );

  return (
    <SectionDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Record attendance"
      description={
        c.status === "logged" && c.priority === "emergency"
          ? "An emergency crew can be sent at once: record when they arrived, without scheduling first. This settles the deadline."
          : "When the crew arrived on site. This settles the deadline."
      }
      busy={working === "attend"}
      submit={
        <SubmitButton pending={working === "attend"} pendingLabel="Saving…" disabled={working !== null || !iso || beforeCall} icon={<MapPinCheck className="size-4" />} onClick={save}>
          Record attendance
        </SubmitButton>
      }
    >
      <Field id={id} label="Arrived at" hint={beforeCall ? <span className="text-danger">Attendance cannot be before the call.</span> : undefined}>
        <DateTimeSelect id={id} value={attendedAt} onChange={setAttendedAt} />
      </Field>
    </SectionDialog>
  );
}

/* ------------------------------------------------------------------ */
/* Findings (diagnosis, resolution, pending works)                     */
/* ------------------------------------------------------------------ */

let rowSeq = 0;
const rowKey = () => `p${(rowSeq += 1)}`;

function RecordSection({ callOut: c, canEdit, working, setWorking, changed, onSuggestWork }: SectionProps & { onSuggestWork: () => void }) {
  const run = useRun(setWorking);
  const editable = canEdit && (c.status === "attended" || c.status === "pending_works" || c.status === "quoted");
  const outcomes = (["resolved", "pending_works"] as const).filter((o) => o === c.status || canMoveCallOut(c.status, o));
  const [editing, setEditing] = useState(false);
  const [diagnosis, setDiagnosis] = useState(c.diagnosis ?? "");
  const [resolution, setResolution] = useState(c.resolution ?? "");
  const [partsNeeded, setPartsNeeded] = useState(c.partsNeeded ?? "");
  const [minutes, setMinutes] = useState("");
  const [rows, setRows] = useState(() => c.pendingWorks.map((p) => ({ key: rowKey(), description: p.description, reason: p.reason })));
  const [outcome, setOutcome] = useState<"resolved" | "pending_works">(() => (c.status === "pending_works" && outcomes.includes("pending_works") ? "pending_works" : "resolved"));
  const ids = { diagnosis: useId(), resolution: useId(), parts: useId(), minutes: useId(), outcome: useId() };
  const base = useId();

  const filled = rows.filter((r) => r.description.trim() || r.reason.trim());
  const minutesValue = minutes.trim() === "" ? null : Number(minutes);
  const problem =
    filled.some((r) => r.description.trim().length < 3 || !r.reason.trim())
      ? "Each pending work needs a description and a reason."
      : outcome === "pending_works" && filled.length === 0
        ? "List the pending works and why."
        : minutesValue !== null && !(Number.isInteger(minutesValue) && minutesValue >= 0 && minutesValue <= 1440)
          ? "Minutes on site is a whole number."
          : null;

  const update = (key: string, next: Partial<(typeof rows)[number]>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...next } : r)));

  const save = () =>
    void run(
      "record",
      async () => {
        const result = await callOutsService.action(c.id, {
          action: "record",
          diagnosis: diagnosis.trim() || null,
          resolution: resolution.trim() || null,
          partsNeeded: partsNeeded.trim() || null,
          minutesOnSite: minutesValue,
          pendingWorks: filled.map((r) => ({ description: r.description.trim(), reason: r.reason.trim() })),
          outcome,
        });
        toast.success(outcome === "resolved" ? `Call out ${c.callOutNo} resolved` : "Findings saved");
        setEditing(false);
        if (result.suggestAdditionalWork) onSuggestWork();
        await changed();
      },
      "Could not save the findings.",
    );

  const nothingYet = !c.diagnosis && !c.resolution && !c.partsNeeded && c.pendingWorks.length === 0;

  return (
    <>
      <Panel
        title="Findings" icon={<Wrench />}
        description="What the crew found and did. Parts, or a long fix, make the corrective work additional work."
        actions={
          editable ? (
            <Button disabled={working !== null} onClick={() => setEditing(true)}>
              <Save className="size-4" />
              {nothingYet ? "Record findings" : "Update findings"}
            </Button>
          ) : null
        }
      >
        {nothingYet ? (
          <PanelEmpty
            icon={<Wrench />}
            title="No findings yet"
            description={c.attendedAt ? "What the crew found, what they did and anything left to do is recorded here." : "Recorded once the crew has attended."}
          />
        ) : (
          <dl className="divide-y text-sm">
            <InfoRow label="Diagnosis">{c.diagnosis ? <span className="whitespace-pre-wrap">{c.diagnosis}</span> : <Muted>Not recorded</Muted>}</InfoRow>
            <InfoRow label="Resolution">{c.resolution ? <span className="whitespace-pre-wrap">{c.resolution}</span> : <Muted>Not recorded</Muted>}</InfoRow>
            {c.resolvedAt ? <InfoRow label="Resolved">{formatDateTime(c.resolvedAt)}</InfoRow> : null}
            <InfoRow label="Parts needed">{c.partsNeeded ?? <Muted>None</Muted>}</InfoRow>
            <InfoRow label="Pending works">
              {c.pendingWorks.length ? (
                <span className="flex flex-col items-end gap-0.5">
                  {c.pendingWorks.map((p, i) => (
                    <span key={i}>
                      {p.description}
                      {p.reason ? <span className="text-muted-foreground font-normal"> ({p.reason})</span> : null}
                    </span>
                  ))}
                </span>
              ) : (
                <Muted>Nothing pending</Muted>
              )}
            </InfoRow>
          </dl>
        )}
      </Panel>

      <SectionDialog
        open={editing}
        onOpenChange={setEditing}
        wide
        title={nothingYet ? "Record findings" : "Update findings"}
        description="What the crew found and did. Parts, or a long fix, make the corrective work additional work."
        busy={working === "record"}
        submit={
          <SubmitButton pending={working === "record"} pendingLabel="Saving…" disabled={working !== null || Boolean(problem)} icon={<Save className="size-4" />} onClick={save}>
            Save findings
          </SubmitButton>
        }
      >
        <Field id={ids.diagnosis} label="Diagnosis">
          <Textarea id={ids.diagnosis} rows={3} maxLength={4000} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />
        </Field>
        <Field id={ids.resolution} label="Resolution">
          <Textarea id={ids.resolution} rows={3} maxLength={4000} value={resolution} onChange={(e) => setResolution(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <Field id={ids.parts} label="Parts needed">
            <Input id={ids.parts} maxLength={1000} placeholder="Leave empty if none" value={partsNeeded} onChange={(e) => setPartsNeeded(e.target.value)} />
          </Field>
          <Field id={ids.minutes} label="Minutes on site">
            <Input id={ids.minutes} type="number" min={0} max={1440} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-2">
          <p className="text-sm font-medium">Pending works</p>
          {rows.map((r, i) => (
            <div key={r.key} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem_auto] sm:items-center">
              <Input
                id={`${base}-${r.key}-desc`}
                aria-label={`Pending work ${i + 1}`}
                placeholder="What is left to do"
                maxLength={1000}
                value={r.description}
                onChange={(e) => update(r.key, { description: e.target.value })}
              />
              <Input aria-label={`Pending work ${i + 1} reason`} placeholder="Why" maxLength={500} value={r.reason} onChange={(e) => update(r.key, { reason: e.target.value })} />
              <Button
                size="icon"
                variant="ghost"
                className="text-muted-foreground hover:text-danger size-8 justify-self-end"
                aria-label={`Remove pending work ${i + 1}`}
                onClick={() => setRows((cur) => cur.filter((x) => x.key !== r.key))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <div>
            <Button size="sm" variant="ghost" disabled={rows.length >= 30} onClick={() => setRows((cur) => [...cur, { key: rowKey(), description: "", reason: "" }])}>
              <Plus className="size-3.5" />
              Add pending work
            </Button>
          </div>
        </div>
        <Field id={ids.outcome} label="Outcome" hint={problem ?? undefined}>
          <Select value={outcome} onValueChange={(v) => setOutcome(v as typeof outcome)}>
            <SelectTrigger id={ids.outcome} className="w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {outcomes.map((o) => (
                <SelectItem key={o} value={o}>
                  {o === "resolved" ? "Resolved" : "Pending works"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </SectionDialog>
    </>
  );
}
