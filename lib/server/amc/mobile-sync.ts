import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { OUTCOME_GROUPS } from "@/lib/amc/job-sheets";
import {
  FILLABLE_KINDS,
  MOBILE_LIST_STAGES,
  WAITING_FOR_EARLIER,
  detailVersion,
  doneCursorFilter,
  isSiteMutation,
  workOf,
  mutationVisit,
  onCrew,
  parseMobileMutation,
  toMobileCard,
  shownOnPhone,
  SHOWN_ON_PHONE_FILTER,
  SHOWN_ON_PHONE_FILTER_NO_STARTED,
  siteApprovalState,
  SITE_APPROVAL_LABELS,
  type FieldVisitViewRow,
  type SiteApprovalState,
  type MobileListQuery,
  type SiteFormInput,
  type MobileResult,
} from "@/lib/amc/mobile-sync";
import { fieldVisitStatusLabel, type FieldVisitKind, type FieldVisitStage } from "@/lib/amc/field-visits";
import { PLANNABLE_STATUSES, VISIT_STATUS_LABELS, type VisitStatus } from "@/lib/amc/ppm";
import { tradeForService } from "@/lib/amc/visits";
import { hasResourceAction } from "@/lib/role-permissions";
import { performWorkAction } from "@/lib/server/amc/additional-works";
import { addWorkPhoto, performCallOutAction, removeWorkPhoto, workPhotos } from "@/lib/server/amc/call-outs";
import { readAmcConfig } from "@/lib/server/amc/config";
import { ContractError, isMissingTable } from "@/lib/server/amc/contracts";
import { addVisitPhoto, jobSheetView, removeVisitPhoto, saveJobSheet } from "@/lib/server/amc/job-sheets";
import { fieldJobSheetView, saveFieldJobSheet } from "@/lib/server/amc/field-job-sheets";
import { addAssessmentPhoto, listAssessmentPhotos, noCategoryColumn, removeAssessmentPhoto, setAssessmentPhotoDetails } from "@/lib/server/amc/assessment-photos";
import { completeAssessment, getAssessment, getProperty, updateAssessment } from "@/lib/server/amc/business";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import {
  createAsset,
  createScopeItem,
  listAssets,
  listScope,
  retireAsset,
  updateAsset,
  updateScopeItem,
  type AssetRecord,
  type ScopeItemRecord,
} from "@/lib/server/amc/client-profile";
import { readAmcSettings } from "@/lib/server/amc/settings";
import { AMC_DOCUMENTS_BUCKET } from "@/lib/server/amc/signed-archive";
import { readCharge } from "@/lib/server/amc/visit-charges";
import { CHARGE_STATUS_LABELS, PAYMENT_TIMING_LABELS, type VisitCharge } from "@/lib/amc/visit-charges";
import { heldSiteChanges, heldSiteStamp, holdSiteChange, notifyApproverReady, withHeldChanges } from "@/lib/server/amc/site-visit-approval";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/*
  The mobile app's AMC endpoints (/api/amc-sync/*), on the server.

  Who: the app's Bearer token, resolved to the same profile and role access
  as the portal (getRequestUserAccess), with the Mobile App permission that
  Snagging's sync asks for. Which visits: the ones whose crew holds the
  technician linked to that account (technician_reference.user_profile_id),
  and site visits the account is the assessor of -- never an id the phone
  sends. AMC proposal or contract permissions are not needed: a technician
  fills in the visits they are sent to, nothing else.
*/

type Admin = SupabaseClient;
type Row = Record<string, unknown>;

export interface MobileTechnician {
  admin: Admin;
  userId: string;
  label: string | null;
  /** The FSM technician linked to this account, when there is one. */
  fsmId: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const one = (v: unknown): Row | null => (Array.isArray(v) ? ((v[0] as Row | undefined) ?? null) : ((v as Row | null) ?? null));
const strings = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).map(String) : []);
/* FSM ids are digits; anything else is not put into a filter. */
const SAFE_ID = /^[\w-]{1,40}$/;

/* The account -> technician link barely changes; a minute's cache saves a query per request. */
const linkCache = new Map<string, { fsmId: string | null; at: number }>();
const LINK_TTL_MS = 60_000;

async function linkedTechnician(admin: Admin, userId: string): Promise<string | null> {
  const hit = linkCache.get(userId);
  if (hit && Date.now() - hit.at < LINK_TTL_MS) return hit.fsmId;
  const { data } = await admin.from("technician_reference").select("fsm_resource_id").eq("user_profile_id", userId).maybeSingle<Row>();
  const fsmId = str(data?.fsm_resource_id);
  linkCache.set(userId, { fsmId: fsmId && SAFE_ID.test(fsmId) ? fsmId : null, at: Date.now() });
  return linkCache.get(userId)!.fsmId;
}

export async function requireMobileTechnician(req: NextRequest): Promise<{ ok: true; tech: MobileTechnician } | { ok: false; response: NextResponse }> {
  const { profile, accessUser } = await getRequestUserAccess(req);
  if (!profile || !accessUser) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!hasResourceAction(accessUser, ResourceType.MOBILE_APP, ActionType.VIEW)) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const admin = await createAdminServerClient();
  return {
    ok: true,
    tech: { admin, userId: profile.id, label: profile.full_name ?? profile.email ?? null, fsmId: await linkedTechnician(admin, profile.id) },
  };
}

export function mobileErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof ContractError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(`[amc-sync] ${fallback}:`, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

/** "My visits": on the crew, or the assessor of a site visit. */
function mineFilter(tech: MobileTechnician): string {
  return [tech.fsmId ? `technician_ids.cs.{"${tech.fsmId}"}` : null, `assessor_id.eq.${tech.userId}`].filter(Boolean).join(",");
}

/* ------------------------------------------------------------------ */
/* The list: cards only                                                */
/* ------------------------------------------------------------------ */

const CARD_COLUMNS = "kind, id, ref, customer_name, property_label, status, stage, day, scheduled_start, scheduled_end, trade";
/** Today and Upcoming are the crew's live workload: bounded, read whole. */
const ACTIVE_CAP = 200;
/* A planned visit's statuses that are NOT on the Active list (the view's stage mapping: review, done, cancelled). */
const PPM_NOT_ACTIVE = "(cancelled,submitted,completed,completed_with_additional_work,partially_completed,not_completed)";

/** Live service lines per visit, from rows of { visit_id }. */
function countLines(lines: Row[] | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines ?? []) out.set(String(l.visit_id), (out.get(String(l.visit_id)) ?? 0) + 1);
  return out;
}

/**
 * The services of every live planned visit on this technician's crew, read
 * beside the cards rather than after them: the Active list is then one
 * database round trip, however many visits it holds.
 */
function activeServiceLines(tech: MobileTechnician) {
  if (!tech.fsmId) return Promise.resolve({ data: [] as Row[], error: null });
  return tech.admin
    .from("amc_visit_lines")
    .select("visit_id, visit:amc_visits!amc_visit_lines_visit_id_fkey!inner(id)")
    .contains("visit.technician_ids", [tech.fsmId])
    .not("visit.status", "in", PPM_NOT_ACTIVE)
    .neq("status", "cancelled")
    .limit(5000);
}

/**
 * Each site visit's approval (sent back, awaiting approval, approved), for
 * its card: one read of the page's site visits. Before the approval
 * migration there are none (the columns are missing), not an error.
 */
async function siteApprovals(admin: MobileTechnician["admin"], ids: string[]): Promise<Map<string, SiteApprovalState>> {
  const out = new Map<string, SiteApprovalState>();
  if (!ids.length) return out;
  const { data, error } = await admin.from("amc_assessments").select("id, status, approver_id, approved_at, sent_back_at").in("id", ids);
  if (error) {
    if (error.code === "42703" || error.code === "PGRST204") return out;
    throw new ContractError(error.message, 500);
  }
  for (const r of (data ?? []) as Row[]) {
    const state = siteApprovalState({ status: String(r.status), approverId: str(r.approver_id), approvedAt: str(r.approved_at), sentBackAt: str(r.sent_back_at) });
    if (state) out.set(String(r.id), state);
  }
  return out;
}

