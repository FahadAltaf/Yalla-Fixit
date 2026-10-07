import type { SupabaseClient } from "@supabase/supabase-js";

import { approversForLevel, type AmcConfig } from "@/lib/amc/config";
import {
  CLOSED_STAGES,
  ENQUIRY_STAGE,
  IDLE_EXEMPT_STAGES,
  checkStageChange,
  dubaiDayBounds,
  enquiryRequiredErrors,
  followUpState,
  idleCutoff,
  idleState,
  siteVisitRequired,
  stageAfterSiteVisitBooked,
  type CreateEnquiryInput,
  type FollowUpInput,
  type IdleState,
  type SiteVisitInput,
  type StageChangeInput,
  type UpdateEnquiryInput,
} from "@/lib/amc/enquiries";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { createAssessment, createCustomer, getCustomer, getProperty } from "@/lib/server/amc/business";
import { createContact } from "@/lib/server/amc/client-profile";
import { ContractError, isMissingTable } from "@/lib/server/amc/contracts";
import { notifyUsers } from "@/lib/server/amc/notifications";
import { recordStatusChange } from "@/lib/server/amc/status-history";

/**
 * The AMC enquiry pipeline (BRD 5.1, 5.2; DEV-347, 358, 359, 362). Rules
 * are in lib/amc/enquiries.ts; routes check the caller (AMC Enquiries).
 *
 * The prospect is a customer record from the first contact (lifecycle
 * "prospect"), so nothing is typed twice: the property, its assets and
 * scope are captured on the client's pages, the site visit is an AMC
 * assessment linked back here, and Phase 4's proposal starts from it.
 *
 * Every stage change is recorded with who, when and why (BRD 6.9). Owners
 * hear about assignments, due follow-ups and idle enquiries in the portal;
 * management hears about enquiries idle past the escalation days.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string; label: string | null };

export const ENQUIRIES_NOT_MIGRATED =
  "Enquiries need the AMC database update 20261007130000, which has not been applied to this database yet.";

function fail(error: { code?: string; message: string }): ContractError {
  if (isMissingTable(error) || error.code === "42703" || error.code === "PGRST204") return new ContractError(ENQUIRIES_NOT_MIGRATED, 503);
  return new ContractError(error.message, 400);
}
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
/** A PostgREST `in` list; stage names have spaces. */
const inList = (values: readonly string[]) => `(${values.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(",")})`;
const enquiryLink = (id: string) => `/extensions/amc-contracts/enquiries/${id}`;

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

export interface EnquiryRecord {
  id: string;
  enquiryNumber: string;
  enquiredAt: string;
  source: string;
  referrer: string | null;
  customer: { id: string; name: string; customerRef: string | null; lifecycle: string };
  property: { id: string; label: string; propertyCategory: string | null; unitType: string | null } | null;
  contactName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  contactWhatsapp: string | null;
  preferredChannel: string | null;
  preferredLanguage: string | null;
  area: string | null;
  propertyCategory: string | null;
  unitType: string | null;
  need: string;
  owner: { id: string; name: string } | null;
  stage: string;
  stageChangedAt: string;
  lostReason: string | null;
  lostNotes: string | null;
  nextFollowUpAt: string | null;
  lastActivityAt: string;
  proposal: { id: string; proposalNumber: string; status: string } | null;
  createdBy: string | null;
  createdAt: string;
  /* Worked out on read. */
  idle: IdleState;
  followUp: ReturnType<typeof followUpState>;
  siteVisitRequired: boolean;
}

const ENQUIRY_COLUMNS =
  "id, enquiry_number, enquired_at, source, referrer, customer_id, property_id, contact_name, contact_phone, contact_email, contact_whatsapp, preferred_channel, preferred_language, area, property_category, unit_type, need, owner_id, stage, stage_changed_at, lost_reason, lost_notes, next_follow_up_at, last_activity_at, submission_id, created_by, created_at, " +
  "customer:customers(id, name, customer_ref, lifecycle), property:customer_properties(id, label, property_category, unit_type), " +
  "owner:user_profile!amc_enquiries_owner_id_fkey(id, full_name, email), submission:amc_submissions!amc_enquiries_submission_id_fkey(id, proposal_number, status)";

