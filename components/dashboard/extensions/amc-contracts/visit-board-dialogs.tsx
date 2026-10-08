"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarCheck, CalendarClock, Search, UserCheck, Users } from "lucide-react";
import { toast } from "sonner";

import { ActionDialogContent, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { TRADE_LABELS } from "@/lib/amc/client-profile";
import { cn } from "@/lib/utils";
import { visitsService, type BoardActionInput, type BoardVisit, type VisitSuggestion } from "@/modules/amc-contracts/visits-service";

import { durationLabel, errorText, inWindow, reasonAsked, shortDate, windowLabel, type BoardTechnician } from "./visit-board-shared";

/**
 * The board's dialogs: place a visit (with the suggested crew), move
 * visits, change their crew, and confirm a drag. Each posts once, shows a
 * failure as a toast and stays open; a 400 that asks for a reason opens
 * the reason field so the same change can be sent again with it.
 */

type Done = (message: string) => void;
type BaseProps = { open: boolean; onOpenChange: (open: boolean) => void; onDone: Done; reload: () => void };

function useResetOnOpen(open: boolean, reset: () => void) {
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) reset();
  }
}

function Shell({
  open,
  onOpenChange,
  busy,
  title,
  description,
  footer,
  wide = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  title: string;
  description: string;
  footer: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className={wide ? "max-h-[88vh] overflow-y-auto sm:max-w-xl" : "sm:max-w-md"}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">{children}</div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          {footer}
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
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

const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Sends the change; a reason the server asks for opens its field instead of failing silently. */
async function send(actions: BoardActionInput[], onAsked: (field: "reason" | "overrideReason") => void, reload?: () => void) {
  try {
    for (const action of actions) await visitsService.boardAction(action);
    return true;
  } catch (e) {
    const message = errorText(e, "Could not change the board.");
    const asked = reasonAsked(message);
    if (asked) onAsked(asked);
    toast.error(message);
    /* Several visits go one by one, so some may have changed before the failure. */
    if (actions.length > 1 || actions.some((a) => "visitIds" in a && a.visitIds.length > 1)) reload?.();
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Place a visit (DEV-393, 396, 397)                                   */
/* ------------------------------------------------------------------ */

export interface PlaceRequest {
  visit: BoardVisit;
  date: string;
  startTime: string;
  /** The row it was dropped on, preselected when that technician can take it. */
  technicianId: string | null;
}

/* A new object per ask, so the answer can be matched to the ask it belongs to. */
type SuggestQuery = { date: string; time: string; duration: number | null; keep: string[] };

export function PlaceDialog({ open, onOpenChange, onDone, reload, request, technicianName }: BaseProps & { request: PlaceRequest | null; technicianName: (id: string) => string }) {
  const visit = request?.visit ?? null;
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [lead, setLead] = useState("");
  const [override, setOverride] = useState("");
  const [reason, setReason] = useState("");
  const [asked, setAsked] = useState<{ reason: boolean; overrideReason: boolean }>({ reason: false, overrideReason: false });
  const [busy, setBusy] = useState(false);
  /* The suggestion asked for, and the answer that came back for it. */
  const [query, setQuery] = useState<SuggestQuery | null>(null);
  const [answer, setAnswer] = useState<{ query: SuggestQuery; data: VisitSuggestion | null; error: string | null } | null>(null);

  useResetOnOpen(open, () => {
    setDay(request?.date ?? "");
    setTime(request?.startTime ?? "09:00");
    setDuration("");
    setSelected([]);
    setLead("");
    setOverride("");
    setReason("");
    setAsked({ reason: false, overrideReason: false });
    setAnswer(null);
    setQuery(
      request
        ? { date: request.date, time: request.startTime, duration: null, keep: request.technicianId ? [request.technicianId] : [] }
        : null,
    );
  });

  useEffect(() => {
    if (!query || !visit) return;
    let stale = false;
    visitsService.suggest(visit.id, query.date, query.time, query.duration).then(
      (data) => {
        if (stale) return;
        setAnswer({ query, data, error: null });
        setDuration((d) => d || String(data.durationMinutes));
        /* Keep who was picked (or dropped on) while they can still take it; else the suggested crew. */
        const free = new Set(data.candidates.map((c) => c.fsmId));
        const kept = query.keep.filter((id) => free.has(id));
        setSelected(kept.length ? kept : data.suggested.technicianIds);
      },
      (e) => !stale && setAnswer({ query, data: null, error: errorText(e, "Could not find technicians.") }),
    );
    return () => {
      stale = true;
    };
  }, [query, visit]);

  const finding = query !== null && answer?.query !== query;
  const suggestion = !finding ? (answer?.data ?? null) : null;
  const durationMinutes = Number(duration);
  const validDuration = Number.isInteger(durationMinutes) && durationMinutes >= 15 && durationMinutes <= 1440;
  const valid = isIsoDate(day) && isTime(time);
  /* The suggestion is for one slot; change the slot and it has to be asked again. */
  const stale = suggestion !== null && (suggestion.date !== day || suggestion.startTime !== time || (validDuration && suggestion.durationMinutes !== durationMinutes));

  const find = () => {
    if (!visit || !valid) return;
    setQuery({ date: day, time, duration: validDuration ? durationMinutes : null, keep: selected });
  };

  const candidates = suggestion?.candidates ?? [];
  const suggested = suggestion?.suggested.technicianIds ?? [];
  const covered = new Set(candidates.filter((c) => selected.includes(c.fsmId)).flatMap((c) => c.covers));
  const uncovered = (suggestion?.trades ?? []).filter((t) => !covered.has(t));
  const differs = suggested.length > 0 && !sameSet(selected, suggested);
  const outside = visit !== null && isIsoDate(day) && !inWindow(visit, day);
  const needsReason = outside || asked.reason;
  const needsOverride = differs || asked.overrideReason;
  const pinned = request?.technicianId ?? null;
  const pinnedBlocked = pinned ? suggestion?.blocked.find((b) => b.fsmId === pinned) : undefined;
  const pinnedMissing = pinned && suggestion && !candidates.some((c) => c.fsmId === pinned) && !pinnedBlocked;
  const leadId = selected.includes(lead) ? lead : (selected[0] ?? "");

  const canSubmit =
    visit !== null &&
    valid &&
    validDuration &&
    suggestion !== null &&
    !stale &&
    selected.length > 0 &&
    uncovered.length === 0 &&
    (!needsOverride || override.trim().length >= 3) &&
    (!needsReason || reason.trim().length >= 3);

  const submit = async () => {
    if (!visit || !canSubmit) return;
    setBusy(true);
    const ok = await send(
      [
        {
          action: "place",
          visitId: visit.id,
          date: day,
          startTime: time,
          durationMinutes,
          technicianIds: selected,
          leadTechnicianId: leadId || null,
          overrideReason: override.trim() || null,
          reason: reason.trim() || null,
        },
      ],
      (field) => setAsked((a) => ({ ...a, [field]: true })),
      reload,
    );
    setBusy(false);
    if (ok) {
      onDone(`Visit ${visit.visitNo} placed`);
      onOpenChange(false);
    }
  };

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      wide
      title={visit ? `Place visit ${visit.visitNo}` : "Place visit"}
      description={
        visit
          ? `${visit.customerName} · ${visit.contractNumber}. Its window is ${windowLabel(visit)}; pick the time and the crew.`
          : "Pick the time and the crew."
      }
      footer={
        <SubmitButton pending={busy} pendingLabel="Placing…" icon={<CalendarCheck className="size-4" />} disabled={!canSubmit} onClick={() => void submit()}>
          Place visit
        </SubmitButton>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="place-date" label="Date">
          <Input id="place-date" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
        <Field id="place-time" label="Start time">
          <Input id="place-time" type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Field id="place-duration" label="Duration (minutes)">
          <Input
            id="place-duration"
            type="number"
            min={15}
            max={1440}
            step={15}
            value={duration}
            placeholder={finding ? "…" : undefined}
            onChange={(e) => setDuration(e.target.value)}
          />
        </Field>
      </div>
      {outside && visit ? (
        <p className="border-warning/30 bg-warning/5 text-warning rounded-md border px-3 py-2 text-xs">
          {shortDate(day)} is outside the service window ({windowLabel(visit)}): this is a reschedule, so say why. The original date is kept.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Crew</p>
          <p className="text-muted-foreground text-xs">
            {suggestion
              ? `Needs ${suggestion.trades.map((t) => TRADE_LABELS[t]).join(", ") || "no trade"} · ${durationLabel(suggestion.durationMinutes)} · ${plural(suggestion.headcount, "technician")}`
              : "Competent, free technicians for this slot."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={find} disabled={!valid || finding || busy}>
          <Search className="size-4" />
          Find technicians
        </Button>
      </div>

      {finding ? (
        <div className="grid gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : answer?.error ? (
        <p className="border-danger/30 bg-danger/5 text-danger rounded-md border px-3 py-2 text-sm">{answer.error}</p>
      ) : suggestion ? (
        <div className="grid gap-2">
          {stale ? <p className="text-warning text-xs">The date, time or duration changed: find technicians again for this slot.</p> : null}
          {suggestion.suggested.uncovered.length ? (
            <p className="text-warning text-xs">
              Nobody free covers {suggestion.suggested.uncovered.map((t) => TRADE_LABELS[t]).join(", ")} at this time. Try another time or day.
            </p>
          ) : null}
          {pinnedBlocked ? (
            <p className="text-warning text-xs">
              {pinnedBlocked.name} cannot take it: {pinnedBlocked.blockers.join("; ").toLowerCase()}. The suggested crew is picked instead.
            </p>
          ) : pinnedMissing ? (
            <p className="text-warning text-xs">{technicianName(pinned)} is not confirmed for this visit&apos;s trades. The suggested crew is picked instead.</p>
          ) : null}
          {candidates.length === 0 && suggestion.blocked.length === 0 ? (
            <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-center text-sm">
              No technician is confirmed for these trades. Add skills under AMC technicians.
            </p>
          ) : null}
          {candidates.map((c) => {
            const checked = selected.includes(c.fsmId);
            return (
              <label key={c.fsmId} className="hover:bg-muted/40 flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm">
                <Checkbox
                  checked={checked}
                  className="mt-0.5"
                  onCheckedChange={(v) => setSelected((cur) => (v === true ? [...cur, c.fsmId] : cur.filter((id) => id !== c.fsmId)))}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{c.name}</span>
                    {suggested.includes(c.fsmId) ? (
                      <Badge variant="secondary" className="bg-brand-50 text-brand border-0 font-medium">
                        Suggested
                      </Badge>
                    ) : null}
                    {c.covers.map((t) => (
                      <Badge key={t} variant="outline" className="font-normal">
                        {TRADE_LABELS[t]}
                      </Badge>
                    ))}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {c.workloadMinutes ? `${durationLabel(c.workloadMinutes)} booked that day` : "Nothing booked that day"}
                    {c.notes.length ? ` · ${c.notes.join(" · ")}` : ""}
                  </span>
                </span>
              </label>
            );
          })}
          {suggestion.blocked.map((b) => (
            <div key={b.fsmId} className="flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm opacity-60">
              <Checkbox checked={false} disabled className="mt-0.5" aria-label={`${b.name} cannot be chosen`} />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{b.name}</span>
                <span className="text-danger block text-xs">{b.blockers.join(" · ")}</span>
              </span>
            </div>
          ))}
          {selected.length > 0 && uncovered.length > 0 ? (
            <p className="text-danger text-xs">Nobody chosen covers {uncovered.map((t) => TRADE_LABELS[t]).join(", ")}.</p>
          ) : null}
        </div>
      ) : null}

      {selected.length > 1 ? (
        <Field id="place-lead" label="Lead technician">
          <Select value={leadId} onValueChange={setLead}>
            <SelectTrigger id="place-lead" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {selected.map((id) => (
                <SelectItem key={id} value={id}>
                  {candidates.find((c) => c.fsmId === id)?.name ?? technicianName(id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      {needsOverride ? (
        <Field id="place-override" label="Why this crew" hint="You chose a different crew from the one suggested. Kept with the visit.">
          <Textarea id="place-override" rows={2} maxLength={500} value={override} onChange={(e) => setOverride(e.target.value)} />
        </Field>
      ) : null}
      {needsReason ? (
        <Field id="place-reason" label="Reason for the reschedule">
          <Textarea id="place-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      ) : null}
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Move visits (DEV-394)                                               */
/* ------------------------------------------------------------------ */

export function MoveDialog({ open, onOpenChange, onDone, reload, visits, date }: BaseProps & { visits: BoardVisit[]; date: string }) {
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  useResetOnOpen(open, () => {
    setDay(date);
    setTime("");
    setReason("");
    setAsked(false);
  });

  const outside = isIsoDate(day) ? visits.filter((v) => !inWindow(v, day)) : [];
  const needsReason = outside.length > 0 || asked;
  const canSubmit = visits.length > 0 && isIsoDate(day) && (!time || isTime(time)) && (!needsReason || reason.trim().length >= 3);
  const single = visits.length === 1 ? visits[0] : null;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    const ok = await send(
      [{ action: "move", visitIds: visits.map((v) => v.id), date: day, startTime: time || null, reason: reason.trim() || null }],
      () => setAsked(true),
      reload,
    );
    setBusy(false);
    if (ok) {
      onDone(single ? `Visit ${single.visitNo} moved` : `${plural(visits.length, "visit")} moved`);
      onOpenChange(false);
    }
  };

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      title={single ? `Move visit ${single.visitNo}` : `Move ${plural(visits.length, "visit")}`}
      description="The crew stays; each technician is checked for leave and double bookings at the new time."
      footer={
        <SubmitButton pending={busy} pendingLabel="Moving…" icon={<CalendarClock className="size-4" />} disabled={!canSubmit} onClick={() => void submit()}>
          Move
        </SubmitButton>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="move-date" label="Date">
          <Input id="move-date" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
        <Field id="move-time" label="Start time (optional)" hint="Empty keeps each visit's time.">
          <Input id="move-time" type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
      {outside.length ? (
        <p className="border-warning/30 bg-warning/5 text-warning rounded-md border px-3 py-2 text-xs">
          {outside.length === 1
            ? `Visit ${outside[0].visitNo} (${outside[0].contractNumber}) is outside its window (${windowLabel(outside[0])})`
            : `${plural(outside.length, "visit")} are outside their window`}
          : this is a reschedule, so say why. The original date is kept.
        </p>
      ) : null}
      <Field id="move-reason" label={needsReason ? "Reason" : "Reason (optional)"}>
        <Textarea id="move-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Change the crew (DEV-394, 397)                                      */
/* ------------------------------------------------------------------ */

export function CrewDialog({ open, onOpenChange, onDone, reload, visits, technicians }: BaseProps & { visits: BoardVisit[]; technicians: BoardTechnician[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [override, setOverride] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  useResetOnOpen(open, () => {
    setSelected(visits.length === 1 ? visits[0].technicianIds : []);
    setOverride("");
    setSearch("");
  });

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? technicians.filter((t) => t.name.toLowerCase().includes(q) || t.trades.some((tr) => TRADE_LABELS[tr].toLowerCase().includes(q))) : technicians;
  }, [technicians, search]);
  const single = visits.length === 1 ? visits[0] : null;
  const unchanged = single !== null && sameSet(selected, single.technicianIds);
  const canSubmit = visits.length > 0 && selected.length > 0 && !unchanged;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    const ok = await send([{ action: "reassign", visitIds: visits.map((v) => v.id), technicianIds: selected, overrideReason: override.trim() || null }], () => undefined, reload);
    setBusy(false);
    if (ok) {
      onDone(single ? `Crew changed for visit ${single.visitNo}` : `Crew changed for ${plural(visits.length, "visit")}`);
      onOpenChange(false);
    }
  };

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      wide
      title={single ? `Change crew: visit ${single.visitNo}` : `Change crew: ${plural(visits.length, "visit")}`}
      description="The time stays; each technician is checked for the trade, access permission, leave and double bookings."
      footer={
        <SubmitButton pending={busy} pendingLabel="Saving…" icon={<UserCheck className="size-4" />} disabled={!canSubmit} onClick={() => void submit()}>
          Save crew
        </SubmitButton>
      }
    >
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input aria-label="Search technicians" placeholder="Search by name or trade" className="ps-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="grid max-h-72 gap-2 overflow-y-auto pr-1">
        {shown.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-center text-sm">No technician matches.</p>
        ) : (
          shown.map((t) => {
            const checked = selected.includes(t.fsmId);
            return (
              <label key={t.fsmId} className={cn("hover:bg-muted/40 flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm", checked && "border-brand/40")}>
                <Checkbox
                  checked={checked}
                  className="mt-0.5"
                  onCheckedChange={(v) => setSelected((cur) => (v === true ? [...cur, t.fsmId] : cur.filter((id) => id !== t.fsmId)))}
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{t.name}</span>
                  {selected[0] === t.fsmId ? <span className="text-muted-foreground"> · lead</span> : null}
                  <span className="text-muted-foreground block text-xs">
                    {t.trades.map((tr) => TRADE_LABELS[tr]).join(", ") || "No confirmed trade"}
                    {t.shift ? ` · ${t.shift}` : ""}
                  </span>
                </span>
              </label>
            );
          })
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        <Users className="mr-1 inline size-3.5" />
        {selected.length ? `${plural(selected.length, "technician")} chosen; the first is the lead.` : "Choose at least one technician."}
      </p>
      <Field id="crew-override" label="Why this crew (optional)" hint="Kept with the visit as the assignment note.">
        <Textarea id="crew-override" rows={2} maxLength={500} value={override} onChange={(e) => setOverride(e.target.value)} />
      </Field>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Confirm a drag                                                      */
/* ------------------------------------------------------------------ */

export interface ChangeRequest {
  title: string;
  description: string;
  /** Sent in order: a block dragged to another row and time changes crew, then time. */
  actions: BoardActionInput[];
  success: string;
  label: string;
}

export function ConfirmChangeDialog({ open, onOpenChange, onDone, reload, request }: BaseProps & { request: ChangeRequest | null }) {
  const [field, setField] = useState<"reason" | "overrideReason" | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useResetOnOpen(open, () => {
    setField(null);
    setText("");
  });

  const canSubmit = request !== null && (!field || text.trim().length >= 3);

  const submit = async () => {
    if (!request || !canSubmit) return;
    const value = text.trim() || null;
    /* The reason goes on the moves, an override on the crew changes. */
    const actions = request.actions.map((a) =>
      field === "reason" && a.action === "move" ? { ...a, reason: value } : field === "overrideReason" && a.action === "reassign" ? { ...a, overrideReason: value } : a,
    );
    setBusy(true);
    const ok = await send(actions, setField, reload);
    setBusy(false);
    if (ok) {
      onDone(request.success);
      onOpenChange(false);
    }
  };

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      title={request?.title ?? "Change the board"}
      description={request?.description ?? ""}
      footer={
        <SubmitButton pending={busy} pendingLabel="Saving…" icon={<CalendarClock className="size-4" />} disabled={!canSubmit} onClick={() => void submit()}>
          {request?.label ?? "Confirm"}
        </SubmitButton>
      }
    >
      {field ? (
        <Field id="change-reason" label={field === "reason" ? "Reason for the reschedule" : "Why this crew"}>
          <Textarea id="change-reason" rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </Field>
      ) : (
        <p className="text-muted-foreground text-sm">Technicians are checked for the trade, access permission, leave and double bookings before it saves.</p>
      )}
    </Shell>
  );
}
