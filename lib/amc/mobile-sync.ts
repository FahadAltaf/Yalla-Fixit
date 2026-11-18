import { z } from "zod";

import { FIELD_VISIT_KINDS, fieldVisitStatusLabel, shortPlace, type FieldVisitKind, type FieldVisitStage } from "@/lib/amc/field-visits";
import { jobSheetSchema } from "@/lib/amc/job-sheets";
import { assetSchema, scopeItemSchema } from "@/lib/amc/client-profile";
import { updateAssessmentSchema } from "@/lib/server/amc/business-schemas";

/*
  AMC on the mobile app (phase 5 of the Visits workstream). Pure rules
  shared by the /api/amc-sync routes and their tests: which visits sit on
  which list, what a card carries, the Done cursor, what a push may say,
  and the version an opened visit is compared by.

  The app loads per screen, as Snagging does: the list asks for cards
  only, an opened visit for its own contents, and a later open asks with
  the version it holds and hears "unchanged" when nothing moved.
*/

/** Active = still to be done by the crew; Done = with the supervisor or finished. */
export const MOBILE_LISTS = ["active", "done"] as const;
export type MobileList = (typeof MOBILE_LISTS)[number];

export const MOBILE_LIST_STAGES: Record<MobileList, readonly FieldVisitStage[]> = {
  active: ["to_plan", "planned", "confirmed", "in_progress"],
  done: ["review", "done"],
};

/*
  A visit the office has not started is not on the phone's Today and
  Upcoming at all (18 Nov 2026); it shows once the office presses Start
  visit on the portal:
  - a planned visit, call out or additional work: the view's started_at
    (migrations 20261118110000 and 20261118120000), set by Start visit --
    their stage now moves only when the crew is on site, so it cannot say
    whether the office started. A planned visit started before the stamp
    existed is known by its stage (in progress or later);
  - a site visit has no Start visit on the portal (the assessor starts it
    on the phone): it shows while planned, as before.
  Done is left as it was: finished work stays there, started or not.
*/
export const NOT_STARTED_STAGES: readonly FieldVisitStage[] = ["to_plan", "planned", "confirmed"];

/**
 * Whether a row of the view goes to the phone's active list. Before the
 * started_at column exists (it is then absent from the row), call outs and
 * additional work show, as before, rather than hide work already started.
 */
export const shownOnPhone = (row: { kind: FieldVisitKind; stage: FieldVisitStage; started_at?: string | null }): boolean => {
  if (row.kind === "site_visit") return true;
  if (row.kind === "ppm") return Boolean(row.started_at) || !NOT_STARTED_STAGES.includes(row.stage);
  return row.started_at === undefined || row.started_at !== null;
};

const NOT_STARTED = `(${NOT_STARTED_STAGES.join(",")})`;
/** The same rule as a PostgREST filter, so the database leaves those rows out (started_at is null for planned and site visits). */
export const SHOWN_ON_PHONE_FILTER = `kind.eq.site_visit,and(kind.eq.ppm,stage.not.in.${NOT_STARTED}),started_at.not.is.null`;
/** Before migration 20261118110000: planned visits by their stage; call outs and additional work all show. */
export const SHOWN_ON_PHONE_FILTER_NO_STARTED = `kind.neq.ppm,stage.not.in.${NOT_STARTED}`;

export const listOfStage = (stage: FieldVisitStage): MobileList | null =>
  MOBILE_LIST_STAGES.active.includes(stage) ? "active" : MOBILE_LIST_STAGES.done.includes(stage) ? "done" : null;

/**
 * What the phone fills in: a planned visit's job sheet (the crew), a site
 * visit's survey (its assessor), and (16 Nov 2026) a call out's attendance
 * and report and an additional work's completion (their crew).
 */
