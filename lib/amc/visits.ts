import { z } from "zod";

import { TRADES } from "./client-profile";

/**
 * AMC visits on the board (BRD v0.3 5.11; Phase 9: DEV-356, 392-399).
 * Pure rules: which trade a service needs, the crew and time a visit
 * suggests, which technicians are competent and free, what blocks an
 * assignment, and where confirmation and access stand. No imports beyond
 * the AMC rules, so routes, screens and tests share them.
 */

export type Trade = (typeof TRADES)[number];

/* ------------------------------------------------------------------ */
/* Trades                                                              */
/* ------------------------------------------------------------------ */

/* The AMC services in AMC Settings, by the trade that carries them out. */
const TRADE_BY_SERVICE: Record<string, Trade> = {
  "ac-ppm": "ac",
  "duct-cleaning": "ac",
  "coil-cleaning": "ac",
  "electrical-ppm": "electrical",
  "plumbing-ppm": "plumbing",
  "water-pump": "plumbing",
  "roof-drain": "plumbing",
  "water-tank": "plumbing",
  handyman: "handyman",
};

/**
 * The trade a service needs: the property's scope says so when it has a
 * line for it; else the catalogue; else the service's name; else "other".
 */
export function tradeForService(serviceId: string, label: string, scopeTrade?: string | null): Trade {
  if (scopeTrade && (TRADES as readonly string[]).includes(scopeTrade)) return scopeTrade as Trade;
  if (TRADE_BY_SERVICE[serviceId]) return TRADE_BY_SERVICE[serviceId];
  const name = `${serviceId} ${label}`.toLowerCase();
  if (/\b(ac|a\/c|hvac|chiller|duct|coil|air)/.test(name)) return "ac";
  if (/plumb|pump|drain|water|tank/.test(name)) return "plumbing";
  if (/electr|lighting|db board|power/.test(name)) return "electrical";
  if (/civil|paint|tile|mason/.test(name)) return "civil";
  if (/handyman|carpent/.test(name)) return "handyman";
  return "other";
}

/* ------------------------------------------------------------------ */
/* The crew and time a visit suggests (DEV-396)                        */
/* ------------------------------------------------------------------ */

export interface CrewNeed {
  trades: Trade[];
  durationMinutes: number;
  headcount: number;
}

/**
 * Trade and headcount from the visit's lines, time from the standard
 * durations (AMC configuration; to confirm): one service takes the base
 * time and each extra unit adds to it; a clubbed visit adds its lines up.
 * One technician per trade, which a multi-skilled technician can cover.
 */
export function crewNeed(
  lines: Array<{ trade: Trade; units?: number | null }>,
  durations: { durationPerServiceMinutes: number; durationPerExtraUnitMinutes: number },
): CrewNeed {
  const trades = [...new Set(lines.map((l) => l.trade))];
  const durationMinutes = lines.reduce(
    (sum, l) => sum + durations.durationPerServiceMinutes + Math.max(0, (l.units ?? 1) - 1) * durations.durationPerExtraUnitMinutes,
    0,
  );
  return { trades, durationMinutes: Math.max(durations.durationPerServiceMinutes, durationMinutes), headcount: Math.max(1, trades.length) };
}

/* ------------------------------------------------------------------ */
/* Who is competent and free                                           */
/* ------------------------------------------------------------------ */

export const SKILL_LEVELS = ["trainee", "competent", "expert"] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];
export const SKILL_LEVEL_LABELS: Record<SkillLevel, string> = { trainee: "Trainee", competent: "Competent", expert: "Expert" };

export interface TechnicianFacts {
  fsmId: string;
  name: string;
  active: boolean;
  shift: string | null;
  skills: Array<{ trade: Trade; level: SkillLevel; certificateExpires: string | null }>;
  areas: string[];
  hasVehicle: boolean;
  isDriver: boolean;
  accessPermissions: string[];
}

export interface VisitNeed {
  trades: Trade[];
  date: string;
  /** Community or area of the property, when known. */
  area?: string | null;
  /** Access permissions the property's rules call for (gate pass types). */
  accessTypes: string[];
}

export interface TechnicianBusy {
  onLeave: boolean;
  /** Bookings (AMC visits or scheduled jobs) that overlap the slot. */
  overlaps: number;
  /** Minutes already booked that day. */
  workloadMinutes: number;
}

export interface TechnicianFit {
  fsmId: string;
  name: string;
  /** Trades of the visit this technician is confirmed competent for (valid certificate). */
  covers: Trade[];
  /** Why they cannot be assigned (BRD: blocked like leave). */
  blockers: string[];
  /** Worth knowing, but not blocking. */
  notes: string[];
  workloadMinutes: number;
  /** Higher is a better pick. */
  score: number;
}

const competent = (s: { level: SkillLevel; certificateExpires: string | null }, date: string) =>
  s.level !== "trainee" && (!s.certificateExpires || s.certificateExpires >= date);

/**
 * One technician against one visit. Never a "merely similar" technician
 * (BRD 5.11): covering none of the visit's trades is a blocker, as is
 * leave, a double booking, or a missing access permission.
 */
