import type { SupabaseClient } from "@supabase/supabase-js";

import type { AmcConfig } from "@/lib/amc/config";
import { fillTemplate, whatsappUrl } from "@/lib/amc/approval-ladder";
import { todayInDubai } from "@/lib/amc/contracts";
import { templateText } from "@/lib/amc/message-templates";
import { PLANNABLE_STATUSES, classifyMove, windowAfterMove, type VisitStatus } from "@/lib/amc/ppm";
import {
  accessAlertDue,
  accessFromPasses,
  assignmentProblems,
  startProblems,
  attemptState,
  confirmationDue,
  crewNeed,
  defaultAccessStatus,
  effectiveAccess,
  fitFor,
  slotsOverlap,
  suggestCrew,
  tradeForService,
  type AccessStatus,
  type AttemptOutcome,
  type BoardAction,
  type SkillLevel,
  type TechnicianFacts,
  type TechnicianFit,
  type TechnicianProfileInput,
  type Trade,
  type VisitAction,
  type VisitNeed,
} from "@/lib/amc/visits";
import { clientEmailHtml, escapeEmailHtml } from "@/lib/email-brand";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { ContractError, isMissingTable } from "@/lib/server/amc/contracts";
import { notifyUsers } from "@/lib/server/amc/notifications";
import { recordSend } from "@/lib/server/amc/proposal-share";
import { closeAmcTodos, openAmcTodo } from "@/lib/server/amc/todos";
import { sendEmail } from "@/lib/server/send-email";

/**
 * AMC visits on the board (Phase 9: DEV-356, 392-399, to-dos 3 and 4).
 * Rules are in lib/amc/visits.ts; routes check the caller first.
 *
 * Live safety: a visit placed on the board stays on amc_visits (day, time,
 * crew). Live schedule entries and leave are only READ, to show who is
 * busy and to block double booking -- nothing is written to the live
 * scheduling tables until visits are published to FSM (Phase 15).
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string | null; label: string | null };

const NOT_MIGRATED = "Visit assignment is not set up on this database yet (migration 20261008120000).";
const notMigrated = (error: { code?: string } | null | undefined) =>
  isMissingTable(error) || error?.code === "42703" || error?.code === "PGRST204";
function fail(error: { code?: string; message: string }): ContractError {
  if (notMigrated(error)) return new ContractError(NOT_MIGRATED, 503);
  return new ContractError(error.message, error.code === "23514" || error.code === "23505" ? 409 : 400);
}
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const one = (v: unknown): Row | null => (Array.isArray(v) ? ((v[0] as Row | undefined) ?? null) : ((v as Row | null) ?? null));
const strings = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).map(String) : []);

/* The portal plans in Dubai time (UTC+4, no daylight saving). */
const DUBAI = "+04:00";
const slotIso = (date: string, time: string) => new Date(`${date}T${time}:00${DUBAI}`).toISOString();
const dayBounds = (date: string) => ({ start: slotIso(date, "00:00"), end: new Date(Date.parse(slotIso(date, "00:00")) + 86_400_000).toISOString() });
const dubaiDate = (iso: string) => todayInDubai(new Date(iso));
const dubaiTime = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Dubai" }).format(new Date(iso));
const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

/* ------------------------------------------------------------------ */
/* Technicians (DEV-356, 395)                                          */
/* ------------------------------------------------------------------ */

export interface TechnicianRecord extends TechnicianFacts {
  role: string | null;
  tools: string[];
  notes: string | null;
  skills: Array<{ trade: Trade; level: SkillLevel; certificate: string | null; certificateExpires: string | null }>;
}

async function technicianFacts(admin: Admin, onlyActive = true, onlyId?: string): Promise<TechnicianRecord[]> {
  let q = admin
    .from("technician_reference")
    .select("fsm_resource_id, display_name, is_active, shift, email, user_profile_id, role:lookup_options!technician_reference_role_id_fkey(name)")
    .order("display_name");
  if (onlyActive) q = q.eq("is_active", true);
  let profileQ = admin.from("amc_technician_profiles").select("fsm_resource_id, areas, has_vehicle, is_driver, tools, access_permissions, notes");
  let skillQ = admin.from("amc_technician_skills").select("fsm_resource_id, trade, level, certificate, certificate_expires");
  /* One technician (Workforce -> People, AMC skills): three small reads instead of the whole roster. */
  if (onlyId) {
    q = q.eq("fsm_resource_id", onlyId);
    profileQ = profileQ.eq("fsm_resource_id", onlyId);
    skillQ = skillQ.eq("fsm_resource_id", onlyId);
  }
  const [{ data: techs, error }, { data: profiles, error: profileError }, { data: skills, error: skillError }] = await Promise.all([q, profileQ, skillQ]);
  if (error) throw fail(error);
  if (profileError) throw fail(profileError);
  if (skillError) throw fail(skillError);
  const profileOf = new Map(((profiles ?? []) as Row[]).map((p) => [String(p.fsm_resource_id), p]));
  const skillsOf = new Map<string, TechnicianRecord["skills"]>();
  for (const s of (skills ?? []) as Row[]) {
    const list = skillsOf.get(String(s.fsm_resource_id)) ?? [];
    list.push({ trade: s.trade as Trade, level: s.level as SkillLevel, certificate: str(s.certificate), certificateExpires: str(s.certificate_expires) });
    skillsOf.set(String(s.fsm_resource_id), list);
  }
  return ((techs ?? []) as unknown as Row[]).map((t) => {
    const id = String(t.fsm_resource_id);
    const p = profileOf.get(id);
    return {
      fsmId: id,
      name: String(t.display_name),
      active: t.is_active !== false,
      shift: str(t.shift),
      role: str(one(t.role)?.name),
      skills: skillsOf.get(id) ?? [],
      areas: strings(p?.areas),
      hasVehicle: Boolean(p?.has_vehicle),
      isDriver: Boolean(p?.is_driver),
      tools: strings(p?.tools),
      accessPermissions: strings(p?.access_permissions),
      notes: str(p?.notes),
      accountId: str(t.user_profile_id),
      email: str(t.email),
    };
  });
}

export async function listTechnicianDirectory(admin: Admin): Promise<{ migrated: boolean; technicians: TechnicianRecord[] }> {
  try {
    return { migrated: true, technicians: await technicianFacts(admin, false) };
  } catch (error) {
    if (error instanceof ContractError && error.status === 503) return { migrated: false, technicians: [] };
    throw error;
  }
}

/** One technician's AMC record (null when not on the roster); migrated false before the AMC tables exist. */
export async function getTechnicianRecord(admin: Admin, fsmId: string): Promise<{ migrated: boolean; technician: TechnicianRecord | null }> {
  try {
    const [technician] = await technicianFacts(admin, false, fsmId);
    return { migrated: true, technician: technician ?? null };
  } catch (error) {
    if (error instanceof ContractError && error.status === 503) return { migrated: false, technician: null };
    throw error;
  }
}

/** Saves a technician's AMC profile and replaces their skills with the list given. */
export async function saveTechnicianProfile(admin: Admin, fsmId: string, input: TechnicianProfileInput, actor: Actor) {
  const { data: tech, error: techError } = await admin.from("technician_reference").select("fsm_resource_id").eq("fsm_resource_id", fsmId).maybeSingle<Row>();
  if (techError) throw fail(techError);
  if (!tech) throw new ContractError("That technician is not on the FSM roster.", 404);
  const now = new Date().toISOString();
  const { error } = await admin.from("amc_technician_profiles").upsert(
    {
      fsm_resource_id: fsmId,
      areas: input.areas,
      has_vehicle: input.hasVehicle,
      is_driver: input.isDriver,
      tools: input.tools,
      access_permissions: input.accessPermissions,
      notes: input.notes,
      updated_by: actor.id,
      updated_at: now,
    },
    { onConflict: "fsm_resource_id" },
  );
  if (error) throw fail(error);
  const keep = input.skills.map((s) => s.trade);
  let remove = admin.from("amc_technician_skills").delete().eq("fsm_resource_id", fsmId);
  if (keep.length) remove = remove.not("trade", "in", `(${keep.join(",")})`);
  const { error: removeError } = await remove;
  if (removeError) throw fail(removeError);
  if (input.skills.length) {
    const { error: skillError } = await admin.from("amc_technician_skills").upsert(
      input.skills.map((s) => ({
        fsm_resource_id: fsmId,
        trade: s.trade,
        level: s.level,
        certificate: s.certificate,
        certificate_expires: s.certificateExpires ?? null,
        verified_by: actor.id,
        verified_at: now,
        updated_at: now,
      })),
      { onConflict: "fsm_resource_id,trade" },
    );
    if (skillError) throw fail(skillError);
  }
  await recordAmcAudit(admin, {
    entityType: "technician",
    entityId: null,
    eventType: "technician_profile_saved",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { fsmId, skills: input.skills.map((s) => `${s.trade}:${s.level}`) },
  });
}

/* ------------------------------------------------------------------ */
/* A visit, with what assignment needs to know                         */
/* ------------------------------------------------------------------ */

const VISIT_COLUMNS =
  "id, contract_id, visit_no, status, cycle_start, cycle_end, window_start, window_end, target_date, original_target_date, reschedule_count, status_reason, " +
  "scheduled_start, scheduled_end, technician_ids, lead_technician_id, headcount, assignment_note, client_confirmation, confirmed_at, confirmation_channel, confirmation_note, " +
  "access_status, access_document_id, access_valid_until, access_note, confirmation_due_notified_at, no_answer_notified_at, access_alert_sent_at, client_reminder_sent_at, " +
  "lines:amc_visit_lines!amc_visit_lines_visit_id_fkey(id, entitlement_id, service_id, service_label, status), " +
  "contract:amc_contracts!amc_visits_contract_id_fkey(id, status, contract_number, proposal_number, customer_name, property_label, property_id, customer, property, ppm_confirmed_at, ppm_window_days, attempt_count, attempt_interval_days, attempt_channels, attempt_escalation_user_id, submission:amc_submissions!amc_contracts_submission_id_fkey(id, owner_id))";

interface VisitContext {
  visit: Row;
  contract: Row;
  ownerId: string | null;
  lines: Array<{ id: string; serviceId: string; label: string; trade: Trade; units: number }>;
  need: VisitNeed;
  durationMinutes: number;
  headcount: number;
  accessRuleCount: number;
  accessRules: AccessRuleView[];
}

