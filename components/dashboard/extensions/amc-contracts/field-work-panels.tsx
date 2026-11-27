"use client";

import { useState } from "react";
import { CheckCircle2, MessageCircle, Play, Send, XCircle, Link2 } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, ListSkeleton, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CLIENT_CONFIRMATION_LABELS, FIELD_START_SHOWN, fieldStartChecks, workApproved, type ClientConfirmation, type FieldStartKind, type FieldStartTab } from "@/lib/amc/field-start";
import { amcRequest } from "@/lib/amc/http-cache";
import type { SendResult } from "@/lib/amc/send-channels";
import { PAYMENT_TIMING_LABELS, chargeOpen, type PaymentTiming } from "@/lib/amc/visit-charges";
import { Money } from "@/components/ui/money";
import type { FieldAccessView } from "@/lib/server/amc/field-access";

import { AccessCard } from "./access-card";
import { ClientLinkButton } from "./client-link-button";
import { errorText } from "./call-out-shared";
import { formatDateTime } from "./contract-status";
import { SendDialog } from "./send-options";
import { useAmcData } from "./use-amc-data";

/*
  A call out's and an additional work's access, Start visit and (additional
  work) client confirmation (17 Nov 2026), as a planned visit has them. The
  page reads them once (useFieldWork) and hands them to each part.
*/

export type FieldWorkData = FieldAccessView & { canEdit: boolean };
export type FieldWork = ReturnType<typeof useFieldWork>;

const url = (kind: FieldStartKind, id: string) => `/api/amc-field-work/${kind}/${encodeURIComponent(id)}`;
const post = <T,>(kind: FieldStartKind, id: string, body: Record<string, unknown>) => amcRequest<T>(url(kind, id), { method: "POST", body: JSON.stringify(body) });

export function useFieldWork(kind: FieldStartKind | null, id: string) {
  return useAmcData(() => (kind ? amcRequest<FieldWorkData>(url(kind, id)) : Promise.resolve(null)), kind ? `field-work|${kind}|${id}` : "field-work:none");
}

const NOT_READY = "Needs the database update 20261117130000.";

/* ------------------------------------------------------------------ */
/* Access                                                              */
/* ------------------------------------------------------------------ */