function mapEnquiry(r: Row, config: Pick<AmcConfig, "enquiries" | "proposals">, now: Date): EnquiryRecord {
  const c = (r.customer as Row | null) ?? {};
  const p = r.property as Row | null;
  const o = r.owner as Row | null;
  const s = r.submission as Row | null;
  const stage = String(r.stage);
  const lastActivityAt = String(r.last_activity_at);
  /* The property's category wins once one is linked; until then, what the enquiry says. */
  const category = str(p?.property_category) ?? str(r.property_category);
  return {
    id: String(r.id),
    enquiryNumber: String(r.enquiry_number),
    enquiredAt: String(r.enquired_at),
    source: String(r.source),
    referrer: str(r.referrer),
    customer: { id: String(c.id ?? r.customer_id), name: String(c.name ?? ""), customerRef: str(c.customer_ref), lifecycle: String(c.lifecycle ?? "prospect") },
    property: p ? { id: String(p.id), label: String(p.label), propertyCategory: str(p.property_category), unitType: str(p.unit_type) } : null,
    contactName: String(r.contact_name),
    contactPhone: str(r.contact_phone),
    contactEmail: str(r.contact_email),
    contactWhatsapp: str(r.contact_whatsapp),
    preferredChannel: str(r.preferred_channel),
    preferredLanguage: str(r.preferred_language),
    area: str(r.area),
    propertyCategory: str(r.property_category),
    unitType: str(r.unit_type),
    need: String(r.need),
    owner: o ? { id: String(o.id), name: str(o.full_name) ?? str(o.email) ?? "User" } : null,
    stage,
    stageChangedAt: String(r.stage_changed_at),
    lostReason: str(r.lost_reason),
    lostNotes: str(r.lost_notes),
    nextFollowUpAt: str(r.next_follow_up_at),
    lastActivityAt,
    proposal: s ? { id: String(s.id), proposalNumber: String(s.proposal_number ?? ""), status: String(s.status) } : null,
    createdBy: str(r.created_by),
    createdAt: String(r.created_at),
    idle: idleState({ stage, lastActivityAt }, config, now),
    followUp: CLOSED_STAGES.includes(stage) ? null : followUpState(str(r.next_follow_up_at), now),
    siteVisitRequired: siteVisitRequired(config, category),
  };
}

export interface FollowUpRecord {
  id: string;
  occurredAt: string;
  channel: string;
  outcome: string;
  notes: string | null;
  nextFollowUpAt: string | null;
  loggedBy: string | null;
}

