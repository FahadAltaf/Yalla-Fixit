// Employee records (FRD FR-1, FR-2, FR-6, FR-7, FR-13, FR-14, D11).
//
// Reads every non-archived employee with identity, certificates and the
// technician link, builds the records in memory (statuses are computed,
// never stored), then filters, sorts and pages. At the sheet's scale (126
// people, NFR-3 allows 500) this is simpler and safer than pushing status
// logic into SQL, and it keeps one status engine.

import type { SupabaseClient } from "@supabase/supabase-js";
import { maskForAudit, normaliseEmiratesId } from "@/lib/compliance/masking";
import type { ComplianceItemStatus } from "@/lib/compliance/status";
import { statusRank, type ComplianceEmploymentStatus } from "@/lib/compliance/statuses";
import { allowedStatuses, type TechnicianLinkState } from "@/lib/compliance/employment";
import { crossFieldErrors, normaliseCertificates, type EmployeeInput } from "@/lib/compliance/validation";
import type { EmployeeListResponse, EmployeeRecord, OverviewKpis, ReminderRow } from "@/lib/compliance/types";
import type { ComplianceActor } from "./access";
import { recordComplianceAudit, recordComplianceAuditMany, type AuditEvent } from "./audit";
import { listCertificateTypes } from "./certificate-types";
import { buildEmployeeRecord, EMPLOYEE_SELECT, EMPLOYEE_SELECT_MINIMAL, EMPLOYEE_SELECT_NO_APPOINTMENT_NAMES, EMPLOYEE_SELECT_NO_DEACTIVATED_AT, EMPLOYEE_SELECT_NO_SITE_SYNC, reminderRowsFor, sortReminderRows, type EmployeeRaw } from "./read-model";
import { loadSiteLookup } from "./sites";
import { itemsWithDocuments } from "./documents";

const PAGE = 1000;

export type ServiceError = { error: string; status: number; fields?: Record<string, string> };
export const isServiceError = (v: unknown): v is ServiceError =>
  typeof v === "object" && v !== null && "error" in v && "status" in v;

async function loadRaw(admin: SupabaseClient, opts: { includeArchived: boolean; id?: string; maherId?: string }): Promise<EmployeeRaw[]> {
  const rows: EmployeeRaw[] = [];
  let select = EMPLOYEE_SELECT;
  for (let from = 0; ; from += PAGE) {
    const run = async (columns: string) => {
      let q = admin.from("compliance_employees").select(columns).order("full_name", { ascending: true }).range(from, from + PAGE - 1);
      if (!opts.includeArchived) q = q.is("archived_at", null);
      if (opts.id) q = q.eq("id", opts.id);
      if (opts.maherId) q = q.eq("maher_id", opts.maherId);
      return q;
    };
    let { data, error } = await run(select);
    // technician_reference.deactivated_at arrives with migration 20261020130000;
    // without it the record simply has no "inactive since" date.
    // Older databases: fall back step by step while a migration is not applied yet.
    for (const fallback of [EMPLOYEE_SELECT_NO_APPOINTMENT_NAMES, EMPLOYEE_SELECT_NO_SITE_SYNC, EMPLOYEE_SELECT_NO_DEACTIVATED_AT, EMPLOYEE_SELECT_MINIMAL]) {
      if (!(error && (error.code === "42703" || error.code === "PGRST204"))) break;
      select = fallback;
      ({ data, error } = await run(select));
    }
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as unknown as EmployeeRaw[]));
    if ((data ?? []).length < PAGE) break;
  }
  return rows;
}

/** The FSM technician's state for the D11 rules, for a given (possibly new) link. */
async function technicianLink(admin: SupabaseClient, fsmResourceId: string | null): Promise<TechnicianLinkState> {
  if (!fsmResourceId) return { linked: false, fsmActive: null, deactivatedAt: null };
  let { data, error } = await admin.from("technician_reference").select("is_active, deactivated_at").eq("fsm_resource_id", fsmResourceId).maybeSingle();
  if (error && (error.code === "42703" || error.code === "PGRST204")) {
    ({ data, error } = await admin.from("technician_reference").select("is_active").eq("fsm_resource_id", fsmResourceId).maybeSingle());
  }
  if (error) throw new Error(error.message);
  if (!data) return { linked: false, fsmActive: null, deactivatedAt: null };
  const row = data as { is_active: boolean; deactivated_at?: string | null };
  return { linked: true, fsmActive: row.is_active, deactivatedAt: row.deactivated_at ?? null };
}