/** A property access rule, as the visit shows it: what is needed, from whom, how early, when. */
export interface AccessRuleView {
  id: string;
  accessType: string;
  issuer: string | null;
  leadTimeDays: number | null;
  permittedDays: string[];
  permittedFrom: string | null;
  permittedTo: string | null;
  parking: string | null;
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
}

/** A property access rule row as a visit (or a site visit) shows it. */
export const accessRuleView = (r: Row): AccessRuleView => ({
  id: String(r.id),
  accessType: String(r.access_type),
  issuer: str(r.issuer),
  leadTimeDays: r.lead_time_days === null || r.lead_time_days === undefined ? null : Number(r.lead_time_days),
  permittedDays: strings(r.permitted_days),
  permittedFrom: str(r.permitted_from),
  permittedTo: str(r.permitted_to),
  parking: str(r.parking),
  contactName: str(r.contact_name),
  contactPhone: str(r.contact_phone),
  notes: str(r.notes),
});

/**
 * A site visit's access (17 Nov 2026), the same way as a planned visit's:
 * the property's active access rules, the site visit's own passes and the
 * property's passes (which count for every visit there), and the status
 * worked out from them for the visit day. Read when shown; nothing stored.
 */
export async function siteVisitAccess(admin: Admin, siteVisit: { id: string; propertyId: string | null; day: string }) {
  const [{ data: rules, error }, own, onProperty] = await Promise.all([
    siteVisit.propertyId
      ? admin.from("amc_property_access_rules").select("id, access_type, issuer, lead_time_days, permitted_days, permitted_from, permitted_to, parking, contact_name, contact_phone, notes").eq("property_id", siteVisit.propertyId).eq("active", true)
      : Promise.resolve({ data: [] as Row[], error: null }),
    readPasses(admin, "site_visit", [siteVisit.id]),
    readPasses(admin, "property", siteVisit.propertyId ? [siteVisit.propertyId] : []),
  ]);
  if (error) throw fail(error);
  const accessRules = ((rules ?? []) as Row[]).map(accessRuleView);
  const passes = [...own.passes, ...onProperty.passes];
  const access = accessFromPasses(passes.map(passInput), siteVisit.day, accessRules.length > 0);
  return { accessRules, passes, passTypes: own.typed && onProperty.typed, status: access.status, validUntil: access.validUntil };
}

/* ------------------------------------------------------------------ */
/* Access from passes (17 Nov 2026)                                    */
/* ------------------------------------------------------------------ */

type AccessWrite = { status: AccessStatus; validUntil: string | null; documentId: string | null; note?: string | null };

/** A visit's access, with what follows: the visit waits for access or is released, and the access to-do closes. */
async function writeVisitAccess(admin: Admin, v: Row, input: AccessWrite, nowIso: string) {
  const visitId = String(v.id);
  const waiting = ["scheduled", "rescheduled", "confirmed", "not_scheduled"].includes(String(v.status));
  const statusChange =
    input.status === "pending" || input.status === "rejected" || input.status === "expired"
      ? waiting
        ? { status: "pending_access" }
        : {}
      : v.status === "pending_access"
        ? { status: v.client_confirmation === "confirmed" ? "confirmed" : v.scheduled_start ? "scheduled" : "not_scheduled" }
        : {};
  const { error } = await admin
    .from("amc_visits")
    .update({
      access_status: input.status,
      access_valid_until: input.validUntil,
      access_document_id: input.documentId,
      ...(input.note !== undefined ? { access_note: input.note } : {}),
      ...statusChange,
      updated_at: nowIso,
    })
    .eq("id", visitId);
  if (error) throw fail(error);
  if (input.status === "approved" || input.status === "not_required") {
    await closeAmcTodos(admin, { entityType: "visit", entityId: visitId, kind: "access_gate_pass" }, { status: "done", reason: `Access ${input.status.replace("_", " ")}` }).catch(() => 0);
  }
}

/** A gate pass as the visit and the property show it (17 Nov 2026). */
export interface PassView {
  id: string;
  /** visit: this visit's own; property: the property's, for every visit there. */
  level: "visit" | "property" | "site_visit" | "call_out" | "additional_work";
  entityId: string;
  fileName: string;
  expiresOn: string | null;
  notes: string | null;
  uploadedAt: string;
  uploadedBy: string | null;
  /** The property access rule it is for, or null. */
  accessRuleId: string | null;
  /** Where it stands; null on a pass from before statuses (counts as approved). */
  accessStatus: AccessStatus | null;
}

const PASS_COLUMNS = "id, level, entity_id, file_name, expires_on, notes, uploaded_at, uploader:user_profile!amc_documents_uploaded_by_fkey(full_name, email)";
/* Until 20261117120000 the columns are missing: the passes are read without them. */
const missingPassColumns = (e: { code?: string; message?: string } | null) =>
  Boolean(e && (e.code === "42703" || e.code === "PGRST204" || /access_(rule_id|status)/.test(e.message ?? "")));

/** Gate passes still in use on the entities given, newest first. */
export async function readPasses(admin: Admin, level: PassView["level"], ids: string[]): Promise<{ passes: PassView[]; typed: boolean }> {
  if (!ids.length) return { passes: [], typed: true };
  const query = (columns: string) =>
    admin.from("amc_documents").select(columns).eq("level", level).in("entity_id", ids).eq("category", "Gate pass").is("superseded_by", null).order("uploaded_at", { ascending: false });
  let typed = true;
  let { data, error } = await query(`${PASS_COLUMNS}, access_rule_id, access_status`);
  if (missingPassColumns(error)) {
    typed = false;
    ({ data, error } = await query(PASS_COLUMNS));
  }
  if (error) throw fail(error);
  return {
    typed,
    passes: ((data ?? []) as unknown as Row[]).map((d) => {
      const uploader = one(d.uploader);
      return {
        id: String(d.id),
        level,
        entityId: String(d.entity_id),
        fileName: String(d.file_name),
        expiresOn: str(d.expires_on),
        notes: str(d.notes),
        uploadedAt: String(d.uploaded_at),
        uploadedBy: str(uploader?.full_name) ?? str(uploader?.email),
        accessRuleId: str(d.access_rule_id),
        accessStatus: (str(d.access_status) as AccessStatus | null) ?? null,
      };
    }),
  };
}

/** A pass's access type and status. Throws a plain message before 20261117120000. */
export async function writePassType(admin: Admin, documentId: string, input: { accessRuleId?: string | null; accessStatus?: AccessStatus }, propertyId: string | null) {
  if (input.accessRuleId) {
    const { data: rule } = await admin.from("amc_property_access_rules").select("id, property_id").eq("id", input.accessRuleId).maybeSingle<Row>();
    if (!rule || str(rule.property_id) !== propertyId) throw new ContractError("That access rule is not on this property.", 400);
  }
  const changes: Row = {};
  if (input.accessRuleId !== undefined) changes.access_rule_id = input.accessRuleId;
  if (input.accessStatus !== undefined) changes.access_status = input.accessStatus;
  if (!Object.keys(changes).length) return;
  const { error } = await admin.from("amc_documents").update(changes).eq("id", documentId);
  if (missingPassColumns(error)) throw new ContractError("A pass's access type and status need the database update 20261117120000 first.", 503);
  if (error) throw fail(error);
}

/** For accessFromPasses. */
const passInput = (p: PassView) => ({ id: p.id, validUntil: p.expiresOn, uploadedAt: p.uploadedAt, status: p.accessStatus });

/** Gate pass documents still in use, on the visits given and on the property (a property pass counts for every visit there). */
async function passDocuments(admin: Admin, visitIds: string[], propertyId: string | null) {
  const [onVisits, onProperty] = await Promise.all([readPasses(admin, "visit", visitIds), readPasses(admin, "property", propertyId ? [propertyId] : [])]);
  return {
    forVisit: (visitId: string) => onVisits.passes.filter((d) => d.entityId === visitId).map(passInput),
    property: onProperty.passes.map(passInput),
  };
}

const visitDay = (v: Row) => (v.scheduled_start ? String(v.scheduled_start).slice(0, 10) : String(v.target_date));

/**
 * After a property's passes change: every visit there not yet started has
 * its access worked out again from its own passes and the property's.
 * Returns how many visits changed.
 */
export async function refreshPropertyVisitsAccess(admin: Admin, propertyId: string, now = new Date()): Promise<number> {
  const { data: contracts, error: contractError } = await admin.from("amc_contracts").select("id").eq("property_id", propertyId);
  if (contractError) throw fail(contractError);
  const contractIds = ((contracts ?? []) as Row[]).map((c) => String(c.id));
  if (!contractIds.length) return 0;
  const { data: visits, error } = await admin
    .from("amc_visits")
    .select("id, status, target_date, scheduled_start, client_confirmation, access_status, access_valid_until, access_document_id")
    .in("contract_id", contractIds)
    .in("status", [...PLANNABLE_STATUSES]);
  if (error) throw fail(error);
  const rows = (visits ?? []) as Row[];
  if (!rows.length) return 0;
  const { count: ruleCount } = await admin.from("amc_property_access_rules").select("id", { count: "exact", head: true }).eq("property_id", propertyId).eq("active", true);
  const docs = await passDocuments(admin, rows.map((r) => String(r.id)), propertyId);
  const nowIso = now.toISOString();
  let changed = 0;
  for (const v of rows) {
    const next = accessFromPasses([...docs.forVisit(String(v.id)), ...docs.property], visitDay(v), (ruleCount ?? 0) > 0);
    if (next.status === v.access_status && next.validUntil === str(v.access_valid_until) && next.documentId === str(v.access_document_id)) continue;
    await writeVisitAccess(admin, v, next, nowIso);
    changed += 1;
  }
  return changed;
}