export interface SiteVisitSummary {
  id: string;
  assessmentNumber: string;
  status: string;
  scheduledAt: string | null;
  assessedOn: string | null;
  assessorName: string | null;
  attendance: string | null;
  property: { id: string; label: string } | null;
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

export interface EnquiryFilters {
  /** A configured stage, or "open" (not Won or Lost). */
  stage?: string | null;
  ownerId?: string | null;
  source?: string | null;
  followUp?: "overdue" | "today" | "week" | null;
  idleOnly?: boolean;
  customerId?: string | null;
  q?: string | null;
  from?: number;
  to?: number;
}

/** A search term safe inside a PostgREST `or` filter. */
const safeTerm = (q: string) => q.replace(/[%_,()*\\:"]/g, " ").trim().slice(0, 80);

export async function listEnquiries(
  admin: Admin,
  filters: EnquiryFilters,
  config: Pick<AmcConfig, "enquiries" | "proposals">,
  now = new Date(),
): Promise<{ enquiries: EnquiryRecord[]; total: number; migrated: boolean }> {
  const from = filters.from ?? 0;
  const to = filters.to ?? from + 24;
  let q = admin
    .from("amc_enquiries")
    .select(ENQUIRY_COLUMNS, { count: "exact" })
    .order("enquired_at", { ascending: false })
    .order("id")
    .range(from, to);
  if (filters.stage === "open") q = q.not("stage", "in", inList(CLOSED_STAGES));
  else if (filters.stage) q = q.eq("stage", filters.stage);
  if (filters.ownerId) q = q.eq("owner_id", filters.ownerId);
  if (filters.source) q = q.eq("source", filters.source);
  if (filters.customerId) q = q.eq("customer_id", filters.customerId);
  if (filters.followUp) {
    if (filters.followUp === "overdue") q = q.lte("next_follow_up_at", now.toISOString());
    else if (filters.followUp === "today") {
      const day = dubaiDayBounds(now);
      q = q.gte("next_follow_up_at", day.start).lt("next_follow_up_at", day.end);
    } else q = q.lte("next_follow_up_at", new Date(now.getTime() + 7 * 86_400_000).toISOString());
    q = q.not("stage", "in", inList(CLOSED_STAGES));
  }
  if (filters.idleOnly) {
    q = q.lte("last_activity_at", idleCutoff(now, config.enquiries.idleDays)).not("stage", "in", inList(IDLE_EXEMPT_STAGES));
  }
  const term = safeTerm(filters.q ?? "");
  if (term) {
    const like = `%${term}%`;
    const { data: customers } = await admin.from("customers").select("id").or(`name.ilike.${like},customer_ref.ilike.${like}`).limit(200);
    const clauses = [`enquiry_number.ilike.${like}`, `contact_name.ilike.${like}`, `need.ilike.${like}`, `area.ilike.${like}`, `contact_phone.ilike.${like}`];
    const ids = ((customers ?? []) as Row[]).map((r) => String(r.id));
    if (ids.length) clauses.push(`customer_id.in.(${ids.join(",")})`);
    q = q.or(clauses.join(","));
  }
  const { data, error, count } = await q;
  if (error) {
    if (isMissingTable(error)) return { enquiries: [], total: 0, migrated: false };
    throw fail(error);
  }
  return { enquiries: ((data ?? []) as unknown as Row[]).map((r) => mapEnquiry(r, config, now)), total: count ?? 0, migrated: true };
}

export async function getEnquiry(admin: Admin, id: string, config: Pick<AmcConfig, "enquiries" | "proposals">, now = new Date()): Promise<EnquiryRecord> {
  const { data, error } = await admin.from("amc_enquiries").select(ENQUIRY_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw fail(error);
  if (!data) throw new ContractError("Enquiry not found.", 404);
  return mapEnquiry(data as unknown as Row, config, now);
}

export async function listFollowUps(admin: Admin, enquiryId: string): Promise<FollowUpRecord[]> {
  const { data, error } = await admin
    .from("amc_enquiry_follow_ups")
    .select("id, occurred_at, channel, outcome, notes, next_follow_up_at, logger:user_profile!amc_enquiry_follow_ups_logged_by_fkey(full_name, email)")
    .eq("enquiry_id", enquiryId)
    .order("occurred_at", { ascending: false })
    .limit(500);
  if (error) throw fail(error);
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const by = r.logger as Row | null;
    return {
      id: String(r.id),
      occurredAt: String(r.occurred_at),
      channel: String(r.channel),
      outcome: String(r.outcome),
      notes: str(r.notes),
      nextFollowUpAt: str(r.next_follow_up_at),
      loggedBy: str(by?.full_name) ?? str(by?.email),
    };
  });
}

export async function listSiteVisits(admin: Admin, enquiryId: string): Promise<SiteVisitSummary[]> {
  const { data, error } = await admin
    .from("amc_assessments")
    .select("id, assessment_number, status, scheduled_at, assessed_on, assessor_name, attendance, property:customer_properties(id, label)")
    .eq("enquiry_id", enquiryId)
    .order("created_at", { ascending: false });
  if (error) throw fail(error);
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const p = r.property as Row | null;
    return {
      id: String(r.id),
      assessmentNumber: String(r.assessment_number),
      status: String(r.status),
      scheduledAt: str(r.scheduled_at),
      assessedOn: str(r.assessed_on),
      assessorName: str(r.assessor_name),
      attendance: str(r.attendance),
      property: p ? { id: String(p.id), label: String(p.label) } : null,
    };
  });
}

async function hasCompletedSiteVisit(admin: Admin, enquiryId: string): Promise<boolean> {
  const { count, error } = await admin
    .from("amc_assessments")
    .select("id", { count: "exact", head: true })
    .eq("enquiry_id", enquiryId)
    .eq("status", "completed");
  if (error) throw fail(error);
  return (count ?? 0) > 0;
}

/** Active portal users, for the owner and assessor pickers. */
export async function listAmcPeople(admin: Admin): Promise<Array<{ id: string; name: string; email: string | null }>> {
  const { data, error } = await admin.from("user_profile").select("id, full_name, email, is_active").order("full_name", { ascending: true }).limit(2000);
  if (error) return [];
  return ((data ?? []) as Row[])
    .filter((u) => u.is_active !== false)
    .map((u) => ({ id: String(u.id), name: str(u.full_name) ?? str(u.email) ?? "User", email: str(u.email) }));
}

async function personName(admin: Admin, userId: string): Promise<string> {
  const { data } = await admin.from("user_profile").select("full_name, email, is_active").eq("id", userId).maybeSingle<Row>();
  if (!data || data.is_active === false) throw new ContractError("That person is not an active portal user.", 400);
  return str(data.full_name) ?? str(data.email) ?? "User";
}

/* ------------------------------------------------------------------ */
/* Logging and editing                                                 */
/* ------------------------------------------------------------------ */

