// Builds the employee record the API returns (FRD FR-1, FR-3, FR-4, FR-9).
// One function, used by the list, the record, the KPIs and the reminder
// list, so they can never disagree. Identity numbers are masked here.

import { certificateStatus, identityStatus, isOnReminderList } from "@/lib/compliance/status";
import { nearestExpiry, type ExpiryItem } from "@/lib/compliance/nearest";
import { maskNumber } from "@/lib/compliance/masking";
import { actionRequired, isActiveManpower, statusRank, type ComplianceEmploymentStatus } from "@/lib/compliance/statuses";
import { allowedStatuses, canArchive, effectiveEmploymentStatus } from "@/lib/compliance/employment";
import type { CertificateItem, CertificateType, EmployeeRecord, EmployeeSite, EmployeeTechnician, ReminderRow } from "@/lib/compliance/types";

export type EmployeeRaw = {
  id: string;
  maher_id: string;
  full_name: string;
  designation_id: string | null;
  nationality_id: string | null;
  date_of_joining: string | null;
  employment_status: ComplianceEmploymentStatus;
  site_client_id: string | null;
  site_property_id: string | null;
  fsm_resource_id: string | null;
  remarks: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  site_source?: "none" | "fsm" | "manual" | null;
  site_client_name?: string | null;
  site_address?: string | null;
  site_fsm_appointment_id?: string | null;
  site_fsm_appointment_name?: string | null;
  site_fsm_work_order_name?: string | null;
  site_appointment_start?: string | null;
  site_appointment_end?: string | null;
  site_synced_at?: string | null;
  designation: { id: string; name: string; sort_order: number } | { id: string; name: string; sort_order: number }[] | null;
  nationality: { id: string; name: string; sort_order: number } | { id: string; name: string; sort_order: number }[] | null;
  identity:
    | {
        emirates_id_number: string | null;
        emirates_id_expiry: string | null;
        emirates_id_source: "portal" | "hr_erp";
        passport_number: string | null;
        passport_expiry: string | null;
        passport_source: "portal" | "hr_erp";
      }
    | { emirates_id_number: string | null; emirates_id_expiry: string | null; emirates_id_source: "portal" | "hr_erp"; passport_number: string | null; passport_expiry: string | null; passport_source: "portal" | "hr_erp" }[]
    | null;
  certificates: { certificate_type_id: string; held: boolean; expiry_date: string | null }[] | null;
  technician:
    | { display_name: string; is_active: boolean; deactivated_at: string | null }
    | { display_name: string; is_active: boolean; deactivated_at: string | null }[]
    | null;
};

/** PostgREST returns a to-one embed as an object, or as a one-element array on some versions. */
export function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export const EMPLOYEE_SELECT = [
  "id, maher_id, full_name, designation_id, nationality_id, date_of_joining, employment_status,",
  "site_client_id, site_property_id, fsm_resource_id, remarks, archived_at, created_at, updated_at,",
  "site_source, site_client_name, site_address, site_fsm_appointment_id, site_fsm_appointment_name, site_fsm_work_order_name, site_appointment_start, site_appointment_end, site_synced_at,",
  "designation:lookup_options!compliance_employees_designation_id_fkey(id, name, sort_order),",
  "nationality:lookup_options!compliance_employees_nationality_id_fkey(id, name, sort_order),",
  "identity:compliance_identity_documents(emirates_id_number, emirates_id_expiry, emirates_id_source, passport_number, passport_expiry, passport_source),",
  "certificates:compliance_employee_certificates(certificate_type_id, held, expiry_date),",
  "technician:technician_reference(display_name, is_active, deactivated_at)",
].join(" ");

/** Fallback while migration 20261020130000 (deactivated_at) is not applied. */
/** Fallback while the 31 Oct re-run of 20261029130000 (appointment and work order numbers) is not applied. */
export const EMPLOYEE_SELECT_NO_APPOINTMENT_NAMES = EMPLOYEE_SELECT.replace(" site_fsm_appointment_name, site_fsm_work_order_name,", "");
export const EMPLOYEE_SELECT_NO_DEACTIVATED_AT = EMPLOYEE_SELECT.replace(", deactivated_at)", ")");
/** Fallback while migration 20261029130000 (FSM site columns) is not applied. */
export const EMPLOYEE_SELECT_NO_SITE_SYNC = EMPLOYEE_SELECT.replace("site_source, site_client_name, site_address, site_fsm_appointment_id, site_fsm_appointment_name, site_fsm_work_order_name, site_appointment_start, site_appointment_end, site_synced_at,", "");
export const EMPLOYEE_SELECT_MINIMAL = EMPLOYEE_SELECT_NO_SITE_SYNC.replace(", deactivated_at)", ")");

export type SiteLookup = (clientId: string | null, propertyId: string | null) => EmployeeSite | null;