export const FILLABLE_KINDS: readonly FieldVisitKind[] = ["ppm", "site_visit", "call_out", "additional_work"];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const mobileListQuerySchema = z
  .object({
    list: z.enum(MOBILE_LISTS).default("active"),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    /** Done only: the last card's day and id from the previous page. */
    before: z.string().regex(DAY).optional(),
    before_id: z.string().regex(UUID_RE).optional(),
  })
  .strict();
export type MobileListQuery = z.infer<typeof mobileListQuerySchema>;

export const mobileDetailQuerySchema = z
  .object({
    kind: z.enum(FIELD_VISIT_KINDS),
    /** The version the phone holds; the same one comes back as { unchanged: true }. */
    version: z.string().max(200).optional(),
  })
  .strict();

/** A row of the amc_field_visits view, as the list reads it. */
export interface FieldVisitViewRow {
  kind: FieldVisitKind;
  id: string;
  ref: string;
  customer_name: string | null;
  property_label: string | null;
  status: string;
  stage: FieldVisitStage;
  day: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  trade: string | null;
  /** Call outs and additional work: when the office pressed Start visit (absent before migration 20261118110000). */
  started_at?: string | null;
}

/** Exactly what a card on the phone shows, and nothing more. */
export interface MobileVisitCard {
  id: string;
  kind: FieldVisitKind;
  ref: string;
  list: MobileList;
  stage: FieldVisitStage;
  status: string;
  status_label: string;
  day: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  place: string;
  customer: string | null;
  services: number;
  trade: string | null;
}

/*
  A site visit's approval, as the inspector should read it (16 Nov 2026):
  the view only knows draft / completed, so a visit its approver sent back
  read "Draft" on the phone. These come from the visit's own row.
*/
export type SiteApprovalState = "sent_back" | "awaiting_approval" | "approved";

export interface SiteApprovalFields {
  status: string;
  approverId: string | null;
  approvedAt: string | null;
  sentBackAt: string | null;
}

export const SITE_APPROVAL_LABELS: Record<SiteApprovalState, string> = {
  sent_back: "Sent back",
  awaiting_approval: "Awaiting approval",
  approved: "Approved",
};

/**
 * Sent back: back to draft after its approver sent it back (until it is
 * completed again). Awaiting approval: completed, with an approver who has
 * not approved it yet. Approved: approved. Otherwise null (a draft never
 * sent back, or a visit booked before approvals, which just completes).
 */
export function siteApprovalState(a: SiteApprovalFields): SiteApprovalState | null {
  if (a.approvedAt) return "approved";
  if (a.status === "completed") return a.approverId ? "awaiting_approval" : null;
  if (a.status === "draft" && a.sentBackAt) return "sent_back";
  return null;
}

/**
 * A card from a view row. `services` is the planned visit's live service
 * lines (read for the page in one query); a call out or additional work is
 * its one trade; a site visit has none.
 */
export function toMobileCard(row: FieldVisitViewRow, serviceLines: number, approval: SiteApprovalState | null = null): MobileVisitCard | null {
  const list = listOfStage(row.stage);
  if (!list) return null;
  const services = row.kind === "ppm" ? serviceLines : row.kind === "site_visit" ? 0 : row.trade ? 1 : 0;
  return {
    id: row.id,
    kind: row.kind,
    ref: row.ref,
    list,
    stage: row.stage,
    /* A site visit's approval stands in for draft / completed (the phone colours the pill by it). */
    status: approval ?? row.status,
    status_label: approval ? SITE_APPROVAL_LABELS[approval] : fieldVisitStatusLabel(row.kind, row.status),
    day: String(row.day).slice(0, 10),
    scheduled_start: row.scheduled_start,
    scheduled_end: row.scheduled_end,
    place: shortPlace(row.property_label) ?? row.ref,
    customer: row.customer_name?.trim() ? row.customer_name : null,
    services,
    trade: row.trade,
  };
}

/**
 * The PostgREST filter for "older than the last card": Done is newest
 * first by (day, id), so the next page starts strictly after that pair.
 */
