export interface User {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string;
  password?: string;
  full_name?: string | null;
  role_id?: string;
  is_active?: boolean;

  last_login?: string | null;
  created_at?: string;
  updated_at?: string;
  profile_image?: string | null;
  status?: string;
  // When TRUE, this user receives the "schedule needs approval" email.
  receives_schedule_approval_email?: boolean;

  settings?: {
    edges: {
      node: {
        site_name: string | null;
        logo_url: string | null;
      };
    }[];
  };
  roles?: {
    name: string | null;
    description?: string;
    role_accessCollection?: {
      edges: Array<{
        node: {
          resource: string;
          action: string;
          enabled?: boolean | null;
          record_access?: string | null;
        };
      }>;
    };
  };
}

export interface MenuItem {
  title: string;
  url: string;
  icon?: React.ReactNode;
  isActive?: boolean;
  resource?: ResourceType;
  unreadCount?: number;
  /**
   * Highlight this entry only on its own path, never on what sits under
   * it. A section landing page needs this, or it stays lit on every
   * child page and the sidebar stops saying where you are.
   */
  exact?: boolean;
  /**
   * Extra path prefixes this entry owns. A record's detail page lives
   * under the section root rather than under the list it was opened
   * from, so the list claims it here and stays selected while you read
   * the record.
   */
  match?: string[];
  items?: MenuItem[];
}

export interface MenuSection {
  title: string;
  url: string;
  items: MenuItem[];
}

export enum UserRoles {
  ADMIN = "admin",
  USER = "user",
}

