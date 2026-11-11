"use client";

import { Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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

/**
 * The one crew list (visit page, call out, the board's Place visit): tick
 * technicians; the suggested crew is marked, the lead is the first chosen
 * unless `leadId` says otherwise, and a blocked technician can only be
 * unticked (kept when they were already on the crew).
 */
export function CrewPicker({
  options,
  picked,
  onPickedChange,
  leadId,
  disabled = false,
}: {
  options: CrewOptions;
  picked: string[];
  onPickedChange: (next: string[]) => void;
  leadId?: string | null;
  disabled?: boolean;
}) {
  const lead = leadId ?? picked[0] ?? null;
  const toggle = (id: string, on: boolean) => onPickedChange(on ? [...picked.filter((x) => x !== id), id] : picked.filter((x) => x !== id));
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
          disabled={disabled || (isBlocked && !checked)}
          onCheckedChange={(on) => toggle(f.fsmId, on === true)}
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
      {gaps.map((message) => (
        <p key={message} className="border-warning/30 bg-warning/5 text-warning rounded-lg border px-3 py-2 text-sm">
          {message}
        </p>
      ))}
      {candidates.length === 0 && blocked.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-center text-sm">
          No technician is confirmed for this trade. Add the skill under AMC → Technicians.
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
