"use client";

import { useId, useState, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarCheck, CalendarClock, CheckCircle2, FileText, KeyRound, Link2, Mail, MessageCircle, MessageSquare, PhoneCall, Play, Plus, Save, Search, Send, ShieldCheck, SquarePen, Trash2, Users, XCircle, type LucideIcon } from "lucide-react";
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
  ATTEMPT_OUTCOME_LABELS,
  LOGGED_OUTCOMES,
  confirmationLabel,
  startProblems,
  type AttemptOutcome,
  type Trade,
} from "@/lib/amc/visits";
import { formatPhone } from "@/lib/phone/format-phone";
import { clientProfileService, type AccessRuleRecord } from "@/modules/amc-contracts/client-profile-service";
import { visitsService, type VisitDetail, type VisitSuggestion } from "@/modules/amc-contracts/visits-service";

import { CompactEmpty, CrewList, FactTile, Field, Muted, Panel, SectionDialog } from "./call-out-shared";
import { AccessRuleDialog } from "./profile/property-panels";
import { SendDialog } from "./send-options";
import { PassTypeBadges, PassTypeFields, newPassType, passTypeOf, type PassType } from "./pass-fields";
import { formatContractDate, formatDateTime } from "./contract-status";
import { CrewPicker, crewOptions, crewSummary, differsFromSuggested } from "./crew-picker";
import { useBookingGuards } from "./booking-guards";
import { ClientLinkButton } from "./client-link-button";
import {
  CHANNEL_LABELS,
  CHANNELS,
  CONFIRMATION_TONE,
  channelLabel,
  slotDate,
  slotLabel,
  slotTime,
  type Channel,
  type ConfirmationState,
} from "./visit-status";

export type VisitWorking = "whatsapp" | "email" | "attempt" | "access" | "upload" | "suggest" | "assign" | "pass" | "start" | null;

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
/* Start visit (17 Nov 2026)                                           */
/* ------------------------------------------------------------------ */

const START_TAB_LABELS = { crew: "Crew & time", client: "Client", access: "Access" } as const;

/**
 * The office starts the visit; only then can the inspector fill its job
 * sheet on the phone. The button opens a check of what must be in place --
 * crew, time, the client's confirmation, access -- each with the tab where
 * it is filled in; Start is offered only when nothing is missing (the
 * server checks the same).
 */