export function fitFor(t: TechnicianFacts, need: VisitNeed, busy: TechnicianBusy): TechnicianFit {
  const blockers: string[] = [];
  const notes: string[] = [];
  const covers = need.trades.filter((trade) => t.skills.some((s) => s.trade === trade && competent(s, need.date)));
  if (!t.active) blockers.push("Not active in FSM");
  if (covers.length === 0) {
    const expired = need.trades.some((trade) => t.skills.some((s) => s.trade === trade && s.level !== "trainee" && s.certificateExpires && s.certificateExpires < need.date));
    blockers.push(expired ? "Certificate expired for this trade" : "Not confirmed for this trade");
  }
  if (busy.onLeave) blockers.push("On leave that day");
  if (busy.overlaps > 0) blockers.push("Already booked at that time");
  const missingAccess = need.accessTypes.filter((a) => !t.accessPermissions.some((p) => p.trim().toLowerCase() === a.trim().toLowerCase()));
  if (missingAccess.length) blockers.push(`No access permission: ${missingAccess.join(", ")}`);
  if (need.area && t.areas.length && !t.areas.some((a) => need.area!.toLowerCase().includes(a.toLowerCase()) || a.toLowerCase().includes(need.area!.toLowerCase()))) {
    notes.push("Usually works another area");
  }
  if (!t.hasVehicle) notes.push("No vehicle");
  const expert = covers.some((trade) => t.skills.some((s) => s.trade === trade && s.level === "expert"));
  const score = covers.length * 100 + (expert ? 10 : 0) - Math.round(busy.workloadMinutes / 30) - notes.length * 5;
  return { fsmId: t.fsmId, name: t.name, covers, blockers, notes, workloadMinutes: busy.workloadMinutes, score };
}

/**
 * The suggested crew: the best free, competent technicians covering every
 * trade, preferring one who covers several. Null when some trade has
 * nobody (the coordinator sees which).
 */
export function suggestCrew(fits: TechnicianFit[], trades: Trade[]): { technicianIds: string[]; uncovered: Trade[] } {
  const eligible = fits.filter((f) => f.blockers.length === 0).sort((a, b) => b.score - a.score);
  const chosen: TechnicianFit[] = [];
  const left = new Set(trades);
  while (left.size) {
    const best = eligible
      .filter((f) => !chosen.includes(f))
      .map((f) => ({ f, gain: f.covers.filter((t) => left.has(t)).length }))
      .filter((x) => x.gain > 0)
      .sort((a, b) => b.gain - a.gain || b.f.score - a.f.score)[0];
    if (!best) break;
    chosen.push(best.f);
    best.f.covers.forEach((t) => left.delete(t));
  }
  return { technicianIds: chosen.map((f) => f.fsmId), uncovered: [...left] };
}

/**
 * What blocks assigning this crew (BRD 5.11 / DEV-397): any technician
 * with a blocker, or a trade nobody in the crew covers. Empty = allowed.
 */
export function assignmentProblems(fits: TechnicianFit[], trades: Trade[]): string[] {
  const problems = fits.flatMap((f) => f.blockers.map((b) => `${f.name}: ${b.toLowerCase()}`));
  const covered = new Set(fits.flatMap((f) => f.covers));
  const missing = trades.filter((t) => !covered.has(t));
  if (missing.length) problems.push(`Nobody in the crew covers ${missing.join(", ")}`);
  return problems;
}

/** Two time ranges (ISO) overlap. */
export function slotsOverlap(a: { start: string; end: string }, b: { start: string; end: string }): boolean {
  return a.start < b.end && b.start < a.end;
}

/* ------------------------------------------------------------------ */
/* Confirmation (DEV-398)                                              */
/* ------------------------------------------------------------------ */

export const CONFIRMATION_LABELS = {
  pending: "Awaiting the client",
  confirmed: "Confirmed by the client",
  declined: "Client declined",
  no_answer: "No answer after the attempts",
} as const;

export const ATTEMPT_OUTCOMES = ["message_sent", "no_answer", "confirmed", "reschedule_requested", "declined"] as const;
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];
export const ATTEMPT_OUTCOME_LABELS: Record<AttemptOutcome, string> = {
  message_sent: "Request sent",
  no_answer: "No answer",
  confirmed: "Confirmed",
  reschedule_requested: "Asked for another date",
  declined: "Declined",
};