export async function listMobileVisits(tech: MobileTechnician, query: MobileListQuery) {
  const { admin } = tech;
  const serverTime = new Date().toISOString();
  const done = query.list === "done";
  const readCards = (withStarted: boolean) => {
    let q = admin
      .from("amc_field_visits")
      .select(withStarted && !done ? `${CARD_COLUMNS}, started_at` : CARD_COLUMNS)
      .or(mineFilter(tech))
      .in("stage", MOBILE_LIST_STAGES[query.list] as string[]);
    if (done) {
      if (query.before) q = q.or(doneCursorFilter(query.before, query.before_id));
      return q.order("day", { ascending: false }).order("id", { ascending: false }).limit(query.limit + 1);
    }
    /* Not started by the office yet: not on Today or Upcoming (lib/amc/mobile-sync shownOnPhone). */
    q = q.or(withStarted ? SHOWN_ON_PHONE_FILTER : SHOWN_ON_PHONE_FILTER_NO_STARTED);
    return q.order("day", { ascending: true }).order("scheduled_start", { ascending: true, nullsFirst: false }).limit(ACTIVE_CAP);
  };
  const [first, activeLines] = await Promise.all([readCards(true), done ? null : activeServiceLines(tech)]);
  let { data, error } = first;
  /* Before migration 20261118110000 the view has no started_at: read without it. */
  if (error && !done && (error.code === "42703" || error.code === "PGRST204")) ({ data, error } = await readCards(false));
  if (error) {
    /* The view is not on this database yet: no AMC visits, not a failure the app should retry. */
    if (isMissingTable(error)) return { server_time: serverTime, linked: Boolean(tech.fsmId), set_up: false, cards: [], has_more: false };
    throw new ContractError(error.message, 500);
  }
  let rows = (data ?? []) as unknown as FieldVisitViewRow[];
  if (!done) rows = rows.filter(shownOnPhone);
  const hasMore = done && rows.length > query.limit;
  if (hasMore) rows = rows.slice(0, query.limit);

  /*
    Each planned visit's live services: read alongside the cards for Active;
    for a page of Done (its visits are only known once the page is in), one
    query for the whole page.
  */
  let services: Map<string, number>;
  if (activeLines) {
    if (activeLines.error) throw new ContractError(activeLines.error.message, 500);
    services = countLines(activeLines.data as Row[]);
  } else {
    const ppmIds = rows.filter((r) => r.kind === "ppm").map((r) => r.id);
    services = new Map();
    if (ppmIds.length) {
      const { data: lines, error: linesError } = await admin.from("amc_visit_lines").select("visit_id").in("visit_id", ppmIds).neq("status", "cancelled");
      if (linesError) throw new ContractError(linesError.message, 500);
      services = countLines(lines as Row[]);
    }
  }
  const approvals = await siteApprovals(admin, rows.filter((r) => r.kind === "site_visit").map((r) => r.id));
  const cards = rows
    .map((r) => toMobileCard(r, services.get(r.id) ?? 0, approvals.get(r.id) ?? null))
    .filter((c): c is NonNullable<typeof c> => c !== null);
  const last = rows[rows.length - 1];
  return {
    server_time: serverTime,
    linked: Boolean(tech.fsmId),
    set_up: true,
    cards,
    has_more: hasMore,
    ...(done ? { next_before: hasMore && last ? String(last.day).slice(0, 10) : null, next_before_id: hasMore && last ? last.id : null } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* An opened visit                                                     */
/* ------------------------------------------------------------------ */


const HEADER_COLUMNS =
  "id, contract_id, visit_no, status, updated_at, scheduled_start, scheduled_end, window_start, window_end, target_date, technician_ids, lead_technician_id, " +
  "client_confirmation, access_status, access_note, access_valid_until, assignment_note, " +
  "contract:amc_contracts!amc_visits_contract_id_fkey(contract_number, proposal_number, customer_name, customer, property_label, property, property_id)";

async function crewNames(admin: Admin, ids: string[], lead: string | null, me: string | null) {
  if (!ids.length) return [];
  const { data } = await admin.from("technician_reference").select("fsm_resource_id, display_name").in("fsm_resource_id", ids);
  const names = new Map(((data ?? []) as Row[]).map((t) => [String(t.fsm_resource_id), String(t.display_name)]));
  return ids.map((id, i) => ({ id, name: names.get(id) ?? "Technician", lead: lead ? id === lead : i === 0, me: id === me }));
}

function clientOf(contract: Row) {
  const customer = (contract.customer ?? {}) as Row;
  const property = (contract.property ?? {}) as Row;
  const contacts = Array.isArray(customer.coordinationContacts) ? (customer.coordinationContacts as Row[]) : [];
  return {
    name: str(contract.customer_name) ?? str(customer.customerName),
    phone: str(customer.customerPhone),
    property: str(contract.property_label),
    address: str(property.propertyAddress) ?? str(property.propertyDetail),
    contacts: contacts
      .map((c) => ({ name: str(c.name), phone: str(c.phone), role: str(c.designation) }))
      .filter((c) => c.name || c.phone)
      .slice(0, 6),
  };
}

/** The visit's top row and what its version is made of, in one round; refuses anyone not on the crew. */
async function ppmHead(tech: MobileTechnician, id: string): Promise<{ v: Row; current: string; officeStarted: boolean }> {
  const { admin } = tech;
  const visitRead = admin.from("amc_visits").select(HEADER_COLUMNS).eq("id", id).maybeSingle<Row>();
  /*
    The visit's passes and its property's access rules move the version too
    (17 Nov 2026): a pass's date or note, or a rule, changes on the portal
    without touching the visit's row. The rules wait for the row (it names
    the property); the passes are read beside it.
  */
  const rulesRead = visitRead.then(({ data }) => {
    const propertyId = str(one(data?.contract)?.property_id);
    return propertyId
      ? admin.from("amc_property_access_rules").select("updated_at").eq("property_id", propertyId).eq("active", true).then((r) => (r.data ?? []) as Row[])
      : ([] as Row[]);
  });
  /* The visit's passes and the property's (the property's need the row). */
  const passesRead = visitRead.then(({ data }) => visitPassRows(admin, "visit", id, str(one(data?.contract)?.property_id)));
  /*
    The office's Start visit (18 Nov 2026, migration 20261118120000): its
    own stamp, with the status left as it was until the crew arrives. Read
    on its own so that, before the column exists, the error just means "go
    by the status" (null here).
  */
  const startedRead = admin
    .from("amc_visits")
    .select("started_at")
    .eq("id", id)
    .maybeSingle<Row>()
    .then((r) => (r.error ? null : str(r.data?.started_at)));
  const [{ data: v, error }, sheetRead, photoRead, passes, rules, startedAt] = await Promise.all([
    visitRead,
    admin.from("amc_visit_job_sheets").select("updated_at").eq("visit_id", id).maybeSingle<Row>(),
    admin.from("amc_visit_photos").select("created_at", { count: "exact" }).eq("visit_id", id).order("created_at", { ascending: false }).limit(1),
    passesRead,
    rulesRead,
    startedRead,
  ]);
  if (error) throw new ContractError(error.message, 500);
  if (!v || !onCrew(v, tech.fsmId)) throw new ContractError("Visit not found.", 404);
  const access = [
    ...passStampOf(passes),
    `r${rules.length}:${rules.map((r) => str(r.updated_at) ?? "").sort().pop() ?? ""}`,
  ].join(",");
  /* The payload's shape is part of the version: a phone holding an older shape fetches the visit again once. */
  const current = PPM_PAYLOAD + detailVersion({
    visitUpdatedAt: str(v.updated_at),
    sheetUpdatedAt: str(sheetRead.data?.updated_at),
    photoCount: photoRead.count ?? 0,
    latestPhotoAt: str((photoRead.data?.[0] as Row | undefined)?.created_at),
  }) + `|${access}|${startedAt ?? "-"}`;
  /* Started: the office's stamp, or (before it, and for visits started the old way) a status past planning. */
  const officeStarted = Boolean(startedAt) || !PLANNABLE_STATUSES.includes(String(v.status) as VisitStatus);
  return { v, current, officeStarted };
}

/* The shape of a planned visit's payload: p2 added photo categories; p3 the property brief; p4 the visit's passes; p5 each check's category (17 Nov 2026); p6 the property's passes and each pass's type (18 Nov). */
const PPM_PAYLOAD = "p6|";

/** Where the portal files a record's own passes (lib/server/amc/field-access): a planned visit's are "visit". */
type PassLevel = "visit" | "call_out" | "additional_work";
const passLevelOf = (kind: FieldVisitKind): PassLevel => (kind === "call_out" || kind === "additional_work" ? kind : "visit");

/**
 * The gate passes and permits in use for a visit, as the portal's Access tab
 * has them (18 Nov 2026): the record's own (a planned visit's, a call out's
 * or an additional work's), then the property's -- a property pass counts
 * for every visit there. One file each. Every column, so a pass's type
 * (access_rule_id, migration 20261117120000) is read once it exists.
 */
async function visitPassRows(admin: Admin, level: PassLevel, id: string, propertyId: string | null): Promise<Row[]> {
  const where = propertyId ? `and(level.eq.${level},entity_id.eq.${id}),and(level.eq.property,entity_id.eq.${propertyId})` : `and(level.eq.${level},entity_id.eq.${id})`;
  const { data, error } = await admin
    .from("amc_documents")
    .select("*")
    .or(where)
    .eq("category", "Gate pass")
    .is("superseded_by", null)
    .order("uploaded_at", { ascending: true });
  /* Before the documents table exists there are no passes, not an error. */
  if (error) return [];
  const rows = (data ?? []) as Row[];
  /* The visit's own first, then the property's. */
  return [...rows.filter((r) => r.level !== "property"), ...rows.filter((r) => r.level === "property")];
}

/** What moves a visit's version when its passes change on the portal. */
const passStampOf = (rows: Row[]) => rows.map((p) => `${str(p.id)}:${str(p.expires_on) ?? ""}:${(str(p.notes) ?? "").length}:${str(p.access_rule_id) ?? ""}:${str(p.access_status) ?? ""}`);

/**
 * The passes as the phone shows them, each with a link to open the file
 * (valid an hour, opened in the browser, not downloaded under its name),
 * where it is filed (this visit, or the property), and its type when the
 * office gave one (the property's access rule it is for).
 */
async function visitPasses(admin: Admin, level: PassLevel, id: string, propertyId: string | null) {
  const rows = await visitPassRows(admin, level, id, propertyId);
  if (!rows.length) return [];
  const ruleIds = [...new Set(rows.map((r) => str(r.access_rule_id)).filter((x): x is string => Boolean(x)))];
  const types = new Map<string, string>();
  if (ruleIds.length) {
    const { data: ruleRows } = await admin.from("amc_property_access_rules").select("id, access_type").in("id", ruleIds);
    for (const r of (ruleRows ?? []) as Row[]) types.set(String(r.id), String(r.access_type));
  }
  const paths = rows.map((r) => String(r.storage_path));
  const { data } = await admin.storage.from(AMC_DOCUMENTS_BUCKET).createSignedUrls(paths, 3600);
  const urlOf = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
  return rows.map((r) => ({
    id: String(r.id),
    file_name: String(r.file_name),
    mime_type: str(r.mime_type),
    valid_until: str(r.expires_on),
    note: str(r.notes),
    /* "property": on file for the property, so for every visit there. */
    scope: r.level === "property" ? ("property" as const) : ("visit" as const),
    access_type: str(r.access_rule_id) ? (types.get(String(r.access_rule_id)) ?? null) : null,
    url: urlOf.get(String(r.storage_path)) ?? null,
  }));
}

/** The property's live equipment, as the phone lists and edits it (the portal's property page, Assets). */
const toPhoneAssets = (assets: AssetRecord[]) =>
  assets
    .filter((x) => x.status === "active")
    .map((x) => ({
      id: x.id,
      assetType: x.assetType,
      trade: x.trade,
      quantity: x.quantity,
      location: x.location,
      make: x.make,
      model: x.model,
      serialNo: x.serialNo,
      capacity: x.capacity,
      installedOn: x.installedOn,
      condition: x.condition,
      notes: x.notes,
    }));

/** The property's live scope of works, as the phone lists and edits it (the portal's property page, Scope). */
const toPhoneScope = (scope: ScopeItemRecord[]) =>
  scope
    .filter((x) => x.active)
    .map((x) => ({
      id: x.id,
      serviceId: x.serviceId,
      trade: x.trade,
      assetId: x.assetId,
      quantity: x.quantity,
      frequencyPerYear: x.frequencyPerYear,
      durationMinutes: x.durationMinutes,
      preferredMonths: x.preferredMonths,
      preferredDays: x.preferredDays,
      exclusions: x.exclusions,
      notes: x.notes,
    }));

/** The property's assets and scope (empty without a property), in one round. */
async function propertyRecords(admin: Admin, propertyId: string | null) {
  if (!propertyId) return { assets: [] as AssetRecord[], scope: [] as ScopeItemRecord[] };
  const [assetList, scopeList] = await Promise.all([listAssets(admin, propertyId), listScope(admin, propertyId)]);
  return { assets: assetList.assets, scope: scopeList.items };
}

/**
 * The property as the office recorded it (its page on the portal): where it
 * is -- building, unit, floor, street, community, city, the map pin -- what
 * it is, its size, zones, occupancy, access constraints and notes. For the
 * crew to read before the visit starts. Null when there is no property or
 * it cannot be read (the visit still opens).
 */
async function propertyBrief(admin: Admin, propertyId: string | null) {
  if (!propertyId) return null;
  const [record, place] = await Promise.all([
    getProperty(admin, propertyId).catch(() => null),
    admin
      .from("snagging_properties")
      .select("location_lat, location_lng, developer_name, built_up_area_sqft, plot_area_sqft, floors, external_areas_in_scope, furnished")
      .eq("id", propertyId)
      .maybeSingle<Row>()
      .then((r) => r.data ?? null, () => null),
  ]);
  if (!record && !place) return null;
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  return {
    label: record?.label ?? null,
    address: record?.address ?? null,
    building: record?.building ?? null,
    unit_no: record?.unitNo ?? null,
    floor: record?.floor ?? null,
    street: record?.street ?? null,
    community: record?.community ?? null,
    city: record?.city ?? null,
    category: record?.propertyCategory ?? null,
    unit_type: record?.unitType ?? null,
    bedrooms: record?.bedrooms ?? num(place?.bedrooms),
    size_sqft: record?.sizeSqft ?? num(place?.built_up_area_sqft),
    plot_sqft: num(place?.plot_area_sqft),
    floors: record?.floorsCount ?? num(place?.floors),
    zones: record?.zones ?? [],
    occupancy: record?.occupancy ?? null,
    access_constraints: record?.accessConstraints ?? null,
    notes: record?.notes ?? null,
    developer: str(place?.developer_name),
    furnished: place?.furnished === true,
    external_areas_in_scope: place?.external_areas_in_scope === true,
    lat: num(place?.location_lat),
    lng: num(place?.location_lng),
  };
}

/** The enquiry a site visit was booked from: what the client asked for, and who asked. */
async function enquiryBrief(admin: Admin, enquiryId: string | null) {
  if (!enquiryId) return null;
  const { data } = await admin
    .from("amc_enquiries")
    .select("enquiry_number, enquired_at, need, area, source, contact_name, contact_phone, preferred_channel, preferred_language")
    .eq("id", enquiryId)
    .maybeSingle<Row>();
  if (!data) return null;
  return {
    number: String(data.enquiry_number),
    enquired_at: str(data.enquired_at),
    need: str(data.need),
    area: str(data.area),
    source: str(data.source),
    contact_name: str(data.contact_name),
    contact_phone: str(data.contact_phone),
    preferred_channel: str(data.preferred_channel),
    preferred_language: str(data.preferred_language),
  };
}

const ACCESS_RULE_COLUMNS = "access_type, issuer, permitted_days, permitted_from, permitted_to, parking, contact_name, contact_phone, notes";
const toPhoneRule = (r: Row) => ({
  access_type: String(r.access_type),
  issuer: str(r.issuer),
  permitted_days: strings(r.permitted_days),
  permitted_from: str(r.permitted_from),
  permitted_to: str(r.permitted_to),
  parking: str(r.parking),
  contact_name: str(r.contact_name),
  contact_phone: str(r.contact_phone),
  notes: str(r.notes),
});

/** The access rules of the visit's property and the crew's names, in one round. */
async function ppmExtras(tech: MobileTechnician, v: Row) {
  const propertyId = str(one(v.contract)?.property_id);
  const [rules, crew, property, passes] = await Promise.all([
    propertyId
      ? tech.admin.from("amc_property_access_rules").select(ACCESS_RULE_COLUMNS).eq("property_id", propertyId).eq("active", true)
      : Promise.resolve({ data: [] as Row[] }),
    crewNames(tech.admin, strings(v.technician_ids), str(v.lead_technician_id), tech.fsmId),
    propertyBrief(tech.admin, propertyId),
    visitPasses(tech.admin, "visit", String(v.id), propertyId),
  ]);
  return { rules: (rules.data ?? []) as Row[], crew, property, passes };
}

/**
 * A planned visit as the phone opens it: the top (when, where, client and
 * access, crew, services), then the job sheet.
 *
 * A later open (the phone sends its version) costs one round when nothing
 * moved: the visit's row, its sheet's stamp and its photo count. A first
 * open has nothing to compare, so everything is read at once -- the sheet
 * with its checklist and photos beside the visit's row, then the access
 * rules and the crew's names as soon as the row is in -- about three
 * database round trips instead of four or more one after another.
 */
async function ppmDetail(tech: MobileTechnician, id: string, version: string | undefined) {
  const { admin } = tech;
  let head: Awaited<ReturnType<typeof ppmHead>>;
  let view: Awaited<ReturnType<typeof jobSheetView>>;
  let extras: Awaited<ReturnType<typeof ppmExtras>>;
  if (version) {
    head = await ppmHead(tech, id);
    if (version === head.current) return { unchanged: true as const, version: head.current, server_time: new Date().toISOString() };
    [view, extras] = await Promise.all([jobSheetView(admin, id, new Date(), 3600), ppmExtras(tech, head.v)]);
  } else {
    const headRead = ppmHead(tech, id);
    /* The crew check (in ppmHead) settles before anything is returned; a refused caller is sent nothing. */
    [head, view, extras] = await Promise.all([headRead, jobSheetView(admin, id, new Date(), 3600), headRead.then((h) => ppmExtras(tech, h.v))]);
  }
  const { v, current } = head;
  const contract = one(v.contract) ?? {};
  const status = String(v.status) as VisitStatus;
  const sheetStatus = view.sheet.status;
  return {
    unchanged: false as const,
    version: current,
    server_time: new Date().toISOString(),
    kind: "ppm" as FieldVisitKind,
    fillable: true,
    /* Only once the office has started the visit (Start visit, 17 Nov 2026). */
    /*
      Open to the crew once the office has started it (18 Nov 2026): still
      planned until they arrive -- Start on the phone stamps the arrival, and
      that puts it in progress -- or in progress.
    */
    can_edit:
      (status === "in_progress" || (PLANNABLE_STATUSES.includes(status) && head.officeStarted)) &&
      (sheetStatus === null || sheetStatus === "draft" || sheetStatus === "returned"),
    waiting_for_start: PLANNABLE_STATUSES.includes(status) && !head.officeStarted,
    visit: {
      id,
      ref: `${String(contract.contract_number ?? contract.proposal_number ?? "")} · V${String(v.visit_no)}`,
      status,
      status_label: VISIT_STATUS_LABELS[status] ?? status,
      scheduled_start: str(v.scheduled_start),
      scheduled_end: str(v.scheduled_end),
      window_start: str(v.window_start),
      window_end: str(v.window_end),
      target_date: str(v.target_date),
      client_confirmation: str(v.client_confirmation),
      access_status: str(v.access_status),
      access_note: str(v.access_note),
      access_valid_until: str(v.access_valid_until),
      assignment_note: str(v.assignment_note),
      summary: null,
      trade: null,
      priority: null,
    },
    client: clientOf(contract),
    access_rules: extras.rules.map(toPhoneRule),
    /* The gate passes and permits for this visit, each with how long it is valid (the portal's Access tab). */
    access_passes: extras.passes,
    /* The property as the office recorded it, for the crew to read before starting. */
    property: extras.property,
    enquiry: null,
    crew: extras.crew,
    services: view.lines.map((l) => ({ id: l.id, label: l.serviceLabel, occurrence: l.occurrence, retry: l.retry })),
    /* The document the phone edits and sends back as it is (lib/amc/job-sheets jobSheetSchema). */
    sheet: view.sheet,
    lines: view.lines.map((l) => ({ lineId: l.id, outcome: l.outcome, outcomeGroup: l.outcomeGroup, outcomeReason: l.outcomeReason })),
    checklist: view.checklist.map((c) => ({ lineId: c.lineId, assetId: c.assetId, label: c.label, category: c.category, result: c.result, note: c.note })),
    photos: view.photos.map((p) => ({ id: p.id, kind: p.kind, category: p.category, line_id: p.lineId, caption: p.caption, url: p.url, created_at: p.createdAt })),
    assets: view.assets,
    outcome_groups: Object.entries(OUTCOME_GROUPS).map(([key, g]) => ({ key, label: g.label, reasons: [...g.reasons] })),
  };
}

const VIEW_DETAIL_COLUMNS =
  "kind, id, ref, contract_id, property_id, contract_number, customer_name, property_label, status, stage, day, due_on, scheduled_start, scheduled_end, technician_ids, lead_technician_id, assessor_id, priority, coverage, trade, summary, client_confirmation, access_status";

/* What a kind keeps on its own table that the view leaves out, read by primary key. */
function kindExtras(admin: Admin, kind: FieldVisitKind, id: string): PromiseLike<{ data: Row | null }> {
  switch (kind) {
    case "call_out":
      return admin
        .from("amc_call_outs")
        .select("on_site_contact_name, on_site_contact_phone, status, attended_at, diagnosis, resolution, parts_needed, pending_works, updated_at, started_at")
        .eq("id", id)
        .maybeSingle<Row>();
    case "additional_work":
      return admin.from("amc_additional_works").select("status, finding, risk, completed_at, updated_at, started_at").eq("id", id).maybeSingle<Row>();
    case "site_visit":
      return admin.from("amc_assessments").select("access_notes, summary, notes").eq("id", id).maybeSingle<Row>();
    default:
      return Promise.resolve({ data: null });
  }
}

/**
 * A call out, additional work or site visit: the same top as a planned
 * visit, read from the visits view (one row) with the kind's own few
 * fields beside it, by primary key, in the same round trip -- a site visit
 * (no crew) opens in one database round, a call out or additional work in
 * two (the crew's names). A call out and an additional work are filled in
 * by their crew (the call out's report, the work's completion, photos).
 */
/* What the crew can still change from the phone: a call out until it is resolved, an additional work until it is completed. */
const CALL_OUT_EDITABLE = ["scheduled", "attended", "pending_works"];
const WORK_EDITABLE = ["scheduled"];

async function viewDetail(tech: MobileTechnician, kind: FieldVisitKind, id: string, version: string | undefined) {
  const { admin } = tech;
  const workOwner = kind === "call_out" ? "call_out_id" : kind === "additional_work" ? "additional_work_id" : null;
  const [{ data, error }, extra, photoStamp] = await Promise.all([
    admin.from("amc_field_visits").select(VIEW_DETAIL_COLUMNS).eq("kind", kind).eq("id", id).maybeSingle<Row>(),
    kindExtras(admin, kind, id),
    /* The photos' count and latest, for the version (a photo added on the portal moves it). */
    workOwner
      ? admin.from("amc_work_photos").select("created_at", { count: "exact" }).eq(workOwner, id).order("created_at", { ascending: false }).limit(1)
      : Promise.resolve({ count: 0, data: [] as Row[] }),
  ]);
  if (error) throw new ContractError(error.message, isMissingTable(error) ? 404 : 500);
  /* Checked before anything is returned: a caller not on the crew (nor the assessor) is sent nothing. */
  if (!data || !(onCrew(data, tech.fsmId) || str(data.assessor_id) === tech.userId)) throw new ContractError("Visit not found.", 404);
  const more = extra.data ?? {};
  /* A call out's or additional work's job sheet (18 Nov 2026): its state moves the version (a supervisor's return). Missing before 20261118100000. */
  const propertyId = str(data.property_id);
  /*
    Beside the sheet's state: the visit's passes and its property's access
    rules (18 Nov 2026), which change on the portal without touching the
    call out or the work, so they move the version too.
  */
  const [sheetStamp, passStamp, ruleStamp, chargeRead] = workOwner
    ? await Promise.all([
        admin.from("amc_visit_job_sheets").select("status, updated_at").eq(workOwner, id).maybeSingle<Row>().then((r) => (r.error ? null : (r.data ?? null))),
        visitPassRows(admin, passLevelOf(kind), id, propertyId).then(passStampOf),
        propertyId
          ? admin.from("amc_property_access_rules").select("updated_at").eq("property_id", propertyId).eq("active", true).then((r) => (r.data ?? []).map((x) => (x as Row).updated_at))
          : Promise.resolve([] as unknown[]),
        /* Its services and what they cost (18 Nov 2026, migration 20261118130000): none before it. */
        readCharge(admin, kind as "call_out" | "additional_work", id)
          .then((r) => r.charge)
          .catch(() => null),
      ])
    : [null, [], [], null];
  const charge: VisitCharge | null = chargeRead;
  const current =
    "w6|" +
    createHash("sha1")
      .update(JSON.stringify([data, more, photoStamp.count ?? 0, (photoStamp.data?.[0] as Row | undefined)?.created_at ?? null, sheetStamp, passStamp, ruleStamp, charge]))
      .digest("hex")
      .slice(0, 20);
  if (version && version === current) return { unchanged: true as const, version: current, server_time: new Date().toISOString() };
  const contractId = str(data.contract_id);
  /*
    What a planned visit shows before the crew starts (18 Nov 2026), for a
    call out or additional work too: the client and their contacts from the
    contract, the property as the office recorded it, its access rules, and
    the passes for this visit.
  */
  const [crew, photos, fieldSheet, contract, property, rules, passes] = await Promise.all([
    crewNames(admin, strings(data.technician_ids), str(data.lead_technician_id), tech.fsmId),
    kind === "call_out"
      ? workPhotos(admin, { callOutId: id }, 3600)
      : kind === "additional_work"
        ? workPhotos(admin, { additionalWorkId: id }, 3600)
        : Promise.resolve([]),
    /* Its job sheet, as a planned visit's (18 Nov 2026); none before 20261118100000. */
    kind === "call_out" || kind === "additional_work" ? fieldJobSheetView(admin, kind, id, new Date(), 3600).catch(() => null) : Promise.resolve(null),
    workOwner && contractId
      ? admin
          .from("amc_contracts")
          .select("contract_number, proposal_number, customer_name, customer, property_label, property, property_id")
          .eq("id", contractId)
          .maybeSingle<Row>()
          .then((r) => r.data ?? null)
      : Promise.resolve(null),
    workOwner ? propertyBrief(admin, propertyId) : Promise.resolve(null),
    workOwner && propertyId
      ? admin.from("amc_property_access_rules").select(ACCESS_RULE_COLUMNS).eq("property_id", propertyId).eq("active", true).then((r) => (r.data ?? []) as Row[])
      : Promise.resolve([] as Row[]),
    workOwner ? visitPasses(admin, passLevelOf(kind), id, propertyId) : Promise.resolve([]),
  ]);
  const ownStatus = str(more.status);
  /*
    Start visit (17 Nov 2026): a call out not yet attended, or an additional
    work, opens for the crew once the office has started it (the view reads
    it as in progress then).
  */
  /* The office's Start visit (18 Nov 2026): its own column; "in progress" is the crew being on site. */
  const started = Boolean(str(more.started_at)) || data.stage === "in_progress" || data.stage === "review";
  const waitingForStart = (kind === "call_out" && (ownStatus === "scheduled" || ownStatus === "logged") && !started) || (kind === "additional_work" && ownStatus === "scheduled" && !started);
  const canEdit =
    (kind === "call_out" ? CALL_OUT_EDITABLE.includes(ownStatus ?? "") : kind === "additional_work" ? WORK_EDITABLE.includes(ownStatus ?? "") : false) && !waitingForStart;
  const contact = kind === "call_out" ? { data: more } : { data: null as Row | null };
  const status = String(data.status);
  return {
    unchanged: false as const,
    version: current,
    server_time: new Date().toISOString(),
    kind,
    fillable: FILLABLE_KINDS.includes(kind),
    can_edit: canEdit,
    waiting_for_start: waitingForStart,
    visit: {
      id,
      ref: String(data.ref),
      status,
      status_label: fieldVisitStatusLabel(kind, status),
      stage: data.stage as FieldVisitStage,
      scheduled_start: str(data.scheduled_start),
      scheduled_end: str(data.scheduled_end),
      window_start: null,
      window_end: str(data.due_on),
      target_date: str(data.day),
      client_confirmation: str(data.client_confirmation),
      access_status: str(data.access_status),
      access_note: str(more.access_notes),
      access_valid_until: null,
      assignment_note: null,
      summary: str(data.summary) ?? str(more.summary) ?? str(more.notes),
      trade: str(data.trade),
      priority: str(data.priority),
    },
    client: (() => {
      /* The call out's own on-site contact first, then the client's contacts on the contract (as a planned visit). */
      const onSite =
        contact.data && (str(contact.data.on_site_contact_name) || str(contact.data.on_site_contact_phone))
          ? [{ name: str(contact.data.on_site_contact_name), phone: str(contact.data.on_site_contact_phone), role: "On site" }]
          : [];
      const fromContract = contract ? clientOf(contract) : null;
      return {
        name: str(data.customer_name) ?? fromContract?.name ?? null,
        phone: fromContract?.phone ?? null,
        property: str(data.property_label),
        address: fromContract?.address ?? null,
        contacts: [...onSite, ...(fromContract?.contacts ?? [])].slice(0, 6),
      };
    })(),
    access_rules: rules.map(toPhoneRule),
    /* The gate passes and permits the office added for this visit (the portal's Access tab). */
    access_passes: passes,
    /* The property as the office recorded it, for the crew to read before starting. */
    property,
    /*
      The services the office set on the call out or additional work and what
      they cost the client (the portal's Services and Payments), so the crew
      knows what is charged and whether to collect payment.
    */
    charge: charge
      ? {
          lines: charge.lines.map((l) => ({ label: l.label, unit: l.unit, units: l.units, unit_price: l.unitPrice, charged: l.charged })),
          subtotal: charge.subtotal,
          vat_amount: charge.vatAmount,
          total: charge.total,
          status: charge.status,
          status_label: CHARGE_STATUS_LABELS[charge.status] ?? charge.status,
          payment_timing: charge.paymentTiming,
          payment_timing_label: charge.paymentTiming ? PAYMENT_TIMING_LABELS[charge.paymentTiming] : null,
          payment_timing_reason: charge.paymentTimingReason,
          paid_amount: charge.paidAmount,
          paid_on: charge.paidOn,
        }
      : null,
    crew,
    services: fieldSheet?.migrated ? fieldSheet.lines.map((l) => ({ id: l.id, label: l.serviceLabel, occurrence: l.occurrence, retry: l.retry })) : [],
    /* The job sheet (18 Nov 2026): the same document as a planned visit's, with the work as its one line. */
    sheet_ready: Boolean(fieldSheet?.migrated),
    sheet: fieldSheet?.migrated ? fieldSheet.sheet : null,
    lines: fieldSheet?.migrated ? fieldSheet.lines.map((l) => ({ lineId: l.id, outcome: l.outcome, outcomeGroup: l.outcomeGroup, outcomeReason: l.outcomeReason })) : [],
    checklist: fieldSheet?.migrated ? fieldSheet.checklist.map((c) => ({ lineId: c.lineId, assetId: c.assetId, label: c.label, category: c.category, result: c.result, note: c.note })) : [],
    photos: photos.map((p) => ({ id: p.id, kind: p.kind, category: p.category, line_id: null, caption: p.caption, url: p.url, created_at: p.createdAt })),
    assets: fieldSheet?.assets ?? [],
    outcome_groups: fieldSheet?.migrated ? Object.entries(OUTCOME_GROUPS).map(([key, g]) => ({ key, label: g.label, reasons: [...g.reasons] })) : [],
    /* The call out's report as it stands (the portal's record action), for the crew to fill in. */
    callout:
      kind === "call_out"
        ? {
            status: ownStatus,
            attended_at: str(more.attended_at),
            diagnosis: str(more.diagnosis),
            resolution: str(more.resolution),
            parts_needed: str(more.parts_needed),
            pending_works: Array.isArray(more.pending_works) ? (more.pending_works as { description: string; reason: string }[]) : [],
          }
        : null,
    /* The additional work: what was found (to do), and whether it is done. */
    work: kind === "additional_work" ? { status: ownStatus, finding: str(more.finding), risk: str(more.risk), completed_at: str(more.completed_at) } : null,
  };
}

/* ------------------------------------------------------------------ */
/* A site visit (an assessment), for its assessor                      */
/* ------------------------------------------------------------------ */

const SITE_STATUS_LABELS: Record<string, string> = { draft: "Draft", completed: "Completed" };
/* Bumped when the site visit payload gains fields (13 Nov 2026: s2 assets and scope; s3 photo categories and each service's visits a year; s4 each service's trade; s5 the property brief, its access rules and the enquiry; s6 its approval, 16 Nov). */
const SITE_PAYLOAD = "s6|";

/* After the office's checklist (sort orders from the AMC checklist settings). */
const CUSTOM_SORT_FROM = 100_000;

/**
 * The checks the assessor added on site, made to match the phone's list:
 * new ones inserted, changed ones relabelled, removed ones deleted. Only
 * "custom-" rows are ever touched -- the office's checklist rows are
 * answered, never added or removed, from the phone. A completed site visit
 * refuses all of it (the rows' own trigger), as the portal does.
 */
async function syncCustomItems(admin: Admin, assessmentId: string, items: NonNullable<SiteFormInput["customItems"]>) {
  const { data: existing, error } = await admin
    .from("amc_assessment_items")
    .select("item_key")
    .eq("assessment_id", assessmentId)
    .like("item_key", "custom-%");
  if (error) throw new ContractError(error.message, 500);
  const keep = new Set(items.map((i) => i.itemKey));
  const gone = ((existing ?? []) as Row[]).map((r) => String(r.item_key)).filter((k) => !keep.has(k));
  const locked = (e: { code?: string; message: string }) =>
    new ContractError(e.code === "23514" ? "A completed site visit cannot be changed." : e.message, e.code === "23514" ? 409 : 500);
  /*
    The assessor builds the checklist on site (the user's decision, 13 Nov
    2026): the office's preset checks nobody answered are taken off this
    visit, so they neither show on the phone nor hold up completing it. An
    office check that was answered stays, with its answer.
  */
  const { error: presetError } = await admin
    .from("amc_assessment_items")
    .delete()
    .eq("assessment_id", assessmentId)
    .not("item_key", "like", "custom-%")
    .is("result", null);
  if (presetError) throw locked(presetError);
  if (gone.length) {
    const { error: deleteError } = await admin.from("amc_assessment_items").delete().eq("assessment_id", assessmentId).in("item_key", gone);
    if (deleteError) throw locked(deleteError);
  }
  if (items.length) {
    const { error: upsertError } = await admin.from("amc_assessment_items").upsert(
      items.map((i, n) => ({
        assessment_id: assessmentId,
        item_key: i.itemKey,
        category_key: "custom",
        category_label: i.categoryLabel,
        label: i.label,
        sort_order: CUSTOM_SORT_FROM + n,
      })),
      { onConflict: "assessment_id,item_key", ignoreDuplicates: false },
    );
    if (upsertError) throw locked(upsertError);
  }
}

/** The site visit's stamp and photo count, in one round; refuses anyone but its assessor. */
async function siteHead(tech: MobileTechnician, id: string): Promise<{ row: Row; current: string }> {
  const [read, photos] = await Promise.all([
    tech.admin.from("amc_assessments").select("id, status, assessor_id, property_id, updated_at").eq("id", id).maybeSingle<Row>(),
    tech.admin.from("amc_assessment_photos").select("created_at", { count: "exact" }).eq("assessment_id", id).order("created_at", { ascending: false }).limit(1),
  ]);
  if (read.error) throw new ContractError(read.error.message, 500);
  const row = read.data;
  if (!row || str(row.assessor_id) !== tech.userId) throw new ContractError("Visit not found.", 404);
  /*
    The property's assets and scope are part of the visit on the phone, so
    an office edit to them (added, changed, retired, taken out of scope)
    moves the version too: each list's row count and latest change, read by
    the property index, beside each other.
  */
  const propertyId = str(row.property_id);
  const stamp = async (table: "amc_property_assets" | "amc_scope_items") => {
    if (!propertyId) return "-";
    const { data, count } = await tech.admin.from(table).select("updated_at", { count: "exact" }).eq("property_id", propertyId).order("updated_at", { ascending: false }).limit(1);
    return `${count ?? 0}:${str((data?.[0] as Row | undefined)?.updated_at) ?? "-"}`;
  };
  /* With the scope and asset changes held on the visit until its approver approves (16 Nov 2026). */
  const [assets, scope, held] = await Promise.all([stamp("amc_property_assets"), stamp("amc_scope_items"), heldSiteStamp(tech.admin, id)]);
  /* The payload's shape is part of the version: a phone holding an older shape fetches the visit again once. */
  const current =
    SITE_PAYLOAD +
    detailVersion({
      visitUpdatedAt: str(row.updated_at),
      sheetUpdatedAt: str(row.status),
      photoCount: photos.count ?? 0,
      latestPhotoAt: str((photos.data?.[0] as Row | undefined)?.created_at),
    }) +
    `|a${assets}|s${scope}|h${held}`;
  return { row, current };
}

/**
 * A site visit as its assessor opens it: when and where, the client, and
 * the survey to fill in (attendance, the property, the checklist, the
 * services to recommend with their unit counts, notes, photos). A later
 * open with the same version costs one round; a first open reads the
 * survey, its photos and the services catalogue at once (two rounds with
 * the photo links).
 */
async function siteDetail(tech: MobileTechnician, id: string, version: string | undefined) {
  const { admin } = tech;
  /*
    The survey, its photos and the catalogue at once; the property's assets
    and scope as soon as the survey says which property (beside the photo
    links), so a first open stays two database rounds.
  */
  const read = async () => {
    const survey = getAssessment(admin, id);
    /* As soon as the survey says which property and enquiry: its assets and scope, its record, its access rules, the enquiry. */
    const around = survey.then(async (found) => {
      const propertyId = found.property?.id ?? null;
      const [records, brief, rules, enquiry] = await Promise.all([
        /* The property's assets and scope with this visit's held changes laid over them (16 Nov 2026). */
        Promise.all([propertyRecords(admin, propertyId), heldSiteChanges(admin, id)]).then(([records, held]) => withHeldChanges(records.assets, records.scope, held)),
        propertyBrief(admin, propertyId),
        propertyId
          ? admin.from("amc_property_access_rules").select(ACCESS_RULE_COLUMNS).eq("property_id", propertyId).eq("active", true).then((r) => (r.data ?? []) as Row[])
          : Promise.resolve([] as Row[]),
        enquiryBrief(admin, found.enquiryId),
      ]);
      return { ...records, brief, rules, enquiry };
    });
    const [a, photoList, settings, place] = await Promise.all([survey, listAssessmentPhotos(admin, id, 3600), readAmcSettings(admin), around]);
    return { a, photos: photoList.photos, settings, assets: place.assets, scope: place.scope, brief: place.brief, rules: place.rules, enquiry: place.enquiry };
  };
  let head: { row: Row; current: string };
  let parts: Awaited<ReturnType<typeof read>>;
  if (version) {
    head = await siteHead(tech, id);
    if (version === head.current) return { unchanged: true as const, version: head.current, server_time: new Date().toISOString() };
    parts = await read();
  } else {
    /* The assessor check (siteHead) settles before anything is returned. */
    [head, parts] = await Promise.all([siteHead(tech, id), read()]);
  }
  const { a, photos, settings, assets, scope, brief, rules, enquiry } = parts;
  const status = a.status;
  const approvalState = siteApprovalState(a);
  return {
    unchanged: false as const,
    version: head.current,
    server_time: new Date().toISOString(),
    kind: "site_visit" as FieldVisitKind,
    fillable: true,
    can_edit: status === "draft",
    visit: {
      id,
      ref: a.assessmentNumber,
      /* As its card says it (sent back, awaiting approval, approved); the survey keeps draft / completed below. */
      status: approvalState ?? status,
      status_label: approvalState ? SITE_APPROVAL_LABELS[approvalState] : (SITE_STATUS_LABELS[status] ?? status),
      scheduled_start: a.scheduledAt,
      scheduled_end: null,
      window_start: null,
      window_end: null,
      target_date: a.assessedOn ?? (a.scheduledAt ? a.scheduledAt.slice(0, 10) : null),
      client_confirmation: null,
      access_status: null,
      access_note: null,
      access_valid_until: null,
      assignment_note: null,
      summary: null,
      trade: null,
      priority: null,
    },
    client: {
      name: a.customer?.name ?? null,
      phone: a.customer?.phone ?? null,
      property: a.property?.label ?? null,
      address: null,
      contacts: [],
    },
    /* Who approves it and where that stands; a sent-back visit carries the approver's reason (16 Nov 2026). */
    approval: {
      state: approvalState,
      approver: a.approverName,
      approved_at: a.approvedAt,
      sent_back_at: a.sentBackAt,
      reason: approvalState === "sent_back" ? a.sentBackReason : null,
    },
    /* The property's access rules apply to a site visit as much as to a planned one. */
    access_rules: rules.map(toPhoneRule),
    property: brief,
    enquiry,
    crew: [],
    services: [],
    sheet: null,
    lines: [],
    checklist: [],
    photos: photos.map((p) => ({ id: p.id, kind: "other", category: p.category, line_id: null, caption: p.caption, url: p.url, created_at: p.createdAt })),
    assets: [],
    outcome_groups: [],
    /* The survey the phone edits and sends back as it is (lib/amc/mobile-sync siteFormSchema). */
    site: {
      status,
      attendance: a.attendance,
      assessedOn: a.assessedOn,
      unitType: a.unitType,
      propertyCategory: a.propertyCategory,
      bedrooms: a.bedrooms,
      sizeSqft: a.sizeSqft,
      occupancy: a.occupancy,
      accessNotes: a.accessNotes,
      exclusions: a.exclusions,
      summary: a.summary,
      findings: a.findings,
      notes: a.notes,
      recommendedServiceIds: a.recommendedServiceIds,
      assetCounts: a.assetCounts,
      items: a.items.map((i) => ({ itemKey: i.itemKey, categoryLabel: i.categoryLabel, label: i.label, result: i.result, notes: i.notes })),
      hasProperty: Boolean(a.property),
    },
    /* The property's equipment and scope of works, live ones only, as the portal's property page keeps them. */
    property_assets: toPhoneAssets(assets),
    property_scope: toPhoneScope(scope),
    /* What can be recommended: the AMC catalogue, only what the picker shows. */
    /*
      Each service's trade and visits a year, filled in when it is added to
      scope. The trade is the visits' own rule (lib/amc/visits), which reads
      the name too: the property page's id-prefix rule called "Coil
      Cleaning" (coil-cleaning) "Other".
    */
    catalogue: settings.services
      .filter((svc) => svc.enabled !== false)
      .map((svc) => ({
        id: svc.id,
        label: svc.label,
        category: svc.category ?? null,
        unit: svc.unitOfMeasure ?? null,
        trade: tradeForService(svc.id, svc.label),
        frequency_per_year: svc.frequencyPerYear ?? null,
      })),
  };
}

export async function mobileVisitDetail(tech: MobileTechnician, kind: FieldVisitKind, id: string, version: string | undefined) {
  if (kind === "ppm") return ppmDetail(tech, id, version);
  if (kind === "site_visit") return siteDetail(tech, id, version);
  return viewDetail(tech, kind, id, version);
}

/* ------------------------------------------------------------------ */
/* Push: the outbox, in order, in one request                          */
/* ------------------------------------------------------------------ */

/**
 * Applies the phone's queued AMC changes in the order they were made.
 *
 * Each change is idempotent on its own: a sheet save replaces the draft, a
 * submit of a sheet already with the supervisor is "already done", a photo
 * carries its own id. Order matters within a visit -- the before and after
 * photos have to be on the sheet before it is submitted -- so once one
 * change to a visit does not go through, the rest for that visit wait
 * (retry) rather than run ahead of it.
 */
export async function applyMobilePush(tech: MobileTechnician, raw: unknown[], files: Map<string, Uint8Array>) {
  const { admin } = tech;
  const results: MobileResult[] = [];
  /* Read every change first (for the crew check below), then apply them strictly in the order sent. */
  const items = raw.map((item) => ({ item, read: parseMobileMutation(item) }));
  const parsed = items.flatMap((i) => (i.read.ok ? [i.read.value] : []));

  /*
    Every visit the batch touches, checked at once: a planned visit against
    its crew, a site visit against its assessor (one query each, together).
  */
  const visitIds = [...new Set(parsed.filter((m) => !isSiteMutation(m) && !workOf(m)).map(mutationVisit))];
  const siteIds = [...new Set(parsed.filter(isSiteMutation).map(mutationVisit))];
  /* Call outs and additional works: their crew, from the visits view (both carry technician_ids and a lead). */
  const workIds = [...new Set(parsed.filter((m) => workOf(m)).map(mutationVisit))];
  const onTheCrew = new Set<string>();
  const [visitsRead, sitesRead, worksRead] = await Promise.all([
    visitIds.length ? admin.from("amc_visits").select("id, technician_ids, lead_technician_id").in("id", visitIds) : null,
    siteIds.length ? admin.from("amc_assessments").select("id, assessor_id").in("id", siteIds) : null,
    workIds.length
      ? admin.from("amc_field_visits").select("id, technician_ids, lead_technician_id").in("kind", ["call_out", "additional_work"]).in("id", workIds)
      : null,
  ]);
  if (visitsRead?.error) throw new ContractError(visitsRead.error.message, 500);
  if (sitesRead?.error) throw new ContractError(sitesRead.error.message, 500);
  if (worksRead?.error) throw new ContractError(worksRead.error.message, 500);
  for (const v of (visitsRead?.data ?? []) as Row[]) if (onCrew(v, tech.fsmId)) onTheCrew.add(String(v.id));
  for (const w of (worksRead?.data ?? []) as Row[]) if (onCrew(w, tech.fsmId)) onTheCrew.add(String(w.id));
  for (const a of (sitesRead?.data ?? []) as Row[]) if (str(a.assessor_id) === tech.userId) onTheCrew.add(String(a.id));
  /* A technician edits a site visit as its assessor, never as an approver. */
  const who = { userId: tech.userId, canApprove: false };
  /* A site visit's property and state, read once per visit in the batch (assets and scope go on its property). */
  const sites = new Map<string, Promise<Row | null>>();
  const siteOf = (id: string) => {
    if (!sites.has(id)) {
      sites.set(
        id,
        Promise.resolve(admin.from("amc_assessments").select("property_id, status, assessment_number").eq("id", id).maybeSingle<Row>()).then((r) => r.data ?? null),
      );
    }
    return sites.get(id)!;
  };
  /* Where an asset or scope change goes: the site visit's own property, while the visit is a draft. */
  const siteProperty = async (id: string) => {
    const site = await siteOf(id);
    if (!site || site.status !== "draft") throw new ContractError("A completed site visit's property is changed on the portal.", 409);
    const propertyId = str(site.property_id);
    if (!propertyId) throw new ContractError("The office has to choose the property first.", 409);
    return { propertyId, where: `site visit ${String(site.assessment_number ?? "")}`.trim() };
  };


  const actor = { id: tech.userId, label: tech.label };
  let config: Awaited<ReturnType<typeof readAmcConfig>> | null = null;
  const amcConfig = async () => (config ??= await readAmcConfig(admin));
  const blocked = new Set<string>();

  for (const { item, read } of items) {
    if (!read.ok) {
      /* Refused for good: what the phone sent cannot become valid by sending it again. */
      const id = (item as { mutation_id?: unknown })?.mutation_id;
      if (typeof id === "string") results.push({ mutation_id: id, status: "rejected", error: read.error });
      continue;
    }
    const m = read.value;
    const visitId = mutationVisit(m);
    const result = (status: MobileResult["status"], message?: string): void => {
      results.push({ mutation_id: m.mutation_id, status, ...(message ? { error: message } : {}) });
      if (status === "retry" || status === "rejected") blocked.add(visitId);
    };
    if (blocked.has(visitId)) {
      results.push({ mutation_id: m.mutation_id, status: "retry", error: WAITING_FOR_EARLIER });
      continue;
    }
    if (!onTheCrew.has(visitId)) {
      result("rejected", isSiteMutation(m) ? "You are not this site visit's assessor any more." : "You are not on this visit's crew any more.");
      continue;
    }
    try {
      switch (m.entity) {
        case "amc_sheet": {
          const fieldKind = workOf(m);
          try {
            if (fieldKind) await saveFieldJobSheet(admin, fieldKind, visitId, m.payload.sheet, actor, await amcConfig(), false);
            else await saveJobSheet(admin, visitId, m.payload.sheet, actor, await amcConfig(), false);
            result("applied");
          } catch (e) {
            /* The sheet moved on (submitted, or the visit closed): a draft save no longer has anywhere to go. */
            if (e instanceof ContractError && e.status === 409) result("duplicate", e.message);
            else throw e;
          }
          break;
        }
        case "amc_submit": {
          /* A call out's or additional work's sheet is found by its own owner column (18 Nov 2026). */
          const fieldKind = workOf(m);
          const owner = fieldKind === "call_out" ? "call_out_id" : fieldKind === "additional_work" ? "additional_work_id" : "visit_id";
          const { data: sheet } = await admin.from("amc_visit_job_sheets").select("status").eq(owner, visitId).maybeSingle<Row>();
          if (sheet?.status === "submitted" || sheet?.status === "closed") {
            result("duplicate");
            break;
          }
          if (fieldKind) await saveFieldJobSheet(admin, fieldKind, visitId, m.payload.sheet, actor, await amcConfig(), true);
          else await saveJobSheet(admin, visitId, m.payload.sheet, actor, await amcConfig(), true);
          result("applied");
          break;
        }
        case "amc_photo": {
          if (m.op === "update") {
            const { data: sheet } = await admin.from("amc_visit_job_sheets").select("status").eq("visit_id", visitId).maybeSingle<Row>();
            if (sheet && sheet.status !== "draft" && sheet.status !== "returned") throw new ContractError("The job sheet is with the supervisor.", 409);
            const base: Record<string, unknown> = { caption: m.payload.caption ?? null };
            if (m.payload.kind) base.kind = m.payload.kind;
            const update = (patch: Record<string, unknown>) => admin.from("amc_visit_photos").update(patch).eq("id", m.entity_id).eq("visit_id", visitId);
            let { error: photoError } = await update(m.payload.category !== undefined ? { ...base, category: m.payload.category } : base);
            /* Before migration 20261113100000 there is no category column: the description still goes in. */
            if (m.payload.category !== undefined && noCategoryColumn(photoError)) ({ error: photoError } = await update(base));
            if (photoError) throw new ContractError(photoError.message, 500);
            result("applied");
            break;
          }
          if (m.op === "delete") {
            try {
              await removeVisitPhoto(admin, visitId, m.entity_id);
              result("applied");
            } catch (e) {
              if (e instanceof ContractError && e.status === 404) result("duplicate");
              else throw e;
            }
            break;
          }
          const bytes = files.get(m.entity_id);
          if (!bytes) {
            const { data: existing } = await admin.from("amc_visit_photos").select("id").eq("id", m.entity_id).maybeSingle<Row>();
            if (existing) result("duplicate");
            else result("retry", "The photo file did not arrive with the change.");
            break;
          }
          const added = await addVisitPhoto(
            admin,
            visitId,
            { id: m.entity_id, bytes, kind: m.payload.kind, lineId: m.payload.line_id ?? null, caption: m.payload.caption ?? null, category: m.payload.category ?? null },
            actor,
          );
          result(added.duplicate ? "duplicate" : "applied");
          break;
        }
        case "amc_site": {
          try {
            const { customItems, ...patch } = m.payload.site;
            /* The rows first, so their answers (in patch.items) have somewhere to land. */
            if (customItems) await syncCustomItems(admin, visitId, customItems);
            await updateAssessment(admin, who, visitId, patch);
            result("applied");
          } catch (e) {
            /* Completed meanwhile: a draft save no longer has anywhere to go. */
            if (e instanceof ContractError && e.status === 409) result("duplicate", e.message);
            else throw e;
          }
          break;
        }
        case "amc_site_complete": {
          const { data: current } = await admin.from("amc_assessments").select("status").eq("id", visitId).maybeSingle<Row>();
          if (current?.status === "completed") {
            result("duplicate");
            break;
          }
          const completed = await completeAssessment(admin, who, visitId, actor);
          /* Its approver is told it is ready for them (16 Nov 2026). */
          await notifyApproverReady(admin, completed).catch(() => undefined);
          result("applied");
          break;
        }
        case "amc_site_photo": {
          if (m.op === "update") {
            const site = await siteOf(visitId);
            if (site?.status !== "draft") throw new ContractError("A completed site visit's photos are kept as they are.", 409);
            await setAssessmentPhotoDetails(admin, visitId, m.entity_id, { caption: m.payload.caption, category: m.payload.category });
            result("applied");
            break;
          }
          if (m.op === "delete") {
            try {
              await removeAssessmentPhoto(admin, who, visitId, m.entity_id, actor);
              result("applied");
            } catch (e) {
              if (e instanceof ContractError && e.status === 404) result("duplicate");
              else throw e;
            }
            break;
          }
          const bytes = files.get(m.entity_id);
          if (!bytes) {
            const { data: existing } = await admin.from("amc_assessment_photos").select("id").eq("id", m.entity_id).maybeSingle<Row>();
            if (existing) result("duplicate");
            else result("retry", "The photo file did not arrive with the change.");
            break;
          }
          const added = await addAssessmentPhoto(admin, who, visitId, { id: m.entity_id, bytes, caption: m.payload.caption ?? null, category: m.payload.category ?? null }, actor);
          result(added.duplicate ? "duplicate" : "applied");
          break;
        }
        case "amc_asset": {
          const { propertyId, where } = await siteProperty(visitId);
          /* Held on the visit until its approver approves; the property only gets them then (16 Nov 2026). */
          if (await holdSiteChange(admin, visitId, { entity: "asset", op: m.op, targetId: m.entity_id, payload: m.op === "delete" ? undefined : (m.payload.asset as Record<string, unknown>) }, tech.userId)) {
            result("applied");
            break;
          }
          if (m.op === "insert") {
            const added = await createAsset(admin, propertyId, m.payload.asset, actor, m.entity_id);
            result(added.duplicate ? "duplicate" : "applied");
          } else if (m.op === "update") {
            await updateAsset(admin, propertyId, m.entity_id, m.payload.asset, actor);
            result("applied");
          } else {
            /* Retired, never deleted, as on the portal: its history stays. */
            try {
              await retireAsset(admin, propertyId, m.entity_id, `Removed on ${where}`, actor);
              result("applied");
            } catch (e) {
              if (e instanceof ContractError && e.status === 404) result("duplicate");
              else throw e;
            }
          }
          break;
        }
        case "amc_scope": {
          const { propertyId } = await siteProperty(visitId);
          /* Held on the visit until its approver approves; the property only gets them then (16 Nov 2026). */
          if (await holdSiteChange(admin, visitId, { entity: "scope", op: m.op, targetId: m.entity_id, payload: m.op === "delete" ? undefined : (m.payload.scope as Record<string, unknown>) }, tech.userId)) {
            result("applied");
            break;
          }
          if (m.op === "insert") {
            const added = await createScopeItem(admin, propertyId, m.payload.scope, actor, m.entity_id);
            result(added.duplicate ? "duplicate" : "applied");
          } else if (m.op === "update") {
            await updateScopeItem(admin, propertyId, m.entity_id, m.payload.scope, actor);
            result("applied");
          } else {
            /* Taken out of scope (inactive), as the portal's Remove does: never deleted. */
            const { data: off, error: offError } = await admin
              .from("amc_scope_items")
              .update({ active: false, updated_at: new Date().toISOString() })
              .eq("id", m.entity_id)
              .eq("property_id", propertyId)
              .select("id");
            if (offError) throw new ContractError(offError.message, 500);
            if (off?.length) {
              await recordAmcAudit(admin, {
                entityType: "property",
                entityId: propertyId,
                eventType: "scope_item_removed",
                actorId: actor.id,
                actorLabel: actor.label,
                payload: { scopeItemId: m.entity_id },
              });
            }
            result(off?.length ? "applied" : "duplicate");
          }
          break;
        }
        case "amc_callout_attend": {
          /* Already attended (or further on): the attendance is there. */
          const { data: co } = await admin.from("amc_call_outs").select("status").eq("id", visitId).maybeSingle<Row>();
          if (co && co.status !== "logged" && co.status !== "scheduled") {
            result("duplicate");
            break;
          }
          await performCallOutAction(admin, visitId, { action: "attend", attendedAt: m.payload.attended_at }, actor, await amcConfig());
          result("applied");
          break;
        }
        case "amc_callout_record": {
          const { data: co } = await admin.from("amc_call_outs").select("status").eq("id", visitId).maybeSingle<Row>();
          if (co?.status === "resolved" || co?.status === "closed") {
            result("duplicate");
            break;
          }
          const r = m.payload.report;
          await performCallOutAction(
            admin,
            visitId,
            {
              action: "record",
              diagnosis: r.diagnosis ?? undefined,
              resolution: r.resolution ?? undefined,
              partsNeeded: r.partsNeeded ?? undefined,
              minutesOnSite: r.minutesOnSite,
              pendingWorks: r.pendingWorks,
              outcome: r.outcome,
            } as Parameters<typeof performCallOutAction>[2],
            actor,
            await amcConfig(),
          );
          result("applied");
          break;
        }
        case "amc_work_complete": {
          const { data: w } = await admin.from("amc_additional_works").select("status").eq("id", visitId).maybeSingle<Row>();
          if (w && ["completed", "invoiced", "paid"].includes(String(w.status))) {
            result("duplicate");
            break;
          }
          await performWorkAction(admin, visitId, { action: "complete", completedAt: m.payload.completed_at }, actor, await amcConfig());
          result("applied");
          break;
        }
        case "amc_work_photo": {
          const owner = m.payload.visit_kind === "call_out" ? { callOutId: visitId } : { additionalWorkId: visitId };
          const column = m.payload.visit_kind === "call_out" ? "call_out_id" : "additional_work_id";
          if (m.op === "update") {
            const base: Record<string, unknown> = { caption: m.payload.caption ?? null };
            if (m.payload.kind) base.kind = m.payload.kind;
            const update = (patch: Record<string, unknown>) => admin.from("amc_work_photos").update(patch).eq("id", m.entity_id).eq(column, visitId);
            let { error: photoError } = await update(m.payload.category !== undefined ? { ...base, category: m.payload.category } : base);
            if (m.payload.category !== undefined && noCategoryColumn(photoError)) ({ error: photoError } = await update(base));
            if (photoError) throw new ContractError(photoError.message, 500);
            result("applied");
            break;
          }
          if (m.op === "delete") {
            try {
              await removeWorkPhoto(admin, owner, m.entity_id);
              result("applied");
            } catch (e) {
              if (e instanceof ContractError && e.status === 404) result("duplicate");
              else throw e;
            }
            break;
          }
          const bytes = files.get(m.entity_id);
          if (!bytes) {
            const { data: existing } = await admin.from("amc_work_photos").select("id").eq("id", m.entity_id).maybeSingle<Row>();
            if (existing) result("duplicate");
            else result("retry", "The photo file did not arrive with the change.");
            break;
          }
          const added = await addWorkPhoto(
            admin,
            owner,
            { id: m.entity_id, bytes, kind: m.payload.kind, caption: m.payload.caption ?? null, category: m.payload.category ?? null },
            actor,
          );
          result(added.duplicate ? "duplicate" : "applied");
          break;
        }
      }
    } catch (e) {
      if (e instanceof ContractError && e.status < 500) result("rejected", e.message);
      else {
        console.error("[amc-sync] change failed:", e instanceof Error ? e.message : e);
        result("retry", e instanceof Error ? e.message : "Could not apply the change");
      }
    }
  }
  return {
    server_time: new Date().toISOString(),
    results,
    applied: results.filter((r) => r.status === "applied" || r.status === "duplicate").length,
    rejected: results.filter((r) => r.status === "rejected").length,
  };
}