async function propertyOfCustomer(admin: Admin, propertyId: string, customerId: string) {
  const property = await getProperty(admin, propertyId);
  if (property.customerId !== customerId) throw new ContractError("That property belongs to a different client.", 409);
  return property;
}

function enquiryRow(input: UpdateEnquiryInput): Row {
  const row: Row = {};
  const text: Array<[keyof UpdateEnquiryInput, string]> = [
    ["source", "source"],
    ["referrer", "referrer"],
    ["contactName", "contact_name"],
    ["contactPhone", "contact_phone"],
    ["contactEmail", "contact_email"],
    ["contactWhatsapp", "contact_whatsapp"],
    ["preferredLanguage", "preferred_language"],
    ["area", "area"],
    ["need", "need"],
  ];
  for (const [key, column] of text) if (input[key] !== undefined) row[column] = blank(input[key] as string | null);
  if (input.preferredChannel !== undefined) row.preferred_channel = input.preferredChannel ?? null;
  if (input.propertyCategory !== undefined) row.property_category = input.propertyCategory ?? null;
  if (input.unitType !== undefined) row.unit_type = input.unitType ?? null;
  if (input.ownerId !== undefined) row.owner_id = input.ownerId ?? null;
  if (input.propertyId !== undefined) row.property_id = input.propertyId ?? null;
  if (input.nextFollowUpAt !== undefined) {
    row.next_follow_up_at = input.nextFollowUpAt ?? null;
    row.follow_up_notified_at = null;
  }
  return row;
}

function checkSource(config: Pick<AmcConfig, "enquiries">, source: string | undefined) {
  if (source !== undefined && !config.enquiries.sources.includes(source.trim())) {
    throw new ContractError("Choose a source from AMC configuration.", 400);
  }
}

async function notifyOwnerAssigned(admin: Admin, e: { id: string; enquiryNumber: string; customerName: string; need: string }, ownerId: string, at: string) {
  await notifyUsers(admin, {
    event: "enquiry_assigned",
    userIds: [ownerId],
    title: `Enquiry ${e.enquiryNumber} assigned to you`,
    body: `${e.customerName}: ${e.need.slice(0, 200)}`,
    link: enquiryLink(e.id),
    entityType: "enquiry",
    entityId: e.id,
    dedupeKey: `enquiry_assigned:${e.id}:${ownerId}:${at}`,
  });
}

export async function createEnquiry(admin: Admin, input: CreateEnquiryInput, actor: Actor, config: AmcConfig): Promise<EnquiryRecord> {
  checkSource(config, input.source);
  const ownerId = input.ownerId ?? actor.id;
  if (ownerId !== actor.id) await personName(admin, ownerId);

  /* The prospect: an existing client or prospect, or a new prospect now. */
  let customer: { id: string; name: string };
  let createdCustomer = false;
  if (input.customerId) {
    const found = await getCustomer(admin, input.customerId);
    customer = { id: found.id, name: found.name };
  } else {
    const created = await createCustomer(
      admin,
      {
        name: input.newCustomer!.name,
        company: input.newCustomer?.company ?? null,
        customerType: input.newCustomer?.customerType ?? null,
        phone: blank(input.contactPhone),
        email: blank(input.contactEmail),
        lifecycle: "prospect",
        preferredChannel: input.preferredChannel ?? null,
        preferredLanguage: blank(input.preferredLanguage),
      },
      actor,
    );
    customer = { id: created.id, name: created.name };
    createdCustomer = true;
  }
  if (input.propertyId) await propertyOfCustomer(admin, input.propertyId, customer.id);

  const stage = config.enquiries.stages[0] ?? ENQUIRY_STAGE.new;
  const { data, error } = await admin
    .from("amc_enquiries")
    .insert({
      ...enquiryRow(input),
      enquired_at: input.enquiredAt ?? new Date().toISOString(),
      customer_id: customer.id,
      owner_id: ownerId,
      stage,
      created_by: actor.id,
    })
    .select("id, enquiry_number, created_at")
    .single<{ id: string; enquiry_number: string; created_at: string }>();
  if (error) throw fail(error);

  /* A new prospect's contact becomes their primary contact (best effort: the
     contacts table is the Phase 2 update). */
  if (createdCustomer) {
    try {
      await createContact(
        admin,
        customer.id,
        {
          role: "primary",
          name: input.contactName,
          phone: blank(input.contactPhone),
          whatsapp: blank(input.contactWhatsapp),
          email: blank(input.contactEmail),
        },
        actor,
      );
    } catch (e) {
      console.warn("[amc:enquiries] primary contact not added:", e instanceof Error ? e.message : e);
    }
  }

  await recordStatusChange(admin, { entityType: "enquiry", entityId: data.id, from: null, to: stage, actor });
  await recordAmcAudit(admin, {
    entityType: "enquiry",
    entityId: data.id,
    eventType: "enquiry_created",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { enquiryNumber: data.enquiry_number, customerId: customer.id, newProspect: createdCustomer, source: input.source, ownerId },
  });
  if (ownerId !== actor.id) {
    await notifyOwnerAssigned(admin, { id: data.id, enquiryNumber: data.enquiry_number, customerName: customer.name, need: input.need }, ownerId, data.created_at);
  }
  return getEnquiry(admin, data.id, config);
}