export function buildEmployeeRecord(
  raw: EmployeeRaw,
  types: CertificateType[],
  today: string,
  lookupSite: SiteLookup,
): EmployeeRecord {
  const identity = one(raw.identity);
  const technicianRow = one(raw.technician);
  const technician: EmployeeTechnician | null =
    raw.fsm_resource_id && technicianRow
      ? {
          fsm_resource_id: raw.fsm_resource_id,
          display_name: technicianRow.display_name,
          is_active: technicianRow.is_active,
          deactivated_at: technicianRow.deactivated_at,
        }
      : null;
  const link = {
    linked: technician !== null,
    fsmActive: technician ? technician.is_active : null,
    deactivatedAt: technician?.deactivated_at ?? null,
  };
  const effective = effectiveEmploymentStatus(raw.employment_status, link);

  const eid = identityStatus(identity?.emirates_id_expiry ?? null, today);
  const passport = identityStatus(identity?.passport_expiry ?? null, today);

  const held = new Map((raw.certificates ?? []).map((c) => [c.certificate_type_id, c]));
  // A retired type stays on a record only while the employee actually holds
  // it; a "Not held" row (left behind when Held was switched off) is not a
  // reason to keep showing it.
  const certificates: CertificateItem[] = types
    .filter((t) => t.is_active || held.get(t.id)?.held === true)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .map((t) => {
      const row = held.get(t.id);
      const s = certificateStatus({ held: row?.held ?? false, expiry: row?.expiry_date ?? null, expires: t.expires }, today);
      return {
        certificate_type_id: t.id,
        name: t.name,
        expires: t.expires,
        is_active: t.is_active,
        held: row?.held ?? false,
        expiry_date: row?.expiry_date ?? null,
        status: s.status,
        days: s.days,
      };
    });

  const items: ExpiryItem[] = [
    { key: "emirates_id", label: "Emirates ID", status: eid.status, days: eid.days, expiry: identity?.emirates_id_expiry ?? null },
    { key: "passport", label: "Passport", status: passport.status, days: passport.days, expiry: identity?.passport_expiry ?? null },
    ...certificates.map((c) => ({ key: `cert:${c.certificate_type_id}`, label: c.name, status: c.status, days: c.days, expiry: c.expiry_date })),
  ];
  const worst = items.reduce((acc, item) => (statusRank(item.status) < statusRank(acc) ? item.status : acc), items[0].status);

  return {
    id: raw.id,
    maher_id: raw.maher_id,
    full_name: raw.full_name,
    designation: one(raw.designation),
    nationality: one(raw.nationality),
    date_of_joining: raw.date_of_joining,
    employment_status: effective.status,
    stored_employment_status: raw.employment_status,
    employment_status_source: effective.source,
    employment_status_since: effective.since,
    allowed_statuses: allowedStatuses(link),
    can_archive: canArchive(link),
    // C3: an FSM-derived site wins; otherwise the older client reference, if any.
    site:
      raw.site_source === "fsm" && raw.site_client_name
        ? {
            client_id: `fsm:${raw.site_client_name.trim().toLowerCase()}`,
            client_name: raw.site_client_name,
            property_id: null,
            property_label: raw.site_address ?? null,
            source: "fsm" as const,
            appointment_start: raw.site_appointment_start ?? null,
            appointment_end: raw.site_appointment_end ?? null,
            appointment_id: raw.site_fsm_appointment_id ?? null,
            appointment_name: raw.site_fsm_appointment_name ?? null,
            work_order_name: raw.site_fsm_work_order_name ?? null,
          }
        : (() => {
            const legacy = lookupSite(raw.site_client_id, raw.site_property_id);
            return legacy ? { ...legacy, source: "manual" as const, appointment_start: null, appointment_end: null } : null;
          })(),
    site_synced_at: raw.site_synced_at ?? null,
    technician,
    remarks: raw.remarks,
    emirates_id: { ...maskNumber(identity?.emirates_id_number), expiry: identity?.emirates_id_expiry ?? null, status: eid.status, days: eid.days, source: identity?.emirates_id_source ?? "portal" },
    passport: { ...maskNumber(identity?.passport_number), expiry: identity?.passport_expiry ?? null, status: passport.status, days: passport.days, source: identity?.passport_source ?? "portal" },
    certificates,
    nearest_expiry: nearestExpiry(items),
    worst_status: worst,
    is_active_manpower: raw.archived_at === null && isActiveManpower(effective.status),
    archived_at: raw.archived_at,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}

/** Every reminder-list row an employee contributes (FR-7). Active manpower only. */
export function reminderRowsFor(record: EmployeeRecord): ReminderRow[] {
  if (!record.is_active_manpower) return [];
  const site_label = record.site ? [record.site.client_name, record.site.property_label].filter(Boolean).join(" · ") : null;
  const base = { employee_id: record.id, maher_id: record.maher_id, full_name: record.full_name, site_client_id: record.site?.client_id ?? null, site_label };
  const rows: ReminderRow[] = [];
  if (isOnReminderList(record.emirates_id.status)) {
    rows.push({ ...base, item_key: "emirates_id", item_label: "Emirates ID", expiry: record.emirates_id.expiry, days: record.emirates_id.days, status: record.emirates_id.status, action: actionRequired(record.emirates_id.status) });
  }
  if (isOnReminderList(record.passport.status)) {
    rows.push({ ...base, item_key: "passport", item_label: "Passport", expiry: record.passport.expiry, days: record.passport.days, status: record.passport.status, action: actionRequired(record.passport.status) });
  }
  for (const c of record.certificates) {
    if (!isOnReminderList(c.status)) continue;
    rows.push({ ...base, item_key: `cert:${c.certificate_type_id}`, item_label: c.name, expiry: c.expiry_date, days: c.days, status: c.status, action: actionRequired(c.status) });
  }
  return rows;
}

/** Sort: fewest days first; items with no date (missing expiry) after the dated ones. */
export function sortReminderRows(rows: ReminderRow[]): ReminderRow[] {
  return [...rows].sort((a, b) => {
    if (a.days === null && b.days === null) return a.full_name.localeCompare(b.full_name);
    if (a.days === null) return 1;
    if (b.days === null) return -1;
    return a.days - b.days || a.full_name.localeCompare(b.full_name);
  });
}