/** D11: a status the technician's FSM state does not allow, as a field error; null when fine. */
function statusError(status: ComplianceEmploymentStatus, link: TechnicianLinkState): string | null {
  if (allowedStatuses(link).includes(status)) return null;
  if (link.linked && link.fsmActive === true) return "This person is active in FSM. Only Active and On Leave can be set here; use Deactivate to ask for the FSM change";
  if (link.linked && link.fsmActive === false) return "FSM shows this technician as inactive, so the status can only be Inactive, Resigned or Terminated";
  return "This status is not available";
}

/** A property must belong to the chosen client (D4). */
async function propertyBelongsToClient(admin: SupabaseClient, propertyId: string, clientId: string): Promise<boolean> {
  const { data, error } = await admin.from("snagging_properties").select("client_id").eq("id", propertyId).maybeSingle();
  if (error) {
    if (error.code === "42P01") return false;
    throw new Error(error.message);
  }
  return Boolean(data) && (data as { client_id: string | null }).client_id === clientId;
}

/** 23505 can be the Maher ID or the one-employee-per-technician index. */
function duplicateError(error: { message?: string; details?: string }, maherId: string): ServiceError {
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  if (text.includes("compliance_employees_fsm_resource_key")) {
    return { error: "That FSM technician is already linked to another employee", status: 409, fields: { fsm_resource_id: "Already linked to another employee" } };
  }
  return DUPLICATE(maherId);
}

async function toRecords(admin: SupabaseClient, raws: EmployeeRaw[], today: string): Promise<EmployeeRecord[]> {
  const types = await listCertificateTypes(admin, true);
  const lookupSite = await loadSiteLookup(
    admin,
    raws.map((r) => r.site_client_id).filter((v): v is string => Boolean(v)),
    raws.map((r) => r.site_property_id).filter((v): v is string => Boolean(v)),
  );
  return raws.map((r) => buildEmployeeRecord(r, types, today, lookupSite));
}

export async function loadAllRecords(admin: SupabaseClient, today: string, includeArchived = false): Promise<EmployeeRecord[]> {
  return toRecords(admin, await loadRaw(admin, { includeArchived }), today);
}

export async function getEmployee(admin: SupabaseClient, id: string, today: string): Promise<EmployeeRecord | null> {
  const raws = await loadRaw(admin, { includeArchived: true, id });
  if (!raws.length) return null;
  return (await toRecords(admin, raws, today))[0];
}

export async function findByMaherId(admin: SupabaseClient, maherId: string, today: string): Promise<EmployeeRecord | null> {
  const raws = await loadRaw(admin, { includeArchived: true, maherId: maherId.trim() });
  if (!raws.length) return null;
  return (await toRecords(admin, raws, today))[0];
}

export type ListQuery = {
  q?: string;
  employmentStatus?: ComplianceEmploymentStatus | "active_manpower" | "";
  itemStatus?: ComplianceItemStatus | "";
  siteClientId?: string;
  includeArchived?: boolean;
  page: number;
  pageSize: number;
  sortBy?: "full_name" | "maher_id" | "nearest" | "worst";
  sortOrder?: "asc" | "desc";
};

export async function listEmployees(admin: SupabaseClient, query: ListQuery, today: string): Promise<EmployeeListResponse> {
  let records = await loadAllRecords(admin, today, query.includeArchived ?? false);
  const q = (query.q ?? "").trim().toLowerCase();
  if (q) {
    records = records.filter((r) => r.full_name.toLowerCase().includes(q) || r.maher_id.toLowerCase().includes(q));
  }
  if (query.employmentStatus === "active_manpower") records = records.filter((r) => r.is_active_manpower);
  else if (query.employmentStatus) records = records.filter((r) => r.employment_status === query.employmentStatus);
  if (query.itemStatus) {
    const s = query.itemStatus;
    records = records.filter((r) => r.emirates_id.status === s || r.passport.status === s || r.certificates.some((c) => c.status === s));
  }
  if (query.siteClientId === "unassigned") records = records.filter((r) => !r.site);
  else if (query.siteClientId) records = records.filter((r) => r.site?.client_id === query.siteClientId);

  const dir = query.sortOrder === "desc" ? -1 : 1;
  const by = query.sortBy ?? "full_name";
  records.sort((a, b) => {
    if (by === "maher_id") return dir * a.maher_id.localeCompare(b.maher_id);
    if (by === "nearest") {
      const ad = a.nearest_expiry?.days ?? Number.POSITIVE_INFINITY;
      const bd = b.nearest_expiry?.days ?? Number.POSITIVE_INFINITY;
      return dir * (ad - bd) || a.full_name.localeCompare(b.full_name);
    }
    if (by === "worst") return dir * (statusRank(a.worst_status) - statusRank(b.worst_status)) || a.full_name.localeCompare(b.full_name);
    return dir * a.full_name.localeCompare(b.full_name);
  });

  const totalCount = records.length;
  const start = query.page * query.pageSize;
  return { data: records.slice(start, start + query.pageSize), totalCount, page: query.page, pageSize: query.pageSize };
}