export async function updateEnquiry(admin: Admin, id: string, patch: UpdateEnquiryInput, actor: Actor, config: AmcConfig): Promise<EnquiryRecord> {
  const current = await getEnquiry(admin, id, config);
  /* A source since dropped from configuration stays on old enquiries; only a new choice is checked. */
  if (patch.source !== undefined && patch.source.trim() !== current.source) checkSource(config, patch.source);
  const merged = {
    source: patch.source ?? current.source,
    referrer: patch.referrer !== undefined ? patch.referrer : current.referrer,
    contactName: patch.contactName ?? current.contactName,
    contactPhone: patch.contactPhone !== undefined ? patch.contactPhone : current.contactPhone,
    contactEmail: patch.contactEmail !== undefined ? patch.contactEmail : current.contactEmail,
    contactWhatsapp: patch.contactWhatsapp !== undefined ? patch.contactWhatsapp : current.contactWhatsapp,
    need: patch.need ?? current.need,
  };
  const missing = enquiryRequiredErrors(merged);
  if (missing.length) throw new ContractError(missing.join(" "), 400);
  if (patch.propertyId) await propertyOfCustomer(admin, patch.propertyId, current.customer.id);
  const ownerChanged = patch.ownerId !== undefined && patch.ownerId !== (current.owner?.id ?? null);
  if (ownerChanged && patch.ownerId) await personName(admin, patch.ownerId);

  const now = new Date().toISOString();
  const row = enquiryRow(patch);
  /* The same follow-up date sent back by the form: keep its "already told" stamp. */
  const sameInstant = (a: string | null | undefined, b: string | null) => (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);
  if (patch.nextFollowUpAt !== undefined && sameInstant(patch.nextFollowUpAt, current.nextFollowUpAt)) {
    delete row.next_follow_up_at;
    delete row.follow_up_notified_at;
  }
  const { error } = await admin.from("amc_enquiries").update({ ...row, updated_at: now }).eq("id", id);
  if (error) throw fail(error);
  /* The fields whose value really changed (the form sends them all). */
  const before: Record<string, unknown> = { ...current, ownerId: current.owner?.id ?? null, propertyId: current.property?.id ?? null };
  const changed = (Object.keys(patch) as Array<keyof UpdateEnquiryInput>).filter((k) => {
    const next = patch[k];
    if (next === undefined) return false;
    if (k === "nextFollowUpAt") return !sameInstant(next as string | null, current.nextFollowUpAt);
    const norm = (v: unknown) => (typeof v === "string" ? v.trim() || null : (v ?? null));
    return norm(next) !== norm(before[k]);
  });
  await recordAmcAudit(admin, {
    entityType: "enquiry",
    entityId: id,
    eventType: ownerChanged ? "enquiry_reassigned" : "enquiry_updated",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { fields: changed, ...(ownerChanged ? { fromOwner: current.owner?.id ?? null, toOwner: patch.ownerId ?? null } : {}) },
  });
  if (ownerChanged && patch.ownerId && patch.ownerId !== actor.id) {
    await notifyOwnerAssigned(admin, { id, enquiryNumber: current.enquiryNumber, customerName: current.customer.name, need: current.need }, patch.ownerId, now);
  }
  return getEnquiry(admin, id, config);
}

/* ------------------------------------------------------------------ */
/* Stages, follow-ups, site visits                                     */
/* ------------------------------------------------------------------ */

