"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarArrowUp, Check, ChevronsUpDown, CircleAlert, CircleCheck, Loader2, Users } from "lucide-react";
import { toast } from "sonner";

import { NeedsLoginBadge, NeedsLoginNote, cannotRegister, useTechnicianLogins } from "@/components/dashboard/shared/technician-login";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { isLeadTimeWarning } from "@/lib/amc/lead-time";
import { MOVE_MAX_DAYS_AHEAD, moveSummary, type MoveEntryResult } from "@/lib/scheduling/move-entries";
import { addDaysToDateString, formatZonedDate, formatZonedTime, todayInZone, zonedTimeToUtc } from "@/lib/scheduling/org-time";
import { cn } from "@/lib/utils";
import { scheduleService, type ScheduleEntry, type TechnicianReference } from "@/modules/scheduling";
import { technicianAccountsService } from "@/modules/users/services/technician-accounts-service";

const KEEP = "__keep";

const dayLabel = (date: string) =>
  formatZonedDate(zonedTimeToUtc(date, "12:00"), { weekday: "short", day: "numeric", month: "short" });

function entryName(e: ScheduleEntry): string {
  return e.title || [e.fsm_work_order_name, e.fsm_appointment_name].filter(Boolean).join(" · ") || "Entry";
}

/**
 * DEV-393: move the selected entries to another day, give them a new crew,
 * or both, in one action. Each entry keeps its time. AMC work moves through
 * AMC, so its service window, crew checks and access lead time apply; the
 * result says per entry what moved and why the rest did not.
 */