export function FieldWorkAccessCard({ kind, id, fw, onChanged }: { kind: FieldStartKind; id: string; fw: FieldWork; onChanged?: () => void | Promise<void> }) {
  const d = fw.data;
  return (
    <AccessCard
      data={d ? { accessRules: d.accessRules, passes: d.passes, passTypes: d.passTypes, status: d.accessStatus, day: d.day, propertyId: d.propertyId, canEdit: d.canEdit && d.ready && !d.startedAt } : null}
      error={fw.error}
      loading={fw.loading}
      reload={fw.reload}
      uploadLevel={kind}
      entityId={id}
      noun={kind === "call_out" ? "call out" : "additional work"}
      who="crew"
      savePass={(input) => post(kind, id, { action: "pass", ...input })}
      removePass={(documentId) => post(kind, id, { action: "pass_remove", documentId })}
      onChanged={onChanged}
      /* The client sends the passes and the property's rules on a link, as on a planned visit (27 Nov 2026). */
      clientLink={
        d && d.canEdit && d.ready && !d.startedAt ? (
          <ClientLinkButton fieldWork={{ kind, id }} purpose="access_upload" label="Ask client for pass" icon={<Link2 className="size-4" />} size="sm" />
        ) : null
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Start visit                                                         */
/* ------------------------------------------------------------------ */

const TAB_NAMES: Record<FieldStartTab, string> = { crew: "Crew & time", client: "Client", access: "Access", services: "Services", payment: "Services" };

/** Start visit in the page header, with the checklist; a "Started" note once it is. */
export function FieldStartAction({
  kind,
  id,
  fw,
  status,
  canEdit,
  onTab,
  onChanged,
  disabled,
}: {
  kind: FieldStartKind;
  id: string;
  fw: FieldWork;
  /** The record's status and the viewer's rights, from the page: the button shows on them, not on the access data arriving. */
  status: string | null | undefined;
  canEdit: boolean | undefined;
  onTab: (tab: FieldStartTab) => void;
  onChanged: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /* Something to pay (18 Nov 2026): before the visit (paid first) or after it, with the reason. */
  const [timing, setTiming] = useState<PaymentTiming>("before_visit");
  const [reason, setReason] = useState("");
  const d = fw.data;
  if (d?.startedAt) {
    return (
      <Badge variant="secondary" className="bg-success/10 text-success h-9 gap-1.5 border-0 px-3 font-medium" title={`Started ${formatDateTime(d.startedAt)}`}>
        <Play className="size-3.5" />
        Started {formatDateTime(d.startedAt)}
      </Badge>
    );
  }
  /* Shown whenever the record can be started (18 Nov 2026); what is missing is said in the dialog, not by hiding the button. */
  if (!canEdit || !status || !FIELD_START_SHOWN[kind].includes(status)) return null;
  const toPay = d ? chargeOpen(d.charge) : false;
  const paid = d?.charge?.status === "paid";
  const servicesMissing = Boolean(d && d.chargeReady && kind === "call_out" && d.coverage === "chargeable" && (!d.charge || d.charge.lines.length === 0));
  const payment = toPay || paid ? { paid, timing, reason: reason.trim() || null } : null;
  const checks = d
    ? fieldStartChecks({
        kind,
        ...(kind === "additional_work" ? { approved: workApproved(status) } : {}),
        priority: d.priority,
        technicianIds: d.technicianIds,
        scheduledStart: d.scheduledStart,
        scheduledEnd: d.scheduledEnd,
        clientConfirmation: d.clientConfirmation,
        accessStatus: d.accessStatus,
        servicesMissing,
        payment,
      })
    : [];
  const problems = checks.filter((c) => !c.ok);
  const emergency = kind === "call_out" && d?.priority === "emergency";
  const blocked = !d || !d.ready || !d.contractActive || problems.length > 0;
  const start = async () => {
    setBusy(true);
    try {
      await post(kind, id, { action: "start", payment: toPay ? { timing, reason: reason.trim() || null } : null });
      toast.success(kind === "call_out" ? "Visit started. The crew can attend it now." : "Visit started. The crew can complete the work now.");
      setOpen(false);
      fw.reload();
      await onChanged();
    } catch (e) {
      toast.error(errorText(e, "Could not start the visit."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        disabled={disabled || busy}
        onClick={() => {
          if (fw.error) fw.reload();
          setOpen(true);
        }}
      >
        <Play className="size-4" />
        Start visit
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <ActionDialogContent busy={busy} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Start the visit?</DialogTitle>
            <DialogDescription>
              {!d
                ? fw.error
                  ? "The checklist could not be loaded."
                  : "Checking the crew, time and access…"
                : !d.ready
                  ? NOT_READY
                  : problems.length
                    ? "Fill these in first. The crew can't begin until the visit is started."
                    : emergency
                      ? "An emergency: the crew and access are in place. Once started, the crew can attend it."
                      : "Everything is in place. Once started, the crew can do the work on the phone."}
            </DialogDescription>
          </DialogHeader>
          {!d ? (
            fw.error ? (
              <ErrorState title="Could not load the checklist" message={fw.error} onRetry={fw.reload} />
            ) : (
              <ListSkeleton rows={3} />
            )
          ) : (
            <ul className="divide-y rounded-lg border">
              {checks.map((c) => (
                <li key={c.key} className="flex items-center gap-3 px-4 py-3 text-sm">
                  {c.ok ? <CheckCircle2 className="text-success size-4 shrink-0" aria-hidden /> : <XCircle className="text-destructive size-4 shrink-0" aria-hidden />}
                  <span className={c.ok ? "flex-1" : "flex-1 font-medium"}>
                    {c.label}
                    {c.ok ? null : <span className="text-muted-foreground block text-xs font-normal">{c.text}</span>}
                  </span>
                  {c.ok ? null : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setOpen(false);
                        onTab(c.tab);
                      }}
                    >
                      Go to {TAB_NAMES[c.tab]}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {d && toPay ? (
            <div className="grid gap-3 rounded-lg border px-4 py-3">
              <p className="text-sm">
                The client pays <Money value={d.charge?.total ?? 0} className="font-semibold" /> (including VAT). When?
              </p>
              <div className="bg-muted inline-flex w-fit rounded-full p-0.5 text-sm" role="radiogroup" aria-label="When the client pays">
                {(["before_visit", "after_visit"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={timing === value}
                    onClick={() => setTiming(value)}
                    className={`rounded-full px-3 py-1 ${timing === value ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {PAYMENT_TIMING_LABELS[value]}
                  </button>
                ))}
              </div>
              {timing === "after_visit" ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="start-pay-after">Why after the visit</Label>
                  <Textarea id="start-pay-after" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: the client pays the technician on site, or settles with the next instalment" />
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">Record the payment first (the {kind === "call_out" ? "Services" : "Quotation"} tab or the contract&apos;s Payments tab), then start.</p>
              )}
            </div>
          ) : null}
          {d && !d.contractActive ? <p className="text-destructive text-sm">The contract is not active, so its work cannot start.</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <SubmitButton pending={busy} pendingLabel="Starting…" disabled={blocked} icon={<Play className="size-4" />} onClick={() => void start()}>
              Start visit
            </SubmitButton>
          </DialogFooter>
        </ActionDialogContent>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Additional work: the client confirms the day                        */
/* ------------------------------------------------------------------ */

const CONFIRMATION_TONE: Record<ClientConfirmation, string> = {
  pending: "bg-warning/10 text-warning",
  confirmed: "bg-success/10 text-success",
  declined: "bg-danger/10 text-danger",
};
const ANSWER_CHANNELS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "in_person", label: "In person" },
] as const;

export function WorkConfirmationCard({ id, fw, onChanged, onTab }: { id: string; fw: FieldWork; onChanged: () => void | Promise<void>; onTab: (tab: FieldStartTab) => void }) {
  const [asking, setAsking] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [outcome, setOutcome] = useState<"confirmed" | "declined">("confirmed");
  const [channel, setChannel] = useState<string>("whatsapp");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const d = fw.data;
  const editable = Boolean(d?.canEdit && d.ready && !d.startedAt);
  const state = d?.clientConfirmation ?? null;

  const saveAnswer = async () => {
    setBusy(true);
    try {
      await post("additional_work", id, { action: "confirm", outcome, channel, note: note.trim() || null });
      toast.success(outcome === "confirmed" ? "Confirmed with the client" : "Recorded: the client declined");
      setAnswering(false);
      fw.reload();
      await onChanged();
    } catch (e) {
      toast.error(errorText(e, "Could not save the answer."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      icon={<MessageCircle />}
      title="Client confirmation"
      description="Whether the client agreed the day and time of the work."
      bodyClassName="border-t"
      action={
        editable && d?.scheduledStart ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setAsking(true)}>
              <Send className="size-4" />
              Ask to confirm
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setOutcome("confirmed");
                setChannel("whatsapp");
                setNote("");
                setAnswering(true);
              }}
            >
              <CheckCircle2 className="size-4" />
              Record answer
            </Button>
          </div>
        ) : null
      }
    >
      {fw.error ? (
        <div className="p-5">
          <ErrorState title="Could not load the confirmation" message={fw.error} onRetry={fw.reload} />
        </div>
      ) : !d ? (
        <ListSkeleton rows={1} />
      ) : !d.ready ? (
        <EmptyState icon={<MessageCircle className="size-5" />} title="Not available yet" description={NOT_READY} />
      ) : !d.scheduledStart ? (
        <EmptyState
          icon={<MessageCircle className="size-5" />}
          title="No time to confirm yet"
          description="Set the date, time and crew first; then ask the client to confirm them."
          action={editable ? { label: "Go to Crew & time", onClick: () => onTab("crew") } : undefined}
        />
      ) : (
        <dl className="divide-y text-sm">
          <div className="flex items-center justify-between gap-3 px-5 py-3">
            <dt className="text-muted-foreground">Status</dt>
            <dd>
              <Badge variant="secondary" className={`border-0 font-medium ${state ? CONFIRMATION_TONE[state] : "bg-mist text-ink-soft"}`}>
                {state ? CLIENT_CONFIRMATION_LABELS[state] : "Not asked yet"}
              </Badge>
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3 px-5 py-3">
            <dt className="text-muted-foreground">Visit</dt>
            <dd className="font-medium">{formatDateTime(d.scheduledStart)}</dd>
          </div>
          {d.confirmedAt ? (
            <div className="flex items-center justify-between gap-3 px-5 py-3">
              <dt className="text-muted-foreground">Confirmed</dt>
              <dd>
                {formatDateTime(d.confirmedAt)}
                {d.confirmationChannel ? ` by ${ANSWER_CHANNELS.find((c) => c.value === d.confirmationChannel)?.label ?? d.confirmationChannel}` : ""}
              </dd>
            </div>
          ) : null}
          {d.confirmationNote ? (
            <div className="flex items-start justify-between gap-3 px-5 py-3">
              <dt className="text-muted-foreground">Note</dt>
              <dd className="text-right whitespace-pre-wrap">{d.confirmationNote}</dd>
            </div>
          ) : null}
        </dl>
      )}

      <SendDialog
        open={asking}
        onOpenChange={setAsking}
        title="Ask the client to confirm the work"
        description="Asks the client to confirm the day and time of the approved work."
        what="the confirmation request"
        noun="Confirmation request"
        hasLink={false}
        defaultChannel="whatsapp"
        onSend={(c) => post<SendResult>("additional_work", id, { action: "request_confirmation", channel: c })}
        onDone={async () => {
          fw.reload();
          await onChanged();
        }}
      />

      <Dialog open={answering} onOpenChange={(next) => !busy && setAnswering(next)}>
        <ActionDialogContent busy={busy} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>The client&apos;s answer</DialogTitle>
            <DialogDescription>For {d?.scheduledStart ? formatDateTime(d.scheduledStart) : "the planned time"}.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="work-answer">Answer</Label>
                <Select value={outcome} onValueChange={(v) => setOutcome(v as "confirmed" | "declined")}>
                  <SelectTrigger id="work-answer" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="declined">Declined</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="work-answer-channel">How</Label>
                <Select value={channel} onValueChange={setChannel}>
                  <SelectTrigger id="work-answer-channel" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ANSWER_CHANNELS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="work-answer-note">Note (optional)</Label>
              <Textarea id="work-answer-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={outcome === "declined" ? "Why, and a time that suits them" : "Who confirmed, anything the crew should know"} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnswering(false)} disabled={busy}>
              Cancel
            </Button>
            <SubmitButton pending={busy} pendingLabel="Saving…" icon={<CheckCircle2 className="size-4" />} onClick={() => void saveAnswer()}>
              Save answer
            </SubmitButton>
          </DialogFooter>
        </ActionDialogContent>
      </Dialog>
    </SectionCard>
  );
}