export function doneCursorFilter(before: string, beforeId: string | undefined): string {
  return beforeId ? `day.lt.${before},and(day.eq.${before},id.lt.${beforeId})` : `day.lt.${before}`;
}

/** Whether the signed-in technician is on this visit's crew. */
export function onCrew(visit: { technician_ids?: unknown; lead_technician_id?: unknown }, fsmId: string | null): boolean {
  if (!fsmId) return false;
  const ids = Array.isArray(visit.technician_ids) ? visit.technician_ids.map(String) : [];
  return ids.includes(fsmId) || visit.lead_technician_id === fsmId;
}

/**
 * What an opened visit is compared by: anything the office changes moves
 * one of these (the visit row, its sheet, or a photo added or removed).
 */
export function detailVersion(parts: { visitUpdatedAt: string | null; sheetUpdatedAt: string | null; photoCount: number; latestPhotoAt: string | null }): string {
  return [parts.visitUpdatedAt ?? "-", parts.sheetUpdatedAt ?? "-", parts.photoCount, parts.latestPhotoAt ?? "-"].join("|");
}

/* ------------------------------------------------------------------ */
/* Push                                                                */
/* ------------------------------------------------------------------ */

export const MOBILE_PHOTO_KINDS = ["before", "after", "fault", "other"] as const;
export type MobilePhotoKind = (typeof MOBILE_PHOTO_KINDS)[number];

const uuid = z.string().uuid();

/* visit_kind (18 Nov 2026): a call out's or additional work's job sheet; a planned visit's when left out. */
const sheetPayload = z.object({ visit_id: uuid, visit_kind: z.enum(["ppm", "call_out", "additional_work"]).optional(), sheet: jobSheetSchema }).strict();
/** What a photo is, as the technician names it on the phone: a preset (Equipment, Fault ...) or their own words. */
const photoCategory = z.string().trim().min(1).max(60).nullable().optional();
const photoInsertPayload = z
  .object({
    visit_id: uuid,
    kind: z.enum(MOBILE_PHOTO_KINDS),
    category: photoCategory,
    line_id: uuid.nullable().optional(),
    caption: z.string().trim().max(300).nullable().optional(),
    taken_at: z.string().max(40).optional(),
  })
  .strict();
const photoDeletePayload = z.object({ visit_id: uuid }).strict();

/**
 * A site visit's survey as the phone saves it: the fields an assessor fills
 * in on site, checked by the portal's own site-visit schema (the rest --
 * client, property, assessor, booking -- stays with the office).
 */
/** The key of a checklist row the assessor added on site (never one of the office's checklist keys). */
export const CUSTOM_ITEM_KEY = /^custom-[a-z0-9-]{8,64}$/;

export const siteFormSchema = updateAssessmentSchema
  .pick({
    assessedOn: true,
    attendance: true,
    unitType: true,
    propertyCategory: true,
    bedrooms: true,
    sizeSqft: true,
    occupancy: true,
    accessNotes: true,
    exclusions: true,
    summary: true,
    findings: true,
    notes: true,
    recommendedServiceIds: true,
    assetCounts: true,
    items: true,
  })
  .extend({
    /*
      Checks the assessor added on site, beside the office's checklist. Kept
      as the visit's own checklist rows (amc_assessment_items, keyed
      "custom-..."), so the portal's site visit page lists them like any
      other; their answers travel in `items` as usual.
    */
    customItems: z
      .array(
        z
          .object({
            itemKey: z.string().regex(CUSTOM_ITEM_KEY, "A check added on site has a custom- key"),
            categoryLabel: z.string().trim().min(1).max(100),
            label: z.string().trim().min(1, "Name the check").max(200),
          })
          .strict(),
      )
      .max(100)
      .optional(),
  })
  .strict();
export type SiteFormInput = z.infer<typeof siteFormSchema>;
const sitePayload = z.object({ visit_id: uuid, site: siteFormSchema }).strict();
const sitePhotoPayload = z
  .object({ visit_id: uuid, caption: z.string().trim().max(300).nullable().optional(), category: photoCategory, taken_at: z.string().max(40).optional() })
  .strict();

