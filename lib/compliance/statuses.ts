// Labels, tones and ordering for the compliance item statuses (FRD section 5)
// and the action-required labels (FR-7, decision D12: the workbook's five).

import type { ComplianceItemStatus } from "./status";

export type StatusTone = "success" | "info" | "warning" | "danger" | "muted";

export const ITEM_STATUS_LABEL: Record<ComplianceItemStatus, string> = {
  valid: "Valid",
  due_90: "Due in 90 days",
  due_60: "Due in 60 days",
  due_30: "Due in 30 days",
  expired: "Expired",
  missing_expiry: "Missing expiry",
  not_held: "Not held",
};

/* Colour follows the workbook's legend: red expired, yellow within 60, blue
   within 90, green valid. Missing expiry is treated as urgent (red) because it
   hides a possibly expired document. */
export const ITEM_STATUS_TONE: Record<ComplianceItemStatus, StatusTone> = {
  valid: "success",
  due_90: "info",
  due_60: "warning",
  due_30: "warning",
  expired: "danger",
  missing_expiry: "danger",
  not_held: "muted",
};

/** Most urgent first; used for sorting and for picking a record's worst item. */
export const ITEM_STATUS_ORDER: ComplianceItemStatus[] = [
  "expired",
  "missing_expiry",
  "due_30",
  "due_60",
  "due_90",
  "valid",
  "not_held",
];

export function statusRank(status: ComplianceItemStatus): number {
  return ITEM_STATUS_ORDER.indexOf(status);
}

export type ActionRequired =
  | "Renew Immediately"
  | "Start Renewal Now"
  | "Prepare Documents"
  | "Plan Renewal"
  | "Enter expiry date"
  | "No Action";

export function actionRequired(status: ComplianceItemStatus): ActionRequired {
  switch (status) {
    case "expired":
      return "Renew Immediately";
    case "due_30":
      return "Start Renewal Now";
    case "due_60":
      return "Prepare Documents";
    case "due_90":
      return "Plan Renewal";
    case "missing_expiry":
      return "Enter expiry date";
    default:
      return "No Action";
  }
}

export type ComplianceEmploymentStatus = "active" | "on_leave" | "inactive" | "resigned" | "terminated";

export const EMPLOYMENT_STATUS_LABEL: Record<ComplianceEmploymentStatus, string> = {
  active: "Active",
  on_leave: "On Leave",
  inactive: "Inactive",
  resigned: "Resigned",
  terminated: "Terminated",
};

export const EMPLOYMENT_STATUSES: ComplianceEmploymentStatus[] = ["active", "on_leave", "inactive", "resigned", "terminated"];

/*
  Who counts as "active manpower" for the KPIs and the reminders. Plan
  decision 5 (pending Sami's confirmation): Active and On Leave, per the D11
  context. Change this one constant if the answer is Active only.
*/
export const ACTIVE_MANPOWER_STATUSES: ComplianceEmploymentStatus[] = ["active", "on_leave"];

export function isActiveManpower(status: ComplianceEmploymentStatus): boolean {
  return ACTIVE_MANPOWER_STATUSES.includes(status);
}
