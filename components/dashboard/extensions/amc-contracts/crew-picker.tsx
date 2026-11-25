"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Check, ChevronsUpDown, KeyRound, Star, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NeedsLoginBadge, NeedsLoginNote, cannotRegister, useTechnicianLogins } from "@/components/dashboard/shared/technician-login";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TRADE_LABELS } from "@/lib/amc/client-profile";
import type { TechnicianFit, Trade } from "@/lib/amc/visits";
import { cn } from "@/lib/utils";

import { crewGapMessages } from "./crew-gap";
import { durationLabel } from "./visit-status";

/**
 * Who can go on a visit at one time, as every crew screen shows it: the
 * competent and free technicians (best first), those competent but blocked
 * (and why), the suggested crew, and why a trade has nobody.
 */
export interface CrewOptions {
  candidates: TechnicianFit[];
  blocked: TechnicianFit[];
  suggestedIds: string[];
  /** Why a trade has nobody, in words (no skill on file, or all busy). */
  gaps: string[];
}

type SuggestionBase = {
  suggested: { technicianIds: string[]; uncovered: Trade[] };
  skilledByTrade: Record<string, number>;
  rosterSize: number;
};

/** A planned visit's suggestion (candidates and blocked) or a call out's (one list of fits), as one shape. */
export function crewOptions(s: SuggestionBase & ({ candidates: TechnicianFit[]; blocked: TechnicianFit[] } | { fits: TechnicianFit[] })): CrewOptions {
  const best = (a: TechnicianFit, b: TechnicianFit) => b.score - a.score;
  const candidates = "fits" in s ? s.fits.filter((f) => f.blockers.length === 0).sort(best) : s.candidates;
  const blocked = "fits" in s ? s.fits.filter((f) => f.blockers.length > 0) : s.blocked;
  return { candidates, blocked, suggestedIds: s.suggested.technicianIds, gaps: crewGapMessages(s) };
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

/** The chosen crew is not the suggested one (a reason is then asked for). */
export const differsFromSuggested = (picked: string[], options: CrewOptions | null) =>
  options !== null && options.suggestedIds.length > 0 && !sameSet(picked, options.suggestedIds);

/** Chosen technicians the options know have no login yet (13 Nov 2026). */
export const crewWithoutLogin = (picked: string[], options: CrewOptions | null, linkedNow: ReadonlySet<string> = new Set()) =>
  options
    ? [...options.candidates, ...options.blocked].filter((f) => picked.includes(f.fsmId) && f.accountId === null && !linkedNow.has(f.fsmId))
    : [];

/**
 * The one crew picker (visit page, call out, the board's Place visit): a
 * searchable dropdown of technicians (23 Nov 2026, the user: the long list
 * of boxes was hard to use), and the chosen crew listed under it. The
 * suggested crew is marked, the lead is the first chosen unless `leadId`
 * says otherwise, and a blocked technician (on leave, not active in FSM)
 * can't be added, only removed when they were already on the crew. An
 * already booked technician can be added, with a warning (DEV-490).
 *
 * A technician with no portal login can't see the visit on the mobile app,
 * so ticking one creates their login first (Inspector role, their FSM
 * email) and shows the email and password to hand over. A suggested crew
 * that includes somebody without a login says so above the list, and
 * `onMissingLoginsChange` tells the screen, which holds its submit until
 * the logins exist.
 */
export function CrewPicker({
  options,
  picked,
  onPickedChange,
  leadId,
  disabled = false,
  onMissingLoginsChange,
}: {
  options: CrewOptions;
  picked: string[];
  onPickedChange: (next: string[]) => void;
  leadId?: string | null;
  disabled?: boolean;
  /** How many chosen technicians still have no login. */
  onMissingLoginsChange?: (count: number) => void;
}) {
  const lead = leadId ?? picked[0] ?? null;
  const { createLogins, dialogs } = useTechnicianLogins();
  /* Logins made on this screen, until the next "Find technicians" brings them from the server. */
  const [linkedNow, setLinkedNow] = useState<ReadonlySet<string>>(() => new Set());
  const [creating, setCreating] = useState(false);
  const hasLogin = (f: TechnicianFit) => f.accountId !== null || linkedNow.has(f.fsmId);
  const missing = crewWithoutLogin(picked, options, linkedNow);
  useEffect(() => {
    onMissingLoginsChange?.(missing.length);
  }, [missing.length, onMissingLoginsChange]);

  const makeLogins = async (fits: TechnicianFit[]) => {
    setCreating(true);
    try {
      const made = await createLogins(fits.map((f) => ({ fsmId: f.fsmId, name: f.name, email: f.email })));
      if (!made) return false;
      setLinkedNow((prev) => new Set([...prev, ...made.map((r) => r.fsmId)]));
      return true;
    } finally {
      setCreating(false);
    }
  };
  const [open, setOpen] = useState(false);
  const { candidates, blocked, suggestedIds, gaps } = options;
  const all = [...candidates, ...blocked];
  const isBlocked = (f: TechnicianFit) => f.blockers.length > 0;
  /* In the order chosen, so the first is the lead; one no longer offered is skipped. */
  const chosen = picked.map((id) => all.find((f) => f.fsmId === id)).filter((f): f is TechnicianFit => Boolean(f));
  const bookedChosen = chosen.filter((f) => f.booked && !isBlocked(f));

  const add = (f: TechnicianFit) => {
    const id = f.fsmId;
    const done = () => {
      onPickedChange([...picked.filter((x) => x !== id), id]);
      /* Picked anyway, so say it at once as well as under the list. */
      if (f.booked) toast.warning(`${f.name} is already booked at that time`, { description: "They are added. Check their other booking before you save." });
    };
    if (hasLogin(f)) return done();
    /* No email in FSM: no login can be made, so they are not added (25 Nov 2026). */
    const blocked = cannotRegister(f);
    if (blocked) return void toast.error(blocked);
    /* No login yet: make it first, then add. */
    void makeLogins([f]).then((ok) => {
      if (ok) done();
    });
  };
  const remove = (id: string) => onPickedChange(picked.filter((x) => x !== id));
  const toggle = (f: TechnicianFit) => (picked.includes(f.fsmId) ? remove(f.fsmId) : add(f));

  const badges = (f: TechnicianFit, inList: boolean) => (
    <>
      {suggestedIds.includes(f.fsmId) ? (
        <Badge variant="secondary" className="bg-success/10 text-success border-0 font-medium">
          <Star className="size-3" />
          Suggested
        </Badge>
      ) : null}
      {!inList && lead === f.fsmId && picked.length > 1 ? (
        <Badge variant="secondary" className="bg-brand-50 text-brand border-0 font-medium">
          Lead
        </Badge>
      ) : null}
      {/* DEV-490: shown and marked, and can still be picked. */}
      {f.booked && !isBlocked(f) ? (
        <Badge variant="secondary" className="bg-warning/10 text-warning border-0 font-medium">
          <CalendarClock className="size-3" />
          Already booked
        </Badge>
      ) : null}
      {f.covers.map((tr) => (
        <Badge key={tr} variant="outline" className="font-normal">
          {TRADE_LABELS[tr] ?? tr}
        </Badge>
      ))}
      {/* Only where it can matter: somebody who can be added, or is on the crew. */}
      {hasLogin(f) || (isBlocked(f) && !picked.includes(f.fsmId)) ? null : <NeedsLoginBadge email={f.email} />}
    </>
  );
  const detail = (f: TechnicianFit) =>
    isBlocked(f) ? (
      <span className="text-danger block text-xs">{f.blockers.join(" · ")}</span>
    ) : (
      <span className="text-muted-foreground block text-xs">
        {[f.workloadMinutes ? `${durationLabel(f.workloadMinutes)} booked that day` : "Nothing else booked that day", ...f.notes].join(" · ")}
      </span>
    );

  const item = (f: TechnicianFit) => {
    const on = picked.includes(f.fsmId);
    /* A blocked technician can't be added; one already on the crew can still be taken off. */
    const locked = isBlocked(f) && !on;
    return (
      <CommandItem
        key={f.fsmId}
        value={f.fsmId}
        keywords={[f.name, ...f.covers.map((tr) => TRADE_LABELS[tr] ?? tr), f.booked ? "already booked" : ""]}
        disabled={disabled || creating || locked}
        onSelect={() => toggle(f)}
        className="cursor-pointer items-start gap-2.5 py-2"
      >
        <span
          className={cn(
            "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
            on ? "bg-primary border-primary text-primary-foreground" : "border-input",
          )}
          aria-hidden
        >
          {on ? <Check className="size-3" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{f.name}</span>
            {badges(f, true)}
          </span>
          {detail(f)}
        </span>
      </CommandItem>
    );
  };

  return (
    <div className="grid gap-2">
      {dialogs}
      {missing.length ? (
        <Alert variant="warning">
          <KeyRound />
          <AlertTitle>{missing.length === 1 ? "No mobile login yet" : "Some have no mobile login yet"}</AlertTitle>
          <AlertDescription>
            <p>
              {missing.length === 1
                ? `${missing[0].name} has no mobile login yet. Create it before assigning them.`
                : `${missing.length} chosen technicians have no mobile login yet. Create them before assigning.`}
            </p>
            <Button type="button" size="sm" variant="outline" disabled={disabled || creating} onClick={() => void makeLogins(missing)}>
              <KeyRound className="size-4" />
              {missing.length === 1 ? "Create login" : "Create logins"}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {gaps.map((message) => (
        <Alert key={message} variant="warning">
          <TriangleAlert />
          <AlertTitle>Check the crew</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ))}
      {bookedChosen.length ? (
        <Alert variant="warning">
          <CalendarClock />
          <AlertTitle>{bookedChosen.length === 1 ? "Already booked at that time" : "Some are already booked at that time"}</AlertTitle>
          <AlertDescription>
            {bookedChosen.map((f) => f.name).join(", ")} {bookedChosen.length === 1 ? "has" : "have"} another booking that overlaps this visit. They can still go: check
            the other booking, or pick someone free.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Who among those who can go still needs a login, before anyone is picked. */}
      <NeedsLoginNote names={candidates.filter((f) => !hasLogin(f) && !picked.includes(f.fsmId)).map((f) => f.name)} />

      {all.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-center text-sm">
          No active technician on the FSM roster. Sync the technicians from Zoho FSM first.
        </p>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" role="combobox" aria-expanded={open} disabled={disabled} className="w-full justify-between font-normal">
              <span className="text-muted-foreground truncate">
                {picked.length ? `Add or remove technicians (${picked.length} chosen)` : "Search and pick technicians"}
              </span>
              <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-(--radix-popover-trigger-width) gap-0 p-0">
            <Command>
              <CommandInput placeholder="Search by name or trade" />
              <CommandList className="max-h-80">
                <CommandEmpty>No technician by that name.</CommandEmpty>
                {candidates.length ? <CommandGroup heading="Available">{candidates.map(item)}</CommandGroup> : null}
                {blocked.length ? <CommandGroup heading="Can't be assigned at that time">{blocked.map(item)}</CommandGroup> : null}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}

      {/* The chosen crew, the lead first. */}
      {chosen.length ? (
        <ul className="grid gap-2">
          {chosen.map((f) => (
            <li key={f.fsmId} className={cn("flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm", isBlocked(f) ? "border-danger/40" : "border-brand/40")}>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{f.name}</span>
                  {badges(f, false)}
                </span>
                {detail(f)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                disabled={disabled || creating}
                onClick={() => remove(f.fsmId)}
                aria-label={`Remove ${f.name}`}
              >
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : all.length ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-center text-sm">No technician chosen yet. Search above to add one.</p>
      ) : null}
    </div>
  );
}

/** Under the list: how many are chosen and who leads. */
export function crewSummary(picked: string[]) {
  if (!picked.length) return "Choose at least one technician.";
  return `${picked.length} ${picked.length === 1 ? "technician" : "technicians"} chosen${picked.length > 1 ? "; the first is the lead" : ""}.`;
}