export async function changeStage(
  admin: Admin,
  id: string,
  input: StageChangeInput,
  actor: Actor,
  config: AmcConfig,
): Promise<{ enquiry: EnquiryRecord; warning: string | null }> {
  const current = await getEnquiry(admin, id, config);
  const check = checkStageChange({
    config,
    from: current.stage,
    to: input.stage,
    reason: input.reason,
    lostReason: input.lostReason,
    propertyCategory: current.property?.propertyCategory ?? current.propertyCategory,
    hasCompletedSiteVisit: await hasCompletedSiteVisit(admin, id),
  });
  if (!check.ok) throw new ContractError(check.error, check.status);

  const now = new Date().toISOString();
  const lost = input.stage === ENQUIRY_STAGE.lost;
  /* Only from the stage the caller saw: two people moving it at once cannot both win. */
  const { data, error } = await admin
    .from("amc_enquiries")
    .update({
      stage: input.stage,
      stage_changed_at: now,
      last_activity_at: now,
      idle_flagged_at: null,
      idle_escalated_at: null,
      lost_reason: lost ? input.lostReason : null,
      lost_notes: lost ? blank(input.lostNotes) : null,
      updated_at: now,
    })
    .eq("id", id)
    .eq("stage", current.stage)
    .select("id");
  if (error) throw fail(error);
  if (!data?.length) throw new ContractError("Someone else changed this enquiry's stage. Reload to see it.", 409);

  await recordStatusChange(admin, {
    entityType: "enquiry",
    entityId: id,
    from: current.stage,
    to: input.stage,
    reason: lost ? [input.lostReason, blank(input.lostNotes)].filter(Boolean).join(": ") : blank(input.reason),
    actor,
    details: check.warning ? { warning: check.warning } : undefined,
  });
  return { enquiry: await getEnquiry(admin, id, config), warning: check.warning };
}

export async function addFollowUp(
  admin: Admin,
  id: string,
  input: FollowUpInput,
  actor: Actor,
  config: AmcConfig,
): Promise<{ enquiry: EnquiryRecord; warning: string | null }> {
  const current = await getEnquiry(admin, id, config);
  if (input.moveToStage === ENQUIRY_STAGE.lost) throw new ContractError("Use Change stage to mark an enquiry lost, with its reason.", 400);
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const { error } = await admin.from("amc_enquiry_follow_ups").insert({
    enquiry_id: id,
    occurred_at: occurredAt,
    channel: input.channel,
    outcome: input.outcome.trim(),
    notes: blank(input.notes),
    next_follow_up_at: input.nextFollowUpAt ?? null,
    logged_by: actor.id,
  });
  if (error) throw fail(error);

  const now = new Date().toISOString();
  const { error: touchError } = await admin
    .from("amc_enquiries")
    .update({
      last_activity_at: now,
      idle_flagged_at: null,
      idle_escalated_at: null,
      next_follow_up_at: input.nextFollowUpAt ?? null,
      follow_up_notified_at: null,
      updated_at: now,
    })
    .eq("id", id);
  if (touchError) throw fail(touchError);

  /* The same conversation in the client's communication log (best effort). */
  const { error: logError } = await admin.from("amc_communication_log").insert({
    customer_id: current.customer.id,
    property_id: current.property?.id ?? null,
    enquiry_id: id,
    channel: input.channel,
    direction: "outbound",
    subject: `Enquiry ${current.enquiryNumber} follow-up`,
    summary: [input.outcome.trim(), blank(input.notes)].filter(Boolean).join("\n\n"),
    occurred_at: occurredAt,
    source: "manual",
    logged_by: actor.id,
  });
  if (logError) console.warn("[amc:enquiries] follow-up not copied to the communication log:", logError.message);

  if (input.moveToStage && input.moveToStage !== current.stage) {
    return changeStage(admin, id, { stage: input.moveToStage }, actor, config);
  }
  return { enquiry: await getEnquiry(admin, id, config), warning: null };
}

/**
 * Books the site visit (DEV-362): an AMC assessment for the enquiry's
 * property, dated and assigned. The assessor is told in the portal and
 * the enquiry moves to Site Visit Scheduled when that is a step forward.
 */