export interface Role {
  id: string;
  name: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

export interface RoleAccess {
  id: string;
  role_id: string;
  resource: ResourceType;
  action: ActionType;
  enabled?: boolean;
  record_access?: string;
  created_at?: string;
  updated_at?: string;
  roles?: Role;
}

export enum ResourceType {
  // Dashboard
  DASHBOARD = "dashboard",
  // Work Management
  TODOS = "todos",
  // Admin Management
  USERS = "users",
  ROLES = "roles",
  PERMISSIONS = "permissions",
  SETTINGS = "settings",
  // Extensions
  EXTENSIONS = "extensions",
  // Scheduling
  SCHEDULING = "scheduling",
  // Property Care / Snagging
  SNAGGING = "snagging",
  SNAGGING_CATALOGUE = "snagging_catalogue",
}

export type TodoStatus =
  "todo" | "in_progress" | "done" | "canceled" | "blocked";

export type TodoRelatedType = "work_order" | "quotation" | "appointment";

export interface TodoAssignee {
  user_id: string;
  user_profile?: User;
}

export interface TodoComment {
  id: string;
  todo_id: string;
  author_id: string;
  body: string;
  created_at: string;
  updated_at?: string;
  author?: User;
}

export interface TodoUpdateLog {
  id: string;
  todo_id: string;
  actor_id?: string | null;
  action: string;
  field_name?: string | null;
  old_value?: unknown;
  new_value?: unknown;
  created_at: string;
  actor?: User;
}

export interface TodoTag {
  id: string;
  name: string;
  color: string;
  created_at?: string;
  updated_at?: string | null;
}

export interface Todo {
  id: string;
  todo_key: string;
  owner_id: string;
  title: string;
  description: string;
  tags: string[];
  related_type?: TodoRelatedType | null;
  related_id?: string | null;
  deadline_at: string;
  reminder_at?: string | null;
  reminder_sent_at?: string | null;
  status: TodoStatus;
  created_at: string;
  updated_at?: string;
  completed_at?: string | null;
  owner?: User;
  assignees?: User[];
  comments?: TodoComment[];
  updates?: TodoUpdateLog[];
}

export const TODO_STATUS_LABELS: Record<TodoStatus, string> = {
  todo: "To-do",
  in_progress: "In progress",
  done: "Done",
  canceled: "Canceled",
  blocked: "Blocked",
};

export interface Attachment {
  $file_id: string;
  File_Name: string;
}

export interface ServiceAppointment {
  id: string;
  name: string;
  address: string;
  contact_id: string;
  contact_name: string;
  summary: string;
  type: string;
  status: string;
  attachments?: Attachment[];
}

export type TechnicianShift = "morning" | "night";

export interface TechnicianRole {
  id: string;
  name: string;
  sort_order: number;
  technician_count?: number;
}

export interface TechnicianServiceType {
  id: string;
  name: string;
  sort_order: number;
  technician_count?: number;
}

export interface TechnicianReference {
  fsm_resource_id: string;
  display_name: string;
  is_active: boolean;
  last_synced_at: string;
  // Portal-managed attributes (kept across FSM sync).
  role_id?: string | null;
  role_name?: string | null;
  service_type_id?: string | null;
  service_type_name?: string | null;
  shift?: TechnicianShift | null;
  team_leader_fsm_id?: string | null;
  team_leader_name?: string | null;
}

export interface TechnicianTag {
  id: string;
  name: string;
  created_by?: string | null;
  created_at: string;
  updated_by?: string | null;
  updated_at: string;
  technician_count?: number;
}

export type LeaveStatus = "active" | "cancelled";

export interface LeaveRecord {
  id: string;
  technician_fsm_id: string;
  technician?: TechnicianReference;
  leave_type: string;
  start_at: string;
  end_at: string;
  status: LeaveStatus;
  notes?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_by?: string | null;
  updated_at: string;
  cancelled_by?: string | null;
  cancelled_at?: string | null;
}

export enum ActionType {
  CREATE = "create",
  EDIT = "edit",
  DELETE = "delete",
  VIEW = "view",
  EXPORT = "export",
  // Grants the holder the right to approve/reject a submitted schedule (#2).
  // Reused by snagging for the manager approval gate (BR-4).
  APPROVE = "approve",
}

// =====================================================
// Property Care / Snagging module
// Mirrors the snagging_* tables. Section refs are to the BRD.
// =====================================================

export type SnaggingSeverity = "low" | "medium" | "high";

/** FR-1.06 lifecycle, plus the resting state after a rejection. */
export type SnaggingTaskStatus =
  | "draft"
  | "assigned"
  | "in_progress"
  | "submitted"
  | "in_review"
  | "rejected"
  | "approved"
  | "delivered"
  | "cancelled";

export type SnaggingTaskType = "single_unit" | "full_building";

/** Which kind of visit a job is (Q1-Q6). */
export type SnaggingVisitType = "initial" | "desnag" | "additional";

export type SnaggingPropertyType =
  "apartment" | "villa" | "townhouse" | "commercial";

export type SnaggingServiceTier =
  "essential" | "comfort" | "full" | "b2b_building";

/** §5.3 — each category carries its own remediation path and SLA. */
export type SnaggingRejectionCategory =
  "minor" | "data_correction" | "critical";

/** §5.2 — the persistent snag status model. */
export type SnaggingSnagStatus =
  | "open"
  | "pending_verification"
  | "verified_closed"
  | "verified_poor_quality"
  | "verified_not_done"
  | "withdrawn";

export type SnaggingVerdict =
  | "verified_closed"
  | "verified_poor_quality"
  | "verified_not_done"
  | "withdrawn";

export type SnaggingAreaStatus = "pending" | "clear" | "has_snags";

export interface SnaggingCatalogueEntry {
  id: string;
  code: string;
  element_code: string;
  element_label: string;
  defect_code: string;
  defect_label: string;
  default_severity: SnaggingSeverity;
  guidance?: string | null;
  catalogue_version: string;
  active: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

export interface SnaggingCatalogueArea {
  code: string;
  label: string;
  sort_order: number;
  active: boolean;
}

export interface SnaggingProperty {
  id: string;
  crm_contact_id?: string | null;
  crm_property_id?: string | null;
  client_name: string;
  client_email?: string | null;
  client_phone?: string | null;
  unit_label: string;
  building_name?: string | null;
  community?: string | null;
  city?: string | null;
  property_type: SnaggingPropertyType;
  developer_name?: string | null;
  handover_date?: string | null;
  // Property record fields (BR-1). Present on the job-detail property object
  // and the snagging_properties endpoints.
  client_id?: string | null;
  bedrooms?: number | null;
  built_up_area_sqft?: number | null;
  plot_area_sqft?: number | null;
  external_areas_in_scope?: boolean | null;
  floors?: number | null;
  location_lat?: number | null;
  location_lng?: number | null;
  title_deed_path?: string | null;
  noc_required?: boolean | null;
  noc_path?: string | null;
  /** Signed, short-lived URLs to view/download the property documents (FR-3.04). */
  noc_url?: string | null;
  title_deed_url?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SnaggingArea {
  id: string;
  task_id: string;
  name: string;
  catalogue_area_code?: string | null;
  sort_order: number;
  status: SnaggingAreaStatus;
  /** Area pin on a floor plan (FR-3.05/3.07): the Floor -> Plan -> Pin -> Area link. */
  floor_plan_id?: string | null;
  pin_x?: number | null;
  pin_y?: number | null;
  note?: string | null;
  confirmed_at?: string | null;
  confirmed_by?: string | null;
  /** How reachable the room was on the day (R1-R6/J3). */
  access_state?: SnaggingAreaAccessState;
  access_reason?: string | null;
}

export type SnaggingAreaAccessState =
  "accessible" | "not_accessible" | "limited_access";

export interface SnaggingPhoto {
  id: string;
  snag_id: string;
  task_id: string;
  storage_path: string;
  media_type: "photo" | "video";
  bytes?: number | null;
  width?: number | null;
  height?: number | null;
  exif?: Record<string, unknown> | null;
  gps_lat?: number | null;
  gps_lng?: number | null;
  taken_at: string;
  round_number: number;
  /** Minted on read; never stored. */
  signed_url?: string | null;
}

export interface SnaggingSnag {
  id: string;
  property_id: string;
  origin_task_id: string;
  area_id: string;
  snag_code: string;
  catalogue_entry_id?: string | null;
  catalogue_code: string;
  area_code?: string | null;
  element_code?: string | null;
  defect_code?: string | null;
  area_label?: string | null;
  element_label?: string | null;
  defect_label?: string | null;
  severity: SnaggingSeverity;
  note?: string | null;
  floor_plan_id?: string | null;
  /** 0..1 fractions of the plan, so a pin survives any zoom level. */
  pin_x?: number | null;
  pin_y?: number | null;
  status: SnaggingSnagStatus;
  round_created: number;
  locked: boolean;
  captured_at: string;
  created_at?: string;
  updated_at?: string;
  photos?: SnaggingPhoto[];
  area?: Pick<SnaggingArea, "id" | "name"> | null;
}

export interface SnaggingFloorPlan {
  id: string;
  task_id?: string | null;
  property_id?: string | null;
  label: string;
  storage_path: string;
  mime_type?: string | null;
  page_number?: number;
  sort_order?: number | null;
  width?: number | null;
  height?: number | null;
  signed_url?: string | null;
}

export interface SnaggingAssignee {
  id: string;
  task_id: string;
  user_id: string;
  role: "technician" | "supervisor";
  user_profile?: Pick<
    User,
    "id" | "full_name" | "email" | "profile_image"
  > | null;
}

export interface SnaggingApprovalAction {
  id: string;
  task_id: string;
  action:
    | "submitted"
    | "supervisor_approved"
    | "supervisor_rejected"
    | "approved"
    | "rejected"
    | "escalated"
    | "reopened";
  rejection_category?: SnaggingRejectionCategory | null;
  comment?: string | null;
  actor_id?: string | null;
  created_at: string;
  actor?: Pick<User, "full_name" | "email"> | null;
}

export interface SnaggingTask {
  id: string;
  code: string;
  project_id?: string | null;
  property_id: string;
  task_type: SnaggingTaskType;
  service_tier?: SnaggingServiceTier | null;
  package_name?: string | null;
  round_number: number;
  /** Distinguishes a fresh pass, a de-snag round, and a chargeable extra visit (Q1-Q6). */
  visit_type?: SnaggingVisitType;
  /** Snapshot of the additional-visit price at booking time, additional visits only. */
  visit_charge?: number | null;
  parent_task_id?: string | null;
  status: SnaggingTaskStatus;
  scheduled_date?: string | null;
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
  /** Appointment date + time (FR-3.02). */
  appointment_at?: string | null;
  /** The single assigned inspector (FR-3.08). */
  inspector_id?: string | null;
  // Site contacts (FR-3.03) — developer-side and client-side representatives.
  developer_contact_name?: string | null;
  developer_contact_phone?: string | null;
  client_contact_name?: string | null;
  client_contact_phone?: string | null;
  supervisor_id?: string | null;
  approval_manager_id?: string | null;
  /**
   * Joined from approval_manager_id, so a screen can name who has to
   * sign an inspection off rather than only knowing that somebody must.
   */
  manager?: {
    id: string;
    full_name?: string | null;
    email?: string | null;
  } | null;
  notes?: string | null;
  catalogue_version: string;
  locked: boolean;
  started_at?: string | null;
  submitted_at?: string | null;
  approved_at?: string | null;
  delivered_at?: string | null;
  rejection_category?: SnaggingRejectionCategory | null;
  rejection_reason?: string | null;
  rejection_count: number;
  approval_due_at?: string | null;
  remediation_due_at?: string | null;
  created_at?: string;
  updated_at?: string;