export default function MoveEntriesDialog({
  entries,
  technicians,
  currentDate,
  onOpenChange,
  onMoved,
}: {
  entries: ScheduleEntry[];
  technicians: TechnicianReference[];
  /** The day the board shows (offered first, as "keep the day"). */
  currentDate: string;
  onOpenChange: (open: boolean) => void;
  /** Something changed: reload the day (and clear the selection when everything moved). */
  onMoved: (allMoved: boolean) => void;
}) {
  const today = todayInZone();
  const days = useMemo(() => Array.from({ length: MOVE_MAX_DAYS_AHEAD + 1 }, (_, i) => addDaysToDateString(today, i)), [today]);
  const [toDate, setToDate] = useState<string>(KEEP);
  const [crew, setCrew] = useState<string[]>([]);
  const [changeCrew, setChangeCrew] = useState(false);
  const [crewOpen, setCrewOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<MoveEntryResult[] | null>(null);

  const amcCount = entries.filter((e) => e.amc_kind).length;
  const names = new Map(technicians.map((t) => [t.fsm_resource_id, t.display_name]));
  const sortedTechs = useMemo(() => [...technicians].sort((a, b) => a.display_name.localeCompare(b.display_name)), [technicians]);
  const day = toDate === KEEP ? null : toDate;
  const problem = !day && !(changeCrew && crew.length)
    ? "Choose a day, a crew, or both."
    : changeCrew && !crew.length
      ? "Choose at least one technician."
      : null;
  const leadTimeSkipped = (results ?? []).filter((r) => r.status === "skipped" && isLeadTimeWarning(r.reason));

  const run = async (entryIds: string[], insideLeadTime = false) => {
    setBusy(true);
    try {
      const { results: got } = await scheduleService.moveEntries({
        entryIds,
        toDate: day,
        technicianFsmIds: changeCrew && crew.length ? crew : null,
        reason: reason.trim() || null,
        ...(insideLeadTime ? { insideLeadTime: true } : {}),
      });
      /* A retry replaces only the entries it ran for. */
      const merged = results ? results.map((r) => got.find((g) => g.entryId === r.entryId) ?? r) : got;
      setResults(merged);
      const moved = got.filter((r) => r.status === "moved").length;
      const allMoved = merged.every((r) => r.status === "moved");
      if (moved) onMoved(allMoved);
      if (allMoved) {
        toast.success(moveSummary(merged));
        onOpenChange(false);
      } else {
        toast.warning(moveSummary(merged), { description: "The reasons are listed in the dialog." });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not move the entries");
    } finally {
      setBusy(false);
    }
  };

  /*
    AMC work is done in the YFI mobile app, so a new crew for it needs logins
    (25 Nov 2026): as on AMC's crew screens, one without a login gets it
    before they are added. Only when AMC entries are among those moving.
  */
  const needsLogins = amcCount > 0 && changeCrew;
  const { createLogins, dialogs: loginDialogs } = useTechnicianLogins();
  const [accounts, setAccounts] = useState<Map<string, { hasLogin: boolean; email: string | null }> | null>(null);
  const [making, setMaking] = useState(false);
  useEffect(() => {
    if (!needsLogins || accounts) return;
    let stale = false;
    technicianAccountsService.list().then(
      (list) => !stale && setAccounts(new Map(list.technicians.map((t) => [t.fsmId, { hasLogin: t.userId !== null, email: t.email }]))),
      () => !stale && setAccounts(new Map()),
    );
    return () => {
      stale = true;
    };
  }, [needsLogins, accounts]);
  const lacksLogin = (id: string) => needsLogins && accounts?.get(id)?.hasLogin === false;

  const toggleTech = (id: string) => {
    if (crew.includes(id) || !lacksLogin(id)) return setCrew((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    const name = names.get(id) ?? id;
    const email = accounts?.get(id)?.email ?? null;
    const blocked = cannotRegister({ name, email });
    if (blocked) return void toast.error(blocked);
    setMaking(true);
    void createLogins([{ fsmId: id, name, email }])
      .then((made) => {
        if (!made?.length) return;
        setAccounts((prev) => new Map(prev ?? []).set(id, { hasLogin: true, email }));
        setCrew((prev) => (prev.includes(id) ? prev : [...prev, id]));
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not create the login"))
      .finally(() => setMaking(false));
  };

  return (
    <Dialog open onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-xl">
        {loginDialogs}
        <DialogHeader>
          <DialogTitle>
            Move {entries.length === 1 ? "entry" : `${entries.length} entries`}
          </DialogTitle>
          <DialogDescription>
            To another day, a new crew, or both. Each entry keeps its time; a moved entry remembers the day it was first planned for.
          </DialogDescription>
        </DialogHeader>

        <ul className="divide-y rounded-lg border">
          {entries.map((e) => {
            const r = results?.find((x) => x.entryId === e.id);
            const crewNames = (e.schedule_entry_assignments ?? []).map((a) => a.technician_reference?.display_name ?? names.get(a.technician_fsm_id) ?? a.technician_fsm_id);
            return (
              <li key={e.id} className="flex items-start gap-3 px-3 py-2">
                <span className="mt-0.5 shrink-0">
                  {r?.status === "moved" ? (
                    <CircleCheck className="text-success size-4" aria-label="Moved" />
                  ) : r?.status === "skipped" ? (
                    <CircleAlert className="text-destructive size-4" aria-label="Not moved" />
                  ) : (
                    <CalendarArrowUp className="text-muted-foreground size-4" aria-hidden />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">{entryName(e)}</span>
                    {e.amc_kind && (
                      <Badge variant="outline" className="border-brand/40 text-brand shrink-0 text-[10px]">
                        AMC
                      </Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground truncate text-xs">
                    {dayLabel(e.operating_date)} · {formatZonedTime(e.start_at)}–{formatZonedTime(e.end_at)}
                    {crewNames.length ? ` · ${crewNames.join(", ")}` : ""}
                  </p>
                  {r?.status === "skipped" && r.reason && <p className="text-destructive mt-1 text-xs">{r.reason}</p>}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="move-day">Day</Label>
            <Select value={toDate} onValueChange={setToDate} disabled={busy}>
              <SelectTrigger id="move-day" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={KEEP}>Keep each entry on its day</SelectItem>
                {days.map((d) => (
                  <SelectItem key={d} value={d} disabled={d === currentDate && entries.every((e) => e.operating_date === d)}>
                    {dayLabel(d)}
                    {d === today ? " (today)" : ""}
                    {d === currentDate ? " (this board)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">Up to {MOVE_MAX_DAYS_AHEAD} days ahead. A day nobody has opened yet is opened as a draft.</p>
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-center gap-2">
              <Checkbox id="move-crew" checked={changeCrew} onCheckedChange={(v) => setChangeCrew(v === true)} disabled={busy} />
              <Label htmlFor="move-crew" className="font-normal">
                Give {entries.length === 1 ? "it" : "them"} a new crew
              </Label>
            </div>
            {changeCrew && (
              <Popover open={crewOpen} onOpenChange={setCrewOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-between font-normal" disabled={busy}>
                    <span className="flex min-w-0 items-center gap-2">
                      <Users className="text-muted-foreground size-4 shrink-0" />
                      <span className={cn("truncate", !crew.length && "text-muted-foreground")}>
                        {crew.length ? crew.map((id) => names.get(id) ?? id).join(", ") : "Choose technicians"}
                      </span>
                    </span>
                    <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start" onInteractOutside={(e) => making && e.preventDefault()}>
                  <Command>
                    <CommandInput placeholder="Search technicians" />
                    <CommandList>
                      <CommandEmpty>No technician found.</CommandEmpty>
                      <CommandGroup>
                        {sortedTechs.map((t) => (
                          <CommandItem key={t.fsm_resource_id} value={t.display_name} disabled={making} onSelect={() => toggleTech(t.fsm_resource_id)}>
                            <Check className={cn("size-4", crew.includes(t.fsm_resource_id) ? "opacity-100" : "opacity-0")} />
                            <span className="flex-1">{t.display_name}</span>
                            {lacksLogin(t.fsm_resource_id) && <NeedsLoginBadge email={accounts?.get(t.fsm_resource_id)?.email ?? null} />}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
            {changeCrew && <p className="text-muted-foreground text-xs">Replaces the crew on every selected entry. The first chosen leads.</p>}
            {needsLogins && accounts && (
              <NeedsLoginNote names={sortedTechs.filter((t) => lacksLogin(t.fsm_resource_id) && !crew.includes(t.fsm_resource_id)).map((t) => t.display_name)} />
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="move-reason">Reason {amcCount ? "" : "(optional)"}</Label>
            <Textarea
              id="move-reason"
              rows={2}
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
              placeholder={amcCount ? "Why it moves: the client asked for another day, the crew changed…" : "Optional"}
            />
            {amcCount > 0 && (
              <p className="text-muted-foreground text-xs">
                {amcCount === 1 ? "The AMC entry moves" : `The ${amcCount} AMC entries move`} through AMC: a PPM visit outside its service window, or a crew other than the one AMC suggests, needs this reason, and the visit keeps its original date.
              </p>
            )}
          </div>
        </div>

        {leadTimeSkipped.length > 0 && (
          <div className="border-warning/40 bg-warning/5 grid gap-2 rounded-lg border px-3 py-2.5 text-sm">
            <p>
              {leadTimeSkipped.length === 1 ? "One AMC job falls" : `${leadTimeSkipped.length} AMC jobs fall`} inside the property&apos;s access lead time. Book anyway once the pass is arranged; it is recorded in the history.
            </p>
            <Button size="sm" variant="outline" className="justify-self-start" disabled={busy} onClick={() => run(leadTimeSkipped.map((r) => r.entryId), true)}>
              Book anyway
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {results ? "Close" : "Cancel"}
          </Button>
          <Button
            disabled={busy || making || Boolean(problem)}
            title={problem ?? undefined}
            onClick={() => run(results ? results.filter((r) => r.status === "skipped").map((r) => r.entryId) : entries.map((e) => e.id))}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {results?.some((r) => r.status === "skipped") ? "Try the rest again" : day ? `Move to ${dayLabel(day)}` : changeCrew ? "Change crew" : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