export async function scheduleSiteVisit(
  admin: Admin,
  id: string,
  input: SiteVisitInput,
  actor: Actor,
  config: AmcConfig,
): Promise<{ assessmentId: string; enquiry: EnquiryRecord }> {
  const current = await getEnquiry(admin, id, config);
  if (CLOSED_STAGES.includes(current.stage)) throw new ContractError(`The enquiry is ${current.stage}. Reopen it first.`, 409);
  await propertyOfCustomer(admin, input.propertyId, current.customer.id);
  const assessorName = await personName(admin, input.assessorId);

  const assessment = await createAssessment(admin, { customerId: current.customer.id, propertyId: input.propertyId, assessorName }, actor);
  const { error } = await admin
    .from("amc_assessments")
    .update({ enquiry_id: id, scheduled_at: input.scheduledAt, assessor_id: input.assessorId, assessor_name: assessorName, updated_at: new Date().toISOString() })
    .eq("id", assessment.id);
  if (error) throw fail(error);

  const now = new Date().toISOString();
  const next = stageAfterSiteVisitBooked(config, current.stage);
  const { data: touched, error: touchError } = await admin
    .from("amc_enquiries")
    .update({
      ...(current.property ? {} : { property_id: input.propertyId }),
      ...(next ? { stage: next, stage_changed_at: now } : {}),
      last_activity_at: now,
      idle_flagged_at: null,
      idle_escalated_at: null,
      updated_at: now,
    })
    .eq("id", id)
    .eq("stage", current.stage)
    .select("id");
  if (touchError) throw fail(touchError);
  /* Moved by someone else meanwhile: the visit stands, their stage stays. */
  if (next && touched?.length) {
    await recordStatusChange(admin, {
      entityType: "enquiry",
      entityId: id,
      from: current.stage,
      to: next,
      reason: `Site visit ${assessment.assessmentNumber} booked`,
      actor,
      details: { assessmentId: assessment.id },
    });
  }
  await recordAmcAudit(admin, {
    entityType: "enquiry",
    entityId: id,
    eventType: "site_visit_scheduled",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { assessmentId: assessment.id, assessmentNumber: assessment.assessmentNumber, scheduledAt: input.scheduledAt, assessorId: input.assessorId },
  });
  if (input.assessorId !== actor.id) {
    await notifyUsers(admin, {
      event: "site_visit_assigned",
      userIds: [input.assessorId],
      title: `Site visit ${assessment.assessmentNumber} assigned to you`,
      body: `${current.customer.name} · ${new Date(input.scheduledAt).toLocaleString("en-GB", { timeZone: "Asia/Dubai", dateStyle: "medium", timeStyle: "short" })}`,
      link: `/extensions/amc-contracts/assessments/${assessment.id}`,
      entityType: "assessment",
      entityId: assessment.id,
      dedupeKey: `site_visit_assigned:${assessment.id}:${input.assessorId}`,
    });
  }
  return { assessmentId: assessment.id, enquiry: await getEnquiry(admin, id, config) };
}

/**
 * Links the proposal started from the enquiry's site visit, and moves the
 * enquiry to Proposal Preparation when that is a step forward. Best effort:
 * the proposal stands whether or not this succeeds.
 */
export async function linkEnquiryProposal(admin: Admin, enquiryId: string, submissionId: string, actor: Actor, config: AmcConfig): Promise<void> {
  try {
    const current = await getEnquiry(admin, enquiryId, config);
    const target = ENQUIRY_STAGE.proposalPreparation;
    const forward =
      config.enquiries.stages.includes(target) &&
      !IDLE_EXEMPT_STAGES.includes(current.stage) &&
      config.enquiries.stages.indexOf(current.stage) < config.enquiries.stages.indexOf(target);
    const now = new Date().toISOString();
    const { data: touched } = await admin
      .from("amc_enquiries")
      .update({ submission_id: submissionId, ...(forward ? { stage: target, stage_changed_at: now } : {}), last_activity_at: now, updated_at: now })
      .eq("id", enquiryId)
      .eq("stage", current.stage)
      .select("id");
    if (forward && touched?.length) {
      await recordStatusChange(admin, { entityType: "enquiry", entityId: enquiryId, from: current.stage, to: target, reason: "Proposal started from the site visit", actor, details: { submissionId } });
    }
  } catch (e) {
    console.error("[amc:enquiries] proposal not linked to the enquiry:", e instanceof Error ? e.message : e);
  }
}

/* ------------------------------------------------------------------ */
/* Sweeps (lib/server/amc/jobs.ts)                                     */
/* ------------------------------------------------------------------ */

type SweepRow = { id: string; enquiry_number: string; owner_id: string | null; last_activity_at: string; next_follow_up_at: string | null; customer: Row | null };

const SWEEP_COLUMNS = "id, enquiry_number, owner_id, last_activity_at, next_follow_up_at, customer:customers(name)";

/**
 * Idle enquiries (BRD 5.1): the owner hears after the idle days, management
 * (and the owner) after the escalation days. Each enquiry is claimed with
 * its stamp before anyone is told, so overlapping runs notify once; any
 * activity clears the stamps.
 */
