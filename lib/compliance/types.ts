// Wire types for the Manpower Compliance module: what the API returns and
// the browser renders. Identity numbers never appear here in full.

import type { ComplianceItemStatus } from "./status";
import type { NearestExpiry } from "./nearest";
import type { MaskedNumber } from "./masking";
import type { ActionRequired, ComplianceEmploymentStatus } from "./statuses";

export type CertificateType = {
  id: string;
  name: string;
  expires: boolean;
  sort_order: number;
  is_active: boolean;
};

export type LookupOption = { id: string; name: string; sort_order: number };

export type IdentityItem = MaskedNumber & {
  expiry: string | null;
  status: ComplianceItemStatus;
  days: number | null;
  /** "portal" or "hr_erp" (FR-10). */
  source: "portal" | "hr_erp";
};

export type CertificateItem = {
  certificate_type_id: string;
  name: string;
  expires: boolean;
  is_active: boolean;
  held: boolean;
  expiry_date: string | null;
  status: ComplianceItemStatus;
  days: number | null;
};

export type EmployeeSite = {
  client_id: string;
  client_name: string;
  property_id: string | null;
  property_label: string | null;
  /** C3: "fsm" = the appointment in progress; "manual" = the older picker. */
  source?: "fsm" | "manual";
  appointment_start?: string | null;
  appointment_end?: string | null;
  /** FSM record id, and the readable numbers shown to people (e.g. the appointment Name). */
  appointment_id?: string | null;
  appointment_name?: string | null;
  work_order_name?: string | null;
};

export type EmployeeTechnician = {
  fsm_resource_id: string;
  display_name: string;
  is_active: boolean;
  deactivated_at: string | null;
};

export type EmployeeRecord = {
  id: string;
  maher_id: string;
  full_name: string;
  designation: LookupOption | null;
  nationality: LookupOption | null;
  date_of_joining: string | null;
  /** Effective status after the D11 rule. */
  employment_status: ComplianceEmploymentStatus;
  /** What is stored; differs from the effective status when FSM overrides it. */
  stored_employment_status: ComplianceEmploymentStatus;
  employment_status_source: "portal" | "fsm";
  employment_status_since: string | null;
  allowed_statuses: ComplianceEmploymentStatus[];
  can_archive: boolean;
  site: EmployeeSite | null;
  /** When the FSM site job last looked at this employee (C3). */
  site_synced_at: string | null;
  technician: EmployeeTechnician | null;
  remarks: string | null;
  emirates_id: IdentityItem;
  passport: IdentityItem;
  certificates: CertificateItem[];
  nearest_expiry: NearestExpiry | null;
  /** The most urgent status across all items, for list colouring. */
  worst_status: ComplianceItemStatus;
  is_active_manpower: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EmployeeListResponse = {
  data: EmployeeRecord[];
  totalCount: number;
  page: number;
  pageSize: number;
};

export type ReminderRow = {
  employee_id: string;
  maher_id: string;
  full_name: string;
  site_client_id: string | null;
  site_label: string | null;
  item_key: string;
  item_label: string;
  expiry: string | null;
  days: number | null;
  status: ComplianceItemStatus;
  action: ActionRequired;
  /** C2: at least one file is attached to this item. */
  has_document?: boolean;
};

export type OverviewKpis = {
  total: number;
  active: number;
  archived: number;
  emirates_id: Record<ComplianceItemStatus, number>;
  passport: Record<ComplianceItemStatus, number>;
  reminder_items: number;
  as_of: string;
};

export type ComplianceSettings = {
  overdue_repeat_days: number;
  hr_owned_groups: string[];
  deactivation_request_user_ids: string[];
};

export type SiteClientOption = {
  id: string;
  name: string;
  company: string | null;
  fsm_contact_id: string | null;
  source: "fsm" | "portal";
};

export type SitePropertyOption = {
  id: string;
  label: string;
  fsm_address_id: string | null;
};

export type TechnicianOption = {
  fsm_resource_id: string;
  display_name: string;
  is_active: boolean;
  deactivated_at: string | null;
  /** Maher ID of the employee already linked to this technician, if any. */
  linked_to: string | null;
};
