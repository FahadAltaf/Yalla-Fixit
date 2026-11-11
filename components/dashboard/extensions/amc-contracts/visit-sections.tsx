"use client";

import { useId, useState, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarCheck, Copy, ExternalLink, FileText, KeyRound, Mail, MessageCircle, MessageSquare, PhoneCall, Save, Search, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { DataTable } from "@/components/data-table";
import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { TruncatedText } from "@/components/ui/truncated-text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import DateSelect from "@/components/ui/date-select";
import TimeSelect from "@/components/ui/time-select";
import { ACCESS_TYPE_LABELS, TRADE_LABELS, WEEKDAY_SHORT } from "@/lib/amc/client-profile";
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
import { formatPhone } from "@/lib/phone/format-phone";
import { clientProfileService } from "@/modules/amc-contracts/client-profile-service";
import { visitsService, type VisitDetail, type VisitSuggestion } from "@/modules/amc-contracts/visits-service";

import { Field, Muted, Panel, PanelEmpty, SectionDialog } from "./call-out-shared";
import { formatContractDate, formatDateTime } from "./contract-status";
import { CrewPicker, crewOptions, crewSummary, differsFromSuggested } from "./crew-picker";
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
  type Channel,
  type ConfirmationState,
} from "./visit-status";

export type VisitWorking = "whatsapp" | "email" | "attempt" | "access" | "upload" | "suggest" | "assign" | "pass" | null;

/**
 * The work on one AMC planned visit (Phase 9: DEV-396, 398, 399), as
 * sections of its page (AMC -> Visits -> the visit): whether the client
 * confirmed and every attempt to reach them, the access pass, and the crew
 * and time. Each shows where it stands, with its form behind an Update
 * button (a dialog), as everywhere in AMC. `canEdit` (from the route)
 * decides whether the buttons show; the route checks again.
 */
export type VisitSectionProps = {
  visit: VisitDetail;
  canEdit: boolean;
  /** One action at a time across the page. */
  working: VisitWorking;
  setWorking: (w: VisitWorking) => void;
  /** After a change: the page reloads the visit. */
  changed: () => Promise<void>;
};

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

