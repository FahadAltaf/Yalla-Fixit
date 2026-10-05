import { format } from "date-fns";

import type { ContractDisplayStatus, EntitlementState, EntitlementType } from "@/lib/amc/contracts";

/* Same colour language as the proposal statuses (amc-status.ts): green is
   in force, amber needs attention soon, red is over, muted is not yet. */
export const CONTRACT_STATUS_LABELS: Record<ContractDisplayStatus, string> = {
  pending_activation: "Pending activation",
  not_started: "Not started",
  active: "Active",
  expiring: "Expiring",
  expired: "Expired",
  cancelled: "Cancelled",
};

export function contractStatusTone(status: ContractDisplayStatus): string {
  switch (status) {
    case "active":
      return "bg-green-600/10 text-green-700 dark:bg-green-400/10 dark:text-green-400";
    case "expiring":
    case "pending_activation":
      return "bg-amber-600/10 text-amber-700 dark:bg-amber-400/10 dark:text-amber-400";
    case "expired":
    case "cancelled":
      return "bg-destructive/10 text-destructive";
    case "not_started":
    default:
      return "bg-sky-600/10 text-sky-700 dark:bg-sky-400/10 dark:text-sky-400";
  }
}

export const ENTITLEMENT_TYPE_LABELS: Record<EntitlementType, string> = {
  visits: "Visits",
  hours: "Hours",
  unlimited: "Unlimited",
  informational: "Included",
};

/** dd/MM/yyyy, as the AMC documents print dates. */
export function formatContractDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? "—" : format(date, "dd/MM/yyyy");
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : format(date, "d MMM yyyy, HH:mm");
}

/** "30 days left", "Ends today", "Ended 3 days ago", or "—". */
export function daysRemainingLabel(days: number | null): string {
  if (days === null) return "—";
  if (days > 1) return `${days} days left`;
  if (days === 1) return "1 day left";
  if (days === 0) return "Ends today";
  if (days === -1) return "Ended yesterday";
  return `Ended ${Math.abs(days)} days ago`;
}

/* What each service is doing today. No percentage for unlimited or
   included services: there is nothing to divide by. */
export const ENTITLEMENT_STATE_LABELS: Record<EntitlementState, string> = {
  available: "Available",
  low_remaining: "Low remaining",
  exhausted: "Exhausted",
  unlimited: "Unlimited",
  included: "Included",
  not_started: "Not started",
  expired: "Expired",
  cancelled: "Cancelled",
};

export function entitlementStateTone(state: EntitlementState): string {
  switch (state) {
    case "available":
      return "bg-green-600/10 text-green-700 dark:bg-green-400/10 dark:text-green-400";
    case "low_remaining":
      return "bg-amber-600/10 text-amber-700 dark:bg-amber-400/10 dark:text-amber-400";
    case "exhausted":
    case "expired":
    case "cancelled":
      return "bg-destructive/10 text-destructive";
    case "unlimited":
    case "included":
      return "bg-violet-600/10 text-violet-700 dark:bg-violet-400/10 dark:text-violet-300";
    case "not_started":
    default:
      return "bg-sky-600/10 text-sky-700 dark:bg-sky-400/10 dark:text-sky-400";
  }
}

export const CALL_OUT_LABELS = { emergency: "Emergency", non_emergency: "Non-emergency" } as const;

/** The contract history, in words. */
export const AUDIT_LABELS: Record<string, string> = {
  contract_activated: "Contract activated",
  contract_cancelled: "Contract cancelled",
  entitlement_consumed: "Usage recorded",
  entitlement_adjusted: "Usage adjusted",
  entitlement_corrected: "Usage corrected",
  renewal_created: "Renewal proposal created",
  renewal_reminders_created: "Renewal reminders created",
};

export function externalRefLabel(type: string | null): string {
  if (type === "fsm_appointment") return "Appointment";
  if (type === "schedule_entry") return "Schedule entry";
  return "Work order";
}
