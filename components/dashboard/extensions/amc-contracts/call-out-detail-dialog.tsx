"use client";

import { useEffect, useId, useState } from "react";
import { AlertTriangle, Ban, CalendarCheck, CheckCheck, Flag, Hammer, MapPinCheck, Plus, Save, Search, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ActionDialogContent, ErrorState, FieldsSkeleton, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { CALL_OUT_CHANNEL_LABELS, canMoveCallOut, slaDueAt, type CallOutChannel, type CallOutStatus } from "@/lib/amc/call-outs";
import { TRADE_LABELS } from "@/lib/amc/client-profile";
import { todayInDubai } from "@/lib/amc/contracts";
import type { Trade } from "@/lib/amc/visits";
import {
  callOutsService,
  type CallOutDetailResponse,
  type CallOutPhotoKind,
  type CallOutRecord,
  type CallOutSuggestion,
} from "@/modules/amc-contracts/call-outs-service";
import { visitsService } from "@/modules/amc-contracts/visits-service";

import { AdditionalWorkDetailDialog } from "./additional-work-detail-dialog";
import {
  CallOutStatusBadge,
  CoverageBadge,
  Fact,
  Field,
  Muted,
  Panel,
  PhotosPanel,
  PriorityBadge,
  ReadText,
  RiskBadge,
  SlaBadge,
  WorkStatusBadge,
  errorText,
  fromLocalInput,
  nowLocalInput,
  shortDateTime,
  useActionForm,
} from "./call-out-shared";
import { formatDateTime } from "./contract-status";
import { useDialog } from "./profile/use-dialog";
import { RaiseAdditionalWorkDialog } from "./raise-additional-work-dialog";
import { durationLabel, slotDate, slotLabel, slotTime } from "./visit-status";

type Working = "suggest" | "schedule" | "attend" | "record" | null;
type Tab = "visit" | "findings" | "photos" | "works";

const PHOTO_KINDS = ["reported", "before", "after", "finding", "other"] as const satisfies readonly CallOutPhotoKind[];
const PHOTO_LABELS: Record<CallOutPhotoKind, string> = { reported: "Reported", before: "Before", after: "After", finding: "Finding", other: "Other" };
const FINDINGS_FIRST: readonly CallOutStatus[] = ["attended", "resolved", "pending_works", "quoted", "closed"];

const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

/**
 * One call out (Phase 11: DEV-405, 406): where it stands against its SLA,
 * coverage and the allowance, then the visit (schedule the crew, record
 * attendance), the findings (diagnosis, resolution, pending works), photos
 * and additional work raised from it. Closing, cancelling and flagging an
 * emergency as misuse sit in the footer. `canEdit` from the route decides
 * what is offered; the route checks again.
 */
export function CallOutDetailDialog({
  callOutId,
  open,
  onOpenChange,
  onChanged,
}: {
  callOutId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After any change, so the screen behind can reload. */
  onChanged?: () => unknown;
}) {
  const [state, setState] = useState<{ id: string | null; data: CallOutDetailResponse | null; error: string | null }>({ id: null, data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const [working, setWorking] = useState<Working>(null);
  const actionForm = useActionForm();

  useEffect(() => {
    if (!open || !callOutId) return;
    let stale = false;
    callOutsService.callOut(callOutId).then(
      (data) => !stale && setState({ id: callOutId, data, error: null }),
      (e) => !stale && setState((s) => ({ id: callOutId, data: s.id === callOutId ? s.data : null, error: errorText(e, "Could not load the call out.") })),
    );
    return () => {
      stale = true;
    };
  }, [open, callOutId, attempt]);

  const current = state.id === callOutId ? state : { data: null, error: null };

  const changed = async () => {
    if (!callOutId) return;
    try {
      const data = await callOutsService.callOut(callOutId);
      setState({ id: callOutId, data, error: null });
    } catch {
      /* The change itself went through; the next open fetches again. */
    }
    await onChanged?.();
  };

  const data = current.data;
  const c = data?.callOut ?? null;
  const canEdit = Boolean(data?.canEdit);

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

  return (
    <Dialog open={open} onOpenChange={(next) => !working && onOpenChange(next)}>
      <ActionDialogContent busy={working !== null} className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {c ? `Call out ${c.callOutNo}` : "Call out"}
            {c ? <CallOutStatusBadge status={c.status} /> : null}
            {c ? <PriorityBadge priority={c.priority} /> : null}
            {c?.misuseFlag ? (
              <Badge variant="secondary" className="bg-danger/10 text-danger border-0 font-medium" title={c.misuseNote ?? undefined}>
                <Flag className="size-3" />
                Misuse flagged
              </Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            {c
              ? [c.contractNumber ? `Contract ${c.contractNumber}` : null, c.customerName, c.propertyLabel].filter(Boolean).join(" · ")
              : "The call out, its SLA, coverage, the visit and what was found."}
          </DialogDescription>
        </DialogHeader>

        {c && data ? (
          <CallOutBody key={c.id} data={data} working={working} setWorking={setWorking} changed={changed} />
        ) : current.error ? (
          <ErrorState title="Could not load the call out" message={current.error} onRetry={() => setAttempt((n) => n + 1)} />
        ) : (
          <FieldsSkeleton />
        )}

        <DialogFooter className="flex-wrap gap-2">
          {c && canEdit ? (
            <div className="mr-auto flex flex-wrap gap-2">
              {c.priority === "emergency" && !c.misuseFlag ? (
                <Button variant="ghost" className="text-danger hover:text-danger" disabled={working !== null} onClick={askMisuse}>
                  <Flag className="size-4" />
                  Flag misuse
                </Button>
              ) : null}
              {canMoveCallOut(c.status, "cancelled") ? (
                <Button variant="outline" className="text-danger hover:text-danger" disabled={working !== null} onClick={askCancel}>
                  <Ban className="size-4" />
                  Cancel call out
                </Button>
              ) : null}
              {canMoveCallOut(c.status, "closed") ? (
                <Button disabled={working !== null} onClick={askClose}>
                  <CheckCheck className="size-4" />
                  Close call out
                </Button>
              ) : null}
            </div>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={working !== null}>
            Close
          </Button>
        </DialogFooter>
      </ActionDialogContent>
      {actionForm.dialog}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Body                                                                */
/* ------------------------------------------------------------------ */

type BodyProps = {
  data: CallOutDetailResponse;
  working: Working;
  setWorking: (w: Working) => void;
  changed: () => Promise<void>;
};

function CallOutBody({ data, working, setWorking, changed }: BodyProps) {
  const c = data.callOut;
  const [tab, setTab] = useState<Tab>(() => (FINDINGS_FIRST.includes(c.status) ? "findings" : "visit"));
  const [names, setNames] = useState<Map<string, string>>(() => new Map());
  const [suggestWork, setSuggestWork] = useState(false);
  const raising = useDialog<true>();
  const opening = useDialog<string>();
  const a = data.allowance;
  const due = slaDueAt(c);
  const open = c.status !== "closed" && c.status !== "cancelled";

  /* Technician names for the crew; without access to the roster, the IDs show. */
  useEffect(() => {
    if (!c.technicianIds.length) return;
    let stale = false;
    visitsService.technicians().then(
      (r) => !stale && setNames(new Map(r.technicians.map((t) => [t.fsmId, t.name]))),
      () => undefined,
    );
    return () => {
      stale = true;
    };
  }, [c.technicianIds.length]);

  const nameOf = (id: string) => names.get(id) ?? id;

  return (
    <div className="grid gap-4">
      <dl className="grid gap-x-8 gap-y-2 rounded-lg border px-4 py-3 text-sm sm:grid-cols-2">
        <Fact label="Reported">
          {formatDateTime(c.reportedAt)}
          <span className="text-muted-foreground font-normal"> · {CALL_OUT_CHANNEL_LABELS[c.channel as CallOutChannel] ?? c.channel}</span>
        </Fact>
        <Fact label="SLA">
          <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
            <SlaBadge state={c.slaState} dueAt={null} withDue={false} />
            {due ? <span className="font-normal">{c.priority === "emergency" ? "attend" : "visit"} by {shortDateTime(due)}</span> : null}
          </span>
        </Fact>
        {data.loggedInTime !== null ? (
          <Fact label="Logged in time">
            {data.loggedInTime ? (
              <Badge variant="secondary" className="bg-success/10 text-success border-0 font-medium">
                Yes
              </Badge>
            ) : (
              <Badge variant="secondary" className="bg-danger/10 text-danger border-0 font-medium">
                No, logged late
              </Badge>
            )}
          </Fact>
        ) : null}
        <Fact label="Coverage">
          <CoverageBadge coverage={c.coverage} reserved={c.reserved} />
        </Fact>
        <Fact label="Allowance">
          {a ? (
            <span>
              {a.serviceLabel}:{" "}
              {a.unlimited ? `unlimited, ${a.used} used` : a.included === null ? "not counted" : `${a.used} used · ${a.reserved} booked · ${a.remaining} of ${a.included} left`}
              {a.nearZero ? <span className="text-warning"> · nearly used up</span> : null}
            </span>
          ) : (
            <Muted>No allowance for this kind</Muted>
          )}
        </Fact>
        <Fact label="Trade">{c.trade ? (TRADE_LABELS[c.trade] ?? c.trade) : <Muted>Not set</Muted>}</Fact>
        <Fact label="On-site contact">
          {c.onSiteContactName || c.onSiteContactPhone ? (
            <span>
              {c.onSiteContactName}
              {c.onSiteContactName && c.onSiteContactPhone ? " · " : null}
              {c.onSiteContactPhone ? (
                <a className="text-brand underline-offset-2 hover:underline" href={`tel:${c.onSiteContactPhone}`}>
                  {c.onSiteContactPhone}
                </a>
              ) : null}
            </span>
          ) : (
            <Muted>The client</Muted>
          )}
        </Fact>
        <Fact label="Placed">{c.scheduledStart ? slotLabel(c.scheduledStart, c.scheduledEnd) : <Muted>Not scheduled</Muted>}</Fact>
        <Fact label="Crew">{c.technicianIds.length ? c.technicianIds.map(nameOf).join(", ") : <Muted>None yet</Muted>}</Fact>
        {c.attendedAt ? <Fact label="Attended">{formatDateTime(c.attendedAt)}</Fact> : null}
        {c.acknowledgedAt ? <Fact label="Acknowledged">{formatDateTime(c.acknowledgedAt)}</Fact> : null}
        <div className="grid gap-1 sm:col-span-2">
          <dt className="text-muted-foreground">Issue</dt>
          <dd className="whitespace-pre-wrap">{c.issue}</dd>
        </div>
        {c.coverageReasons.length ? (
          <div className="grid gap-1 sm:col-span-2">
            <dt className="text-muted-foreground">Why {c.coverage === "covered" ? "covered" : "chargeable"}</dt>
            <dd>
              <ul className="list-disc space-y-0.5 pl-5">
                {c.coverageReasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              {c.coverageOverrideReason ? (
                <p className="text-warning mt-1 text-xs font-medium">Booked as covered: {c.coverageOverrideReason}</p>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>

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
        <div className="rounded-lg border px-4 py-3 text-sm">
          <p className="text-muted-foreground text-xs">Cancelled{c.closedAt ? ` · ${formatDateTime(c.closedAt)}` : ""}</p>
          <p className="mt-1 whitespace-pre-wrap">{c.statusReason}</p>
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={(next) => setTab(next as Tab)}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 group-data-horizontal/tabs:h-auto">
          <TabsTrigger value="visit">Visit</TabsTrigger>
          <TabsTrigger value="findings">Findings</TabsTrigger>
          <TabsTrigger value="photos">
            Photos
            {data.photos.length ? <span className="text-muted-foreground ml-1 tabular-nums">({data.photos.length})</span> : null}
          </TabsTrigger>
          <TabsTrigger value="works">
            Additional work
            {data.additionalWorks.length ? <span className="text-muted-foreground ml-1 tabular-nums">({data.additionalWorks.length})</span> : null}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="visit" className="mt-4 grid gap-4">
          <ScheduleSection callOut={c} canEdit={data.canEdit} working={working} setWorking={setWorking} changed={changed} />
          <AttendSection callOut={c} canEdit={data.canEdit} working={working} setWorking={setWorking} changed={changed} />
          {!data.canEdit || (!canMoveCallOut(c.status, "scheduled") && !canMoveCallOut(c.status, "attended")) ? (
            <p className="text-muted-foreground text-sm">
              {data.canEdit ? "The visit is done; see Findings." : "You can see this call out, but not change it."}
            </p>
          ) : null}
        </TabsContent>
        <TabsContent value="findings" className="mt-4 grid gap-4">
          {suggestWork ? (
            <Alert className="border-warning/30 bg-warning/5 items-start p-4">
              <AlertTriangle className="text-warning" />
              <AlertTitle>This looks like additional work</AlertTitle>
              <AlertDescription>
                <p>Parts are needed, or the fix takes longer than {data.minorFixHours} hours: quote it to the client as additional work.</p>
                <Button size="sm" variant="outline" className="mt-3" onClick={() => raising.show(true)}>
                  <Hammer className="size-4" />
                  Raise additional work
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          <RecordSection
            callOut={c}
            canEdit={data.canEdit}
            working={working}
            setWorking={setWorking}
            changed={changed}
            onSuggestWork={() => setSuggestWork(true)}
          />
        </TabsContent>
        <TabsContent value="photos" className="mt-4 grid gap-4">
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
        </TabsContent>
        <TabsContent value="works" className="mt-4 grid gap-4">
          <Panel
            title="Additional work"
            description="Work outside the contract found on this call out. The call out stays open until each is done or declined."
            action={
              data.canEdit && open ? (
                <Button size="sm" variant="outline" onClick={() => raising.show(true)}>
                  <Plus className="size-3.5" />
                  Raise additional work
                </Button>
              ) : null
            }
          >
            {data.additionalWorks.length === 0 ? (
              <p className="text-muted-foreground text-sm">None raised.</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {data.additionalWorks.map((w) => (
                  <li key={w.id}>
                    <button type="button" className="hover:bg-muted/40 flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm" onClick={() => opening.show(w.id)}>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">{w.workNo}</span>
                          <WorkStatusBadge status={w.status} />
                          <RiskBadge risk={w.risk} />
                        </span>
                        <span className="text-muted-foreground line-clamp-2 text-xs">{w.finding}</span>
                      </span>
                      <span className="shrink-0">{w.total ? <Money value={w.total} /> : <Muted>Not quoted</Muted>}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </TabsContent>
      </Tabs>

      <RaiseAdditionalWorkDialog
        key={`raise-${raising.key}`}
        open={raising.open}
        onOpenChange={raising.onOpenChange}
        contractId={c.contractId}
        source="call_out"
        callOutId={c.id}
        initialFinding={[c.diagnosis, c.partsNeeded ? `Parts needed: ${c.partsNeeded}` : null].filter(Boolean).join("\n")}
        initialTrade={c.trade}
        context={`call out ${c.callOutNo}`}
        onRaised={async (w) => {
          setSuggestWork(false);
          await changed();
          setTab("works");
          opening.show(w.id);
        }}
      />
      <AdditionalWorkDetailDialog key={`work-${opening.key}`} workId={opening.target} open={opening.open} onOpenChange={opening.onOpenChange} onChanged={changed} />
    </div>
  );
}

/** One action at a time: a failure is a toast, the dialog stays open. */
function useRun(setWorking: (w: Working) => void) {
  return async (kind: Exclude<Working, null>, fn: () => Promise<void>, fallback: string) => {
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
  working: Working;
  setWorking: (w: Working) => void;
  changed: () => Promise<void>;
};

/* ------------------------------------------------------------------ */
/* Schedule                                                            */
/* ------------------------------------------------------------------ */

function ScheduleSection({ callOut: c, canEdit, working, setWorking, changed }: SectionProps) {
  const run = useRun(setWorking);
  const placedMinutes = c.scheduledStart && c.scheduledEnd ? Math.round((Date.parse(c.scheduledEnd) - Date.parse(c.scheduledStart)) / 60_000) : null;
  const [date, setDate] = useState(() => (c.scheduledStart ? slotDate(c.scheduledStart) : todayInDubai()));
  const [time, setTime] = useState(() => (c.scheduledStart ? slotTime(c.scheduledStart) : "09:00"));
  const [duration, setDuration] = useState(String(placedMinutes ?? (c.priority === "emergency" ? 60 : 120)));
  const [suggestion, setSuggestion] = useState<{ key: string; data: CallOutSuggestion } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [override, setOverride] = useState("");
  const ids = { date: useId(), time: useId(), duration: useId(), override: useId() };

  if (!canEdit || !canMoveCallOut(c.status, "scheduled")) return null;

  const minutes = Number(duration);
  const validSlot = isIsoDate(date) && isTime(time) && Number.isInteger(minutes) && minutes >= 15 && minutes <= 720;
  const slotKey = `${date}|${time}|${minutes}`;
  const fresh = suggestion?.key === slotKey ? suggestion.data : null;
  const suggestedIds = fresh?.suggested.technicianIds ?? [];
  const differs = fresh !== null && !sameSet(picked, suggestedIds);
  const fits = fresh ? [...fresh.fits].sort((x, y) => x.blockers.length - y.blockers.length || y.score - x.score) : [];

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
        await changed();
      },
      "Could not schedule the call out.",
    );

  const toggle = (id: string, on: boolean) => setPicked((cur) => (on ? [...cur, id] : cur.filter((x) => x !== id)));

  return (
    <Panel
      title={c.scheduledStart ? "Reschedule" : "Schedule the visit"}
      description="Pick a day and time, then find who is competent for the trade and free. Blocked technicians show why."
    >
      {!c.trade ? (
        <p className="text-warning text-xs">This call out has no trade, so nobody can be confirmed competent for it.</p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id={ids.date} label="Date">
          <Input id={ids.date} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field id={ids.time} label="Start time">
          <Input id={ids.time} type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Field id={ids.duration} label="Duration (minutes)">
          <Input id={ids.duration} type="number" min={15} max={720} step={15} value={duration} onChange={(e) => setDuration(e.target.value)} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">
          {suggestion && !fresh ? "The day or time changed: find technicians again." : validSlot ? null : "Enter a date, a start time and 15 to 720 minutes."}
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
              Nobody free covers {fresh.suggested.uncovered.map((t: Trade) => TRADE_LABELS[t] ?? t).join(", ")} at that time.
            </div>
          ) : null}
          {fits.length === 0 ? (
            <p className="text-muted-foreground text-sm">No technicians on the roster.</p>
          ) : (
            <div className="grid gap-2">
              {fits.map((f) => {
                const blocked = f.blockers.length > 0;
                return (
                  <label
                    key={f.fsmId}
                    className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm ${blocked ? "opacity-60" : "hover:bg-muted/40 cursor-pointer"}`}
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={picked.includes(f.fsmId)}
                      disabled={blocked && !picked.includes(f.fsmId)}
                      onCheckedChange={(on) => toggle(f.fsmId, on === true)}
                      aria-label={blocked ? `${f.name} can't be assigned` : f.name}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{f.name}</span>
                        {suggestedIds.includes(f.fsmId) ? (
                          <Badge variant="secondary" className="bg-success/10 text-success border-0 font-medium">
                            <Star className="size-3" />
                            Suggested
                          </Badge>
                        ) : null}
                        {picked[0] === f.fsmId && picked.length > 1 ? (
                          <Badge variant="secondary" className="bg-brand-50 text-brand border-0 font-medium">
                            Lead
                          </Badge>
                        ) : null}
                      </span>
                      {blocked ? (
                        <span className="text-danger block text-xs">{f.blockers.join(" · ")}</span>
                      ) : (
                        <span className="text-muted-foreground block text-xs">
                          {[
                            f.covers.length ? `Covers ${f.covers.map((t) => TRADE_LABELS[t] ?? t).join(", ")}` : null,
                            f.workloadMinutes ? `${durationLabel(f.workloadMinutes)} booked that day` : "Nothing else booked that day",
                            ...f.notes,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          {differs && picked.length ? (
            <Field id={ids.override} label="Why this crew (optional)" hint="Not the suggested crew: say why, for the record.">
              <Textarea id={ids.override} rows={2} maxLength={500} value={override} onChange={(e) => setOverride(e.target.value)} />
            </Field>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <p className="text-muted-foreground text-xs">
              {picked.length
                ? `${picked.length} ${picked.length === 1 ? "technician" : "technicians"} chosen${picked.length > 1 ? "; the first is the lead" : ""}.`
                : "Choose at least one technician."}
            </p>
            <SubmitButton
              pending={working === "schedule"}
              pendingLabel="Saving…"
              disabled={working !== null || picked.length === 0 || picked.length > 10}
              icon={<CalendarCheck className="size-4" />}
              onClick={save}
            >
              {c.scheduledStart ? "Reschedule" : "Schedule"}
            </SubmitButton>
          </div>
        </>
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Attend                                                              */
/* ------------------------------------------------------------------ */

function AttendSection({ callOut: c, canEdit, working, setWorking, changed }: SectionProps) {
  const run = useRun(setWorking);
  const [attendedAt, setAttendedAt] = useState(() => nowLocalInput());
  const id = useId();

  if (!canEdit || !canMoveCallOut(c.status, "attended")) return null;
  const iso = fromLocalInput(attendedAt);
  const beforeCall = iso !== null && Date.parse(iso) < Date.parse(c.reportedAt);

  const save = () =>
    void run(
      "attend",
      async () => {
        if (!iso) return;
        await callOutsService.action(c.id, { action: "attend", attendedAt: iso });
        toast.success(`Call out ${c.callOutNo}: attendance recorded`);
        await changed();
      },
      "Could not record the attendance.",
    );

  return (
    <Panel
      title="Record attendance"
      description={
        c.status === "logged" && c.priority === "emergency"
          ? "An emergency crew can be sent at once: record when they arrived, without scheduling first. This settles the SLA."
          : "When the crew arrived on site. This settles the SLA."
      }
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-2">
          <Field id={id} label="Arrived at" hint={beforeCall ? <span className="text-danger">Attendance cannot be before the call.</span> : undefined}>
            <Input id={id} type="datetime-local" className="w-56" value={attendedAt} onChange={(e) => setAttendedAt(e.target.value)} />
          </Field>
        </div>
        <SubmitButton
          pending={working === "attend"}
          pendingLabel="Saving…"
          disabled={working !== null || !iso || beforeCall}
          icon={<MapPinCheck className="size-4" />}
          onClick={save}
        >
          Record attendance
        </SubmitButton>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Record (diagnosis, resolution, pending works)                       */
/* ------------------------------------------------------------------ */

let rowSeq = 0;
const rowKey = () => `p${(rowSeq += 1)}`;

function RecordSection({ callOut: c, canEdit, working, setWorking, changed, onSuggestWork }: SectionProps & { onSuggestWork: () => void }) {
  const run = useRun(setWorking);
  const editable = canEdit && (c.status === "attended" || c.status === "pending_works" || c.status === "quoted");
  const outcomes = (["resolved", "pending_works"] as const).filter((o) => o === c.status || canMoveCallOut(c.status, o));
  const [diagnosis, setDiagnosis] = useState(c.diagnosis ?? "");
  const [resolution, setResolution] = useState(c.resolution ?? "");
  const [partsNeeded, setPartsNeeded] = useState(c.partsNeeded ?? "");
  const [minutes, setMinutes] = useState("");
  const [rows, setRows] = useState(() => c.pendingWorks.map((p) => ({ key: rowKey(), description: p.description, reason: p.reason })));
  const [outcome, setOutcome] = useState<"resolved" | "pending_works">(() => (c.status === "pending_works" && outcomes.includes("pending_works") ? "pending_works" : "resolved"));
  const ids = { diagnosis: useId(), resolution: useId(), parts: useId(), minutes: useId(), outcome: useId() };
  const base = useId();

  if (!editable) {
    return (
      <>
        <Panel title="Diagnosis">
          <ReadText value={c.diagnosis} empty={c.attendedAt ? "Not recorded." : "Recorded after the crew attends."} />
        </Panel>
        <Panel title="Resolution">
          <ReadText value={c.resolution} empty="Not recorded." />
          {c.resolvedAt ? <p className="text-muted-foreground text-xs">Resolved {formatDateTime(c.resolvedAt)}</p> : null}
        </Panel>
        <Panel title="Parts needed">
          <ReadText value={c.partsNeeded} empty="None." />
        </Panel>
        <Panel title="Pending works">
          {c.pendingWorks.length ? (
            <ul className="list-disc space-y-0.5 pl-5 text-sm">
              {c.pendingWorks.map((p, i) => (
                <li key={i}>
                  {p.description}
                  {p.reason ? <span className="text-muted-foreground"> ({p.reason})</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">Nothing pending.</p>
          )}
        </Panel>
      </>
    );
  }

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
        if (result.suggestAdditionalWork) onSuggestWork();
        await changed();
      },
      "Could not save the findings.",
    );

  return (
    <Panel title="Findings" description="What the crew found and did. Parts, or a long fix, make the corrective work additional work.">
      <Field id={ids.diagnosis} label="Diagnosis">
        <Textarea id={ids.diagnosis} rows={3} maxLength={4000} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />
      </Field>
      <Field id={ids.resolution} label="Resolution">
        <Textarea id={ids.resolution} rows={3} maxLength={4000} value={resolution} onChange={(e) => setResolution(e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
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
          <div key={r.key} className="grid gap-2 sm:grid-cols-[1fr_14rem_auto] sm:items-center">
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

      <div className="flex flex-wrap items-end justify-between gap-3 border-t pt-3">
        <Field id={ids.outcome} label="Outcome">
          <Select value={outcome} onValueChange={(v) => setOutcome(v as typeof outcome)}>
            <SelectTrigger id={ids.outcome} className="w-56">
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
        <div className="flex flex-wrap items-center gap-3">
          {problem ? <p className="text-muted-foreground text-xs">{problem}</p> : null}
          <SubmitButton pending={working === "record"} pendingLabel="Saving…" disabled={working !== null || Boolean(problem)} icon={<Save className="size-4" />} onClick={save}>
            Save findings
          </SubmitButton>
        </div>
      </div>
      {c.attendedAt ? <p className="text-muted-foreground text-xs">Attended {formatDateTime(c.attendedAt)}.</p> : null}
    </Panel>
  );
}