async function loadVisitContext(admin: Admin, visitId: string, date: string | null, config: AmcConfig): Promise<VisitContext> {
  const { data: visit, error } = await admin.from("amc_visits").select(VISIT_COLUMNS).eq("id", visitId).maybeSingle<Row>();
  if (error) throw fail(error);
  if (!visit) throw new ContractError("Visit not found.", 404);
  const contract = one(visit.contract) ?? {};
  const propertyId = str(contract.property_id);
  const rawLines = (visit.lines ?? []) as Row[];
  const [{ data: entitlements }, { data: scope }, { data: rules }] = await Promise.all([
    rawLines.length
      ? admin.from("amc_contract_entitlements").select("id, units").in("id", rawLines.map((l) => String(l.entitlement_id)))
      : Promise.resolve({ data: [] as Row[] }),
    propertyId ? admin.from("amc_scope_items").select("service_id, trade").eq("property_id", propertyId).eq("active", true) : Promise.resolve({ data: [] as Row[] }),
    propertyId
      ? admin
          .from("amc_property_access_rules")
          .select("id, access_type, issuer, lead_time_days, permitted_days, permitted_from, permitted_to, parking, contact_name, contact_phone, notes")
          .eq("property_id", propertyId)
          .eq("active", true)
      : Promise.resolve({ data: [] as Row[] }),
  ]);
  const unitsOf = new Map(((entitlements ?? []) as Row[]).map((e) => [String(e.id), Number(e.units) || 1]));
  const scopeTrade = new Map(((scope ?? []) as Row[]).map((s) => [String(s.service_id), String(s.trade)]));
  const lines = rawLines
    .filter((l) => l.status !== "cancelled")
    .map((l) => ({
      id: String(l.id),
      serviceId: String(l.service_id),
      label: String(l.service_label),
      trade: tradeForService(String(l.service_id), String(l.service_label), scopeTrade.get(String(l.service_id))),
      units: unitsOf.get(String(l.entitlement_id)) ?? 1,
    }));
  const crew = crewNeed(lines, config.scheduling);
  /* A security clearance is the technician's own; gate passes and permits are got per visit. */
  const accessTypes = ((rules ?? []) as Row[]).filter((r) => r.access_type === "security_clearance").map((r) => str(r.issuer) ?? "Security clearance");
  const property = (contract.property ?? {}) as Row;
  return {
    visit,
    contract,
    ownerId: str(one(contract.submission)?.owner_id),
    lines,
    need: {
      trades: crew.trades,
      date: date ?? String(visit.target_date),
      area: str(property.community) ?? str(property.propertyDetail) ?? null,
      accessTypes,
    },
    durationMinutes: crew.durationMinutes,
    headcount: crew.headcount,
    accessRuleCount: ((rules ?? []) as Row[]).length,
    accessRules: ((rules ?? []) as Row[]).map(accessRuleView),
  };
}

/* ------------------------------------------------------------------ */
/* Who is busy                                                         */
/* ------------------------------------------------------------------ */

interface BusyBlock {
  technicianId: string;
  start: string;
  end: string;
  kind: "amc" | "job" | "leave";
  title: string;
  visitId?: string;
}

/**
 * Everything that occupies technicians on a day: their AMC visits, the
 * jobs on the current scheduling board (read only), and their leave.
 */
async function busyOn(admin: Admin, date: string, technicianIds: string[] | null, options: { skipAmc?: boolean } = {}): Promise<BusyBlock[]> {
  const { start, end } = dayBounds(date);
  /*
    A slot lasts at most a day (1440 minutes), so anything overlapping this day
    started at most two days before it. The lower bound keeps the slot index
    to a short range instead of every slot ever placed (13 Nov 2026).
  */
  const earliest = new Date(Date.parse(start) - 2 * 86_400_000).toISOString();
  const blocks: BusyBlock[] = [];
  /* The four sources are independent: read together, not one after another. The board skips the AMC ones (it shows them itself). */
  let amc = admin
    .from("amc_visits")
    .select("id, visit_no, scheduled_start, scheduled_end, technician_ids, contract:amc_contracts!amc_visits_contract_id_fkey(customer_name, contract_number)")
    .gte("scheduled_start", earliest)
    .lt("scheduled_start", end)
    .gt("scheduled_end", start)
    .not("status", "in", "(cancelled,completed,completed_with_additional_work,not_completed)");
  if (technicianIds?.length) amc = amc.overlaps("technician_ids", technicianIds);
  let calls = admin
    .from("amc_call_outs")
    .select("id, call_out_no, priority, scheduled_start, scheduled_end, technician_ids, contract:amc_contracts!amc_call_outs_contract_id_fkey(customer_name)")
    .gte("scheduled_start", earliest)
    .lt("scheduled_start", end)
    .gt("scheduled_end", start)
    .not("status", "in", "(cancelled,closed,resolved)");
  if (technicianIds?.length) calls = calls.overlaps("technician_ids", technicianIds);
  /* Additional work with a slot and a crew (20261112100000; before it the read fails and adds nothing). */
  let works = admin
    .from("amc_additional_works")
    .select("id, work_no, scheduled_start, scheduled_end, technician_ids, contract:amc_contracts!amc_additional_works_contract_id_fkey(customer_name)")
    .eq("status", "scheduled")
    .gte("scheduled_start", earliest)
    .lt("scheduled_start", end)
    .gt("scheduled_end", start);
  if (technicianIds?.length) works = works.overlaps("technician_ids", technicianIds);
  let leave = admin.from("leave_records").select("technician_fsm_id, leave_type, start_at, end_at").eq("status", "active").lt("start_at", end).gt("end_at", start);
  if (technicianIds?.length) leave = leave.in("technician_fsm_id", technicianIds);
  /* The live board's current version for the day, then its entries (read only). */
  /* One query with the day's current version joined in (16 Nov 2026): it used to be two, one after the other. */
  const jobs = (async () => {
    const { data: entries } = await admin
      .from("schedule_entries")
      .select("id, start_at, end_at, title, client_name, assignments:schedule_entry_assignments(technician_fsm_id), schedule_versions!inner(schedule_date, is_current)")
      .eq("schedule_versions.schedule_date", date)
      .eq("schedule_versions.is_current", true)
      .not("start_at", "is", null);
    return (entries ?? []) as unknown as Row[];
  })();
  const [visitsRead, callsRead, worksRead, entries, leavesRead] = await Promise.all([options.skipAmc ? null : amc, options.skipAmc ? null : calls, options.skipAmc ? null : works, jobs, leave]);
  const visits = visitsRead?.data;
  if (visitsRead?.error) throw fail(visitsRead.error);
  for (const v of (visits ?? []) as unknown as Row[]) {
    const c = one(v.contract);
    for (const t of strings(v.technician_ids)) {
      blocks.push({
        technicianId: t,
        start: String(v.scheduled_start),
        end: String(v.scheduled_end),
        kind: "amc",
        title: `AMC ${String(c?.contract_number ?? "")} visit ${String(v.visit_no)}: ${String(c?.customer_name ?? "")}`,
        visitId: String(v.id),
      });
    }
  }

  /* AMC call outs with a slot (Phase 11; absent before 20261012120000: no rows). */
  const callOuts = callsRead?.data;
  for (const c of (callOuts ?? []) as unknown as Row[]) {
    for (const t of strings(c.technician_ids)) {
      blocks.push({
        technicianId: t,
        start: String(c.scheduled_start),
        end: String(c.scheduled_end),
        kind: "amc",
        title: `AMC call out ${String(c.call_out_no)}${c.priority === "emergency" ? " (emergency)" : ""}: ${String(one(c.contract)?.customer_name ?? "")}`,
        visitId: String(c.id),
      });
    }
  }

  for (const w of (worksRead?.error ? [] : (worksRead?.data ?? [])) as unknown as Row[]) {
    for (const t of strings(w.technician_ids)) {
      blocks.push({
        technicianId: t,
        start: String(w.scheduled_start),
        end: String(w.scheduled_end),
        kind: "amc",
        title: `AMC additional work ${String(w.work_no)}: ${String(one(w.contract)?.customer_name ?? "")}`,
        visitId: String(w.id),
      });
    }
  }

  for (const e of entries) {
    if (!e.start_at || !e.end_at) continue;
    for (const a of (e.assignments ?? []) as Row[]) {
      const t = String(a.technician_fsm_id);
      if (technicianIds?.length && !technicianIds.includes(t)) continue;
      blocks.push({ technicianId: t, start: String(e.start_at), end: String(e.end_at), kind: "job", title: str(e.title) ?? str(e.client_name) ?? "Scheduled job" });
    }
  }

  const leaves = leavesRead.data;
  for (const l of (leaves ?? []) as Row[]) {
    blocks.push({ technicianId: String(l.technician_fsm_id), start: String(l.start_at), end: String(l.end_at), kind: "leave", title: str(l.leave_type) ?? "Leave" });
  }
  return blocks;
}

function busyFor(blocks: BusyBlock[], technicianId: string, slot: { start: string; end: string } | null, ignoreVisitIds: string[] = []) {
  const mine = blocks.filter((b) => b.technicianId === technicianId && !(b.visitId && ignoreVisitIds.includes(b.visitId)));
  return {
    onLeave: mine.some((b) => b.kind === "leave"),
    overlaps: slot ? mine.filter((b) => b.kind !== "leave" && slotsOverlap(b, slot)).length : 0,
    workloadMinutes: mine.filter((b) => b.kind !== "leave").reduce((m, b) => m + Math.max(0, (Date.parse(b.end) - Date.parse(b.start)) / 60_000), 0),
  };
}

/* ------------------------------------------------------------------ */
/* Who is free to inspect at one time (site visits, 13-16 Nov 2026)    */
/* ------------------------------------------------------------------ */

/** A site visit is booked as a time, not a slot: it is taken to last this long. */
export const SITE_VISIT_MINUTES = 60;

export interface AvailableInspectors {
  /** Technicians free then; `login: "none"` gets a login when picked. */
  technicians: Array<{ fsmId: string; name: string; email: string | null; userId: string | null; login: "none" | "ready" }>;
  /** Other active portal users free then. */
  staff: Array<{ id: string; name: string; email: string | null }>;
  /** How many were left out as booked then. */
  busy: number;
  /** What the person asked about (`currentUserId`) is booked on then; empty when free. */
  currentBusy: string[];
}

/**
 * The people who could inspect a site visit at `startIso` for `minutes`, and
 * are free then: technicians (their AMC work, live jobs and leave) and the
 * rest of the team (their other open site visits). Everything is read at
 * once in one round of queries, for everybody, then filtered in memory:
 * the Find button waits on one request, not one per person (16 Nov 2026).
 */