/** The confirmation to-do falls due this many days before the window opens (BRD: 7). */
export function confirmationDue(windowStart: string, today: string, leadDays: number): boolean {
  const due = new Date(`${windowStart}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() - Math.max(0, leadDays));
  return today >= due.toISOString().slice(0, 10);
}

/**
 * Whether the attempts are used up with no answer (BRD: three attempts two
 * days apart by default) and when the next attempt may be made.
 */
export function attemptState(
  attempts: Array<{ outcome: AttemptOutcome; attemptedAt: string }>,
  rule: { attemptCount: number; attemptIntervalDays: number },
  now: Date,
): { tried: number; exhausted: boolean; nextAllowedAt: string | null } {
  const unanswered = attempts.filter((a) => a.outcome === "no_answer" || a.outcome === "message_sent");
  const answered = attempts.some((a) => a.outcome === "confirmed" || a.outcome === "declined" || a.outcome === "reschedule_requested");
  const tried = unanswered.length;
  const last = attempts.map((a) => a.attemptedAt).sort().at(-1) ?? null;
  const nextAllowedAt = last ? new Date(Date.parse(last) + rule.attemptIntervalDays * 86_400_000).toISOString() : null;
  return { tried, exhausted: !answered && tried >= rule.attemptCount, nextAllowedAt: nextAllowedAt && nextAllowedAt > now.toISOString() ? nextAllowedAt : null };
}

/* ------------------------------------------------------------------ */
/* Access (DEV-399)                                                    */
/* ------------------------------------------------------------------ */

export const ACCESS_STATUSES = ["not_required", "pending", "approved", "rejected", "expired"] as const;
export type AccessStatus = (typeof ACCESS_STATUSES)[number];
export const ACCESS_STATUS_LABELS: Record<AccessStatus, string> = {
  not_required: "Not required",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
};

/** A property with access rules needs a pass; one without needs nothing. */
export function defaultAccessStatus(accessRuleCount: number): AccessStatus {
  return accessRuleCount > 0 ? "pending" : "not_required";
}

/** An approved pass that runs out before the visit has expired for it. */
export function effectiveAccess(status: AccessStatus | null, validUntil: string | null, visitDate: string): AccessStatus | null {
  if (status === "approved" && validUntil && validUntil < visitDate) return "expired";
  return status;
}

/** The visit is near and still has no usable access (BRD: an alert). */
export function accessAlertDue(status: AccessStatus | null, visitDate: string, today: string, alertDays: number): boolean {
  if (status !== "pending" && status !== "rejected" && status !== "expired") return false;
  const from = new Date(`${visitDate}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - Math.max(0, alertDays));
  return today >= from.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* What the routes accept                                              */
/* ------------------------------------------------------------------ */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time (HH:MM)");
const uuid = z.string().uuid();
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v && v.length ? v : null));
const fsmIds = z.array(z.string().trim().min(1).max(40)).max(20);

export const technicianProfileSchema = z
  .object({
    areas: z.array(z.string().trim().min(1).max(80)).max(30),
    hasVehicle: z.boolean(),
    isDriver: z.boolean(),
    tools: z.array(z.string().trim().min(1).max(80)).max(50),
    accessPermissions: z.array(z.string().trim().min(1).max(80)).max(50),
    notes: optionalText(1000),
    skills: z
      .array(
        z
          .object({
            trade: z.enum(TRADES),
            level: z.enum(SKILL_LEVELS),
            certificate: optionalText(200),
            certificateExpires: isoDate.optional().nullable(),
          })
          .strict(),
      )
      .max(TRADES.length)
      .refine((rows) => new Set(rows.map((r) => r.trade)).size === rows.length, { message: "One row per trade" }),
  })
  .strict();
export type TechnicianProfileInput = z.infer<typeof technicianProfileSchema>;

export const boardActionSchema = z.discriminatedUnion("action", [
  /* Put a visit on the board: day, start, crew (blocked without skill, access, or when on leave / booked). */
  z
    .object({
      action: z.literal("place"),
      visitId: uuid,
      date: isoDate,
      startTime: hhmm,
      durationMinutes: z.number().int().min(15).max(1440).optional().nullable(),
      technicianIds: fsmIds.min(1, "Choose at least one technician"),
      leadTechnicianId: z.string().trim().max(40).optional().nullable(),
      overrideReason: optionalText(500),
      reason: optionalText(500),
    })
    .strict(),
  /* Move one or several to another day / time; crews stay. Outside the window is a reschedule (reason). */
  z
    .object({ action: z.literal("move"), visitIds: z.array(uuid).min(1).max(50), date: isoDate, startTime: hhmm.optional().nullable(), reason: optionalText(500) })
    .strict(),
  /* Change the crew of one or several. */
  z
    .object({ action: z.literal("reassign"), visitIds: z.array(uuid).min(1).max(50), technicianIds: fsmIds.min(1), overrideReason: optionalText(500) })
    .strict(),
  z.object({ action: z.literal("unplace"), visitId: uuid }).strict(),
]);
export type BoardAction = z.infer<typeof boardActionSchema>;

export const visitActionSchema = z.discriminatedUnion("action", [
  /* The confirmation request to the client: WhatsApp prepared (link), or email sent. */
  z.object({ action: z.literal("request_confirmation"), channel: z.enum(["whatsapp", "email"]) }).strict(),
  z
    .object({ action: z.literal("attempt"), channel: z.enum(["whatsapp", "call", "sms", "email"]), outcome: z.enum(ATTEMPT_OUTCOMES), note: optionalText(500) })
    .strict(),
  z
    .object({
      action: z.literal("access"),
      status: z.enum(ACCESS_STATUSES),
      validUntil: isoDate.optional().nullable(),
      documentId: uuid.optional().nullable(),
      note: optionalText(500),
    })
    .strict(),
]);
export type VisitAction = z.infer<typeof visitActionSchema>;
