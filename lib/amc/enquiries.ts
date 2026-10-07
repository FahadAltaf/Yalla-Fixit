import { z } from "zod";

import { PREFERRED_CHANNELS, UNIT_TYPES } from "./client-profile";
import type { AmcConfig } from "./config";

/**
 * The AMC enquiry pipeline (BRD 5.1, 5.2; DEV-347, 358, 359, 362). Pure:
 * used by the API, the screens and the tests.
 *
 * Stages, sources and lost reasons are configurable lists (AMC
 * configuration, "enquiries"). A few stages carry behaviour, by name:
 *   * Lost needs a reason from the configured list;
 *   * Won, Lost and On Hold stop the idle clock;
 *   * leaving Won or Lost (reopening) needs a reason;
 *   * Site Visit Scheduled is set when a site visit is booked;
 *   * Proposal Preparation and later need a completed site visit for the
 *     categories configuration names (flag by default, or block).
 * Configuration refuses a stage list without Won and Lost; renaming any
 * other of these drops only its own behaviour.
 */

export const ENQUIRY_STAGE = {
  new: "New Enquiry",
  contacted: "Contacted",
  qualified: "Qualified",
  detailsCaptured: "Details Captured",
  siteVisitScheduled: "Site Visit Scheduled",
  proposalPreparation: "Proposal Preparation",
  won: "Won",
  lost: "Lost",
  onHold: "On Hold",
} as const;

/** Closed: the enquiry has its outcome. */
export const CLOSED_STAGES: readonly string[] = [ENQUIRY_STAGE.won, ENQUIRY_STAGE.lost];
/** The idle clock stops here. */
export const IDLE_EXEMPT_STAGES: readonly string[] = [ENQUIRY_STAGE.won, ENQUIRY_STAGE.lost, ENQUIRY_STAGE.onHold];

export const FOLLOW_UP_CHANNELS = ["call", "whatsapp", "email", "sms", "meeting", "site_visit", "other"] as const;
export type FollowUpChannel = (typeof FOLLOW_UP_CHANNELS)[number];
export const FOLLOW_UP_CHANNEL_LABELS: Record<FollowUpChannel, string> = {
  call: "Call",
  whatsapp: "WhatsApp",
  email: "Email",
  sms: "SMS",
  meeting: "Meeting",
  site_visit: "Site visit",
  other: "Other",
};

export const SITE_VISIT_ATTENDANCE = ["attended", "client_no_show", "rescheduled", "cancelled"] as const;
export type SiteVisitAttendance = (typeof SITE_VISIT_ATTENDANCE)[number];
export const ATTENDANCE_LABELS: Record<SiteVisitAttendance, string> = {
  attended: "Attended",
  client_no_show: "Client not available",
  rescheduled: "Rescheduled",
  cancelled: "Cancelled",
};

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const instant = z.string().datetime({ offset: true });
const optionalEmail = z
  .union([z.literal(""), z.string().trim().email("Enter a valid email").max(200)])
  .nullable()
  .optional();

/** The enquiry's own fields, for logging one and for editing it. */
const enquiryFields = {
  source: z.string().trim().min(1, "Choose the source").max(80),
  referrer: optionalText(200),
  contactName: z.string().trim().min(1, "Name the contact").max(200),
  contactPhone: optionalText(40),
  contactEmail: optionalEmail,
  contactWhatsapp: optionalText(40),
  preferredChannel: z.enum(PREFERRED_CHANNELS).nullable().optional(),
  preferredLanguage: optionalText(40),
  area: optionalText(120),
  propertyCategory: z.enum(["residential", "commercial"]).nullable().optional(),
  unitType: z.enum(UNIT_TYPES).nullable().optional(),
  need: z.string().trim().min(3, "Say in short what the client needs").max(2000),
  ownerId: z.string().uuid().nullable().optional(),
  propertyId: z.string().uuid().nullable().optional(),
  nextFollowUpAt: instant.nullable().optional(),
};

const isReferral = (source: string | null | undefined) => !!source && /referr/i.test(source);
const reachable = (v: { contactPhone?: string | null; contactEmail?: string | null; contactWhatsapp?: string | null }) =>
  !!(v.contactPhone?.trim() || v.contactEmail?.trim() || v.contactWhatsapp?.trim());