export async function availableInspectors(
  admin: Admin,
  startIso: string,
  minutes: number,
  options: { ignoreAssessmentId?: string | null; currentUserId?: string | null } = {},
): Promise<AvailableInspectors> {
  const start = Date.parse(startIso);
  const end = start + minutes * 60_000;
  const overlaps = (s: number, e: number) => s < end && e > start;
  const fmt = (ms: number) => dubaiTime(new Date(ms).toISOString());

  const [blocks, siteVisitsRead, techsRead, usersRead] = await Promise.all([
    busyOn(admin, dubaiDate(startIso), null),
    admin
      .from("amc_assessments")
      .select("id, assessment_number, assessor_id, scheduled_at, customer:snagging_clients(name)")
      .eq("status", "draft")
      .not("assessor_id", "is", null)
      .gte("scheduled_at", new Date(start - SITE_VISIT_MINUTES * 60_000).toISOString())
      .lt("scheduled_at", new Date(end).toISOString()),
    admin.from("technician_reference").select("fsm_resource_id, display_name, email, user_profile_id, hidden_from_lists").eq("is_active", true).order("display_name"),
    admin.from("user_profile").select("id, full_name, email, is_active, hidden_from_lists").order("full_name").limit(2000),
  ]);
  if (techsRead.error) throw fail(techsRead.error);
  if (usersRead.error) throw fail(usersRead.error);

  const busyTech = new Map<string, string[]>();
  for (const b of blocks) {
    const s = Date.parse(b.start);
    const e = Date.parse(b.end);
    if (!overlaps(s, e)) continue;
    const list = busyTech.get(b.technicianId) ?? [];
    list.push(b.kind === "leave" ? b.title : `${b.title} (${fmt(s)}–${fmt(e)})`);
    busyTech.set(b.technicianId, list);
  }
  const busyUser = new Map<string, string[]>();
  /* Before the site visit columns exist the read fails: nobody is busy with one. */
  for (const a of (siteVisitsRead.error ? [] : (siteVisitsRead.data ?? [])) as unknown as Row[]) {
    if (options.ignoreAssessmentId && String(a.id) === options.ignoreAssessmentId) continue;
    const s = Date.parse(String(a.scheduled_at));
    if (!overlaps(s, s + SITE_VISIT_MINUTES * 60_000)) continue;
    const who = one(a.customer)?.name;
    const list = busyUser.get(String(a.assessor_id)) ?? [];
    list.push(`Site visit ${String(a.assessment_number ?? "")}${who ? `: ${String(who)}` : ""} (${fmt(s)})`);
    busyUser.set(String(a.assessor_id), list);
  }

  const users = new Map(((usersRead.data ?? []) as Row[]).map((u) => [String(u.id), u]));
  const activeUser = (id: string | null) => {
    const u = id ? users.get(id) : undefined;
    return u && u.is_active !== false ? u : null;
  };
  const technicians: AvailableInspectors["technicians"] = [];
  const technicianUsers = new Set<string>();
  const techOfUser = new Map<string, string>();
  let busy = 0;
  for (const t of (techsRead.data ?? []) as Row[]) {
    if (t.hidden_from_lists === true) continue;
    const fsmId = String(t.fsm_resource_id);
    const linked = str(t.user_profile_id);
    if (linked) {
      technicianUsers.add(linked);
      techOfUser.set(linked, fsmId);
    }
    /* A login that is switched off can't be given the visit. */
    if (linked && users.has(linked) && !activeUser(linked)) continue;
    const userId = activeUser(linked) ? linked : null;
    if (busyTech.has(fsmId) || (userId && busyUser.has(userId))) {
      busy += 1;
      continue;
    }
    technicians.push({ fsmId, name: str(t.display_name) ?? "Technician", email: str(t.email), userId, login: userId ? "ready" : "none" });
  }
  const staff: AvailableInspectors["staff"] = [];
  for (const u of users.values()) {
    const id = String(u.id);
    if (u.is_active === false || u.hidden_from_lists === true || technicianUsers.has(id)) continue;
    if (busyUser.has(id)) {
      busy += 1;
      continue;
    }
    staff.push({ id, name: str(u.full_name) ?? str(u.email) ?? "User", email: str(u.email) });
  }

  const current = options.currentUserId ?? null;
  const currentTech = current ? techOfUser.get(current) : undefined;
  const currentBusy = current ? [...(currentTech ? (busyTech.get(currentTech) ?? []) : []), ...(busyUser.get(current) ?? [])] : [];
  return { technicians, staff, busy, currentBusy };
}

/**
 * Fit of technicians for a slot, for work other than a PPM visit (call
 * outs, Phase 11): the same competence, leave, double-booking and access
 * rules. All active technicians when none are named.
 */
export async function crewFitsForSlot(
  admin: Admin,
  need: VisitNeed,
  slot: { start: string; end: string },
  technicianIds: string[] | null,
  ignoreIds: string[] = [],
): Promise<TechnicianFit[]> {
  const [techs, blocks] = await Promise.all([technicianFacts(admin, !technicianIds), busyOn(admin, need.date, technicianIds)]);
  const chosen = technicianIds ? technicianIds.map((id) => techs.find((t) => t.fsmId === id)).filter((t): t is TechnicianRecord => Boolean(t)) : techs;
  if (technicianIds && chosen.length !== technicianIds.length) throw new ContractError("A chosen technician is not on the FSM roster.", 400);
  return chosen.map((t) => fitFor(t, need, busyFor(blocks, t.fsmId, slot, ignoreIds)));
}

/** A day and a time in Dubai, as an instant. */
export const dubaiSlot = (date: string, time: string, minutes: number) => ({
  start: slotIso(date, time),
  end: new Date(Date.parse(slotIso(date, time)) + minutes * 60_000).toISOString(),
});

/* ------------------------------------------------------------------ */
/* Suggestions (DEV-396)                                               */
/* ------------------------------------------------------------------ */

export interface VisitSuggestion {
  date: string;
  startTime: string;
  durationMinutes: number;
  headcount: number;
  trades: Trade[];
  /** Competent and free, best first. */
  candidates: TechnicianFit[];
  /** Competent for a trade but blocked (on leave, booked, no access), so the coordinator sees why. */
  blocked: TechnicianFit[];
  suggested: { technicianIds: string[]; uncovered: Trade[] };
  /** Active technicians confirmed for each trade, free or not: 0 means nobody has it on their AMC profile. */
  skilledByTrade: Record<string, number>;
  /** Active technicians on the FSM roster. */
  rosterSize: number;
}

export async function suggestForVisit(admin: Admin, visitId: string, date: string, startTime: string, config: AmcConfig, durationMinutes?: number | null): Promise<VisitSuggestion> {
  const ctx = await loadVisitContext(admin, visitId, date, config);
  const duration = durationMinutes ?? ctx.durationMinutes;
  const slot = { start: slotIso(date, startTime), end: new Date(Date.parse(slotIso(date, startTime)) + duration * 60_000).toISOString() };
  const [techs, blocks] = await Promise.all([technicianFacts(admin), busyOn(admin, date, null)]);
  const fits = techs.map((t) => fitFor(t, ctx.need, busyFor(blocks, t.fsmId, slot, [visitId])));
  /* Only technicians confirmed for one of the trades are listed at all (BRD: never a merely similar one). */
  const relevant = fits.filter((f) => f.covers.length > 0 || f.blockers.some((b) => b.startsWith("Certificate")));
  return {
    date,
    startTime,
    durationMinutes: duration,
    headcount: ctx.headcount,
    trades: ctx.need.trades,
    candidates: relevant.filter((f) => f.blockers.length === 0).sort((a, b) => b.score - a.score),
    blocked: relevant.filter((f) => f.blockers.length > 0),
    suggested: suggestCrew(fits, ctx.need.trades),
    skilledByTrade: Object.fromEntries(
      ctx.need.trades.map((trade) => [trade, techs.filter((t) => t.skills.some((s) => s.trade === trade && s.level !== "trainee" && (!s.certificateExpires || s.certificateExpires >= date))).length]),
    ),
    rosterSize: techs.length,
  };
}

/* ------------------------------------------------------------------ */
/* The board (DEV-392, 393, 394)                                       */
/* ------------------------------------------------------------------ */

export interface BoardVisit {
  id: string;
  contractId: string;
  contractNumber: string;
  customerName: string;
  propertyLabel: string;
  visitNo: number;
  status: VisitStatus;
  windowStart: string;
  windowEnd: string;
  targetDate: string;
  originalTargetDate: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  technicianIds: string[];
  leadTechnicianId: string | null;
  services: string[];
  clientConfirmation: string | null;
  accessStatus: AccessStatus | null;
}

function boardVisit(v: Row): BoardVisit {
  const c = one(v.contract) ?? {};
  return {
    id: String(v.id),
    contractId: String(v.contract_id),
    contractNumber: String(c.contract_number ?? c.proposal_number ?? ""),
    customerName: String(c.customer_name ?? ""),
    propertyLabel: String(c.property_label ?? ""),
    visitNo: Number(v.visit_no),
    status: v.status as VisitStatus,
    windowStart: String(v.window_start),
    windowEnd: String(v.window_end),
    targetDate: String(v.target_date),
    originalTargetDate: str(v.original_target_date),
    scheduledStart: str(v.scheduled_start),
    scheduledEnd: str(v.scheduled_end),
    technicianIds: strings(v.technician_ids),
    leadTechnicianId: str(v.lead_technician_id),
    services: ((v.lines ?? []) as Row[]).filter((l) => l.status !== "cancelled").map((l) => String(l.service_label)),
    clientConfirmation: str(v.client_confirmation),
    accessStatus: effectiveAccess(str(v.access_status) as AccessStatus | null, str(v.access_valid_until), String(v.target_date)),
  };
}

export interface BoardData {
  migrated: boolean;
  date: string;
  technicians: Array<Pick<TechnicianRecord, "fsmId" | "name" | "shift" | "role"> & { trades: Trade[]; accountId: string | null; email: string | null }>;
  /** AMC visits placed on this day. */
  placed: BoardVisit[];
  /** Live jobs and leave that day (read only), for who is busy. */
  busy: BusyBlock[];
  /** Planned visits not yet on the board, whose window is open or coming. */
  toPlace: BoardVisit[];
  /** Open call outs without a slot, emergencies first (Phase 11). */
  callOuts: BoardCallOut[];
}

export interface BoardCallOut {
  id: string;
  callOutNo: string;
  contractId: string;
  customerName: string;
  propertyLabel: string;
  priority: "emergency" | "non_emergency";
  issue: string;
  reportedAt: string;
  dueAt: string | null;
  coverage: "covered" | "chargeable";
}

