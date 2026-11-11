import { z } from "zod";

/**
 * AMC visit execution and closure (BRD v0.3 5.12; Phase 10: DEV-402,
 * 403, 404). Pure rules: the five non-completion groups, when review is
 * mandatory, what a closed visit's status is, what the remaining trade
 * is, the no-show rule and the 48-hour report clock.
 */

/* ------------------------------------------------------------------ */
/* Outcomes                                                            */
/* ------------------------------------------------------------------ */

export const LINE_OUTCOMES = ["completed", "partially_completed", "not_completed"] as const;
export type LineOutcome = (typeof LINE_OUTCOMES)[number];
export const LINE_OUTCOME_LABELS: Record<LineOutcome, string> = {
  completed: "Completed",
  partially_completed: "Partially completed",
  not_completed: "Not completed",
};

/** BRD 5.11: Not Completed and Partially Completed carry a reason in one of five groups. */
export const OUTCOME_GROUPS = {
  client: {
    label: "Client related",
    reasons: ["No access given", "Not reachable", "No answer after the attempts", "Property vacant", "Client rescheduled", "Payment outstanding"],
  },
  internal: { label: "Internal failure", reasons: ["Manpower", "Tools", "Vehicle"] },
  material: { label: "Material shortage", reasons: ["Material shortage"] },
  access: { label: "Access failure", reasons: ["Community", "Building"] },
  partial: { label: "Partial completion", reasons: ["Partial completion"] },
} as const;
export type OutcomeGroup = keyof typeof OUTCOME_GROUPS;
export const OUTCOME_GROUP_KEYS = Object.keys(OUTCOME_GROUPS) as OutcomeGroup[];

/** A client no-show: the reasons the contract counts towards a consumed visit. */
const NO_SHOW_REASONS = new Set(["No access given", "Not reachable", "No answer after the attempts", "Property vacant"]);

export function isNoShow(group: OutcomeGroup | null, reason: string | null): boolean {
  return group === "client" && Boolean(reason && NO_SHOW_REASONS.has(reason));
}

/**
 * "The contract treats two no shows in a row as a consumed visit"
 * (BRD 5.11): this attempt and the one before it, for the same planned
 * visit of a service, both client no-shows.
 */
export function noShowConsumesVisit(current: { group: OutcomeGroup | null; reason: string | null }, previous: { group: OutcomeGroup | null; reason: string | null } | null, inARow = 2): boolean {
  if (inARow <= 1) return isNoShow(current.group, current.reason);
  return isNoShow(current.group, current.reason) && Boolean(previous && isNoShow(previous.group, previous.reason));
}

/* ------------------------------------------------------------------ */
/* Review and closure (DEV-402)                                        */
/* ------------------------------------------------------------------ */

export interface SheetFacts {
  pendingWorks: Array<{ description: string; reason: string }>;
  qualityConcern: boolean;
  additionalWork: Array<{ description: string }>;
  lines: Array<{ outcome: LineOutcome | null }>;
  photos: Array<{ kind: "before" | "after" | "fault" | "other" }>;
  clientSignatureName: string | null;
}

export const REVIEW_REASON_LABELS = {
  pending_works: "Pending works",
  quality_concern: "Quality concern",
  missing_evidence: "Missing evidence",
  incomplete_scope: "Incomplete scope",
} as const;
export type ReviewReason = keyof typeof REVIEW_REASON_LABELS;

/**
 * Why a supervisor must look closely (BRD 5.12: pending works, quality
 * concerns, missing evidence, incomplete scope). Missing evidence: a
 * completed trade without both a before and an after photo, or no client
 * signature for work that was done.
 */
export function reviewReasons(s: SheetFacts): ReviewReason[] {
  const out: ReviewReason[] = [];
  if (s.pendingWorks.length) out.push("pending_works");
  if (s.qualityConcern) out.push("quality_concern");
  const done = s.lines.some((l) => l.outcome === "completed" || l.outcome === "partially_completed");
  const hasBefore = s.photos.some((p) => p.kind === "before");
  const hasAfter = s.photos.some((p) => p.kind === "after");
  if (done && (!hasBefore || !hasAfter || !s.clientSignatureName?.trim())) out.push("missing_evidence");
  if (s.lines.some((l) => l.outcome !== "completed")) out.push("incomplete_scope");
  return out;
}

/** What blocks submitting the job sheet (the record must be complete enough to review). */
export function submitProblems(s: SheetFacts & { arrivedAt: string | null; completedAt: string | null; linesExplained: boolean }): string[] {
  const out: string[] = [];
  if (!s.arrivedAt) out.push("Record the arrival time");
  if (!s.completedAt) out.push("Record the completion time");
  if (s.arrivedAt && s.completedAt && s.completedAt < s.arrivedAt) out.push("Completion is before arrival");
  if (s.lines.some((l) => !l.outcome)) out.push("Give every trade an outcome");
  if (!s.linesExplained) out.push("A trade not completed (or partly) needs its reason");
  if (s.pendingWorks.some((p) => !p.reason.trim())) out.push("Every pending work needs a reason");
  const done = s.lines.some((l) => l.outcome === "completed" || l.outcome === "partially_completed");
  if (done && !s.clientSignatureName?.trim()) out.push("The client's signature (name) proves the visit was delivered");
  return out;
}

