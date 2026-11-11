import { z } from "zod";

/**
 * Renewals due, their outcome and the escalation on the draft (BRD v0.3
 * 5.16; Phase 13: DEV-415, 416, to-do 7). Pure rules; the renewal draft
 * itself is lib/amc/renewal.ts.
 */

export const RENEWAL_OUTCOMES = ["renewed", "renewed_revised_scope", "under_negotiation", "not_renewed", "lapsed"] as const;
export type RenewalOutcome = (typeof RENEWAL_OUTCOMES)[number];
export const RENEWAL_OUTCOME_LABELS: Record<RenewalOutcome, string> = {
  renewed: "Renewed",
  renewed_revised_scope: "Renewed with revised scope",
  under_negotiation: "Under negotiation",
  not_renewed: "Not renewed",
  lapsed: "Lapsed",
};
/** The renewal is settled: no more reminders or escalation. */
export const FINAL_OUTCOMES: readonly RenewalOutcome[] = ["renewed", "renewed_revised_scope", "not_renewed", "lapsed"];
/** The ones the team records by hand; renewed and lapsed are also set by the system. */
export const MANUAL_OUTCOMES = ["under_negotiation", "not_renewed", "lapsed"] as const;

const dayMs = 86_400_000;
export const daysUntil = (today: string, date: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / dayMs);

/** The escalation on a renewal price, to the fils. */
export function escalate(price: number, percent: number): number {
  return Math.round(price * (1 + percent / 100) * 100) / 100;
}

export interface RenewalFacts {
  status: string;
  endDate: string;
  renewedByContractId: string | null;
  outcome: RenewalOutcome | null;
  remindedAt: string | null;
  /** The last thing done about the renewal (draft created, outcome recorded, proposal moved). */
  activityAt: string | null;
}

export type RenewalStage = "not_due" | "due" | "idle" | "overdue" | "settled";

/**
 * Where a contract's renewal stands: due inside the lead time; idle when
 * reminded and nothing has happened for the idle days; overdue once the
 * contract has ended without a renewal; settled once the outcome is final.
 */
export function renewalStage(f: RenewalFacts, today: string, rules: { leadDays: number; idleEscalationDays: number }): RenewalStage {
  if (f.renewedByContractId || (f.outcome && FINAL_OUTCOMES.includes(f.outcome))) return "settled";
  if (!["active", "on_hold", "expired"].includes(f.status)) return "settled";
  const left = daysUntil(today, f.endDate);
  if (left < 0) return "overdue";
  if (left > rules.leadDays) return "not_due";
  const since = f.activityAt ?? f.remindedAt;
  if (f.remindedAt && since && Date.parse(since) + rules.idleEscalationDays * dayMs < Date.parse(`${today}T00:00:00Z`)) return "idle";
  return "due";
}

/** "Expiring in 60 and 30 days" (BRD 6.2): the notice due today, if any. */
export function expiryNotice(today: string, endDate: string, notices: readonly number[] = [60, 30]): number | null {
  const left = daysUntil(today, endDate);
  const due = [...notices].sort((a, b) => a - b).find((n) => left >= 0 && left <= n);
  return due ?? null;
}

/** Renewed, or renewed with a revised scope: the new contract's services against the old. */
export function renewedOutcome(
  previous: Array<{ serviceId: string; units: number; frequency: number }>,
  next: Array<{ serviceId: string; units: number; frequency: number }>,
): "renewed" | "renewed_revised_scope" {
  const key = (s: { serviceId: string; units: number; frequency: number }) => `${s.serviceId}:${s.units}:${s.frequency}`;
  const a = new Set(previous.map(key));
  const b = new Set(next.map(key));
  return a.size === b.size && [...a].every((k) => b.has(k)) ? "renewed" : "renewed_revised_scope";
}

export const renewalOutcomeSchema = z
  .object({
    outcome: z.enum(MANUAL_OUTCOMES),
    reason: z.string().trim().max(1000).optional().nullable(),
  })
  .strict()
  .refine((v) => v.outcome !== "not_renewed" || Boolean(v.reason && v.reason.length >= 3), { message: "Say why it was not renewed", path: ["reason"] });
export type RenewalOutcomeInput = z.infer<typeof renewalOutcomeSchema>;