  // Sign-off + delivery (K1-K3). Come through on the job row.
  signed_at?: string | null;
  signer_name?: string | null;
  signature_path?: string | null;
  delivery_channel?: string | null;
  delivery_recipient?: string | null;

  property?: SnaggingProperty | null;
  areas?: SnaggingArea[];
  snags?: SnaggingSnag[];
  assignees?: SnaggingAssignee[];
  approvals?: SnaggingApprovalAction[];
  floor_plans?: SnaggingFloorPlan[];
  checklist?: SnaggingChecklistItem[];
  submissions?: SnaggingSubmission[];
}

/** One append-only audit event on an inspection (BR-5). */
export interface SnaggingAuditEvent {
  id: number;
  event_type: string;
  entity_type: string;
  actor_label?: string | null;
  origin?: string | null;
  justification?: string | null;
  payload?: Record<string, unknown> | null;
  created_at: string;
}

/** The inspector's on-site sign-off for a visit (FR-2.08). */
export interface SnaggingSubmission {
  id: string;
  task_id: string;
  attempt: number;
  signed_at?: string | null;
  signer_name?: string | null;
  signature_path?: string | null;
  signature_url?: string | null;
}

export type SnaggingChecklistStatus =
  "pending" | "passed" | "failed" | "not_checked";

export interface SnaggingChecklistItem {
  id: string;
  code: string;
  group_name: string;
  label: string;
  mandatory: boolean;
  status: SnaggingChecklistStatus;
  reason?: string | null;
  sort_order: number;
}

/** Row shape of the snagging_task_summaries view. */
export interface SnaggingTaskSummary {
  id: string;
  code: string;
  status: SnaggingTaskStatus;
  task_type: SnaggingTaskType;
  round_number: number;
  visit_type?: SnaggingVisitType;
  parent_task_id?: string | null;
  scheduled_date?: string | null;
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
  package_name?: string | null;
  service_tier?: SnaggingServiceTier | null;
  locked: boolean;
  rejection_category?: SnaggingRejectionCategory | null;
  rejection_reason?: string | null;
  rejection_count: number;
  remediation_due_at?: string | null;
  approval_due_at?: string | null;
  submitted_at?: string | null;
  approved_at?: string | null;
  delivered_at?: string | null;
  created_at: string;
  updated_at: string;
  supervisor_id?: string | null;
  approval_manager_id?: string | null;
  property_id: string;
  unit_label: string;
  building_name?: string | null;
  community?: string | null;
  property_type: SnaggingPropertyType;
  client_name: string;
  developer_name?: string | null;
  area_count: number;
  confirmed_area_count: number;
  snag_count: number;
  high_severity_count: number;
  open_snag_count: number;
  photo_count: number;
  /** Attached by the list route from the assignee and snag tables. */
  inspector_name?: string | null;
  medium_severity_count?: number;
  low_severity_count?: number;
  /** FR-6.07 — submitted more than 48h ago and still awaiting a decision. */
  escalated?: boolean;
}

/** Payload behind the "Today at a glance" dashboard. */
/** Day / week / month, the three grains FR-10.01 asks the throughput chart for. */
export type SnaggingAnalyticsGranularity = "day" | "week" | "month";

/**
 * Operations analytics (FR-10.01 to FR-10.06).
 *
 * Two deliberate absences, both required rather than incidental:
 *
 * - No severity or element distribution (FR-10.05). Those breakdowns
 *   say nothing once you compare one project against another, and the
 *   client report is where they belong (FR-7.02).
 * - No snag count against an inspector (FR-10.04). Counting an
 *   inspector's snags rewards whoever walks the worst buildings.
 */
export interface SnaggingAnalytics {
  /**
   * FR-10.01 — every status the jobs raised in the period sit in, with
   * the movement against the window before it.
   */
  byStatus: Array<{
    status: SnaggingTaskStatus;
    count: number;
    trend: number | null;
  }>;
  /**
   * FR-10.01 — the review queue by submission time. Live, not scoped to
   * the date range: a queue filtered by an arbitrary window would show a
   * reviewer less work than is actually waiting.
   */
  reviewQueue: {
    total: number;
    oldestSubmittedAt: string | null;
    buckets: Array<{
      bucket: "under_24h" | "h24_48" | "over_48h";
      count: number;
    }>;
  };
  /**
   * FR-10.01 — jobs completed, counted at approval.
   *
   * All three grains come back together. They are the same rows bucketed
   * three ways, so computing them costs nothing extra, and it means
   * switching between day, week and month is a local state change rather
   * than a round trip that empties the whole page into a skeleton.
   */
  completed: {
    total: number;
    series: Record<
      SnaggingAnalyticsGranularity,
      Array<{ period: string; label: string; count: number }>
    >;
  };
  /** FR-10.02 — the five time metrics, each with the sample it was taken over. */
  timeMetrics: {
    avgMinutesOnSite: number | null;
    onSiteSample: number;
    avgSubmitToApprovalMinutes: number | null;
    submitToApprovalSample: number;
    firstTimeApprovalRate: number | null;
    firstTimeApprovalSample: number;
    deliveredWithin24hRate: number | null;
    deliveredSample: number;
    /** Live count, like the queue above — not scoped to the date range. */
    overdueApprovals: number;
  };
  /** FR-10.03 — developer view. */
  byDeveloper: Array<{
    developer_name: string;
    /** Units this period against the one before, as a signed count. */
    unit_trend: number | null;
    last_inspection_at: string | null;
    unit_count: number;
    snag_count: number;
    snags_per_unit: number;
    outstanding_count: number;
    /**
     * FR-10.03 defect mix: which defects this developer's units keep
     * failing on. Scoped to one developer on purpose — the portfolio-wide
     * version of this chart is what FR-10.05 rules out.
     */
    defect_mix: Array<{ label: string; count: number }>;
  }>;
  /** FR-10.04 — inspector view. Inspections and time, never snag volume. */
  byInspector: Array<{
    user_id: string;
    name: string;
    inspection_count: number;
    avgMinutesPerInspection: number | null;
    timedSample: number;
    /**
     * The two office-side measures, per inspector. Portfolio-wide they
     * are already in the stat row; per person is what makes this table
     * say something the rest of the page does not.
     */
    firstTimeApprovalRate: number | null;
    approvalSample: number;
    avgSubmitToApprovalMinutes: number | null;
  }>;
}

/** The figures on the analytics page a reader can open (FR-10.06). */
export type SnaggingAnalyticsMetric =
  | "status"
  | "review_queue"
  | "completed"
  | "time_on_site"
  | "submit_to_approval"
  | "first_time_approval"
  | "delivered_sla"
  | "overdue_approvals"
  | "developer"
  | "inspector";

/**
 * The records behind one figure (FR-10.06).
 *
 * The server names the columns as well as the rows, so the drill-down
 * table and the CSV / Excel file it exports cannot drift apart, and each
 * metric can show the fields that actually explain it — a duration for a
 * time metric, a rejection count for first-time approval.
 */
export interface SnaggingAnalyticsDrilldown {
  metric: SnaggingAnalyticsMetric;
  title: string;
  description: string;
  columns: Array<{ key: string; label: string; align?: "left" | "right" }>;
  rows: Array<Record<string, string | number | null> & { id: string }>;
  totalCount: number;
}

export interface Settings {
  id: string;
  site_name?: string;
  site_description?: string;
  site_image?: string;
  appearance_theme?: string;
  primary_color?: string;
  secondary_color?: string;
  logo_url?: string;
  logo_horizontal_url?: string;
  favicon_url?: string;
  meta_keywords?: string;
  meta_description?: string;
  contact_email?: string;
  social_links?: string;
  created_at?: string;
  updated_at?: string;
  logo_setting?: string;
  type?: UserRoles;
  user_id?: User;
  oauth_access_token?: string;
  oauth_token_refreshed_at?: string;
}