/* A photo's description and category, changed after it was taken (a planned visit's photo, its kind too). */
const photoUpdatePayload = z
  .object({ visit_id: uuid, caption: z.string().trim().max(300).nullable(), category: photoCategory, kind: z.enum(MOBILE_PHOTO_KINDS).optional() })
  .strict();
const sitePhotoUpdatePayload = z.object({ visit_id: uuid, caption: z.string().trim().max(300).nullable(), category: photoCategory }).strict();
/*
  The property's assets and scope, as the assessor finds them on a site
  visit: checked by the portal's own schemas (lib/amc/client-profile), and
  always against the site visit's property -- never a property id the
  phone sends.
*/
const assetPayload = z.object({ visit_id: uuid, asset: assetSchema }).strict();
const scopePayload = z.object({ visit_id: uuid, scope: scopeItemSchema }).strict();

/*
  A call out and an additional work, from their crew: the call out's
  attendance and its report (the portal's own attend and record actions,
  lib/amc/call-outs callOutActionSchema), an additional work's completion,
  and either one's photos (the shared work-photo table). visit_kind says
  which one a photo is for.
*/
const iso = z.string().datetime({ offset: true });
const callOutReport = z
  .object({
    diagnosis: z.string().trim().max(4000).nullable(),
    resolution: z.string().trim().max(4000).nullable(),
    partsNeeded: z.string().trim().max(1000).nullable(),
    minutesOnSite: z.number().int().min(0).max(24 * 60).nullable(),
    pendingWorks: z.array(z.object({ description: z.string().trim().min(3).max(1000), reason: z.string().trim().min(1).max(500) }).strict()).max(30),
    outcome: z.enum(["resolved", "pending_works"]),
  })
  .strict();
const workKind = z.enum(["call_out", "additional_work"]);
export const WORK_PHOTO_KINDS = ["reported", "before", "after", "finding", "other"] as const;
const workPhotoInsertPayload = z
  .object({
    visit_id: uuid,
    visit_kind: workKind,
    kind: z.enum(WORK_PHOTO_KINDS),
    category: photoCategory,
    caption: z.string().trim().max(300).nullable().optional(),
    taken_at: z.string().max(40).optional(),
  })
  .strict();
const workPhotoUpdatePayload = z
  .object({ visit_id: uuid, visit_kind: workKind, caption: z.string().trim().max(300).nullable(), category: photoCategory, kind: z.enum(WORK_PHOTO_KINDS).optional() })
  .strict();
const workPhotoDeletePayload = z.object({ visit_id: uuid, visit_kind: workKind }).strict();

/** The entities that change a call out or an additional work (checked against their crew). */
export const WORK_ENTITIES = ["amc_callout_attend", "amc_callout_record", "amc_work_complete", "amc_work_photo"] as const;

/** The entities that change a site visit (an assessment) or its property, not a planned visit. */
export const SITE_ENTITIES = ["amc_site", "amc_site_complete", "amc_site_photo", "amc_asset", "amc_scope"] as const;

/**
 * One queued change from the phone's outbox. The mutation id is the
 * idempotency key; a photo's entity id is the photo's own id, so a replay
 * after a lost response finds the photo already there.
 */