export async function runEnquiryIdleSweep(admin: Admin, config: AmcConfig, now = new Date()) {
  const result = { idle: 0, escalated: 0, noManagementNamed: false, skipped: null as string | null };
  const pick = (stampColumn: "idle_flagged_at" | "idle_escalated_at", days: number) =>
    admin
      .from("amc_enquiries")
      .select(SWEEP_COLUMNS)
      .is(stampColumn, null)
      .lte("last_activity_at", idleCutoff(now, days))
      .not("stage", "in", inList(IDLE_EXEMPT_STAGES))
      .order("last_activity_at", { ascending: true })
      .limit(200);
  const claim = async (id: string, stampColumn: "idle_flagged_at" | "idle_escalated_at") => {
    const { data } = await admin.from("amc_enquiries").update({ [stampColumn]: now.toISOString() }).eq("id", id).is(stampColumn, null).select("id");
    return (data ?? []).length > 0;
  };

  const { data: idle, error } = await pick("idle_flagged_at", config.enquiries.idleDays);
  if (error) {
    if (isMissingTable(error)) return { ...result, skipped: "not migrated" };
    throw new Error(error.message);
  }
  for (const row of (idle ?? []) as unknown as SweepRow[]) {
    if (!(await claim(row.id, "idle_flagged_at")) || !row.owner_id) continue;
    await notifyUsers(admin, {
      event: "enquiry_idle",
      userIds: [row.owner_id],
      title: `Enquiry ${row.enquiry_number} is idle`,
      body: `${String(row.customer?.name ?? "")}: nothing logged for ${config.enquiries.idleDays} days or more. Log a follow-up or move it on.`,
      link: enquiryLink(row.id),
      entityType: "enquiry",
      entityId: row.id,
      dedupeKey: `enquiry_idle:${row.id}:${row.last_activity_at}`,
    });
    result.idle += 1;
  }

  const management = approversForLevel(config, 2);
  result.noManagementNamed = management.length === 0;
  const { data: stale, error: staleError } = await pick("idle_escalated_at", config.enquiries.managementEscalationDays);
  if (staleError) throw new Error(staleError.message);
  for (const row of (stale ?? []) as unknown as SweepRow[]) {
    if (!(await claim(row.id, "idle_escalated_at"))) continue;
    await notifyUsers(admin, {
      event: "enquiry_escalated",
      userIds: [...management, ...(row.owner_id ? [row.owner_id] : [])],
      title: `Enquiry ${row.enquiry_number} idle for ${config.enquiries.managementEscalationDays}+ days`,
      body: `${String(row.customer?.name ?? "")}: no activity since ${new Date(row.last_activity_at).toLocaleDateString("en-GB", { timeZone: "Asia/Dubai", dateStyle: "medium" })}.`,
      link: enquiryLink(row.id),
      entityType: "enquiry",
      entityId: row.id,
      dedupeKey: `enquiry_escalated:${row.id}:${row.last_activity_at}`,
    });
    result.escalated += 1;
  }
  return result;
}

/** Follow-ups due (BRD 5.1): the owner hears once per follow-up date. */
export async function runEnquiryFollowUpSweep(admin: Admin, now = new Date()) {
  const result = { due: 0, skipped: null as string | null };
  const { data, error } = await admin
    .from("amc_enquiries")
    .select(SWEEP_COLUMNS)
    .is("follow_up_notified_at", null)
    .lte("next_follow_up_at", now.toISOString())
    .not("stage", "in", inList(CLOSED_STAGES))
    .order("next_follow_up_at", { ascending: true })
    .limit(200);
  if (error) {
    if (isMissingTable(error)) return { ...result, skipped: "not migrated" };
    throw new Error(error.message);
  }
  for (const row of (data ?? []) as unknown as SweepRow[]) {
    const { data: claimed } = await admin
      .from("amc_enquiries")
      .update({ follow_up_notified_at: now.toISOString() })
      .eq("id", row.id)
      .is("follow_up_notified_at", null)
      .select("id");
    if (!(claimed ?? []).length || !row.owner_id) continue;
    await notifyUsers(admin, {
      event: "enquiry_follow_up_due",
      userIds: [row.owner_id],
      title: `Follow-up due: enquiry ${row.enquiry_number}`,
      body: `${String(row.customer?.name ?? "")}: the follow-up planned for ${new Date(row.next_follow_up_at!).toLocaleString("en-GB", { timeZone: "Asia/Dubai", dateStyle: "medium", timeStyle: "short" })} is due.`,
      link: enquiryLink(row.id),
      entityType: "enquiry",
      entityId: row.id,
      dedupeKey: `enquiry_follow_up_due:${row.id}:${row.next_follow_up_at}`,
    });
    result.due += 1;
  }
  return result;
}
