"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { CalendarCheck, Copy, ExternalLink, FileText, Mail, MessageCircle, PhoneCall, Save, Search, ShieldCheck, Star } from "lucide-react";
import { toast } from "sonner";

import { ActionDialogContent, ErrorState, FieldsSkeleton, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { TRADE_LABELS } from "@/lib/amc/client-profile";
import { PLANNABLE_STATUSES, VISIT_STATUS_LABELS } from "@/lib/amc/ppm";
import {
  ACCESS_STATUS_LABELS,
  ACCESS_STATUSES,
  ATTEMPT_OUTCOME_LABELS,
  ATTEMPT_OUTCOMES,
  CONFIRMATION_LABELS,
  type AccessStatus,
  type AttemptOutcome,
  type Trade,
} from "@/lib/amc/visits";
import { clientProfileService } from "@/modules/amc-contracts/client-profile-service";
import { visitsService, type VisitDetail, type VisitResponse, type VisitSuggestion } from "@/modules/amc-contracts/visits-service";

import { formatContractDate, formatDateTime } from "./contract-status";
import {
  ACCESS_TONE,
  CHANNEL_LABELS,
  CHANNELS,
  CONFIRMATION_TONE,
  channelLabel,
  durationLabel,
  slotDate,
  slotLabel,
  slotTime,
  visitStatusTone,
  type Channel,
  type ConfirmationState,
} from "./visit-status";

type Working = "whatsapp" | "email" | "attempt" | "access" | "suggest" | "assign" | "pass" | null;

type Tab = "confirmation" | "access" | "assignment";

/**
 * One AMC visit (Phase 9: DEV-396, 398, 399), opened from the contract's
 * Schedule tab or the visit board: whether the client confirmed and every
 * attempt to reach them, the access pass, and the crew. Anyone who can see
 * the contract reads it; `canEdit` (from the route) decides whether the
 * change controls show, and the route checks again.
 */
export function VisitDetailDialog({
  visitId,
  open,
  onOpenChange,
  onChanged,
  initialTab = "confirmation",
}: {
  visitId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After any change, so the screen behind can reload. */
  onChanged?: () => unknown;
  initialTab?: Tab;
}) {
  const [state, setState] = useState<{ id: string | null; data: VisitResponse | null; error: string | null }>({ id: null, data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const [working, setWorking] = useState<Working>(null);

  /* Fetched on every open; the last answer stays on screen while the next one loads. */
  useEffect(() => {
    if (!open || !visitId) return;
    let stale = false;
    visitsService.visit(visitId).then(
      (data) => !stale && setState({ id: visitId, data, error: null }),
      (e) => !stale && setState((s) => ({ id: visitId, data: s.id === visitId ? s.data : null, error: e instanceof Error ? e.message : "Could not load the visit." })),
    );
    return () => {
      stale = true;
    };
  }, [open, visitId, attempt]);

  const current = state.id === visitId ? state : { data: null, error: null };

  /* After a change: the visit again, then whatever is behind the dialog. A failed refresh keeps what is shown. */
  const changed = async () => {
    if (!visitId) return;
    try {
      const data = await visitsService.visit(visitId);
      setState({ id: visitId, data, error: null });
    } catch {
      /* The change itself went through; the next open fetches again. */
    }
    await onChanged?.();
  };

  const v = current.data?.visit ?? null;

  return (
    <Dialog open={open} onOpenChange={(next) => !working && onOpenChange(next)}>
      <ActionDialogContent busy={working !== null} className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {v ? `Visit ${v.visitNo}` : "Visit"}
            {v ? (
              <Badge variant="secondary" className={`border-0 font-medium ${visitStatusTone(v.status)}`}>
                {VISIT_STATUS_LABELS[v.status] ?? v.status}
              </Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            {v
              ? [v.contractNumber ? `Contract ${v.contractNumber}` : null, v.customerName, v.propertyLabel].filter(Boolean).join(" · ")
              : "The client's confirmation, access and the crew for this visit."}
          </DialogDescription>
        </DialogHeader>

        {v && current.data ? (
          <VisitBody
            key={v.id}
            visit={v}
            canEdit={current.data.canEdit}
            initialTab={initialTab}
            working={working}
            setWorking={setWorking}
            changed={changed}
          />
        ) : current.error ? (
          <ErrorState title="Could not load the visit" message={current.error} onRetry={() => setAttempt((n) => n + 1)} />
        ) : (
          <FieldsSkeleton />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={working !== null}>
            Close
          </Button>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

type BodyProps = {
  visit: VisitDetail;
  canEdit: boolean;
  working: Working;
  setWorking: (w: Working) => void;
  changed: () => Promise<void>;
};

function VisitBody({ initialTab, ...props }: BodyProps & { initialTab: Tab }) {
  const { visit: v } = props;
  const [tab, setTab] = useState<Tab>(initialTab);
  const lead = v.technicians.find((t) => t.fsmId === v.leadTechnicianId) ?? v.technicians[0];

  return (
    <div className="grid gap-4">
      <dl className="grid gap-x-8 gap-y-2 rounded-lg border px-4 py-3 text-sm sm:grid-cols-2">
        <Fact label="Window">
          {v.windowStart === v.windowEnd ? formatContractDate(v.windowStart) : `${formatContractDate(v.windowStart)} – ${formatContractDate(v.windowEnd)}`}
        </Fact>
        <Fact label="Target">
          {formatContractDate(v.targetDate)}
          {v.originalTargetDate && v.originalTargetDate !== v.targetDate ? (
            <span className="text-muted-foreground ml-1.5 font-normal">
              <span className="sr-only">Originally </span>
              <s>{formatContractDate(v.originalTargetDate)}</s>
            </span>
          ) : null}
        </Fact>
        <Fact label="Placed">{v.scheduledStart ? slotLabel(v.scheduledStart, v.scheduledEnd) : <Muted>Not on the board</Muted>}</Fact>
        <Fact label="Crew">
          {v.technicians.length ? (
            v.technicians.map((t) => t.name + (t.fsmId === lead?.fsmId && v.technicians.length > 1 ? " (lead)" : "")).join(", ")
          ) : (
            <Muted>None yet</Muted>
          )}
        </Fact>
        <div className="sm:col-span-2">
          <Fact label="Services">{v.services.length ? v.services.join(", ") : <Muted>—</Muted>}</Fact>
        </div>
      </dl>

      <Tabs value={tab} onValueChange={(next) => setTab(next as Tab)}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 group-data-horizontal/tabs:h-auto">
          <TabsTrigger value="confirmation">Confirmation</TabsTrigger>
          <TabsTrigger value="access">Access</TabsTrigger>
          <TabsTrigger value="assignment">Assignment</TabsTrigger>
        </TabsList>
        <TabsContent value="confirmation" className="mt-4 grid gap-4">
          <ConfirmationSection {...props} />
        </TabsContent>
        <TabsContent value="access" className="mt-4 grid gap-4">
          <AccessSection {...props} />
        </TabsContent>
        <TabsContent value="assignment" className="mt-4 grid gap-4">
          <AssignmentSection {...props} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

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
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <div className="text-muted-foreground text-xs">{hint}</div> : null}
    </div>
  );
}

function TradeBadges({ trades }: { trades: Trade[] }) {
  if (!trades.length) return <Muted>—</Muted>;
  return (
    <span className="inline-flex flex-wrap justify-end gap-1">
      {trades.map((t) => (
        <Badge key={t} variant="secondary" className="bg-brand-50 text-brand border-0 font-medium">
          {TRADE_LABELS[t] ?? t}
        </Badge>
      ))}
    </span>
  );
}

/** One action at a time: a failure is a toast, the dialog stays open. */
function useRun({ setWorking }: Pick<BodyProps, "setWorking">) {
  return async (kind: Exclude<Working, null>, fn: () => Promise<void>, fallback: string) => {
    setWorking(kind);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : fallback);
    } finally {
      setWorking(null);
    }
  };
}

/* ------------------------------------------------------------------ */
/* Confirmation (DEV-398)                                              */
/* ------------------------------------------------------------------ */

function ConfirmationSection({ visit: v, canEdit, working, setWorking, changed }: BodyProps) {
  const run = useRun({ setWorking });
  const [prepared, setPrepared] = useState<{ text: string; link: string | null } | null>(null);
  const [channel, setChannel] = useState<Channel>("call");
  const [outcome, setOutcome] = useState<AttemptOutcome>("no_answer");
  const [note, setNote] = useState("");
  const ids = { channel: useId(), outcome: useId(), note: useId() };

  const state = v.clientConfirmation as ConfirmationState | null;
  const { rule, attemptState: tries } = v;

  const requestBy = (by: "whatsapp" | "email") =>
    void run(
      by,
      async () => {
        const result = await visitsService.visitAction(v.id, { action: "request_confirmation", channel: by });
        if (by === "whatsapp") {
          setPrepared({ text: result.message ?? "", link: result.whatsapp ?? null });
          if (result.whatsapp) {
            window.open(result.whatsapp, "_blank", "noopener");
            toast.success("WhatsApp message prepared");
          } else {
            toast.warning("The client has no phone number on file: copy the message and send it yourself.");
          }
        } else if (result.outcome === "sent") {
          toast.success("Confirmation request emailed");
        } else if (result.outcome === "no_recipient") {
          toast.error("The client has no email address on file.");
        } else {
          toast.error("The email could not be sent. Try again, or send it by WhatsApp.");
        }
        await changed();
      },
      "Could not send the request.",
    );

  const logAttempt = () =>
    void run(
      "attempt",
      async () => {
        await visitsService.visitAction(v.id, { action: "attempt", channel, outcome, note: note.trim() || null });
        toast.success("Attempt logged");
        setNote("");
        await changed();
      },
      "Could not log the attempt.",
    );

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Message copied");
    } catch {
      toast.error("Could not copy the message.");
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border px-4 py-4">
        <div className="min-w-0 space-y-1.5">
          <Badge variant="secondary" className={`border-0 font-medium ${state ? CONFIRMATION_TONE[state] : "bg-mist text-ink-soft"}`}>
            {state ? CONFIRMATION_LABELS[state] : "Not requested yet"}
          </Badge>
          {v.confirmedAt ? (
            <p className="text-sm">
              Confirmed {formatDateTime(v.confirmedAt)}
              {v.confirmationChannel ? ` by ${channelLabel(v.confirmationChannel)}` : ""}
            </p>
          ) : null}
          {v.confirmationNote ? <p className="text-muted-foreground text-sm">{v.confirmationNote}</p> : null}
          <p className="text-muted-foreground text-sm">
            Up to {rule.attemptCount} {rule.attemptCount === 1 ? "attempt" : "attempts"}, {rule.attemptIntervalDays}{" "}
            {rule.attemptIntervalDays === 1 ? "day" : "days"} apart, by {rule.attemptChannels.map(channelLabel).join(", ") || "any channel"}.
          </p>
          <p className="text-sm">
            Tried {tries.tried} of {rule.attemptCount}
            {tries.exhausted ? <span className="text-danger"> · attempts used up</span> : null}
            {tries.nextAllowedAt ? <span className="text-muted-foreground"> · next attempt from {formatDateTime(tries.nextAllowedAt)}</span> : null}
          </p>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <SubmitButton
              variant="outline"
              pending={working === "whatsapp"}
              pendingLabel="Preparing…"
              disabled={working !== null}
              icon={<MessageCircle className="size-4" />}
              onClick={() => requestBy("whatsapp")}
            >
              Send request by WhatsApp
            </SubmitButton>
            <SubmitButton
              variant="outline"
              pending={working === "email"}
              pendingLabel="Sending…"
              disabled={working !== null}
              icon={<Mail className="size-4" />}
              onClick={() => requestBy("email")}
            >
              Send by email
            </SubmitButton>
          </div>
        ) : null}
      </div>

      {prepared ? (
        <div className="border-brand/30 bg-brand-50 grid gap-3 rounded-lg border px-4 py-3">
          <p className="text-sm font-medium">The WhatsApp message</p>
          <p className="text-sm whitespace-pre-wrap">{prepared.text}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void copy(prepared.text)}>
              <Copy className="size-3.5" />
              Copy
            </Button>
            {prepared.link ? (
              <Button size="sm" variant="outline" asChild>
                <a href={prepared.link} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-3.5" />
                  Open WhatsApp
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {canEdit ? (
        <Panel title="Log an attempt" description="A call or message to the client and how it went. Confirmed or declined settles the confirmation.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={ids.channel} label="Channel">
              <Select value={channel} onValueChange={(c) => setChannel(c as Channel)}>
                <SelectTrigger id={ids.channel} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CHANNEL_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id={ids.outcome} label="Outcome">
              <Select value={outcome} onValueChange={(o) => setOutcome(o as AttemptOutcome)}>
                <SelectTrigger id={ids.outcome} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ATTEMPT_OUTCOMES.map((o) => (
                    <SelectItem key={o} value={o}>
                      {ATTEMPT_OUTCOME_LABELS[o]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field id={ids.note} label="Note (optional)">
            <Textarea id={ids.note} rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="flex justify-end">
            <SubmitButton
              pending={working === "attempt"}
              pendingLabel="Saving…"
              disabled={working !== null}
              icon={<PhoneCall className="size-4" />}
              onClick={logAttempt}
            >
              Log attempt
            </SubmitButton>
          </div>
        </Panel>
      ) : null}

      <Panel title="Attempts" description="Every request and call to the client about this visit, oldest first.">
        {v.attempts.length === 0 ? (
          <p className="text-muted-foreground text-sm">No attempts yet.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <Table className="min-w-[620px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-4">#</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="pr-4">By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {v.attempts.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="pl-4 tabular-nums">{a.attemptNo}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDateTime(a.attemptedAt)}</TableCell>
                    <TableCell>{channelLabel(a.channel)}</TableCell>
                    <TableCell>{ATTEMPT_OUTCOME_LABELS[a.outcome] ?? a.outcome}</TableCell>
                    <TableCell className="max-w-[220px] whitespace-normal">{a.note ?? <Muted>—</Muted>}</TableCell>
                    <TableCell className="pr-4">{a.actorLabel ?? <Muted>System</Muted>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Access (DEV-399)                                                    */
/* ------------------------------------------------------------------ */

function AccessSection({ visit: v, canEdit, working, setWorking, changed }: BodyProps) {
  const run = useRun({ setWorking });
  const [status, setStatus] = useState<AccessStatus>(v.accessStatus ?? (v.need.accessTypes.length ? "pending" : "not_required"));
  const [validUntil, setValidUntil] = useState(v.accessValidUntil ?? "");
  const [note, setNote] = useState(v.accessNote ?? "");
  const ids = { status: useId(), until: useId(), note: useId() };

  const openPass = (documentId: string) =>
    void run(
      "pass",
      async () => {
        const { url } = await clientProfileService.documentUrl(documentId);
        window.open(url, "_blank", "noopener");
      },
      "Could not open the pass.",
    );

  const save = () =>
    void run(
      "access",
      async () => {
        await visitsService.visitAction(v.id, {
          action: "access",
          status,
          validUntil: status === "approved" && validUntil ? validUntil : null,
          note: note.trim() || null,
        });
        toast.success("Access saved");
        await changed();
      },
      "Could not save the access.",
    );

  /* A pass that runs out before the visit day is no pass for it. */
  const shortPass = status === "approved" && validUntil && validUntil < v.targetDate;

  return (
    <>
      <dl className="divide-y rounded-lg border px-4 text-sm">
        <AccessRow label="Status">
          {v.accessStatus ? (
            <Badge variant="secondary" className={`border-0 font-medium ${ACCESS_TONE[v.accessStatus]}`}>
              {ACCESS_STATUS_LABELS[v.accessStatus]}
            </Badge>
          ) : (
            <Muted>Not set</Muted>
          )}
        </AccessRow>
        <AccessRow label="Valid until">{v.accessValidUntil ? formatContractDate(v.accessValidUntil) : <Muted>—</Muted>}</AccessRow>
        <AccessRow label="Note">{v.accessNote ?? <Muted>—</Muted>}</AccessRow>
        <AccessRow label="Pass">
          {v.accessDocumentId ? (
            <Button size="sm" variant="outline" disabled={working !== null} onClick={() => openPass(v.accessDocumentId!)}>
              <FileText className="size-3.5" />
              Open pass
            </Button>
          ) : (
            <Muted>No pass on file</Muted>
          )}
        </AccessRow>
        <AccessRow label="Property needs">
          {v.need.accessTypes.length ? v.need.accessTypes.join(", ") : <Muted>No access rules</Muted>}
        </AccessRow>
      </dl>

      {canEdit ? (
        <Panel title="Update access" description="Where the gate pass stands for this visit. Approved or not required closes the access to-do.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={ids.status} label="Status">
              <Select value={status} onValueChange={(s) => setStatus(s as AccessStatus)}>
                <SelectTrigger id={ids.status} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCESS_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {ACCESS_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              id={ids.until}
              label="Valid until"
              hint={shortPass ? <span className="text-warning">Runs out before the visit ({formatContractDate(v.targetDate)}).</span> : "Only for an approved pass."}
            >
              <Input id={ids.until} type="date" value={validUntil} disabled={status !== "approved"} onChange={(e) => setValidUntil(e.target.value)} />
            </Field>
          </div>
          <Field id={ids.note} label="Note (optional)">
            <Textarea id={ids.note} rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="flex justify-end">
            <SubmitButton pending={working === "access"} pendingLabel="Saving…" disabled={working !== null} icon={<ShieldCheck className="size-4" />} onClick={save}>
              Save access
            </SubmitButton>
          </div>
        </Panel>
      ) : null}
    </>
  );
}

function AccessRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{children}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Assignment (DEV-396, 397)                                           */
/* ------------------------------------------------------------------ */

const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

function AssignmentSection({ visit: v, canEdit, working, setWorking, changed }: BodyProps) {
  const run = useRun({ setWorking });
  const placedMinutes = v.scheduledStart && v.scheduledEnd ? Math.round((Date.parse(v.scheduledEnd) - Date.parse(v.scheduledStart)) / 60_000) : null;
  const placed = v.scheduledStart ? { date: slotDate(v.scheduledStart), time: slotTime(v.scheduledStart), duration: placedMinutes ?? v.need.durationMinutes } : null;

  const [date, setDate] = useState(placed?.date ?? v.targetDate);
  const [time, setTime] = useState(placed?.time ?? "09:00");
  const [duration, setDuration] = useState(String(placed?.duration ?? v.need.durationMinutes));
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState("");
  const [suggestion, setSuggestion] = useState<{ key: string; data: VisitSuggestion } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const ids = { date: useId(), time: useId(), duration: useId(), reason: useId(), override: useId() };

  const plannable = PLANNABLE_STATUSES.includes(v.status);
  const minutes = Number(duration);
  const validSlot = isIsoDate(date) && isTime(time) && Number.isInteger(minutes) && minutes >= 15 && minutes <= 1440;
  const slotKey = `${date}|${time}|${minutes}`;
  const fresh = suggestion?.key === slotKey ? suggestion.data : null;
  const outsideWindow = isIsoDate(date) && date !== v.targetDate && (date < v.windowStart || date > v.windowEnd);
  const suggestedIds = fresh?.suggested.technicianIds ?? [];
  const differs = fresh !== null && suggestedIds.length > 0 && !sameSet(picked, suggestedIds);
  /* Same slot as on the board: only the crew changes. */
  const crewOnly = placed !== null && date === placed.date && time === placed.time && minutes === placed.duration;

  const find = () =>
    void run(
      "suggest",
      async () => {
        const data = await visitsService.suggest(v.id, date, time, minutes);
        setSuggestion({ key: slotKey, data });
        setPicked(data.suggested.technicianIds);
        setOverride("");
        if (data.candidates.length === 0) toast.warning("Nobody competent is free at that time.");
      },
      "Could not find technicians.",
    );

  const save = () =>
    void run(
      "assign",
      async () => {
        if (crewOnly) {
          await visitsService.boardAction({ action: "reassign", visitIds: [v.id], technicianIds: picked, overrideReason: differs ? override.trim() : null });
          toast.success(`Visit ${v.visitNo}: crew changed`);
        } else {
          await visitsService.boardAction({
            action: "place",
            visitId: v.id,
            date,
            startTime: time,
            durationMinutes: minutes,
            technicianIds: picked,
            leadTechnicianId: picked[0] ?? null,
            overrideReason: differs ? override.trim() : null,
            reason: outsideWindow ? reason.trim() : null,
          });
          toast.success(placed ? `Visit ${v.visitNo} moved` : `Visit ${v.visitNo} placed`);
        }
        setSuggestion(null);
        await changed();
      },
      "Could not assign the crew.",
    );

  const toggle = (id: string, on: boolean) => setPicked((cur) => (on ? [...cur, id] : cur.filter((x) => x !== id)));
  const canSave =
    fresh !== null && picked.length > 0 && (!differs || override.trim().length >= 3) && (!outsideWindow || crewOnly || reason.trim().length >= 3);

  return (
    <>
      <dl className="divide-y rounded-lg border px-4 text-sm">
        <AccessRow label="Trades">
          <TradeBadges trades={v.need.trades} />
        </AccessRow>
        <AccessRow label="Duration">{durationLabel(v.need.durationMinutes)}</AccessRow>
        <AccessRow label="Crew size">{v.need.headcount}</AccessRow>
        <AccessRow label="Access types">{v.need.accessTypes.length ? v.need.accessTypes.join(", ") : <Muted>None</Muted>}</AccessRow>
        <AccessRow label="Current crew">
          {v.technicians.length ? v.technicians.map((t) => t.name).join(", ") : <Muted>None yet</Muted>}
        </AccessRow>
        {v.assignmentNote ? <AccessRow label="Why this crew">{v.assignmentNote}</AccessRow> : null}
      </dl>

      {!canEdit ? null : !plannable ? (
        <p className="text-muted-foreground text-sm">
          This visit is {(VISIT_STATUS_LABELS[v.status] ?? v.status).toLowerCase()}, so its crew can&apos;t be changed.
        </p>
      ) : (
        <Panel
          title={placed ? "Change crew or time" : "Assign crew"}
          description="Pick a day and time, then find who is competent and free. Only technicians confirmed for the visit's trades are listed."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id={ids.date} label="Date">
              <Input id={ids.date} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field id={ids.time} label="Start time">
              <Input id={ids.time} type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
            <Field id={ids.duration} label="Duration (minutes)">
              <Input id={ids.duration} type="number" min={15} max={1440} step={15} value={duration} onChange={(e) => setDuration(e.target.value)} />
            </Field>
          </div>
          {outsideWindow && !crewOnly ? (
            <Field
              id={ids.reason}
              label="Reason for the new date"
              hint={<span className="text-warning">Outside the service window ({formatContractDate(v.windowStart)} – {formatContractDate(v.windowEnd)}): say why.</span>}
            >
              <Textarea id={ids.reason} rows={2} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
            </Field>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground text-xs">
              {suggestion && !fresh ? "The day or time changed: find technicians again." : validSlot ? null : "Enter a date, a start time and 15 to 1440 minutes."}
            </p>
            <SubmitButton
              variant="outline"
              pending={working === "suggest"}
              pendingLabel="Finding…"
              disabled={working !== null || !validSlot}
              icon={<Search className="size-4" />}
              onClick={find}
            >
              Find technicians
            </SubmitButton>
          </div>

          {fresh ? (
            <>
              {fresh.suggested.uncovered.length ? (
                <div className="border-warning/30 bg-warning/5 text-warning rounded-lg border px-3 py-2 text-sm">
                  Nobody free covers {fresh.suggested.uncovered.map((t) => TRADE_LABELS[t] ?? t).join(", ")} at that time.
                </div>
              ) : null}
              <div className="grid gap-2">
                <p className="text-sm font-medium">Available</p>
                {fresh.candidates.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Nobody competent is free at that time.</p>
                ) : (
                  fresh.candidates.map((c) => (
                    <label key={c.fsmId} className="hover:bg-muted/40 flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm">
                      <Checkbox className="mt-0.5" checked={picked.includes(c.fsmId)} onCheckedChange={(on) => toggle(c.fsmId, on === true)} />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">{c.name}</span>
                          {suggestedIds.includes(c.fsmId) ? (
                            <Badge variant="secondary" className="bg-success/10 text-success border-0 font-medium">
                              <Star className="size-3" />
                              Suggested
                            </Badge>
                          ) : null}
                          {picked[0] === c.fsmId && picked.length > 1 ? (
                            <Badge variant="secondary" className="bg-brand-50 text-brand border-0 font-medium">
                              Lead
                            </Badge>
                          ) : null}
                        </span>
                        <span className="text-muted-foreground block text-xs">
                          {[
                            `Covers ${c.covers.map((t) => TRADE_LABELS[t] ?? t).join(", ")}`,
                            c.workloadMinutes ? `${durationLabel(c.workloadMinutes)} booked that day` : "Nothing else booked that day",
                            ...c.notes,
                          ].join(" · ")}
                        </span>
                      </span>
                    </label>
                  ))
                )}
              </div>
              {fresh.blocked.length ? (
                <div className="grid gap-2">
                  <p className="text-sm font-medium">Can&apos;t be assigned</p>
                  {fresh.blocked.map((b) => (
                    <div key={b.fsmId} className="flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm opacity-60">
                      <Checkbox className="mt-0.5" checked={false} disabled aria-label={`${b.name} can't be assigned`} />
                      <span className="min-w-0">
                        <span className="font-medium">{b.name}</span>
                        <span className="text-danger block text-xs">{b.blockers.join(" · ")}</span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              {differs ? (
                <Field id={ids.override} label="Override reason" hint="This crew is not the one suggested: say why.">
                  <Textarea id={ids.override} rows={2} value={override} maxLength={500} onChange={(e) => setOverride(e.target.value)} />
                </Field>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                <p className="text-muted-foreground text-xs">
                  {picked.length
                    ? `${picked.length} ${picked.length === 1 ? "technician" : "technicians"} chosen${picked.length > 1 ? "; the first is the lead" : ""}.`
                    : "Choose at least one technician."}
                </p>
                <SubmitButton
                  pending={working === "assign"}
                  pendingLabel="Saving…"
                  disabled={working !== null || !canSave}
                  icon={crewOnly ? <Save className="size-4" /> : <CalendarCheck className="size-4" />}
                  onClick={save}
                >
                  {crewOnly ? "Save crew" : placed ? "Move and assign" : "Place visit"}
                </SubmitButton>
              </div>
            </>
          ) : null}
        </Panel>
      )}
    </>
  );
}