export async function reminderList(
  admin: SupabaseClient,
  filters: { itemKey?: string; status?: ComplianceItemStatus | ""; siteClientId?: string },
  today: string,
): Promise<ReminderRow[]> {
  const records = await loadAllRecords(admin, today, false);
  let rows = records.flatMap(reminderRowsFor);
  if (filters.itemKey) {
    rows = filters.itemKey === "certificates" ? rows.filter((r) => r.item_key.startsWith("cert:")) : rows.filter((r) => r.item_key === filters.itemKey);
  }
  if (filters.status) rows = rows.filter((r) => r.status === filters.status);
  if (filters.siteClientId) {
    const wanted = new Set(records.filter((r) => (filters.siteClientId === "unassigned" ? !r.site : r.site?.client_id === filters.siteClientId)).map((r) => r.id));
    rows = rows.filter((r) => wanted.has(r.employee_id));
  }
  const withFiles = await itemsWithDocuments(admin);
  rows = rows.map((r) => (withFiles.has(`${r.employee_id}|${r.item_key}`) ? { ...r, has_document: true } : r));
  return sortReminderRows(rows);
}

export async function overviewKpis(admin: SupabaseClient, today: string): Promise<OverviewKpis> {
  const records = await loadAllRecords(admin, today, true);
  const empty = (): Record<ComplianceItemStatus, number> => ({ valid: 0, due_90: 0, due_60: 0, due_30: 0, expired: 0, missing_expiry: 0, not_held: 0 });
  const kpis: OverviewKpis = { total: 0, active: 0, archived: 0, emirates_id: empty(), passport: empty(), reminder_items: 0, as_of: today };
  for (const r of records) {
    if (r.archived_at) {
      kpis.archived += 1;
      continue;
    }
    kpis.total += 1;
    if (!r.is_active_manpower) continue;
    kpis.active += 1;
    kpis.emirates_id[r.emirates_id.status] += 1;
    kpis.passport[r.passport.status] += 1;
    kpis.reminder_items += reminderRowsFor(r).length;
  }
  return kpis;
}

// ---------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------

type IdentityPatch = {
  emirates_id_number?: string | null;
  emirates_id_expiry?: string | null;
  passport_number?: string | null;
  passport_expiry?: string | null;
};

function identityDiff(before: Record<string, unknown> | null, after: IdentityPatch): AuditEvent[] {
  const events: AuditEvent[] = [];
  const fields: (keyof IdentityPatch)[] = ["emirates_id_number", "emirates_id_expiry", "passport_number", "passport_expiry"];
  for (const f of fields) {
    if (after[f] === undefined) continue;
    const prev = (before?.[f] as string | null | undefined) ?? null;
    if (prev === after[f]) continue;
    const isNumber = f.endsWith("_number");
    events.push({
      entity_type: "identity",
      event_type: "edit",
      field: f,
      old_value: isNumber ? maskForAudit(prev) : prev,
      new_value: isNumber ? maskForAudit(after[f]) : after[f],
    });
  }
  return events;
}

const DUPLICATE = (maherId: string): ServiceError => ({
  error: `An employee with Maher ID ${maherId} already exists`,
  status: 409,
  fields: { maher_id: "Already used by another employee" },
});