export const createEnquirySchema = z
  .object({
    ...enquiryFields,
    enquiredAt: instant.optional(),
    /* An existing client or prospect, or a new prospect created with the enquiry. */
    customerId: z.string().uuid().nullable().optional(),
    newCustomer: z
      .object({
        name: z.string().trim().min(1, "Name the client").max(200),
        customerType: z.enum(["individual", "company"]).nullable().optional(),
        company: optionalText(200),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict()
  .refine((v) => !!v.customerId || !!v.newCustomer, { message: "Choose the client or add a new prospect", path: ["customerId"] })
  .refine(reachable, { message: "Give a phone, WhatsApp or email for the contact", path: ["contactPhone"] })
  .refine((v) => !isReferral(v.source) || !!v.referrer?.trim(), { message: "Say who referred them", path: ["referrer"] });

export const updateEnquirySchema = z.object(enquiryFields).partial().strict();

export const stageChangeSchema = z
  .object({
    stage: z.string().trim().min(1).max(80),
    reason: optionalText(500),
    lostReason: optionalText(80),
    lostNotes: optionalText(1000),
  })
  .strict();

export const followUpSchema = z
  .object({
    occurredAt: instant.optional(),
    channel: z.enum(FOLLOW_UP_CHANNELS),
    outcome: z.string().trim().min(2, "Say what happened").max(500),
    notes: optionalText(2000),
    nextFollowUpAt: instant.nullable().optional(),
    /* Move the enquiry on in the same step (not to Lost: that needs its reason). */
    moveToStage: z.string().trim().min(1).max(80).nullable().optional(),
  })
  .strict();

export const siteVisitSchema = z
  .object({
    propertyId: z.string().uuid("Choose the property"),
    scheduledAt: instant,
    assessorId: z.string().uuid("Choose the assessor"),
  })
  .strict();

export type CreateEnquiryInput = z.infer<typeof createEnquirySchema>;
export type UpdateEnquiryInput = z.infer<typeof updateEnquirySchema>;
export type StageChangeInput = z.infer<typeof stageChangeSchema>;
export type FollowUpInput = z.infer<typeof followUpSchema>;
export type SiteVisitInput = z.infer<typeof siteVisitSchema>;

/** What an enquiry still lacks after an edit (the create schema checks the same on logging). */
export function enquiryRequiredErrors(e: {
  source?: string | null;
  referrer?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  contactWhatsapp?: string | null;
  need?: string | null;
}): string[] {
  const errors: string[] = [];
  if (!e.source?.trim()) errors.push("Choose the source.");
  if (isReferral(e.source) && !e.referrer?.trim()) errors.push("Say who referred them.");
  if (!e.contactName?.trim()) errors.push("Name the contact.");
  if (!reachable(e)) errors.push("Give a phone, WhatsApp or email for the contact.");
  if (!e.need?.trim()) errors.push("Say in short what the client needs.");
  return errors;
}

/* ------------------------------------------------------------------ */
/* Stage rules                                                         */
/* ------------------------------------------------------------------ */

/** What the stage rules read; the full AMC configuration fits, and so does the enquiry screens' meta. */
export interface StageRulesConfig {
  enquiries: { stages: readonly string[]; lostReasons: readonly string[] };
  proposals: { siteVisitRequiredCategories: readonly string[]; siteVisitRule: "flag" | "block" };
}

/** Whether configuration asks for a site visit before a proposal for this category (BRD 5.2, Q5). */
export function siteVisitRequired(config: Pick<StageRulesConfig, "proposals">, category: string | null | undefined): boolean {
  return !!category && config.proposals.siteVisitRequiredCategories.includes(category);
}

/** Whether `stage` comes at or after `reference` in this order (unknown stages never do). */
export function isAtOrAfter(stages: readonly string[], stage: string, reference: string): boolean {
  const at = stages.indexOf(stage);
  const ref = stages.indexOf(reference);
  return at >= 0 && ref >= 0 && at >= ref;
}

/** The same, in the configured order. */
export function stageAtOrAfter(config: { enquiries: { stages: readonly string[] } }, stage: string, reference: string): boolean {
  return isAtOrAfter(config.enquiries.stages, stage, reference);
}

export type StageCheck = { ok: true; warning: string | null } | { ok: false; status: 400 | 409; error: string };

export function checkStageChange(input: {
  config: StageRulesConfig;
  from: string;
  to: string;
  reason?: string | null;
  lostReason?: string | null;
  propertyCategory: string | null;
  hasCompletedSiteVisit: boolean;
}): StageCheck {
  const { config, from, to } = input;
  if (!config.enquiries.stages.includes(to)) return { ok: false, status: 400, error: `"${to}" is not a stage in AMC configuration.` };
  if (from === to) return { ok: false, status: 409, error: `The enquiry is already at ${to}.` };
  if (to === ENQUIRY_STAGE.lost) {
    if (!input.lostReason?.trim()) return { ok: false, status: 400, error: "Choose why the enquiry was lost." };
    if (!config.enquiries.lostReasons.includes(input.lostReason)) {
      return { ok: false, status: 400, error: "Choose a lost reason from AMC configuration." };
    }
  }
  if (CLOSED_STAGES.includes(from) && !input.reason?.trim()) {
    return { ok: false, status: 400, error: `Give a reason for reopening an enquiry that is ${from}.` };
  }
  const pastVisit =
    to !== ENQUIRY_STAGE.lost && to !== ENQUIRY_STAGE.onHold && stageAtOrAfter(config, to, ENQUIRY_STAGE.proposalPreparation);
  if (pastVisit && siteVisitRequired(config, input.propertyCategory) && !input.hasCompletedSiteVisit) {
    const message = `A completed site visit is required for ${input.propertyCategory} properties before ${to}.`;
    if (config.proposals.siteVisitRule === "block") return { ok: false, status: 409, error: message };
    return { ok: true, warning: message };
  }
  return { ok: true, warning: null };
}

/** Whether booking a site visit moves the enquiry to Site Visit Scheduled (only forward, never from a closed or held one). */
export function stageAfterSiteVisitBooked(config: { enquiries: { stages: readonly string[] } }, current: string): string | null {
  const target = ENQUIRY_STAGE.siteVisitScheduled;
  if (!config.enquiries.stages.includes(target) || IDLE_EXEMPT_STAGES.includes(current)) return null;
  return stageAtOrAfter(config, current, target) ? null : target;
}

/* ------------------------------------------------------------------ */
/* Idle and follow-up state                                            */
/* ------------------------------------------------------------------ */

const DAY_MS = 86_400_000;

export interface IdleState {
  /** Whole days since the last activity. */
  days: number;
  /** "idle" after the configured days; "escalate" after the management days. */
  state: "idle" | "escalate" | null;
}

export function idleState(
  e: { stage: string; lastActivityAt: string },
  config: Pick<AmcConfig, "enquiries">,
  now: Date,
): IdleState {
  const days = Math.max(0, Math.floor((now.getTime() - new Date(e.lastActivityAt).getTime()) / DAY_MS));
  if (IDLE_EXEMPT_STAGES.includes(e.stage)) return { days, state: null };
  if (days >= config.enquiries.managementEscalationDays) return { days, state: "escalate" };
  if (days >= config.enquiries.idleDays) return { days, state: "idle" };
  return { days, state: null };
}

/** The cut-off instant: activity at or before it means idle after `days`. */
export function idleCutoff(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

const dubaiDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });

/** "overdue" (past), "today" (later today, Dubai time), "upcoming", or null when none is set. */
export function followUpState(nextFollowUpAt: string | null, now: Date): "overdue" | "today" | "upcoming" | null {
  if (!nextFollowUpAt) return null;
  const at = new Date(nextFollowUpAt);
  if (at.getTime() <= now.getTime()) return "overdue";
  return dubaiDay(at) === dubaiDay(now) ? "today" : "upcoming";
}

/** Start and end of the Dubai day that contains `now`, as instants (Dubai has no daylight saving: UTC+4). */
export function dubaiDayBounds(now: Date): { start: string; end: string } {
  const day = dubaiDay(now);
  const start = new Date(`${day}T00:00:00+04:00`);
  return { start: start.toISOString(), end: new Date(start.getTime() + DAY_MS).toISOString() };
}

/* ------------------------------------------------------------------ */
/* Site visit → proposal                                               */
/* ------------------------------------------------------------------ */

/** Units counted on site, kept for recommended services only, as whole numbers from 1 to `max`. */
export function cleanAssetCounts(counts: Record<string, unknown> | null | undefined, recommended: readonly string[], max = 10_000): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of recommended) {
    const n = Number(counts?.[id]);
    if (Number.isFinite(n) && n >= 1) out[id] = Math.min(Math.trunc(n), max);
  }
  return out;
}
