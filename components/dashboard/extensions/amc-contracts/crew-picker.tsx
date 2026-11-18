"use client";

import { useEffect, useState } from "react";
import { KeyRound, Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTechnicianLogins } from "@/components/dashboard/shared/technician-login";
import { Checkbox } from "@/components/ui/checkbox";
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
 * The one crew list (visit page, call out, the board's Place visit): tick
 * technicians; the suggested crew is marked, the lead is the first chosen
 * unless `leadId` says otherwise, and a blocked technician can only be
 * unticked (kept when they were already on the crew).
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
  const toggle = (f: TechnicianFit, on: boolean) => {
    const id = f.fsmId;
    if (!on) return onPickedChange(picked.filter((x) => x !== id));
    if (hasLogin(f)) return onPickedChange([...picked.filter((x) => x !== id), id]);
    /* No login yet: make it first, then tick. */
    void makeLogins([f]).then((ok) => {
      if (ok) onPickedChange([...picked.filter((x) => x !== id), id]);
    });
  };
  const { candidates, blocked, suggestedIds, gaps } = options;

  const row = (f: TechnicianFit, isBlocked: boolean) => {
    const checked = picked.includes(f.fsmId);
    return (
      <label
        key={f.fsmId}
        className={cn(
          "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm",
          isBlocked && !checked ? "opacity-60" : "hover:bg-muted/40 cursor-pointer",
          checked && "border-brand/40",
        )}
      >
        <Checkbox
          className="mt-0.5"
          checked={checked}
          disabled={disabled || creating || (isBlocked && !checked)}
          onCheckedChange={(on) => toggle(f, on === true)}
          aria-label={isBlocked && !checked ? `${f.name} can't be assigned` : f.name}
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
            {checked && lead === f.fsmId && picked.length > 1 ? (
              <Badge variant="secondary" className="bg-brand-50 text-brand border-0 font-medium">
                Lead
              </Badge>
            ) : null}
            {f.covers.map((t) => (
              <Badge key={t} variant="outline" className="font-normal">
                {TRADE_LABELS[t] ?? t}
              </Badge>
            ))}
            {/* Only where it can matter: somebody who can be ticked, or is on the crew. */}
            {hasLogin(f) || (isBlocked && !checked) ? null : (
              <Badge variant="outline" className="border-warning/40 text-warning font-normal" title="No mobile login yet: ticking creates one">
                <KeyRound className="size-3" />
                No login
              </Badge>
            )}
          </span>
          {isBlocked ? (
            <span className="text-danger block text-xs">{f.blockers.join(" · ")}</span>
          ) : (
            <span className="text-muted-foreground block text-xs">
              {[f.workloadMinutes ? `${durationLabel(f.workloadMinutes)} booked that day` : "Nothing else booked that day", ...f.notes].join(" · ")}
            </span>
          )}
        </span>
      </label>
    );
  };

  return (
    <div className="grid gap-2">
      {dialogs}
      {missing.length ? (
        <div className="border-warning/30 bg-warning/5 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
          <p className="text-warning min-w-0 flex-1 text-sm">
            {missing.length === 1
              ? `${missing[0].name} has no mobile login yet. Create it before assigning them.`
              : `${missing.length} chosen technicians have no mobile login yet. Create them before assigning.`}
          </p>
          <Button type="button" size="sm" variant="outline" disabled={disabled || creating} onClick={() => void makeLogins(missing)}>
            <KeyRound className="size-4" />
            {missing.length === 1 ? "Create login" : "Create logins"}
          </Button>
        </div>
      ) : null}
      {gaps.map((message) => (
        <p key={message} className="border-warning/30 bg-warning/5 text-warning rounded-lg border px-3 py-2 text-sm">
          {message}
        </p>
      ))}
      {candidates.length === 0 && blocked.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-center text-sm">
          No technician is confirmed for this trade. Add the skill under Workforce → People → AMC skills.
        </p>
      ) : null}
      {candidates.length ? <p className="text-sm font-medium">Available</p> : null}
      {candidates.map((f) => row(f, false))}
      {blocked.length ? <p className="pt-1 text-sm font-medium">Can&apos;t be assigned at that time</p> : null}
      {blocked.map((f) => row(f, true))}
    </div>
  );
}

/** Under the list: how many are chosen and who leads. */
export function crewSummary(picked: string[]) {
  if (!picked.length) return "Choose at least one technician.";
  return `${picked.length} ${picked.length === 1 ? "technician" : "technicians"} chosen${picked.length > 1 ? "; the first is the lead" : ""}.`;
}