export type ClosedVisitStatus = "completed" | "completed_with_additional_work" | "partially_completed" | "not_completed";

/** The visit's status once the supervisor closes it, from its trades and any additional work found. */
export function closedStatus(lines: Array<{ outcome: LineOutcome }>, additionalWork: number): ClosedVisitStatus {
  const done = lines.filter((l) => l.outcome === "completed").length;
  const some = lines.some((l) => l.outcome !== "not_completed");
  if (done === lines.length && lines.length > 0) return additionalWork > 0 ? "completed_with_additional_work" : "completed";
  return some ? "partially_completed" : "not_completed";
}

/**
 * Trades to plan again: the rest of a partly done trade, and a trade not
 * done unless the no-show rule consumed it. The retry of a partly done
 * trade finishes work already counted, so it does not consume again.
 */
export function remainingTrades<T extends { outcome: LineOutcome; consumed: boolean }>(lines: T[]): T[] {
  return lines.filter((l) => l.outcome === "partially_completed" || (l.outcome === "not_completed" && !l.consumed));
}

/* ------------------------------------------------------------------ */
/* The 48-hour report clock (DEV-404)                                  */
/* ------------------------------------------------------------------ */

/** Contract clause 1.2: the report goes to the client within 48 hours of the visit. */
export function reportDueAt(visitCompletedAt: string, hours = 48): string {
  return new Date(Date.parse(visitCompletedAt) + hours * 3_600_000).toISOString();
}

/** Late, or due within the warning hours and still not sent. */
export function reportState(dueAt: string | null, sentAt: string | null, now: Date, warnHours = 12): "sent" | "on_time" | "at_risk" | "late" | null {
  if (sentAt) return "sent";
  if (!dueAt) return null;
  const left = Date.parse(dueAt) - now.getTime();
  if (left < 0) return "late";
  return left <= warnHours * 3_600_000 ? "at_risk" : "on_time";
}

/* ------------------------------------------------------------------ */
/* What the routes accept                                              */
/* ------------------------------------------------------------------ */

const iso = z.string().datetime({ offset: true, message: "Use a date and time" });
const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).optional().nullable().transform((v) => (v && v.length ? v : null));

export const jobSheetSchema = z
  .object({
    arrivedAt: iso.optional().nullable(),
    completedAt: iso.optional().nullable(),
    technicianIds: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    faults: optionalText(4000),
    consumables: z.array(z.object({ item: text(200).min(1), quantity: z.number().positive().max(100_000), unit: optionalText(20) }).strict()).max(100).default([]),
    additionalWork: z.array(z.object({ description: text(1000).min(3, "Describe the additional work"), trade: optionalText(40) }).strict()).max(50).default([]),
    pendingWorks: z.array(z.object({ description: text(1000).min(3), reason: text(500) }).strict()).max(50).default([]),
    qualityConcern: z.boolean().default(false),
    qualityNote: optionalText(2000),
    clientSignatureName: optionalText(200),
    notes: optionalText(4000),
    lines: z
      .array(
        z
          .object({
            lineId: uuid,
            outcome: z.enum(LINE_OUTCOMES).nullable(),
            outcomeGroup: z.enum(OUTCOME_GROUP_KEYS as [OutcomeGroup, ...OutcomeGroup[]]).optional().nullable(),
            outcomeReason: optionalText(200),
          })
          .strict(),
      )
      .max(20),
    checklist: z
      .array(
        z
          .object({
            lineId: uuid.optional().nullable(),
            assetId: uuid.optional().nullable(),
            label: text(300).min(1),
            result: z.enum(["ok", "attention", "fault", "not_applicable"]),
            note: optionalText(1000),
          })
          .strict(),
      )
      .max(300)
      .default([]),
  })
  .strict();
export type JobSheetInput = z.infer<typeof jobSheetSchema>;

export const jobSheetActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), sheet: jobSheetSchema }).strict(),
  z.object({ action: z.literal("submit"), sheet: jobSheetSchema }).strict(),
  z.object({ action: z.literal("close"), comment: optionalText(1000) }).strict(),
  z.object({ action: z.literal("return"), comment: text(1000).min(3, "Say what needs fixing") }).strict(),
  z.object({ action: z.literal("resend_report") }).strict(),
]);
export type JobSheetAction = z.infer<typeof jobSheetActionSchema>;