async function openCallOuts(admin: Admin): Promise<BoardCallOut[]> {
  const { data, error } = await admin
    .from("amc_call_outs")
    .select("id, call_out_no, contract_id, priority, issue, reported_at, sla_attend_due_at, sla_schedule_due_at, coverage, contract:amc_contracts!amc_call_outs_contract_id_fkey(customer_name, property_label)")
    .is("scheduled_start", null)
    .eq("status", "logged")
    .order("reported_at")
    .limit(100);
  if (error) return [];
  return ((data ?? []) as unknown as Row[])
    .map((c) => ({
      id: String(c.id),
      callOutNo: String(c.call_out_no),
      contractId: String(c.contract_id),
      customerName: String(one(c.contract)?.customer_name ?? ""),
      propertyLabel: String(one(c.contract)?.property_label ?? ""),
      priority: c.priority as BoardCallOut["priority"],
      issue: String(c.issue),
      reportedAt: String(c.reported_at),
      dueAt: str(c.sla_attend_due_at) ?? str(c.sla_schedule_due_at),
      coverage: c.coverage as BoardCallOut["coverage"],
    }))
    .sort((a, b) => (a.priority === b.priority ? a.reportedAt.localeCompare(b.reportedAt) : a.priority === "emergency" ? -1 : 1));
}

export async function boardData(admin: Admin, date: string, now = new Date()): Promise<BoardData> {
  const today = todayInDubai(now);
  const { start, end } = dayBounds(date);
  /* Everything at once; a database without the technician tables (503) shows the board as not set up. */
  let notSetUp = false;
  const [techs, placedResult, toPlaceResult, blocks, callOuts] = await Promise.all([
    technicianFacts(admin).catch((error: unknown): TechnicianRecord[] => {
      if (error instanceof ContractError && error.status === 503) {
        notSetUp = true;
        return [];
      }
      throw error;
    }),
    admin.from("amc_visits").select(VISIT_COLUMNS).gte("scheduled_start", start).lt("scheduled_start", end).neq("status", "cancelled").order("scheduled_start"),
    admin
      .from("amc_visits")
      .select(VISIT_COLUMNS)
      .is("scheduled_start", null)
      .in("status", [...PLANNABLE_STATUSES])
      .gte("window_end", today)
      .order("window_start")
      .limit(200),
    /* The board draws its own AMC visits and call outs; only jobs and leave are needed here. */
    busyOn(admin, date, null, { skipAmc: true }),
    openCallOuts(admin),
  ]);
  if (notSetUp) return { migrated: false, date, technicians: [], placed: [], busy: [], toPlace: [], callOuts: [] };
  if (placedResult.error) throw fail(placedResult.error);
  if (toPlaceResult.error) throw fail(toPlaceResult.error);
  const live = (r: Row) => ["active", "on_hold"].includes(String(one(r.contract)?.status));
  return {
    migrated: true,
    date,
    technicians: techs.map((t) => ({
      fsmId: t.fsmId,
      name: t.name,
      shift: t.shift,
      role: t.role,
      trades: [...new Set(t.skills.filter((s) => s.level !== "trainee").map((s) => s.trade))],
      accountId: t.accountId ?? null,
      email: t.email ?? null,
    })),
    placed: ((placedResult.data ?? []) as unknown as Row[]).filter(live).map(boardVisit),
    busy: blocks.filter((b) => b.kind !== "amc"),
    toPlace: ((toPlaceResult.data ?? []) as unknown as Row[]).filter((r) => one(r.contract)?.status === "active").map(boardVisit),
    callOuts,
  };
}

async function recordVisitChange(
  admin: Admin,
  entry: { contractId: string; visitId: string; type: string; from?: string | null; to?: string | null; reason?: string | null; detail?: Row },
  actor: Actor,
) {
  await admin.from("amc_visit_changes").insert({
    contract_id: entry.contractId,
    visit_id: entry.visitId,
    change_type: entry.type,
    from_date: entry.from ?? null,
    to_date: entry.to ?? null,
    reason: entry.reason ?? null,
    detail: entry.detail ?? {},
    actor_id: actor.id,
    actor_label: actor.label,
  });
}

/** The date part of a board change, as the PPM rules see it (Phase 8): inside the window, a reschedule, or a tentative adjustment. */
function dateChange(ctx: VisitContext, date: string, reason: string | null, config: AmcConfig) {
  const v = ctx.visit;
  const from = String(v.target_date);
  if (date === from) return { changes: {} as Row, type: null as string | null };
  const confirmed = Boolean(ctx.contract.ppm_confirmed_at);
  const move = classifyMove({ windowStart: String(v.window_start), windowEnd: String(v.window_end) }, date, confirmed);
  if (move.needsReason && !reason) {
    throw new ContractError(`Visit ${String(v.visit_no)}: that day is outside its service window, so say why it is rescheduled.`, 400);
  }
  const windowDays = Number(ctx.contract.ppm_window_days) || config.scheduling.serviceWindowDays;
  const window = windowAfterMove({ windowStart: String(v.window_start), windowEnd: String(v.window_end) }, date, windowDays, confirmed);
  const reschedule = move.kind === "outside_window" && confirmed;
  return {
    changes: {
      target_date: date,
      window_start: window.windowStart,
      window_end: window.windowEnd,
      ...(reschedule
        ? { original_target_date: str(v.original_target_date) ?? from, reschedule_count: Number(v.reschedule_count ?? 0) + 1, status: "rescheduled", status_reason: reason }
        : {}),
    } as Row,
    type: move.kind === "in_window" ? "moved_in_window" : reschedule ? "rescheduled" : "adjusted",
  };
}

async function crewFits(admin: Admin, ctx: VisitContext, technicianIds: string[], slot: { start: string; end: string }, date: string) {
  const [techs, blocks] = await Promise.all([technicianFacts(admin, false), busyOn(admin, date, technicianIds)]);
  const chosen = technicianIds.map((id) => techs.find((t) => t.fsmId === id)).filter((t): t is TechnicianRecord => Boolean(t));
  if (chosen.length !== technicianIds.length) throw new ContractError("A chosen technician is not on the FSM roster.", 400);
  return chosen.map((t) => fitFor(t, { ...ctx.need, date }, busyFor(blocks, t.fsmId, slot, [String(ctx.visit.id)])));
}

/**
 * When the office started a planned visit (Start visit, 18 Nov 2026), read
 * on its own so nothing else depends on the column: ready is false before
 * migration 20261118120000, when a visit in progress was the started one.
 */
export async function visitStartedAt(admin: Admin, visitId: string): Promise<{ startedAt: string | null; ready: boolean }> {
  const { data, error } = await admin.from("amc_visits").select("started_at").eq("id", visitId).maybeSingle<Row>();
  if (error) return { startedAt: null, ready: false };
  return { startedAt: str(data?.started_at), ready: true };
}

export async function performBoardAction(admin: Admin, action: BoardAction, actor: Actor, config: AmcConfig, canChange: (contractOwnerId: string | null) => boolean) {
  const now = new Date().toISOString();
  const guard = async (ctx: VisitContext) => {
    if (!canChange(ctx.ownerId)) throw new ContractError("You cannot change this contract's visits.", 403);
    if (!["active", "on_hold"].includes(String(ctx.contract.status))) throw new ContractError("Visits are placed while the contract is active.", 409);
    if (!PLANNABLE_STATUSES.includes(ctx.visit.status as VisitStatus)) {
      throw new ContractError(`Visit ${String(ctx.visit.visit_no)} is ${String(ctx.visit.status).replace(/_/g, " ")}.`, 409);
    }
    /* Started by the office (18 Nov 2026): the crew is on its way, so the slot and crew stay as they are. */
    if ((await visitStartedAt(admin, String(ctx.visit.id))).startedAt) {
      throw new ContractError(`Visit ${String(ctx.visit.visit_no)} has been started, so it can no longer be moved or changed here.`, 409);
    }
  };

  switch (action.action) {
    case "place": {
      const ctx = await loadVisitContext(admin, action.visitId, action.date, config);
      await guard(ctx);
      const duration = action.durationMinutes ?? ctx.durationMinutes;
      const slot = { start: slotIso(action.date, action.startTime), end: new Date(Date.parse(slotIso(action.date, action.startTime)) + duration * 60_000).toISOString() };
      const fits = await crewFits(admin, ctx, action.technicianIds, slot, action.date);
      const problems = assignmentProblems(fits, ctx.need.trades);
      if (problems.length) throw new ContractError(`Cannot assign: ${problems.join("; ")}.`, 409);
      /* BRD 5.11: accept the suggestion or override it with a reason. */
      const suggestion = await suggestForVisit(admin, action.visitId, action.date, action.startTime, config, duration);
      const same =
        suggestion.suggested.technicianIds.length === action.technicianIds.length &&
        suggestion.suggested.technicianIds.every((id) => action.technicianIds.includes(id));
      if (!same && suggestion.suggested.technicianIds.length && !action.overrideReason) {
        throw new ContractError("You chose a different crew from the one suggested: say why.", 400);
      }
      const dated = dateChange(ctx, action.date, action.reason, config);
      const { error } = await admin
        .from("amc_visits")
        .update({
          ...dated.changes,
          scheduled_start: slot.start,
          scheduled_end: slot.end,
          technician_ids: action.technicianIds,
          lead_technician_id: action.leadTechnicianId ?? action.technicianIds[0],
          headcount: action.technicianIds.length,
          assignment_note: same ? null : action.overrideReason,
          placed_by: actor.id,
          placed_at: now,
          updated_at: now,
        })
        .eq("id", action.visitId);
      if (error) throw fail(error);
      if (dated.type) await recordVisitChange(admin, { contractId: String(ctx.visit.contract_id), visitId: action.visitId, type: dated.type, from: String(ctx.visit.target_date), to: action.date, reason: action.reason }, actor);
      await recordAmcAudit(admin, {
        entityType: "contract",
        entityId: String(ctx.visit.contract_id),
        eventType: "visit_placed",
        actorId: actor.id,
        actorLabel: actor.label,
        payload: { visitNo: ctx.visit.visit_no, date: action.date, startTime: action.startTime, technicians: action.technicianIds, override: same ? null : action.overrideReason },
      });
      return { ok: true as const, changed: 1 };
    }
    case "move": {
      let changed = 0;
      for (const visitId of action.visitIds) {
        const ctx = await loadVisitContext(admin, visitId, action.date, config);
        await guard(ctx);
        const placed = str(ctx.visit.scheduled_start);
        const duration = placed ? (Date.parse(String(ctx.visit.scheduled_end)) - Date.parse(placed)) / 60_000 : ctx.durationMinutes;
        const time = action.startTime ?? (placed ? dubaiTime(placed) : null);
        const slot = time ? { start: slotIso(action.date, time), end: new Date(Date.parse(slotIso(action.date, time)) + duration * 60_000).toISOString() } : null;
        const crew = strings(ctx.visit.technician_ids);
        if (slot && crew.length) {
          const problems = assignmentProblems(await crewFits(admin, ctx, crew, slot, action.date), ctx.need.trades);
          if (problems.length) throw new ContractError(`Visit ${String(ctx.visit.visit_no)} cannot move there: ${problems.join("; ")}.`, 409);
        }
        const dated = dateChange(ctx, action.date, action.reason, config);
        const { error } = await admin
          .from("amc_visits")
          .update({ ...dated.changes, ...(slot && placed ? { scheduled_start: slot.start, scheduled_end: slot.end } : {}), updated_at: now })
          .eq("id", visitId);
        if (error) throw fail(error);
        if (dated.type) await recordVisitChange(admin, { contractId: String(ctx.visit.contract_id), visitId, type: dated.type, from: String(ctx.visit.target_date), to: action.date, reason: action.reason }, actor);
        changed += 1;
      }
      return { ok: true as const, changed };
    }
    case "reassign": {
      let changed = 0;
      for (const visitId of action.visitIds) {
        const ctx = await loadVisitContext(admin, visitId, null, config);
        await guard(ctx);
        const placed = str(ctx.visit.scheduled_start);
        if (!placed) throw new ContractError(`Visit ${String(ctx.visit.visit_no)} is not on the board yet: place it first.`, 409);
        const date = dubaiDate(placed);
        const slot = { start: placed, end: String(ctx.visit.scheduled_end) };
        const problems = assignmentProblems(await crewFits(admin, ctx, action.technicianIds, slot, date), ctx.need.trades);
        if (problems.length) throw new ContractError(`Visit ${String(ctx.visit.visit_no)}: ${problems.join("; ")}.`, 409);
        const { error } = await admin
          .from("amc_visits")
          .update({
            technician_ids: action.technicianIds,
            lead_technician_id: action.technicianIds[0],
            headcount: action.technicianIds.length,
            assignment_note: action.overrideReason ?? str(ctx.visit.assignment_note),
            updated_at: now,
          })
          .eq("id", visitId);
        if (error) throw fail(error);
        changed += 1;
      }
      return { ok: true as const, changed };
    }
    case "unplace": {
      const ctx = await loadVisitContext(admin, action.visitId, null, config);
      await guard(ctx);
      const { error } = await admin
        .from("amc_visits")
        .update({ scheduled_start: null, scheduled_end: null, technician_ids: [], lead_technician_id: null, headcount: null, updated_at: now })
        .eq("id", action.visitId);
      if (error) throw fail(error);
      return { ok: true as const, changed: 1 };
    }
  }
}