const MUTATION_SCHEMAS = {
  "amc_sheet:update": z.object({ mutation_id: uuid, entity: z.literal("amc_sheet"), entity_id: uuid, op: z.literal("update"), payload: sheetPayload }).strict(),
  "amc_submit:insert": z.object({ mutation_id: uuid, entity: z.literal("amc_submit"), entity_id: uuid, op: z.literal("insert"), payload: sheetPayload }).strict(),
  "amc_photo:insert": z.object({ mutation_id: uuid, entity: z.literal("amc_photo"), entity_id: uuid, op: z.literal("insert"), payload: photoInsertPayload }).strict(),
  "amc_photo:delete": z.object({ mutation_id: uuid, entity: z.literal("amc_photo"), entity_id: uuid, op: z.literal("delete"), payload: photoDeletePayload }).strict(),
  "amc_site:update": z.object({ mutation_id: uuid, entity: z.literal("amc_site"), entity_id: uuid, op: z.literal("update"), payload: sitePayload }).strict(),
  "amc_site_complete:insert": z.object({ mutation_id: uuid, entity: z.literal("amc_site_complete"), entity_id: uuid, op: z.literal("insert"), payload: photoDeletePayload }).strict(),
  "amc_site_photo:insert": z.object({ mutation_id: uuid, entity: z.literal("amc_site_photo"), entity_id: uuid, op: z.literal("insert"), payload: sitePhotoPayload }).strict(),
  "amc_site_photo:delete": z.object({ mutation_id: uuid, entity: z.literal("amc_site_photo"), entity_id: uuid, op: z.literal("delete"), payload: photoDeletePayload }).strict(),
  "amc_photo:update": z.object({ mutation_id: uuid, entity: z.literal("amc_photo"), entity_id: uuid, op: z.literal("update"), payload: photoUpdatePayload }).strict(),
  "amc_site_photo:update": z.object({ mutation_id: uuid, entity: z.literal("amc_site_photo"), entity_id: uuid, op: z.literal("update"), payload: sitePhotoUpdatePayload }).strict(),
  "amc_asset:insert": z.object({ mutation_id: uuid, entity: z.literal("amc_asset"), entity_id: uuid, op: z.literal("insert"), payload: assetPayload }).strict(),
  "amc_asset:update": z.object({ mutation_id: uuid, entity: z.literal("amc_asset"), entity_id: uuid, op: z.literal("update"), payload: assetPayload }).strict(),
  "amc_asset:delete": z.object({ mutation_id: uuid, entity: z.literal("amc_asset"), entity_id: uuid, op: z.literal("delete"), payload: photoDeletePayload }).strict(),
  "amc_scope:insert": z.object({ mutation_id: uuid, entity: z.literal("amc_scope"), entity_id: uuid, op: z.literal("insert"), payload: scopePayload }).strict(),
  "amc_scope:update": z.object({ mutation_id: uuid, entity: z.literal("amc_scope"), entity_id: uuid, op: z.literal("update"), payload: scopePayload }).strict(),
  "amc_scope:delete": z.object({ mutation_id: uuid, entity: z.literal("amc_scope"), entity_id: uuid, op: z.literal("delete"), payload: photoDeletePayload }).strict(),
  "amc_callout_attend:insert": z
    .object({ mutation_id: uuid, entity: z.literal("amc_callout_attend"), entity_id: uuid, op: z.literal("insert"), payload: z.object({ visit_id: uuid, attended_at: iso }).strict() })
    .strict(),
  "amc_callout_record:insert": z
    .object({ mutation_id: uuid, entity: z.literal("amc_callout_record"), entity_id: uuid, op: z.literal("insert"), payload: z.object({ visit_id: uuid, report: callOutReport }).strict() })
    .strict(),
  "amc_work_complete:insert": z
    .object({ mutation_id: uuid, entity: z.literal("amc_work_complete"), entity_id: uuid, op: z.literal("insert"), payload: z.object({ visit_id: uuid, completed_at: iso }).strict() })
    .strict(),
  "amc_work_photo:insert": z.object({ mutation_id: uuid, entity: z.literal("amc_work_photo"), entity_id: uuid, op: z.literal("insert"), payload: workPhotoInsertPayload }).strict(),
  "amc_work_photo:update": z.object({ mutation_id: uuid, entity: z.literal("amc_work_photo"), entity_id: uuid, op: z.literal("update"), payload: workPhotoUpdatePayload }).strict(),
  "amc_work_photo:delete": z.object({ mutation_id: uuid, entity: z.literal("amc_work_photo"), entity_id: uuid, op: z.literal("delete"), payload: workPhotoDeletePayload }).strict(),
} as const;