/** One action at a time: a failure is a toast, the form stays open. */
function useRun({ setWorking }: Pick<VisitSectionProps, "setWorking">) {
  return async (kind: Exclude<VisitWorking, null>, fn: () => Promise<void>, fallback: string) => {
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

function Rows({ children }: { children: ReactNode }) {
  return <dl className="divide-y text-sm">{children}</dl>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{children}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Client (DEV-398)                                                    */
/* ------------------------------------------------------------------ */

const noop = () => undefined;

const CHANNEL_ICONS: Record<string, LucideIcon> = { email: Mail, whatsapp: MessageCircle, call: PhoneCall, sms: MessageSquare };

const OUTCOME_TONE: Record<string, string> = {
  confirmed: "bg-success/10 text-success",
  declined: "bg-danger/10 text-danger",
  reschedule_requested: "bg-warning/10 text-warning",
  no_answer: "bg-mist text-ink-soft",
  message_sent: "bg-brand-50 text-brand",
};

type Attempt = VisitDetail["attempts"][number];

const attemptColumns: ColumnDef<Attempt>[] = [
  {
    id: "attempt",
    header: "Attempt",
    cell: ({ row }) => (
      <IdentityCell title={`Attempt ${row.original.attemptNo}`} subtitle={formatDateTime(row.original.attemptedAt)} icon={CHANNEL_ICONS[row.original.channel] ?? PhoneCall} />
    ),
  },
  { id: "channel", header: "Channel", cell: ({ row }) => <span className="text-sm">{channelLabel(row.original.channel)}</span> },
  {
    id: "outcome",
    header: "Outcome",
    cell: ({ row }) => (
      <Badge variant="secondary" className={`border-0 font-medium ${OUTCOME_TONE[row.original.outcome] ?? "bg-mist text-ink-soft"}`}>
        {ATTEMPT_OUTCOME_LABELS[row.original.outcome] ?? row.original.outcome}
      </Badge>
    ),
  },
  {
    id: "note",
    header: "Note",
    cell: ({ row }) => (row.original.note ? <TruncatedText text={row.original.note} className="max-w-[280px] text-sm" /> : <span className="text-muted-foreground text-sm">—</span>),
  },
  { id: "by", header: "By", cell: ({ row }) => <IdentityCell title={row.original.actorLabel ?? "System"} /> },
];

export function ConfirmationSection({ visit: v, canEdit, working, setWorking, changed }: VisitSectionProps) {
  const run = useRun({ setWorking });
  const [prepared, setPrepared] = useState<{ text: string; link: string | null } | null>(null);
  const [logging, setLogging] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [channel, setChannel] = useState<Channel>("call");
  const [outcome, setOutcome] = useState<AttemptOutcome>("no_answer");
  const [note, setNote] = useState("");
  const ids = { channel: useId(), outcome: useId(), note: useId() };

  const state = v.clientConfirmation as ConfirmationState | null;
  const { rule, attemptState: tries } = v;

  /* Asked first (11 Nov 2026): it acts at once, so it is confirmed like every other step. */
  const requestBy = (by: "whatsapp" | "email") =>
    void confirm({ title: by === "email" ? "Email the client to confirm the visit?" : "Send the confirmation request by WhatsApp?", description: by === "email" ? "Emails the client asking them to confirm the day and time. It counts as one of the attempts to reach them." : "Records the request (it counts as an attempt) and opens WhatsApp with the message ready to send.", confirmText: by === "email" ? "Send email" : "Open WhatsApp" }).then((ok) => {
      if (ok) void requestByNow(by);
    });
  const requestByNow = (by: "whatsapp" | "email") =>
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
        setLogging(false);
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
      <Panel
        title="Client confirmation" icon={<MessageCircle />}
        description="Whether the client agreed the day, and how many times they can still be asked."
        actions={
          canEdit ? (
            <>
              <Button variant="outline" disabled={working !== null} onClick={() => setLogging(true)}>
                <PhoneCall className="size-4" />
                Log an attempt
              </Button>
              <SubmitButton variant="outline" pending={working === "email"} pendingLabel="Sending…" disabled={working !== null} icon={<Mail className="size-4" />} onClick={() => requestBy("email")}>
                Send by email
              </SubmitButton>
              <SubmitButton pending={working === "whatsapp"} pendingLabel="Preparing…" disabled={working !== null} icon={<MessageCircle className="size-4" />} onClick={() => requestBy("whatsapp")}>
                Send by WhatsApp
              </SubmitButton>
            </>
          ) : null
        }
      >
        <Rows>
          <Row label="Status">
            <Badge variant="secondary" className={`border-0 font-medium ${state ? CONFIRMATION_TONE[state] : "bg-mist text-ink-soft"}`}>
              {state ? CONFIRMATION_LABELS[state] : "Not requested yet"}
            </Badge>
          </Row>
          {v.confirmedAt ? (
            <Row label="Confirmed">
              {formatDateTime(v.confirmedAt)}
              {v.confirmationChannel ? ` by ${channelLabel(v.confirmationChannel)}` : ""}
            </Row>
          ) : null}
          {v.confirmationNote ? <Row label="Note">{v.confirmationNote}</Row> : null}
          <Row label="Attempts">
            {tries.tried} of {rule.attemptCount}
            {tries.exhausted ? <span className="text-danger"> · used up</span> : null}
          </Row>
          {tries.nextAllowedAt ? <Row label="Next attempt from">{formatDateTime(tries.nextAllowedAt)}</Row> : null}
          <Row label="The rule">
            <span className="font-normal">
              Up to {rule.attemptCount}, {rule.attemptIntervalDays} {rule.attemptIntervalDays === 1 ? "day" : "days"} apart, by{" "}
              {rule.attemptChannels.map(channelLabel).join(", ") || "any channel"}
            </span>
          </Row>
        </Rows>
      </Panel>

      {prepared ? (
        <div className="border-brand/30 bg-brand-50 grid gap-3 rounded-xl border px-5 py-4">
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

      {/* The attempts as every list in the product: a data table in its card (11 Nov 2026). */}
      <SectionCard title="Attempts" icon={<PhoneCall />} description="Every request and call to the client about this visit, newest first." bodyClassName="border-t">
        <DataTable
          columns={attemptColumns}
          data={[...v.attempts].reverse()}
          loading={false}
          rowCount={v.attempts.length}
          pageSize={500}
          currentPage={0}
          onPageChange={noop}
          onPageSizeChange={noop}
          onGlobalFilterChange={noop}
          emptyState={<EmptyState icon={<PhoneCall />} title="No attempts yet" description="Each request sent and each call logged shows here, with how it went." />}
        />
      </SectionCard>

      {confirmDialog}
      <SectionDialog
        open={logging}
        onOpenChange={setLogging}
        title="Log an attempt"
        description="A call or message to the client and how it went. Confirmed or declined settles the confirmation."
        busy={working === "attempt"}
        submit={
          <SubmitButton pending={working === "attempt"} pendingLabel="Saving…" disabled={working !== null} icon={<PhoneCall className="size-4" />} onClick={logAttempt}>
            Log attempt
          </SubmitButton>
        }
      >
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
          <Textarea id={ids.note} rows={3} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </SectionDialog>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Access (DEV-399)                                                    */
/* ------------------------------------------------------------------ */

export function AccessSection({ visit: v, canEdit, working, setWorking, changed }: VisitSectionProps) {
  const run = useRun({ setWorking });
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<AccessStatus>(v.accessStatus ?? (v.need.accessTypes.length ? "pending" : "not_required"));
  const [validUntil, setValidUntil] = useState(v.accessValidUntil ?? "");
  const [note, setNote] = useState(v.accessNote ?? "");
  const [passFile, setPassFile] = useState<File | null>(null);
  /* Bumped after an upload, so the file input starts empty again. */
  const [fileKey, setFileKey] = useState(0);
  const ids = { status: useId(), until: useId(), note: useId(), file: useId() };

  const openPass = (documentId: string) =>
    void run(
      "pass",
      async () => {
        const { url } = await clientProfileService.documentUrl(documentId);
        window.open(url, "_blank", "noopener");
      },
      "Could not open the pass.",
    );

  /* One Save: a pass file chosen goes to the visit's documents first, then the access is saved pointing at it. */
  const save = () =>
    void run(
      "access",
      async () => {
        const uploaded = passFile
          ? (
              await clientProfileService.uploadDocument({
                file: passFile,
                level: "visit",
                entityId: v.id,
                category: "Gate pass",
                title: `Gate pass, visit ${v.visitNo}`,
              })
            ).document
          : null;
        await visitsService.visitAction(v.id, {
          action: "access",
          status,
          validUntil: status === "approved" && validUntil ? validUntil : null,
          ...(uploaded ? { documentId: uploaded.id } : {}),
          note: note.trim() || null,
        });
        setPassFile(null);
        setFileKey((k) => k + 1);
        setEditing(false);
        toast.success(uploaded ? "Access saved with the pass" : "Access saved");
        await changed();
      },
      "Could not save the access.",
    );

  /* A pass that runs out before the visit day is no pass for it. */
  const shortPass = status === "approved" && validUntil && validUntil < v.targetDate;

  return (
    <>
      <Panel
        title="Access for this visit" icon={<ShieldCheck />}
        description="The gate pass or permit, how long it is valid and the file."
        actions={
          canEdit ? (
            <Button disabled={working !== null} onClick={() => setEditing(true)}>
              <ShieldCheck className="size-4" />
              Update access
            </Button>
          ) : null
        }
      >
        <Rows>
          <Row label="Status">
            {v.accessStatus ? (
              <Badge variant="secondary" className={`border-0 font-medium ${ACCESS_TONE[v.accessStatus]}`}>
                {ACCESS_STATUS_LABELS[v.accessStatus]}
              </Badge>
            ) : (
              <Muted>Not set</Muted>
            )}
          </Row>
          <Row label="Valid until">
            {v.accessValidUntil ? (
              <span className={v.accessValidUntil < v.targetDate ? "text-warning" : undefined}>
                {formatContractDate(v.accessValidUntil)}
                {v.accessValidUntil < v.targetDate ? " (before the visit)" : ""}
              </span>
            ) : (
              <Muted>—</Muted>
            )}
          </Row>
          <Row label="Note">{v.accessNote ?? <Muted>—</Muted>}</Row>
          <Row label="Pass">
            {v.accessDocumentId ? (
              <Button size="sm" variant="outline" disabled={working !== null} onClick={() => openPass(v.accessDocumentId!)}>
                <FileText className="size-3.5" />
                Open pass
              </Button>
            ) : (
              <Muted>No pass on file</Muted>
            )}
          </Row>
        </Rows>
      </Panel>

      <Panel title="Property access rules" icon={<KeyRound />} description="What the property asks for before a crew can get in: passes, permits, lifts and keys.">
        {v.accessRules.length === 0 ? (
          <PanelEmpty icon={<KeyRound />} title="No access rules" description="This property asks for no pass or permit. Rules are kept on the property's page." />
        ) : (
          <ul className="grid gap-2">
            {v.accessRules.map((r, index) => (
              <AccessRuleItem key={`${r.accessType}-${index}`} rule={r} />
            ))}
          </ul>
        )}
      </Panel>

      <SectionDialog
        open={editing}
        onOpenChange={setEditing}
        title="Update access"
        description="Where the gate pass stands for this visit. Approved or not required closes the access to-do."
        busy={working === "access"}
        submit={
          <SubmitButton pending={working === "access"} pendingLabel={passFile ? "Uploading and saving…" : "Saving…"} disabled={working !== null} icon={<ShieldCheck className="size-4" />} onClick={save}>
            Save access
          </SubmitButton>
        }
      >
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
            <DateSelect id={ids.until} value={validUntil} disabled={status !== "approved"} onChange={setValidUntil} />
          </Field>
        </div>
        <Field id={ids.note} label="Note (optional)">
          <Textarea id={ids.note} rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field
          id={ids.file}
          label="Pass file (optional)"
          hint={
            passFile
              ? `${passFile.name} is uploaded when you save${v.accessDocumentId ? ", replacing the pass on file" : ""}.`
              : `${v.accessDocumentId ? "A new file replaces the pass on file. " : ""}PDF or a photo; kept with the visit's documents.`
          }
        >
          <Input key={fileKey} id={ids.file} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" disabled={working !== null} onChange={(e) => setPassFile(e.target.files?.[0] ?? null)} />
        </Field>
      </SectionDialog>
    </>
  );
}

/* Stored as weekday numbers (0 = Sunday); none or all seven means any day. */
const dayList = (days: string[]) =>
  days.length === 0 || days.length === 7 ? "Any day" : days.map((d) => (/^[0-6]$/.test(d) ? WEEKDAY_SHORT[Number(d)] : d)).join(", ");
const hhmm = (time: string | null) => (time ? time.slice(0, 5) : null);

function AccessRuleItem({ rule: r }: { rule: VisitDetail["accessRules"][number] }) {
  const from = hhmm(r.permittedFrom);
  const to = hhmm(r.permittedTo);
  const hours = from && to ? `, ${from}–${to}` : from ? `, from ${from}` : to ? `, until ${to}` : "";
  const facts = [
    r.issuer ? `Issued by ${r.issuer}` : null,
    r.leadTimeDays !== null ? `${r.leadTimeDays} ${r.leadTimeDays === 1 ? "day" : "days"} notice` : null,
    `${dayList(r.permittedDays)}${hours}`,
    r.parking ? `Parking: ${r.parking}` : null,
  ].filter(Boolean);
  const contact = [r.contactName, formatPhone(r.contactPhone)].filter(Boolean).join(" · ");
  return (
    <li className="flex items-start gap-3 rounded-lg border px-4 py-3 text-sm">
      <span className="bg-muted/50 text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md border [&_svg]:size-4">
        <KeyRound />
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="font-medium">{ACCESS_TYPE_LABELS[r.accessType as keyof typeof ACCESS_TYPE_LABELS] ?? r.accessType}</span>
        <span className="text-muted-foreground text-xs">{facts.join(" · ")}</span>
        {contact ? <span className="text-xs">Contact: {contact}</span> : null}
        {r.notes ? <span className="text-muted-foreground text-xs whitespace-pre-wrap">{r.notes}</span> : null}
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Crew & time (DEV-396, 397)                                          */
/* ------------------------------------------------------------------ */

const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export function AssignmentSection({ visit: v, canEdit, working, setWorking, changed }: VisitSectionProps) {
  const run = useRun({ setWorking });
  const [editing, setEditing] = useState(false);
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
  const options = fresh ? crewOptions(fresh) : null;
  const differs = differsFromSuggested(picked, options);
  /* Same slot as on the board: only the crew changes. */
  const crewOnly = placed !== null && date === placed.date && time === placed.time && minutes === placed.duration;
  const lead = v.technicians.find((t) => t.fsmId === v.leadTechnicianId) ?? v.technicians[0];

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
        setEditing(false);
        await changed();
      },
      "Could not assign the crew.",
    );

  const canSave = fresh !== null && picked.length > 0 && (!differs || override.trim().length >= 3) && (!outsideWindow || crewOnly || reason.trim().length >= 3);

  return (
    <>
      <Panel
        title="Crew and time" icon={<Users />}
        description="When the visit is, who goes, and what the contract's services need."
        actions={
          canEdit && plannable ? (
            <Button disabled={working !== null} onClick={() => setEditing(true)}>
              <Users className="size-4" />
              {placed ? "Change crew or time" : "Assign crew and time"}
            </Button>
          ) : null
        }
      >
        <Rows>
          <Row label="Planned for">{v.scheduledStart ? slotLabel(v.scheduledStart, v.scheduledEnd) : <Muted>No time set yet</Muted>}</Row>
          <Row label="Service window">
            {v.windowStart === v.windowEnd ? formatContractDate(v.windowStart) : `${formatContractDate(v.windowStart)} – ${formatContractDate(v.windowEnd)}`}
          </Row>
          <Row label="Crew">
            {v.technicians.length ? (
              v.technicians.map((t) => t.name + (t.fsmId === lead?.fsmId && v.technicians.length > 1 ? " (lead)" : "")).join(", ")
            ) : (
              <Muted>None yet</Muted>
            )}
          </Row>
          {v.assignmentNote ? <Row label="Why this crew">{v.assignmentNote}</Row> : null}
          <Row label="Trades">
            <TradeBadges trades={v.need.trades} />
          </Row>
          <Row label="Needs">
            {durationLabel(v.need.durationMinutes)}, {v.need.headcount} {v.need.headcount === 1 ? "person" : "people"}
          </Row>
          <Row label="Access types">{v.need.accessTypes.length ? v.need.accessTypes.join(", ") : <Muted>None</Muted>}</Row>
        </Rows>
        {canEdit && !plannable ? (
          <p className="text-muted-foreground text-sm">This visit is {(VISIT_STATUS_LABELS[v.status] ?? v.status).toLowerCase()}, so its crew and time can&apos;t be changed.</p>
        ) : null}
      </Panel>

      <SectionDialog
        open={editing}
        onOpenChange={setEditing}
        wide
        title={placed ? `Change crew or time: visit ${v.visitNo}` : `Assign crew and time: visit ${v.visitNo}`}
        description="Pick a day and time, then find who is competent and free. Only technicians confirmed for the visit's trades are listed."
        busy={working === "assign"}
        submit={
          <SubmitButton
            pending={working === "assign"}
            pendingLabel="Saving…"
            disabled={working !== null || !canSave}
            icon={crewOnly ? <Save className="size-4" /> : <CalendarCheck className="size-4" />}
            onClick={save}
          >
            {crewOnly ? "Save crew" : placed ? "Move and assign" : "Place visit"}
          </SubmitButton>
        }
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id={ids.date} label="Date">
            <DateSelect id={ids.date} value={date} onChange={setDate} />
          </Field>
          <Field id={ids.time} label="Start time">
            <TimeSelect id={ids.time} step={900} value={time} onChange={setTime} />
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
            {suggestion && !fresh ? "The day or time changed: find technicians again." : validSlot ? (fresh ? crewSummary(picked) : "Then choose the crew.") : "Enter a date, a start time and 15 to 1440 minutes."}
          </p>
          <SubmitButton variant="outline" pending={working === "suggest"} pendingLabel="Finding…" disabled={working !== null || !validSlot} icon={<Search className="size-4" />} onClick={find}>
            Find technicians
          </SubmitButton>
        </div>
        {options ? <CrewPicker options={options} picked={picked} onPickedChange={setPicked} disabled={working !== null} /> : null}
        {differs ? (
          <Field id={ids.override} label="Override reason" hint="This crew is not the one suggested: say why.">
            <Textarea id={ids.override} rows={2} value={override} maxLength={500} onChange={(e) => setOverride(e.target.value)} />
          </Field>
        ) : null}
      </SectionDialog>
    </>
  );
}