/* ------------------------------------------------------------------ */
/* One visit: confirmation and access (DEV-398, 399)                   */
/* ------------------------------------------------------------------ */

export interface VisitDetail extends BoardVisit {
  cycleStart: string;
  cycleEnd: string;
  statusReason: string | null;
  headcount: number | null;
  assignmentNote: string | null;
  confirmedAt: string | null;
  confirmationChannel: string | null;
  confirmationNote: string | null;
  accessValidUntil: string | null;
  accessNote: string | null;
  accessDocumentId: string | null;
  /** The contract's property: access rules added from the visit go to it. */
  propertyId: string | null;
  /** The contract's status: a visit starts only on an active contract. */
  contractStatus: string;
  lines: VisitContext["lines"];
  need: { trades: Trade[]; durationMinutes: number; headcount: number; accessTypes: string[] };
  /* Every access rule of the property (gate pass, permit, lift, keys...), not only the clearances. */
  accessRules: AccessRuleView[];
  /* The visit's own passes, then the property's (17 Nov 2026); passTypes: the access type and status can be stored. */
  passes: PassView[];
  /** When the office pressed Start visit (18 Nov 2026); the visit is in progress once the crew arrives. */
  startedAt: string | null;
  passTypes: boolean;
  rule: { attemptCount: number; attemptIntervalDays: number; attemptChannels: string[] };
  attempts: Array<{ id: string; attemptNo: number; channel: string; outcome: AttemptOutcome; note: string | null; attemptedAt: string; actorLabel: string | null }>;
  attemptState: ReturnType<typeof attemptState>;
  technicians: Array<{ fsmId: string; name: string }>;
  ownerId: string | null;
}

function ruleOf(c: Row, config: AmcConfig) {
  return {
    attemptCount: Number(c.attempt_count) || config.scheduling.attemptCount,
    attemptIntervalDays: c.attempt_interval_days === null || c.attempt_interval_days === undefined ? config.scheduling.attemptIntervalDays : Number(c.attempt_interval_days),
    attemptChannels: strings(c.attempt_channels).length ? strings(c.attempt_channels) : [...config.scheduling.attemptChannels],
  };
}

export async function visitDetail(admin: Admin, visitId: string, config: AmcConfig, now = new Date(), recheck = true): Promise<VisitDetail> {
  const [ctx, started] = await Promise.all([loadVisitContext(admin, visitId, null, config), visitStartedAt(admin, visitId)]);
  /*
    A visit not yet started shows its access as its passes say today
    (17 Nov 2026): a pass that ran out, or a visit moved past a pass's date,
    is caught here rather than when a pass changes. Written once, then read again.
  */
  if (recheck && !started.startedAt && (PLANNABLE_STATUSES as readonly string[]).includes(String(ctx.visit.status))) {
    const docs = await passDocuments(admin, [visitId], str(ctx.contract.property_id));
    const live = accessFromPasses([...docs.forVisit(visitId), ...docs.property], visitDay(ctx.visit), ctx.accessRuleCount > 0);
    if (live.status !== ctx.visit.access_status || live.validUntil !== str(ctx.visit.access_valid_until) || live.documentId !== str(ctx.visit.access_document_id)) {
      await writeVisitAccess(admin, ctx.visit, live, now.toISOString());
      return visitDetail(admin, visitId, config, now, false);
    }
  }
  const [{ data: attempts, error }, techs] = await Promise.all([
    admin.from("amc_visit_attempts").select("id, attempt_no, channel, outcome, note, attempted_at, actor_label").eq("visit_id", visitId).order("attempt_no"),
    technicianFacts(admin, false),
  ]);
  if (error) throw fail(error);
  const list = ((attempts ?? []) as Row[]).map((a) => ({
    id: String(a.id),
    attemptNo: Number(a.attempt_no),
    channel: String(a.channel),
    outcome: a.outcome as AttemptOutcome,
    note: str(a.note),
    attemptedAt: String(a.attempted_at),
    actorLabel: str(a.actor_label),
  }));
  const rule = ruleOf(ctx.contract, config);
  const v = ctx.visit;
  const ids = strings(v.technician_ids);
  const propertyId = str(ctx.contract.property_id);
  const [visitPasses, propertyPasses] = await Promise.all([readPasses(admin, "visit", [visitId]), readPasses(admin, "property", propertyId ? [propertyId] : [])]);
  return {
    ...boardVisit(v),
    cycleStart: String(v.cycle_start),
    cycleEnd: String(v.cycle_end),
    statusReason: str(v.status_reason),
    headcount: v.headcount === null || v.headcount === undefined ? null : Number(v.headcount),
    assignmentNote: str(v.assignment_note),
    confirmedAt: str(v.confirmed_at),
    confirmationChannel: str(v.confirmation_channel),
    confirmationNote: str(v.confirmation_note),
    accessValidUntil: str(v.access_valid_until),
    accessNote: str(v.access_note),
    accessDocumentId: str(v.access_document_id),
    propertyId: str(ctx.contract.property_id),
    contractStatus: String(ctx.contract.status ?? ""),
    lines: ctx.lines,
    need: { trades: ctx.need.trades, durationMinutes: ctx.durationMinutes, headcount: ctx.headcount, accessTypes: ctx.need.accessTypes },
    accessRules: ctx.accessRules,
    passes: [...visitPasses.passes, ...propertyPasses.passes],
    startedAt: started.startedAt,
    passTypes: visitPasses.typed && propertyPasses.typed,
    rule,
    attempts: list,
    attemptState: attemptState(list, rule, now),
    technicians: ids.map((id) => ({ fsmId: id, name: techs.find((t) => t.fsmId === id)?.name ?? id })),
    ownerId: ctx.ownerId,
  };
}

/** Email text and prepared WhatsApp text for a visit (BRD 6.3 messages; no WhatsApp API until Phase 15). */
function visitMessage(ctx: VisitContext, templateId: "messageAppointmentConfirmation" | "messageAppointmentReminder", config: AmcConfig) {
  const v = ctx.visit;
  const customer = (ctx.contract.customer ?? {}) as Row;
  const placed = str(v.scheduled_start);
  const values = {
    "Client name": str(customer.customerName) ?? String(ctx.contract.customer_name ?? "") ?? "customer",
    Service: ctx.lines.map((l) => l.label).join(", "),
    Property: String(ctx.contract.property_label ?? ""),
    "Window start": fmtDate(String(v.window_start)),
    "Window end": fmtDate(String(v.window_end)),
    "Proposed date": fmtDate(placed ? dubaiDate(placed) : String(v.target_date)),
    "Proposed time": placed ? dubaiTime(placed) : "a time that suits you",
    "Visit date": fmtDate(placed ? dubaiDate(placed) : String(v.target_date)),
    "Visit time": placed ? dubaiTime(placed) : "",
  };
  const text = fillTemplate(templateText(templateId, config.templates)!.body, values).trim();
  return { text, to: String(customer.customerEmail ?? "").trim(), phone: str(customer.customerPhone), clientName: values["Client name"] };
}

async function emailVisitText(ctx: VisitContext, subject: string, heading: string, text: string, to: string) {
  await sendEmail({
    to,
    subject,
    html: clientEmailHtml({ eyebrow: "AMC visit", heading, paragraphs: text.split(/\n{2,}/).map((b) => escapeEmailHtml(b).replace(/\n/g, "<br>")), details: [] }),
  });
}

async function nextAttemptNo(admin: Admin, visitId: string) {
  const { data } = await admin.from("amc_visit_attempts").select("attempt_no").eq("visit_id", visitId).order("attempt_no", { ascending: false }).limit(1);
  return Number((data?.[0] as Row | undefined)?.attempt_no ?? 0) + 1;
}