export async function createEmployee(
  admin: SupabaseClient,
  actor: ComplianceActor,
  input: EmployeeInput,
  today: string,
): Promise<EmployeeRecord | ServiceError> {
  const fieldErrors = crossFieldErrors(input, today);
  const link = await technicianLink(admin, input.fsm_resource_id);
  if (input.fsm_resource_id && !link.linked) fieldErrors.fsm_resource_id = "That FSM technician no longer exists";
  const statusProblem = statusError(input.employment_status, link);
  if (statusProblem) fieldErrors.employment_status = statusProblem;
  if (input.site_property_id && input.site_client_id && !(await propertyBelongsToClient(admin, input.site_property_id, input.site_client_id))) {
    fieldErrors.site_property_id = "That project location does not belong to the chosen client";
  }
  if (Object.keys(fieldErrors).length) return { error: "Check the highlighted fields", status: 400, fields: fieldErrors };

  const { data: created, error } = await admin
    .from("compliance_employees")
    .insert({
      maher_id: input.maher_id,
      full_name: input.full_name,
      designation_id: input.designation_id,
      nationality_id: input.nationality_id,
      date_of_joining: input.date_of_joining,
      employment_status: input.employment_status,
      site_client_id: input.site_client_id,
      site_property_id: input.site_property_id,
      site_assigned_at: input.site_client_id ? new Date().toISOString() : null,
      site_assigned_by: input.site_client_id ? actor.id : null,
      fsm_resource_id: input.fsm_resource_id,
      remarks: input.remarks,
      created_by: actor.id,
      updated_by: actor.id,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return duplicateError(error, input.maher_id);
    if (error.code === "23503") return { error: "A linked value no longer exists (designation, nationality, site or technician)", status: 400 };
    throw new Error(error.message);
  }
  const id = (created as { id: string }).id;

  try {
    const identity = input.identity ?? {};
    const { error: idError } = await admin.from("compliance_identity_documents").insert({
      employee_id: id,
      emirates_id_number: identity.emirates_id_number ?? null,
      emirates_id_expiry: identity.emirates_id_expiry ?? null,
      passport_number: identity.passport_number ?? null,
      passport_expiry: identity.passport_expiry ?? null,
      updated_by: actor.id,
    });
    if (idError) throw new Error(idError.message);

    const certs = normaliseCertificates(input.certificates).filter((c) => c.held);
    if (certs.length) {
      const { error: certError } = await admin.from("compliance_employee_certificates").insert(
        certs.map((c) => ({ employee_id: id, certificate_type_id: c.certificate_type_id, held: true, expiry_date: c.expiry_date, updated_by: actor.id })),
      );
      if (certError) throw new Error(certError.message);
    }

    await recordComplianceAudit(admin, actor, {
      entity_type: "employee",
      entity_id: id,
      employee_id: id,
      event_type: "create",
      new_value: {
        maher_id: input.maher_id,
        full_name: input.full_name,
        employment_status: input.employment_status,
        emirates_id_number: maskForAudit(identity.emirates_id_number),
        passport_number: maskForAudit(identity.passport_number),
        certificates_held: certs.length,
      },
    });
  } catch (e) {
    // No transaction over PostgREST: undo the employee row so a half-record never exists.
    const { error: undoError } = await admin.from("compliance_employees").delete().eq("id", id);
    if (undoError) console.error(`[compliance] could not undo half-created employee ${id}:`, undoError.message);
    throw e;
  }

  const record = await getEmployee(admin, id, today);
  if (!record) throw new Error("Employee vanished after create");
  return record;
}

export type EmployeePatch = Partial<Omit<EmployeeInput, "identity" | "certificates">> & {
  identity?: IdentityPatch;
  certificates?: EmployeeInput["certificates"];
};

const SCALAR_FIELDS = ["maher_id", "full_name", "designation_id", "nationality_id", "date_of_joining", "employment_status", "site_client_id", "site_property_id", "fsm_resource_id", "remarks"] as const;

export async function updateEmployee(
  admin: SupabaseClient,
  actor: ComplianceActor,
  id: string,
  patch: EmployeePatch,
  today: string,
): Promise<EmployeeRecord | ServiceError> {
  const current = await getEmployee(admin, id, today);
  if (!current) return { error: "Employee not found", status: 404 };
  if (current.archived_at) return { error: "This employee is archived. Restore the record before editing it", status: 409 };

  const merged = {
    maher_id: patch.maher_id ?? current.maher_id,
    full_name: patch.full_name ?? current.full_name,
    designation_id: patch.designation_id === undefined ? (current.designation?.id ?? null) : patch.designation_id,
    nationality_id: patch.nationality_id === undefined ? (current.nationality?.id ?? null) : patch.nationality_id,
    date_of_joining: patch.date_of_joining === undefined ? current.date_of_joining : patch.date_of_joining,
    employment_status: patch.employment_status ?? current.stored_employment_status,
    site_client_id: patch.site_client_id === undefined ? (current.site?.client_id ?? null) : patch.site_client_id,
    site_property_id: patch.site_property_id === undefined ? (current.site?.property_id ?? null) : patch.site_property_id,
    fsm_resource_id: patch.fsm_resource_id === undefined ? (current.technician?.fsm_resource_id ?? null) : patch.fsm_resource_id,
    remarks: patch.remarks === undefined ? current.remarks : patch.remarks,
    identity: {},
    certificates: [],
  } satisfies EmployeeInput;
  const fieldErrors = crossFieldErrors(merged, today);
  // D11 against the link AS IT WILL BE after this patch. An unchanged status is
  // never re-validated, so a record whose status FSM has overridden can still
  // have its other fields edited.
  const linkChanged = merged.fsm_resource_id !== (current.technician?.fsm_resource_id ?? null);
  if (linkChanged || merged.employment_status !== current.stored_employment_status) {
    const link = await technicianLink(admin, merged.fsm_resource_id);
    if (merged.fsm_resource_id && !link.linked) fieldErrors.fsm_resource_id = "That FSM technician no longer exists";
    // When ONLY the FSM link is being set (no explicit status in the patch — e.g.
    // the FSM-links linker, which can link an inactive employee), reconcile the
    // stored status to the one FSM governs instead of refusing the link: a record
    // the sheet marked Inactive whose technician is active in FSM becomes Active,
    // and one marked Active whose technician is inactive in FSM becomes Inactive
    // (D11 — FSM is the source of truth for linked staff).
    if (linkChanged && patch.employment_status === undefined && link.linked && !allowedStatuses(link).includes(merged.employment_status)) {
      merged.employment_status = link.fsmActive ? "active" : "inactive";
    }
    const statusChanged = merged.employment_status !== current.stored_employment_status;
    const statusProblem = statusError(merged.employment_status, link);
    if (statusProblem && (statusChanged || linkChanged)) fieldErrors.employment_status = statusProblem;
  }
  const siteChanged = merged.site_client_id !== (current.site?.client_id ?? null) || merged.site_property_id !== (current.site?.property_id ?? null);
  if (siteChanged && merged.site_property_id && merged.site_client_id && !(await propertyBelongsToClient(admin, merged.site_property_id, merged.site_client_id))) {
    fieldErrors.site_property_id = "That project location does not belong to the chosen client";
  }
  if (Object.keys(fieldErrors).length) return { error: "Check the highlighted fields", status: 400, fields: fieldErrors };

  const events: AuditEvent[] = [];
  const employeeUpdate: Record<string, unknown> = { updated_by: actor.id, updated_at: new Date().toISOString() };
  const beforeScalars: Record<string, unknown> = {
    maher_id: current.maher_id,
    full_name: current.full_name,
    designation_id: current.designation?.id ?? null,
    nationality_id: current.nationality?.id ?? null,
    date_of_joining: current.date_of_joining,
    employment_status: current.stored_employment_status,
    site_client_id: current.site?.client_id ?? null,
    site_property_id: current.site?.property_id ?? null,
    fsm_resource_id: current.technician?.fsm_resource_id ?? null,
    remarks: current.remarks,
  };
  for (const f of SCALAR_FIELDS) {
    const next = (merged as Record<string, unknown>)[f];
    if (next === beforeScalars[f]) continue;
    employeeUpdate[f] = next;
    events.push({ entity_type: f === "site_client_id" || f === "site_property_id" ? "site" : "employee", entity_id: id, employee_id: id, event_type: "edit", field: f, old_value: beforeScalars[f], new_value: next });
  }
  if (employeeUpdate.site_client_id !== undefined || employeeUpdate.site_property_id !== undefined) {
    employeeUpdate.site_assigned_at = merged.site_client_id ? new Date().toISOString() : null;
    employeeUpdate.site_assigned_by = merged.site_client_id ? actor.id : null;
  }
  // Work out every write first, then audit, then write. There is no transaction
  // over PostgREST, so the order is chosen to over-record rather than
  // under-record: a failed data write after its audit row is visible as an
  // audit entry with no matching change, which the log can show; a change
  // with no audit row would be invisible (FR-13).
  let identityUpsert: Record<string, unknown> | null = null;
  if (patch.identity && Object.values(patch.identity).some((v) => v !== undefined)) {
    const { data: before } = await admin
      .from("compliance_identity_documents")
      .select("emirates_id_number, emirates_id_expiry, passport_number, passport_expiry")
      .eq("employee_id", id)
      .maybeSingle();
    const cleaned: IdentityPatch = { ...patch.identity };
    if (typeof cleaned.emirates_id_number === "string") cleaned.emirates_id_number = normaliseEmiratesId(cleaned.emirates_id_number);
    const diff = identityDiff((before as Record<string, unknown> | null) ?? null, cleaned);
    if (diff.length) {
      identityUpsert = { employee_id: id, updated_by: actor.id, updated_at: new Date().toISOString() };
      for (const [k, v] of Object.entries(cleaned)) if (v !== undefined) identityUpsert[k] = v;
      events.push(...diff.map((e) => ({ ...e, entity_id: id, employee_id: id })));
    }
  }

  const certificateUpserts: Record<string, unknown>[] = [];
  if (patch.certificates) {
    const wanted = normaliseCertificates(patch.certificates);
    const before = new Map(current.certificates.map((c) => [c.certificate_type_id, c]));
    for (const c of wanted) {
      const prev = before.get(c.certificate_type_id);
      const prevHeld = prev?.held ?? false;
      const prevExpiry = prev?.expiry_date ?? null;
      if (prevHeld === c.held && prevExpiry === c.expiry_date) continue;
      certificateUpserts.push({ employee_id: id, certificate_type_id: c.certificate_type_id, held: c.held, expiry_date: c.expiry_date, updated_by: actor.id, updated_at: new Date().toISOString() });
      events.push({ entity_type: "certificate", entity_id: c.certificate_type_id, employee_id: id, event_type: "edit", field: prev?.name ?? c.certificate_type_id, old_value: { held: prevHeld, expiry_date: prevExpiry }, new_value: { held: c.held, expiry_date: c.expiry_date } });
    }
  }

  if (events.length) await recordComplianceAuditMany(admin, actor, events);

  if (Object.keys(employeeUpdate).length > 2) {
    const { error } = await admin.from("compliance_employees").update(employeeUpdate).eq("id", id);
    if (error) {
      if (error.code === "23505") return duplicateError(error, merged.maher_id);
      if (error.code === "23503") return { error: "A linked value no longer exists (designation, nationality, site or technician)", status: 400 };
      throw new Error(error.message);
    }
  }
  if (identityUpsert) {
    const { error } = await admin.from("compliance_identity_documents").upsert(identityUpsert, { onConflict: "employee_id" });
    if (error) throw new Error(error.message);
  }
  for (const upsert of certificateUpserts) {
    const { error } = await admin.from("compliance_employee_certificates").upsert(upsert, { onConflict: "employee_id,certificate_type_id" });
    if (error) throw new Error(error.message);
  }

  const record = await getEmployee(admin, id, today);
  if (!record) throw new Error("Employee vanished after update");
  return record;
}

export async function setArchived(
  admin: SupabaseClient,
  actor: ComplianceActor,
  id: string,
  archived: boolean,
  reason: string | null,
  today: string,
): Promise<EmployeeRecord | ServiceError> {
  const current = await getEmployee(admin, id, today);
  if (!current) return { error: "Employee not found", status: 404 };
  if (archived && current.archived_at) return { error: "Already archived", status: 409 };
  if (!archived && !current.archived_at) return { error: "Not archived", status: 409 };
  if (archived && !current.can_archive) {
    return { error: "This person is still active in FSM. Use Deactivate to ask for the FSM change first", status: 409 };
  }
  await recordComplianceAudit(admin, actor, {
    entity_type: "employee",
    entity_id: id,
    employee_id: id,
    event_type: archived ? "archive" : "unarchive",
    new_value: archived ? { reason } : null,
  });
  const { error } = await admin
    .from("compliance_employees")
    .update(
      archived
        ? { archived_at: new Date().toISOString(), archived_by: actor.id, archive_reason: reason, updated_by: actor.id, updated_at: new Date().toISOString() }
        : { archived_at: null, archived_by: null, archive_reason: null, updated_by: actor.id, updated_at: new Date().toISOString() },
    )
    .eq("id", id);
  if (error) throw new Error(error.message);
  const record = await getEmployee(admin, id, today);
  if (!record) throw new Error("Employee vanished after archive");
  return record;
}

/** Raw identity row for the audited reveal (phase 2) and the import; never for the wire. */
export async function readIdentityRaw(admin: SupabaseClient, id: string) {
  const { data, error } = await admin
    .from("compliance_identity_documents")
    .select("emirates_id_number, emirates_id_expiry, passport_number, passport_expiry")
    .eq("employee_id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Record<string, string | null> | null) ?? null;
}