export function StartVisitAction({
  visit: v,
  canEdit,
  working,
  setWorking,
  changed,
  onTab,
}: VisitSectionProps & { onTab: (tab: "crew" | "client" | "access") => void }) {
  const run = useRun({ setWorking });
  const contractActive = v.contractStatus === "active";
  const [open, setOpen] = useState(false);
  const startable = ["not_scheduled", "scheduled", "rescheduled", "confirmed", "pending_access"].includes(v.status);
  /* Started by the office (18 Nov 2026): said in the header; in progress once the crew arrives on the phone. */
  if (v.startedAt) {
    return (
      <Badge variant="secondary" className="bg-success/10 text-success h-9 gap-1.5 border-0 px-3 font-medium" title={`Started ${formatDateTime(v.startedAt)}`}>
        <Play className="size-3.5" />
        Started {formatDateTime(v.startedAt)}
      </Badge>
    );
  }
  if (!canEdit || !startable) return null;
  const problems = startProblems({
    status: v.status,
    contractActive,
    technicianIds: v.technicianIds,
    scheduledStart: v.scheduledStart,
    scheduledEnd: v.scheduledEnd,
    clientConfirmation: v.clientConfirmation,
    accessStatus: v.accessStatus,
  });
  const checks = [
    { tab: "crew" as const, label: "Crew chosen", ok: v.technicianIds.length > 0 },
    { tab: "crew" as const, label: "Date and time set", ok: Boolean(v.scheduledStart && v.scheduledEnd) },
    { tab: "client" as const, label: "Confirmed with the client", ok: v.clientConfirmation === "confirmed" },
    { tab: "access" as const, label: "Access sorted", ok: v.accessStatus === "approved" || v.accessStatus === "not_required" },
  ];
  const start = () =>
    void run(
      "start",
      async () => {
        await visitsService.visitAction(v.id, { action: "start" });
        toast.success("Visit started. It shows on the crew's phone, and is in progress once they arrive.");
        setOpen(false);
        await changed();
      },
      "Could not start the visit.",
    );

  return (
    <>
      <Button disabled={working !== null} onClick={() => setOpen(true)}>
        <Play className="size-4" />
        Start visit
      </Button>
      <SectionDialog
        open={open}
        onOpenChange={setOpen}
        title="Start the visit?"
        description={problems.length ? "Fill these in first. The inspector can't begin until the visit is started." : "Everything is in place. Once started, the inspector can fill in the job sheet on the phone."}
        busy={working === "start"}
        submit={
          <SubmitButton pending={working === "start"} pendingLabel="Starting…" disabled={working !== null || problems.length > 0} icon={<Play className="size-4" />} onClick={start}>
            Start visit
          </SubmitButton>
        }
      >
        <ul className="divide-y rounded-lg border">
          {checks.map((c) => (
            <li key={c.label} className="flex items-center gap-3 px-4 py-3 text-sm">
              {c.ok ? <CheckCircle2 className="text-success size-4 shrink-0" aria-hidden /> : <XCircle className="text-destructive size-4 shrink-0" aria-hidden />}
              <span className={c.ok ? "flex-1" : "flex-1 font-medium"}>{c.label}</span>
              {c.ok ? null : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setOpen(false);
                    onTab(c.tab);
                  }}
                >
                  Go to {START_TAB_LABELS[c.tab]}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {!contractActive ? <p className="text-destructive text-sm">The contract is not active, so its visits cannot start.</p> : null}
      </SectionDialog>
    </>
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
  /* Asking the client to confirm: WhatsApp or email, as the contract allows (17 Nov 2026). */
  const [requesting, setRequesting] = useState(false);
  const [logging, setLogging] = useState(false);
  const { dialog: confirmDialog } = useConfirm();
  const [channel, setChannel] = useState<Channel>("call");
  const [outcome, setOutcome] = useState<AttemptOutcome>("no_answer");
  const [note, setNote] = useState("");
  const ids = { channel: useId(), outcome: useId(), note: useId() };

  const state = v.clientConfirmation as ConfirmationState | null;
  const { rule, attemptState: tries } = v;
  /*
    The contract's rule is for Ask to confirm (23 Nov 2026, the user): its
    channels, count and spacing. Log an attempt records any call or
    message, by any channel, at any time.
  */
  const attemptChannel: Channel = channel;
  const requestChannels = (["whatsapp", "email"] as const).filter((c) => rule.attemptChannels.includes(c));
  const sendChannels = requestChannels.length ? requestChannels : (["whatsapp", "email"] as const);
  const requestBlocked = tries.exhausted
    ? `All ${rule.attemptCount} requests have been sent with no answer`
    : tries.nextAllowedAt
      ? `The next request can go from ${formatDateTime(tries.nextAllowedAt)}`
      : null;

  const logAttempt = () =>
    void run(
      "attempt",
      async () => {
        await visitsService.visitAction(v.id, { action: "attempt", channel: attemptChannel, outcome, note: note.trim() || null });
        toast.success("Attempt logged");
        setNote("");
        setLogging(false);
        await changed();
      },
      "Could not log the attempt.",
    );

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
              {/* DEV-507: a link where the client confirms or asks to reschedule; the answer lands on this visit. */}
              <ClientLinkButton visitId={v.id} purpose="visit_confirmation" label="Client link" icon={<Link2 className="size-4" />} disabled={working !== null} />
              <Button disabled={working !== null || requestBlocked !== null} title={requestBlocked ?? undefined} onClick={() => setRequesting(true)}>
                <Send className="size-4" />
                Ask to confirm
              </Button>
            </>
          ) : null
        }
      >
        <Rows>
          <Row label="Status">
            <Badge variant="secondary" className={`border-0 font-medium ${state ? CONFIRMATION_TONE[state] : "bg-mist text-ink-soft"}`}>
              {confirmationLabel(state, v.attempts)}
            </Badge>
          </Row>
          {v.confirmedAt ? (
            <Row label="Confirmed">
              {formatDateTime(v.confirmedAt)}
              {v.confirmationChannel ? ` by ${channelLabel(v.confirmationChannel)}` : ""}
            </Row>
          ) : null}
          {v.confirmationNote ? <Row label="Note">{v.confirmationNote}</Row> : null}
          <Row label="Requests sent">
            {tries.tried} of {rule.attemptCount}
            {tries.exhausted ? <span className="text-danger"> · used up</span> : null}
          </Row>
          {tries.nextAllowedAt ? <Row label="Next request from">{formatDateTime(tries.nextAllowedAt)}</Row> : null}
          <Row label="The rule">
            <span className="font-normal">
              Ask to confirm: up to {rule.attemptCount}, {rule.attemptIntervalDays} {rule.attemptIntervalDays === 1 ? "day" : "days"} apart, by{" "}
              {sendChannels.map(channelLabel).join(", ")}. Logged calls and messages are not counted.
            </span>
          </Row>
        </Rows>
      </Panel>

      <SendDialog
        open={requesting}
        onOpenChange={setRequesting}
        title="Ask the client to confirm the visit"
        description={`Asks the client to confirm the day and time. It is request ${tries.tried + 1} of the ${rule.attemptCount} this contract allows.`}
        what="the confirmation request"
        noun="Confirmation request"
        channels={sendChannels}
        hasLink={false}
        defaultChannel="whatsapp"
        onSend={async (channel) => {
          const r = await visitsService.visitAction(v.id, { action: "request_confirmation", channel: channel === "email" ? "email" : "whatsapp" });
          return { outcome: (r.outcome as "sent" | "failed" | "no_recipient" | "prepared" | undefined) ?? "prepared", message: r.message ?? "", whatsapp: r.whatsapp ?? null, link: null };
        }}
        onDone={changed}
      />

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
        description="A call or message to the client and how it went. Not counted in the contract's requests. Confirmed or declined settles the confirmation."
        busy={working === "attempt"}
        submit={
          <SubmitButton pending={working === "attempt"} pendingLabel="Saving…" disabled={working !== null} icon={<PhoneCall className="size-4" />} onClick={logAttempt}>
            Log attempt
          </SubmitButton>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={ids.channel} label="Channel">
            <Select value={attemptChannel} onValueChange={(c) => setChannel(c as Channel)}>
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
                {LOGGED_OUTCOMES.map((o) => (
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
  const { confirm, dialog: confirmDialog } = useConfirm();
  /* Add: new files. Edit: one pass's date and note. */
  const [adding, setAdding] = useState(false);
  const [editingPass, setEditingPass] = useState<{ id: string; fileName: string } | null>(null);
  const [passFiles, setPassFiles] = useState<File[]>([]);
  const [validUntil, setValidUntil] = useState("");
  const [note, setNote] = useState("");
  /* Bumped after an upload, so the file input starts empty again. */
  const [fileKey, setFileKey] = useState(0);
  const [addingRule, setAddingRule] = useState(0);
  /* The rule being changed (null: a new one). */
  const [editingRule, setEditingRule] = useState<AccessRuleRecord | null>(null);
  const openRule = (rule: AccessRuleRecord | null) => {
    setEditingRule(rule);
    setAddingRule((n) => n + 1);
  };
  const ids = { until: useId(), note: useId(), file: useId() };
  /* Which access rule the pass is for, and its status (17 Nov 2026). */
  const [passType, setPassType] = useState<PassType>(() => newPassType(v.accessRules));

  /*
    The visit's passes (17 Nov 2026): each one its own file with its own
    valid-until, note, access type and status, then the property's, which
    count for this visit too (changed on the property's page). The visit's
    access is worked out from them on the server.
  */
  const passList = v.passes;
  const visitDay = v.scheduledStart ? v.scheduledStart.slice(0, 10) : v.targetDate;

  const openPass = (documentId: string) =>
    void run(
      "pass",
      async () => {
        const { url } = await clientProfileService.documentUrl(documentId);
        window.open(url, "_blank", "noopener");
      },
      "Could not open the pass.",
    );

  const startAdd = () => {
    setPassFiles([]);
    setValidUntil("");
    setNote("");
    setPassType(newPassType(v.accessRules));
    setFileKey((k) => k + 1);
    setAdding(true);
  };
  const startEdit = (d: VisitDetail["passes"][number]) => {
    setValidUntil(d.expiresOn ?? "");
    setNote(d.notes ?? "");
    setPassType(passTypeOf(d));
    setEditingPass({ id: d.id, fileName: d.fileName });
  };

  /* Each file is its own pass (titled with its name, so one never replaces another), then the visit's access follows. */
  const addPasses = () =>
    void run(
      "access",
      async () => {
        for (const file of passFiles) {
          const { document } = await clientProfileService.uploadDocument({
            file,
            level: "visit",
            entityId: v.id,
            category: "Gate pass",
            title: `Gate pass, visit ${v.visitNo}: ${file.name}`,
            expiresOn: validUntil || null,
            notes: note.trim() || null,
          });
          /* Its access type and status; the visit's access follows. */
          if (v.passTypes) {
            await visitsService.visitAction(v.id, { action: "pass", documentId: document.id, validUntil: validUntil || null, note: note.trim() || null, accessRuleId: passType.ruleId, accessStatus: passType.status });
          }
        }
        if (!v.passTypes) await visitsService.visitAction(v.id, { action: "passes_changed" });
        toast.success(passFiles.length === 1 ? "Pass added" : `${passFiles.length} passes added`);
        setAdding(false);
        await changed();
      },
      "Could not add the pass.",
    );

  const savePass = () =>
    void run(
      "access",
      async () => {
        await visitsService.visitAction(v.id, {
          action: "pass",
          documentId: editingPass!.id,
          validUntil: validUntil || null,
          note: note.trim() || null,
          ...(v.passTypes ? { accessRuleId: passType.ruleId, accessStatus: passType.status } : {}),
        });
        toast.success("Pass saved");
        setEditingPass(null);
        await changed();
      },
      "Could not save the pass.",
    );

  const removePass = (d: { id: string; fileName: string }) =>
    void confirm({
      title: `Remove ${d.fileName}?`,
      description: "It no longer counts for this visit's access. The file stays on record.",
      confirmText: "Remove pass",
      action: async () => {
        await visitsService.visitAction(v.id, { action: "pass_remove", documentId: d.id });
        toast.success("Pass removed");
        await changed();
      },
    });

  const shortDate = adding || editingPass ? Boolean(validUntil) && validUntil < visitDay : false;

  return (
    <>
      {confirmDialog}
      {/*
        One Access card (17 Nov 2026): what the property asks for, then the
        passes this visit has -- read together, not as two cards.
      */}
      <Panel
        title="Access"
        icon={<ShieldCheck />}
        description="What the property asks for before a crew can get in, and the passes for this visit with how long each is valid."
        actions={
          canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              {v.propertyId ? (
                <Button variant="outline" disabled={working !== null} onClick={() => openRule(null)}>
                  <KeyRound className="size-4" />
                  Add rule
                </Button>
              ) : null}
              {/* DEV-494: the client uploads the pass on a link; it is kept on this visit. */}
              <ClientLinkButton visitId={v.id} purpose="access_upload" label="Ask client for pass" icon={<Link2 className="size-4" />} disabled={working !== null} />
              <Button disabled={working !== null} onClick={startAdd}>
                <Plus className="size-4" />
                Add pass
              </Button>
            </div>
          ) : null
        }
      >
        {/*
          Nothing asked and nothing on file (25 Nov 2026): one compact box, not
          two tall empty ones; otherwise each part, an empty one as one line.
        */}
        {v.accessRules.length === 0 && passList.length === 0 ? (
          /* The buttons are in the section's header only (26 Nov 2026: they showed twice). */
          <CompactEmpty icon={<ShieldCheck />} title="Nothing needed for access" description="This property asks for no pass or permit, and no pass is on file." />
        ) : (
        <div className="grid gap-6">
          <div className="grid gap-2">
            <AccessHeading icon={<KeyRound />} title="What the property needs" count={v.accessRules.length} hint="Kept on the property, for every visit there." />
          {v.accessRules.length === 0 ? (
            <CompactEmpty title="No access rules" description={canEdit && v.propertyId ? "This property asks for no pass or permit yet. Add the gate pass, permit or key collection it needs." : "This property asks for no pass or permit."} />
          ) : (
            <ul className="grid gap-2">
              {v.accessRules.map((r, index) => (
                <AccessRuleItem
                  key={r.id ?? `${r.accessType}-${index}`}
                  rule={r}
                  onEdit={canEdit && v.propertyId && r.id ? () => openRule(ruleRecord(r, v.propertyId!)) : undefined}
                  disabled={working !== null}
                />
              ))}
            </ul>
          )}
          </div>
        <div className="grid gap-2">
          <AccessHeading icon={<ShieldCheck />} title="Passes for this visit" count={passList.length} />
          {passList.length === 0 ? (
            <CompactEmpty title="No pass on file" description="Add the gate pass or permit with how long it is valid. A visit can have more than one." />
          ) : (
            <ul className="grid gap-2">
              {passList.map((d) => {
                const runsOut = d.expiresOn !== null && d.expiresOn < visitDay;
                const onProperty = d.level === "property";
                return (
                  <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3">
                    <span aria-hidden className="bg-muted/50 text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md border">
                      <FileText className="size-4" />
                    </span>
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium" title={d.fileName}>{d.fileName}</span>
                        <Badge
                          variant="secondary"
                          className={`border-0 font-medium ${runsOut ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}
                        >
                          {d.expiresOn ? (runsOut ? `Ran out ${formatContractDate(d.expiresOn)}` : `Valid until ${formatContractDate(d.expiresOn)}`) : "No end date"}
                        </Badge>
                        {v.passTypes ? <PassTypeBadges pass={d} rules={v.accessRules} /> : null}
                        {onProperty ? (
                          <Badge variant="outline" className="font-normal" title="Held by the property, for every visit there. Change it on the property's page.">
                            Property pass
                          </Badge>
                        ) : null}
                      </span>
                      {/* What the pass is, when no rule says it: the name the client gave it (27 Nov 2026). */}
                      {!d.accessRuleId && d.title && !/^pass from /i.test(d.title) ? <span className="text-sm font-medium">{d.title}</span> : null}
                      {d.notes ? <span className="text-sm whitespace-pre-wrap">{d.notes}</span> : null}
                      <span className="text-muted-foreground text-xs">
                        Added {formatDateTime(d.uploadedAt)}
                        {d.uploadedBy ? ` by ${d.uploadedBy}` : ""}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <Button size="sm" variant="outline" disabled={working !== null} onClick={() => openPass(d.id)}>
                        Open
                      </Button>
                      {canEdit && !onProperty ? (
                        <>
                          <Button size="icon" variant="ghost" className="size-8" title="Change the date or note" aria-label={`Change ${d.fileName}`} disabled={working !== null} onClick={() => startEdit(d)}>
                            <SquarePen className="size-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="text-destructive size-8" title="Remove the pass" aria-label={`Remove ${d.fileName}`} disabled={working !== null} onClick={() => removePass(d)}>
                            <Trash2 className="size-4" />
                          </Button>
                        </>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        </div>
        )}
      </Panel>

      {v.propertyId ? (
        <AccessRuleDialog
          key={addingRule}
          open={addingRule > 0}
          onOpenChange={(open) => !open && setAddingRule(0)}
          initial={editingRule}
          onSave={async (input) => {
            if (editingRule) await clientProfileService.updateAccessRule(v.propertyId!, editingRule.id, { ...input, active: editingRule.active });
            else await clientProfileService.addAccessRule(v.propertyId!, input);
            await clientProfileService.refreshPropertyAccess(v.propertyId!).catch(() => undefined);
            toast.success(editingRule ? "Access rule saved on the property" : "Access rule added to the property");
            setAddingRule(0);
            setEditingRule(null);
            await changed();
          }}
        />
      ) : null}


      <SectionDialog
        open={adding || editingPass !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAdding(false);
            setEditingPass(null);
          }
        }}
        title={editingPass ? "Change the pass" : "Add pass"}
        description={editingPass ? editingPass.fileName : "The gate pass or permit for this visit. Several files can share one date and note."}
        busy={working === "access"}
        submit={
          <SubmitButton
            pending={working === "access"}
            pendingLabel={editingPass ? "Saving…" : "Uploading…"}
            disabled={working !== null || (!editingPass && passFiles.length === 0)}
            icon={editingPass ? <Save className="size-4" /> : <Plus className="size-4" />}
            onClick={editingPass ? savePass : addPasses}
          >
            {editingPass ? "Save pass" : passFiles.length > 1 ? `Add ${passFiles.length} passes` : "Add pass"}
          </SubmitButton>
        }
      >
        {editingPass ? null : (
          <Field id={ids.file} label="Files" hint={passFiles.length ? passFiles.map((p) => p.name).join(", ") : "Choose one or more: PDF or photos."}>
            <Input key={fileKey} id={ids.file} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp" disabled={working !== null} onChange={(e) => setPassFiles(Array.from(e.target.files ?? []))} />
          </Field>
        )}
        <Field
          id={ids.until}
          label="Valid until (optional)"
          hint={shortDate ? <span className="text-warning">Runs out before the visit ({formatContractDate(visitDay)}).</span> : "Leave empty if it has no end date."}
        >
          <DateSelect id={ids.until} value={validUntil} onChange={setValidUntil} />
        </Field>
        {v.passTypes ? <PassTypeFields rules={v.accessRules} value={passType} onChange={setPassType} disabled={working !== null} /> : null}
        <Field id={ids.note} label="Note (optional)">
          <Textarea id={ids.note} rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Gate number, who issued it, anything the crew should know" />
        </Field>
      </SectionDialog>
    </>
  );
}

/* A part of the Access card: icon, title, how many, and a line of help. */
function AccessHeading({ icon, title, count, hint }: { icon: ReactNode; title: string; count: number; hint?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="text-muted-foreground flex items-center gap-1.5 text-sm font-medium [&_svg]:size-3.5">
        {icon}
        {title}
        {count ? <span className="tabular-nums">({count})</span> : null}
      </span>
      {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
    </div>
  );
}

/* Stored as weekday numbers (0 = Sunday); none or all seven means any day. */
const dayList = (days: string[]) =>
  days.length === 0 || days.length === 7 ? "Any day" : days.map((d) => (/^[0-6]$/.test(d) ? WEEKDAY_SHORT[Number(d)] : d)).join(", ");
const hhmm = (time: string | null) => (time ? time.slice(0, 5) : null);

/* A visit's rule as the property's rule record, for the shared rule dialog. */
export function ruleRecord(r: VisitDetail["accessRules"][number], propertyId: string): AccessRuleRecord {
  return {
    id: r.id,
    propertyId,
    accessType: r.accessType,
    issuer: r.issuer,
    leadTimeDays: r.leadTimeDays ?? 0,
    permittedDays: r.permittedDays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
    permittedFrom: hhmm(r.permittedFrom),
    permittedTo: hhmm(r.permittedTo),
    parking: r.parking,
    contactName: r.contactName,
    contactPhone: r.contactPhone,
    notes: r.notes,
    active: true,
  };
}

export function AccessRuleItem({ rule: r, onEdit, disabled }: { rule: VisitDetail["accessRules"][number]; onEdit?: () => void; disabled?: boolean }) {
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
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="font-medium">{ACCESS_TYPE_LABELS[r.accessType as keyof typeof ACCESS_TYPE_LABELS] ?? r.accessType}</span>
        <span className="text-muted-foreground text-xs">{facts.join(" · ")}</span>
        {contact ? <span className="text-xs">Contact: {contact}</span> : null}
        {r.notes ? <span className="text-muted-foreground text-xs whitespace-pre-wrap">{r.notes}</span> : null}
      </span>
      {onEdit ? (
        <Button size="icon" variant="ghost" className="size-8 shrink-0 self-center" title="Change the rule" aria-label="Change the rule" disabled={disabled} onClick={onEdit}>
          <SquarePen className="size-4" />
        </Button>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Crew & time (DEV-396, 397)                                          */
/* ------------------------------------------------------------------ */

const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export function AssignmentSection({ visit: v, canEdit, working, setWorking, changed }: VisitSectionProps) {
  const { guard, dialogs: leadTimeDialog } = useBookingGuards();
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
  /* Chosen technicians still without a mobile login (the crew list creates them). */
  const [missingLogins, setMissingLogins] = useState(0);
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
          await guard((answers) =>
            visitsService.boardAction({
              action: "place",
              visitId: v.id,
              date,
              startTime: time,
              durationMinutes: minutes,
              technicianIds: picked,
              leadTechnicianId: picked[0] ?? null,
              overrideReason: differs ? override.trim() : null,
              reason: outsideWindow ? reason.trim() : null,
              ...answers,
            }),
          );
          toast.success(placed ? `Visit ${v.visitNo} moved` : `Visit ${v.visitNo} placed`);
        }
        setSuggestion(null);
        setEditing(false);
        await changed();
      },
      "Could not assign the crew.",
    );

  const canSave = fresh !== null && picked.length > 0 && missingLogins === 0 && (!differs || override.trim().length >= 3) && (!outsideWindow || crewOnly || reason.trim().length >= 3);

  return (
    <>
      {leadTimeDialog}
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
        {/* Tiles for when and what the services need, then who goes (25 Nov 2026), as the call out reads. */}
        <div className="grid gap-3 sm:grid-cols-3">
          <FactTile icon={<CalendarCheck />} label="Planned for" value={v.scheduledStart ? slotLabel(v.scheduledStart, v.scheduledEnd) : null} empty="No time set yet" />
          <FactTile
            icon={<CalendarClock />}
            label="Service window"
            value={v.windowStart === v.windowEnd ? formatContractDate(v.windowStart) : `${formatContractDate(v.windowStart)} – ${formatContractDate(v.windowEnd)}`}
          />
          <FactTile
            icon={<Users />}
            label="Needs"
            value={`${v.need.headcount} ${v.need.headcount === 1 ? "person" : "people"}`}
            sub={v.need.accessTypes.length ? `Access: ${v.need.accessTypes.join(", ")}` : null}
          />
        </div>
        {v.need.trades.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">Trades</span>
            <TradeBadges trades={v.need.trades} />
          </div>
        ) : null}
        <div className="grid gap-2">
          <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">Crew</p>
          <CrewList people={v.technicians.map((t) => ({ id: t.fsmId, name: t.name, lead: t.fsmId === lead?.fsmId }))} empty="No crew yet" />
          {v.assignmentNote ? <p className="text-muted-foreground text-xs">Why this crew: {v.assignmentNote}</p> : null}
        </div>
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
        {options ? <CrewPicker options={options} picked={picked} onPickedChange={setPicked} disabled={working !== null} onMissingLoginsChange={setMissingLogins} /> : null}
        {differs ? (
          <Field id={ids.override} label="Override reason" hint="This crew is not the one suggested: say why.">
            <Textarea id={ids.override} rows={2} value={override} maxLength={500} onChange={(e) => setOverride(e.target.value)} />
          </Field>
        ) : null}
      </SectionDialog>
    </>
  );
}