export async function performVisitAction(
  admin: Admin,
  visitId: string,
  action: VisitAction,
  actor: Actor,
  config: AmcConfig,
  canChange: (contractOwnerId: string | null) => boolean,
  now = new Date(),
): Promise<{ ok: true; message?: string; whatsapp?: string | null; outcome?: string }> {
  const ctx = await loadVisitContext(admin, visitId, null, config);
  if (!canChange(ctx.ownerId)) throw new ContractError("You cannot change this contract's visits.", 403);
  const v = ctx.visit;
  const contractId = String(v.contract_id);
  const nowIso = now.toISOString();
  /* The visit's access, with what follows from it: the visit waits for access or is released, and the access to-do closes. */
  const saveAccess = (input: AccessWrite) => writeVisitAccess(admin, v, input, nowIso);
  const refreshAccess = async () => {
    const propertyId = str(ctx.contract.property_id);
    const docs = await passDocuments(admin, [visitId], propertyId);
    const next = accessFromPasses([...docs.forVisit(visitId), ...docs.property], visitDay(v), ctx.accessRuleCount > 0);
    await saveAccess(next);
    return next;
  };
  const passOf = async (documentId: string) => {
    const { data } = await admin.from("amc_documents").select("id, level, entity_id, category, superseded_by").eq("id", documentId).maybeSingle<Row>();
    if (!data || data.level !== "visit" || String(data.entity_id) !== visitId || data.category !== "Gate pass" || data.superseded_by) {
      throw new ContractError("That pass is not on this visit.", 404);
    }
    return data;
  };
  const logAttempt = async (channel: string, outcome: AttemptOutcome, note: string | null) => {
    const { error } = await admin.from("amc_visit_attempts").insert({
      visit_id: visitId,
      attempt_no: await nextAttemptNo(admin, visitId),
      channel,
      outcome,
      note,
      actor_id: actor.id,
      actor_label: actor.label,
    });
    if (error) throw fail(error);
  };

  switch (action.action) {
    case "request_confirmation": {
      const msg = visitMessage(ctx, "messageAppointmentConfirmation", config);
      let outcome: "prepared" | "sent" | "failed" | "no_recipient" = "prepared";
      if (action.channel === "email") {
        outcome = "no_recipient";
        if (msg.to) {
          try {
            await emailVisitText(ctx, `Yalla Fix It AMC visit: please confirm ${fmtDate(String(v.target_date))}`, "Please confirm your AMC visit", msg.text, msg.to);
            outcome = "sent";
          } catch (e) {
            outcome = "failed";
            console.error("[amc:visits] confirmation email failed:", e instanceof Error ? e.message.slice(0, 200) : e);
          }
        }
      }
      if (outcome === "prepared" || outcome === "sent") await logAttempt(action.channel, "message_sent", null);
      if (!v.client_confirmation) await admin.from("amc_visits").update({ client_confirmation: "pending", updated_at: nowIso }).eq("id", visitId);
      const submissionId = str(one(ctx.contract.submission)?.id);
      if (submissionId) {
        await recordSend(admin, {
          submissionId,
          versionNo: 1,
          document: "visit_confirmation",
          channel: action.channel,
          recipients: action.channel === "email" && msg.to ? [{ name: msg.clientName, address: msg.to }] : msg.phone ? [{ name: msg.clientName, address: msg.phone }] : [],
          outcome,
          detail: `Visit ${String(v.visit_no)}`,
          sentBy: actor.id,
        });
      }
      return { ok: true, outcome, message: msg.text, whatsapp: action.channel === "whatsapp" && msg.phone ? whatsappUrl(msg.phone, msg.text) : null };
    }
    case "attempt": {
      if (action.outcome === "no_answer" || action.outcome === "message_sent") {
        /* The contract's channels (Schedule rules), as its count and interval are (17 Nov 2026). */
        const channels = ruleOf(ctx.contract, config).attemptChannels;
        if (channels.length && !channels.includes(action.channel)) {
          throw new ContractError(`This contract's attempts are by ${channels.join(", ")}: change its schedule rules to use ${action.channel}.`, 400);
        }
        const { data: earlier } = await admin.from("amc_visit_attempts").select("outcome, attempted_at").eq("visit_id", visitId);
        const before = attemptState(
          ((earlier ?? []) as Row[]).map((a) => ({ outcome: a.outcome as AttemptOutcome, attemptedAt: String(a.attempted_at) })),
          ruleOf(ctx.contract, config),
          now,
        );
        if (before.nextAllowedAt) {
          throw new ContractError(`The contract asks for ${ruleOf(ctx.contract, config).attemptIntervalDays} day(s) between attempts: the next one from ${fmtDate(before.nextAllowedAt.slice(0, 10))}.`, 409);
        }
      }
      await logAttempt(action.channel, action.outcome, action.note);
      const changes: Row = { updated_at: nowIso };
      if (action.outcome === "confirmed") {
        Object.assign(changes, {
          client_confirmation: "confirmed",
          confirmed_at: nowIso,
          confirmed_by: actor.id,
          confirmation_channel: action.channel,
          confirmation_note: action.note,
          ...(["scheduled", "rescheduled", "not_scheduled", "pending_access"].includes(String(v.status)) ? { status: "confirmed" } : {}),
        });
        await closeAmcTodos(admin, { entityType: "visit", entityId: visitId, kind: "ppm_confirmation" }, { status: "done", reason: "Client confirmed" }).catch(() => 0);
      } else if (action.outcome === "declined") {
        Object.assign(changes, { client_confirmation: "declined", confirmation_note: action.note });
      } else if (action.outcome === "reschedule_requested") {
        Object.assign(changes, { client_confirmation: "pending", confirmation_note: action.note });
      } else {
        const { data: all } = await admin.from("amc_visit_attempts").select("outcome, attempted_at").eq("visit_id", visitId);
        const state = attemptState(
          ((all ?? []) as Row[]).map((a) => ({ outcome: a.outcome as AttemptOutcome, attemptedAt: String(a.attempted_at) })),
          ruleOf(ctx.contract, config),
          now,
        );
        if (state.exhausted) {
          Object.assign(changes, { client_confirmation: "no_answer" });
          const { data: claimed } = await admin.from("amc_visits").update({ no_answer_notified_at: nowIso }).eq("id", visitId).is("no_answer_notified_at", null).select("id");
          if (claimed?.length) {
            const escalation = str(ctx.contract.attempt_escalation_user_id);
            await notifyUsers(admin, {
              event: "visit_no_answer",
              userIds: [escalation, ctx.ownerId].filter((id): id is string => Boolean(id)),
              title: `No answer after ${state.tried} attempts: ${String(ctx.contract.contract_number ?? "")}`,
              body: `${String(ctx.contract.customer_name ?? "")}: visit ${String(v.visit_no)} (${fmtDate(String(v.target_date))}) could not be confirmed. Decide whether to go ahead, reschedule or record it as not completed.`,
              link: `/extensions/amc-contracts/${contractId}?tab=schedule`,
              entityType: "visit",
              entityId: visitId,
              contractId,
              dedupeKey: `visit_no_answer:${visitId}`,
            });
          }
        } else if (!v.client_confirmation) {
          Object.assign(changes, { client_confirmation: "pending" });
        }
      }
      const { error } = await admin.from("amc_visits").update(changes).eq("id", visitId);
      if (error) throw fail(error);
      return { ok: true };
    }
    case "access": {
      if (action.documentId) {
        const { data: doc } = await admin.from("amc_documents").select("id, level, entity_id").eq("id", action.documentId).maybeSingle<Row>();
        const ok = doc && ((doc.level === "visit" && String(doc.entity_id) === visitId) || (doc.level === "contract" && String(doc.entity_id) === contractId));
        if (!ok) throw new ContractError("Upload the pass to this visit or its contract first.", 400);
      }
      await saveAccess({ status: action.status, validUntil: action.validUntil ?? null, documentId: action.documentId ?? str(v.access_document_id), note: action.note });
      await recordAmcAudit(admin, { entityType: "contract", entityId: contractId, eventType: "visit_access_updated", actorId: actor.id, actorLabel: actor.label, payload: { visitNo: v.visit_no, status: action.status } });
      return { ok: true };
    }
    case "pass": {
      await passOf(action.documentId);
      const { error } = await admin.from("amc_documents").update({ expires_on: action.validUntil, notes: action.note }).eq("id", action.documentId);
      if (error) throw fail(error);
      await writePassType(admin, action.documentId, { accessRuleId: action.accessRuleId, accessStatus: action.accessStatus }, str(ctx.contract.property_id));
      const next = await refreshAccess();
      await recordAmcAudit(admin, { entityType: "contract", entityId: contractId, eventType: "visit_pass_updated", actorId: actor.id, actorLabel: actor.label, payload: { visitNo: v.visit_no, documentId: action.documentId, validUntil: action.validUntil, passStatus: action.accessStatus ?? null, access: next.status } });
      return { ok: true };
    }
    case "pass_remove": {
      await passOf(action.documentId);
      /* Taken out of use, the file kept: marked as replaced by itself, so every list leaves it out. */
      const { error } = await admin.from("amc_documents").update({ superseded_by: action.documentId }).eq("id", action.documentId);
      if (error) throw fail(error);
      const next = await refreshAccess();
      await recordAmcAudit(admin, { entityType: "contract", entityId: contractId, eventType: "visit_pass_removed", actorId: actor.id, actorLabel: actor.label, payload: { visitNo: v.visit_no, documentId: action.documentId, access: next.status } });
      return { ok: true };
    }
    case "start": {
      /* Access as the passes say today, for the visit's current day: a pass may have run out or the visit moved (17 Nov 2026). */
      const access = await refreshAccess();
      const problems = startProblems({
        status: String(v.status),
        contractActive: ctx.contract.status === "active",
        technicianIds: strings(v.technician_ids),
        scheduledStart: str(v.scheduled_start),
        scheduledEnd: str(v.scheduled_end),
        clientConfirmation: str(v.client_confirmation),
        accessStatus: access.status,
      });
      if (problems.length) throw new ContractError(`Before starting the visit: ${problems.map((p) => p.text.replace(/\.$/, "").toLowerCase()).join("; ")}.`, 400);
      /*
        Stamped by the office (18 Nov 2026), the status left as it is: the
        visit is in progress once the crew records their arrival on the
        phone. Before migration 20261118120000 it is set in progress, as before.
      */
      const startedBefore = await visitStartedAt(admin, visitId);
      if (startedBefore.startedAt) throw new ContractError(`Visit ${String(v.visit_no)} was already started.`, 409);
      const startable = ["not_scheduled", "scheduled", "rescheduled", "confirmed", "pending_access"];
      const { data: started, error } = startedBefore.ready
        ? await admin.from("amc_visits").update({ started_at: nowIso, started_by: actor.id, updated_at: nowIso }).eq("id", visitId).is("started_at", null).in("status", startable).select("id")
        : await admin.from("amc_visits").update({ status: "in_progress", updated_at: nowIso }).eq("id", visitId).in("status", startable).select("id");
      if (error) throw fail(error);
      if (!started?.length) throw new ContractError("This visit changed a moment ago. Refresh the page.", 409);
      await recordAmcAudit(admin, { entityType: "contract", entityId: contractId, eventType: "visit_started", actorId: actor.id, actorLabel: actor.label, payload: { visitNo: v.visit_no } });
      return { ok: true };
    }
    case "passes_changed": {
      const next = await refreshAccess();
      await recordAmcAudit(admin, { entityType: "contract", entityId: contractId, eventType: "visit_access_updated", actorId: actor.id, actorLabel: actor.label, payload: { visitNo: v.visit_no, status: next.status, fromPasses: true } });
      return { ok: true };
    }
  }
}