/* For the type: a plain union (a photo is added and removed under one entity name). */
type Schemas = typeof MUTATION_SCHEMAS;
export const mobileMutationSchema = z.union(Object.values(MUTATION_SCHEMAS) as unknown as [
  Schemas["amc_sheet:update"],
  Schemas["amc_submit:insert"],
  Schemas["amc_photo:insert"],
  Schemas["amc_photo:delete"],
  Schemas["amc_site:update"],
  Schemas["amc_site_complete:insert"],
  Schemas["amc_site_photo:insert"],
  Schemas["amc_site_photo:delete"],
  Schemas["amc_photo:update"],
  Schemas["amc_site_photo:update"],
  Schemas["amc_asset:insert"],
  Schemas["amc_asset:update"],
  Schemas["amc_asset:delete"],
  Schemas["amc_scope:insert"],
  Schemas["amc_scope:update"],
  Schemas["amc_scope:delete"],
  Schemas["amc_callout_attend:insert"],
  Schemas["amc_callout_record:insert"],
  Schemas["amc_work_complete:insert"],
  Schemas["amc_work_photo:insert"],
  Schemas["amc_work_photo:update"],
  Schemas["amc_work_photo:delete"],
]);
export type MobileMutation = z.infer<typeof mobileMutationSchema>;

/**
 * Reads one change, against the schema its entity and op name, so a
 * refusal says what is wrong with it ("sheet.lines: Required") rather
 * than a union's "Invalid input".
 */
export function parseMobileMutation(raw: unknown): { ok: true; value: MobileMutation } | { ok: false; error: string } {
  const r = (raw ?? {}) as { entity?: unknown; op?: unknown };
  const schema = (MUTATION_SCHEMAS as Record<string, z.ZodType<MobileMutation>>)[`${String(r.entity)}:${String(r.op)}`];
  if (!schema) return { ok: false, error: `Unknown change: ${String(r.entity)} ${String(r.op)}` };
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  return { ok: false, error: issue ? `${issue.path.join(".") || "change"}: ${issue.message}` : "Invalid change" };
}

export const MOBILE_PUSH_MAX = 100;

export const mobilePushSchema = z
  .object({
    device_id: z.string().max(120).optional(),
    free_bytes: z.number().nonnegative().optional(),
    mutations: z.array(z.unknown()).max(MOBILE_PUSH_MAX),
  })
  .strict();

/** What became of one change: done, already done, try again later, or refused for good. */
export type MobileResultStatus = "applied" | "duplicate" | "retry" | "rejected";
export interface MobileResult {
  mutation_id: string;
  status: MobileResultStatus;
  error?: string;
}

/** The reason given to every change queued behind one that did not go through. */
export const WAITING_FOR_EARLIER = "Waiting for an earlier change to this visit";

/** The visit a mutation belongs to. */
export const mutationVisit = (m: MobileMutation): string => m.payload.visit_id;

/** Whether a change is to a site visit (checked against its assessor) rather than a planned visit (its crew). */
export const isSiteMutation = (m: MobileMutation): boolean => (SITE_ENTITIES as readonly string[]).includes(m.entity);

/** A call out's or an additional work's change: which of the two it is for, or null for a planned or site visit. */
export function workOf(m: MobileMutation): "call_out" | "additional_work" | null {
  if (m.entity === "amc_callout_attend" || m.entity === "amc_callout_record") return "call_out";
  if (m.entity === "amc_work_complete") return "additional_work";
  if (m.entity === "amc_work_photo") return m.payload.visit_kind;
  if ((m.entity === "amc_sheet" || m.entity === "amc_submit") && (m.payload.visit_kind === "call_out" || m.payload.visit_kind === "additional_work")) return m.payload.visit_kind;
  return null;
}