/* ------------------------------------------------------------------ */
/* The daily sweep (job "visits")                                      */
/* ------------------------------------------------------------------ */

/**
 * Daily: the confirmation to-do and notification N days before a window
 * opens (and the access status a visit starts with); an access alert when
 * a visit is near without a usable pass (to-do 4); and the client's
 * reminder the day before a placed visit. Each is claimed with its stamp
 * first, so overlapping runs act once. (The technician's reminder on the
 * day goes through the FSM app: Phase 15.)
 */
export async function runVisitSweep(admin: Admin, config: AmcConfig, now = new Date()) {
  const result = { confirmationsDue: 0, accessAlerts: 0, clientReminders: 0, skipped: null as string | null };
  const today = todayInDubai(now);
  const lead = config.scheduling.confirmationLeadDays;
  const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + (Math.max(lead, config.scheduling.accessAlertDaysBefore) + 1) * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await admin
    .from("amc_visits")
    .select(VISIT_COLUMNS)
    .in("status", [...PLANNABLE_STATUSES])
    .lte("window_start", horizon)
    .gte("window_end", today)
    .limit(500);
  if (error) {
    if (notMigrated(error)) return { ...result, skipped: "not migrated" };
    throw new Error(error.message);
  }
  for (const v of (data ?? []) as unknown as Row[]) {
    const c = one(v.contract);
    if (!c || c.status !== "active" || !c.ppm_confirmed_at) continue;
    const owner = str(one(c.submission)?.owner_id);
    const visitId = String(v.id);
    const contractId = String(v.contract_id);
    const link = `/extensions/amc-contracts/${contractId}?tab=schedule`;
    const label = `${String(c.contract_number ?? "")} visit ${String(v.visit_no)}`;

    /* Confirmation due (BRD 5.11: a set number of days before the window, 7 in the meeting). */
    if (!v.confirmation_due_notified_at && confirmationDue(String(v.window_start), today, lead)) {
      const { data: claimed } = await admin.from("amc_visits").update({ confirmation_due_notified_at: now.toISOString() }).eq("id", visitId).is("confirmation_due_notified_at", null).select("id");
      if (claimed?.length) {
        let accessStatus = str(v.access_status);
        if (!accessStatus && c.property_id) {
          const { count } = await admin.from("amc_property_access_rules").select("id", { count: "exact", head: true }).eq("property_id", String(c.property_id)).eq("active", true);
          accessStatus = defaultAccessStatus(count ?? 0);
        }
        await admin
          .from("amc_visits")
          .update({ client_confirmation: str(v.client_confirmation) ?? "pending", access_status: accessStatus ?? "not_required" })
          .eq("id", visitId);
        v.access_status = accessStatus ?? "not_required";
        /* To-do 3 (BRD 6.8): service, access rule and allowance balance in the to-do itself. */
        const visitLines = ((v.lines ?? []) as Row[]).filter((l) => l.status !== "cancelled");
        const [{ data: rulesForTodo }, { data: entsForTodo }] = await Promise.all([
          c.property_id
            ? admin.from("amc_property_access_rules").select("access_type, issuer, lead_time_days").eq("property_id", String(c.property_id)).eq("active", true)
            : Promise.resolve({ data: [] as Row[] }),
          visitLines.length
            ? admin.from("amc_contract_entitlements").select("service_label, included_quantity, used_quantity, reserved_quantity").in("id", visitLines.map((l) => String(l.entitlement_id)))
            : Promise.resolve({ data: [] as Row[] }),
        ]);
        const accessText = ((rulesForTodo ?? []) as Row[])
          .map((r) => `${String(r.access_type).replace(/_/g, " ")}${str(r.issuer) ? ` (${str(r.issuer)})` : ""}${r.lead_time_days ? `, ${String(r.lead_time_days)} days ahead` : ""}`)
          .join("; ");
        const balanceText = ((entsForTodo ?? []) as Row[])
          .filter((e) => e.included_quantity !== null && e.included_quantity !== undefined)
          .map((e) => `${String(e.service_label)} ${Math.max(0, Number(e.included_quantity) - Number(e.used_quantity ?? 0) - Number(e.reserved_quantity ?? 0))} of ${String(e.included_quantity)} left`)
          .join("; ");
        const todoDetail = [
          `Services: ${visitLines.map((l) => String(l.service_label)).join(", ") || "—"}.`,
          `Access: ${accessText || "no rule recorded"}.`,
          `Allowance: ${balanceText || "not counted"}.`,
        ].join(" ");
        if (owner) {
          await openAmcTodo(
            admin,
            {
              kind: "ppm_confirmation",
              entityType: "visit",
              entityId: visitId,
              dedupeKey: `ppm_confirmation:${visitId}`,
              title: `Confirm PPM visit: ${label}`,
              description: `${String(c.customer_name ?? "")}, ${String(c.property_label ?? "")}: window ${fmtDate(String(v.window_start))} to ${fmtDate(String(v.window_end))}. ${todoDetail} Send the confirmation request, log each attempt, confirm the date and time.`,
              ownerId: owner,
              assigneeIds: [owner],
              dueAt: new Date(Date.parse(`${String(v.window_start)}T08:00:00${DUBAI}`)).toISOString(),
              escalateAt: new Date(Date.parse(`${String(v.window_start)}T08:00:00${DUBAI}`) + 2 * 86_400_000).toISOString(),
            },
            config,
          ).catch((e) => console.error("[amc:visits] confirmation to-do not opened:", e instanceof Error ? e.message : e));
          await notifyUsers(admin, {
            event: "ppm_confirmation_due",
            userIds: [owner],
            title: `PPM confirmation due: ${label}`,
            body: `${String(c.customer_name ?? "")}: the window opens ${fmtDate(String(v.window_start))}.`,
            link,
            entityType: "visit",
            entityId: visitId,
            contractId,
            dedupeKey: `ppm_confirmation_due:${visitId}`,
          });
        }
        result.confirmationsDue += 1;
      }
    }

    /* Access near and not usable (BRD 5.11 / to-do 4). */
    const date = str(v.scheduled_start) ? dubaiDate(String(v.scheduled_start)) : String(v.target_date);
    const access = effectiveAccess(str(v.access_status) as AccessStatus | null, str(v.access_valid_until), date);
    if (access === "expired" && v.access_status === "approved") {
      await admin.from("amc_visits").update({ access_status: "expired" }).eq("id", visitId);
    }
    if (!v.access_alert_sent_at && accessAlertDue(access, date, today, config.scheduling.accessAlertDaysBefore)) {
      const { data: claimed } = await admin.from("amc_visits").update({ access_alert_sent_at: now.toISOString() }).eq("id", visitId).is("access_alert_sent_at", null).select("id");
      if (claimed?.length && owner) {
        await openAmcTodo(
          admin,
          {
            kind: "access_gate_pass",
            entityType: "visit",
            entityId: visitId,
            dedupeKey: `access_gate_pass:${visitId}`,
            title: `Access needed: ${label}`,
            description: `${String(c.customer_name ?? "")}, ${String(c.property_label ?? "")}: the visit is on ${fmtDate(date)} and access is ${access}. Request the pass, upload it, or mark it not required.`,
            ownerId: owner,
            assigneeIds: [owner],
            dueAt: new Date(Date.parse(`${date}T08:00:00${DUBAI}`) - 86_400_000).toISOString(),
          },
          config,
        ).catch((e) => console.error("[amc:visits] access to-do not opened:", e instanceof Error ? e.message : e));
        await notifyUsers(admin, {
          event: "visit_access_pending",
          userIds: [owner],
          title: `Access pending: ${label}`,
          body: `${String(c.customer_name ?? "")}: visit on ${fmtDate(date)}, access ${access}.`,
          link,
          entityType: "visit",
          entityId: visitId,
          contractId,
          dedupeKey: `visit_access_pending:${visitId}`,
        });
        result.accessAlerts += 1;
      }
    }

    /* The client's reminder the day before a placed visit. */
    const placed = str(v.scheduled_start);
    const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    if (placed && dubaiDate(placed) === tomorrow && !v.client_reminder_sent_at) {
      const { data: claimed } = await admin.from("amc_visits").update({ client_reminder_sent_at: now.toISOString() }).eq("id", visitId).is("client_reminder_sent_at", null).select("id");
      if (!claimed?.length) continue;
      const ctx = await loadVisitContext(admin, visitId, null, config);
      const msg = visitMessage(ctx, "messageAppointmentReminder", config);
      let outcome: "sent" | "failed" | "no_recipient" = "no_recipient";
      if (msg.to) {
        try {
          await emailVisitText(ctx, `Yalla Fix It AMC visit tomorrow, ${fmtDate(dubaiDate(placed))}`, "Your AMC visit is tomorrow", msg.text, msg.to);
          outcome = "sent";
        } catch (e) {
          outcome = "failed";
          console.error("[amc:visits] reminder email failed:", e instanceof Error ? e.message.slice(0, 200) : e);
        }
      }
      const submissionId = str(one(c.submission)?.id);
      if (submissionId) {
        await recordSend(admin, {
          submissionId,
          versionNo: 1,
          document: "visit_reminder",
          channel: "email",
          recipients: msg.to ? [{ name: msg.clientName, address: msg.to }] : [],
          outcome,
          detail: `Visit ${String(v.visit_no)} reminder`,
          sentBy: null,
        });
      }
      result.clientReminders += 1;
    }
  }
  return result;
}
