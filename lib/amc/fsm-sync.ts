/**
 * Active AMC <-> Zoho FSM: the rules, without I/O.
 *
 * What the repository and the production data establish (see
 * docs/amc-fsm-integration-report.md):
 *
 *  - An FSM Service Appointment's Status is a per-org editable picklist.
 *    The values seen in production are New/Scheduled/Dispatched/In
 *    Progress/Completed/Cannot Complete (schedule_entries.fsm_status, 6 Oct
 *    2026). Every "Completed" record read carried Actual_Start_Date_Time,
 *    Actual_End_Date_Time and Actual_Duration; no other status did.
 *  - Whether "Completed" means "the AMC service was delivered", and whether
 *    a completed appointment can be reopened, is NOT confirmed by the
 *    business. So automatic consumption and reversal are OFF below.
 *  - FSM has no shared customer or service identifier with AMC. Both are
 *    explicit links (amc_contracts.fsm_contact_id, amc_fsm_service_mappings).
 *  - Actual_Duration is the appointment's elapsed time, not approved
 *    handyman hours. Hours are never consumed from it automatically.
 *  - FSM records no request time and no arrival time as such. SLA fields
 *    are mapped only where a person has confirmed what they mean.
 */
import {
  checkUsage,
  usageDate,
  type CallOutClass,
  type ContractEntitlement,
  type ContractForRules,
  type EntitlementType,
} from "./contracts";
import { resolveAppointmentState, type AppointmentState } from "@/lib/scheduling/appointment-status";
import { evaluateSla, type SlaEvaluation } from "./sla";

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

export interface FsmAutomationConfig {
  /**
   * FSM statuses that mean the work was done, matched exactly (case and
   * spacing ignored). "Completed" is the value seen in production; it is
   * listed so the engine can be exercised, but it only drives automatic
   * consumption once `autoConsume` is switched on.
   */
  completedStatuses: ReadonlyArray<string>;
  /** Per entitlement type: may a completed appointment be consumed without a person confirming it? */
  autoConsume: Record<"visits" | "hours" | "unlimited", boolean>;
  /** May a consumed appointment that is no longer completed be reversed automatically? */
  autoReverse: boolean;
  /** Visits counted per completed appointment. */
  visitsPerAppointment: number;
  /**
   * Where hours come from. null: no trustworthy source; hours are entered by
   * a person. "actual_duration" would use FSM's Actual_Duration (elapsed
   * appointment time, not approved labour hours).
   */
  hoursSource: null | "actual_duration";
}

/** Everything automatic is off until the business confirms the signal and the mappings. */
export const AMC_FSM_AUTOMATION: FsmAutomationConfig = {
  completedStatuses: ["Completed"],
  autoConsume: { visits: false, hours: false, unlimited: false },
  autoReverse: false,
  visitsPerAppointment: 1,
  hoursSource: null,
};

export function automationSummary(config: FsmAutomationConfig = AMC_FSM_AUTOMATION) {
  return {
    visits: config.autoConsume.visits,
    hours: config.autoConsume.hours && config.hoursSource !== null,
    unlimited: config.autoConsume.unlimited,
    reversal: config.autoReverse,
    any: config.autoConsume.visits || config.autoConsume.unlimited || (config.autoConsume.hours && config.hoursSource !== null),
  };
}

/* ------------------------------------------------------------------ */
/* FSM appointment snapshot                                            */
/* ------------------------------------------------------------------ */

/** The parts of an FSM Service Appointment the AMC rules read. */
export interface FsmAppointmentSnapshot {
  id: string;
  name: string | null;
  status: string | null;
  workOrderId: string | null;
  workOrderName: string | null;
  contactId: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  actualDurationSeconds: number | null;
  cancelledOrTerminatedAt: string | null;
  /** Service line items this appointment covers (live associations only). */
  lineItemIds: string[];
}

type Raw = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const relId = (v: unknown): string | null => (v && typeof v === "object" ? str((v as Raw).id) : null);
const relName = (v: unknown): string | null => (v && typeof v === "object" ? str((v as Raw).name) : null);

/**
 * FSM's Actual_Duration, seen as { unit: <seconds>, hours: "HH:MM:SS" }.
 * Anything else reads as unknown rather than guessed.
 */
export function parseActualDuration(value: unknown): number | null {
  if (value && typeof value === "object") {
    const unit = (value as Raw).unit;
    if (typeof unit === "number" && Number.isFinite(unit) && unit >= 0) return Math.round(unit);
    const hours = (value as Raw).hours;
    if (typeof hours === "string") {
      const m = /^(\d+):(\d{2}):(\d{2})$/.exec(hours.trim());
      if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    }
  }
  return null;
}

/** Maps a full FSM Service_Appointments record (GET /Service_Appointments/{id}). */
export function snapshotFromFsmRecord(record: Raw): FsmAppointmentSnapshot {
  const axs = Array.isArray(record.Appointments_X_Services) ? (record.Appointments_X_Services as Raw[]) : [];
  const lineItemIds = axs
    .filter((a) => a.is_line_item_active !== false)
    .map((a) => relId(a.Service_Line_Item))
    .filter((id): id is string => Boolean(id));
  return {
    id: String(record.id ?? ""),
    name: str(record.Name),
    status: str(record.Status),
    workOrderId: relId(record.Work_Order),
    workOrderName: relName(record.Work_Order),
    contactId: relId(record.Contact),
    scheduledStart: str(record.Scheduled_Start_Date_Time),
    scheduledEnd: str(record.Scheduled_End_Date_Time),
    actualStart: str(record.Actual_Start_Date_Time),
    actualEnd: str(record.Actual_End_Date_Time),
    actualDurationSeconds: parseActualDuration(record.Actual_Duration),
    cancelledOrTerminatedAt: str(record.Cancelled_Or_Terminated_Time),
    lineItemIds: [...new Set(lineItemIds)],
  };
}

export function appointmentState(snapshot: Pick<FsmAppointmentSnapshot, "status">): AppointmentState {
  return resolveAppointmentState(snapshot.status);
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Completed, for AMC purposes: the status is one of the configured
 * completion statuses (exact, not pattern-matched) AND FSM recorded when
 * the work ended. A status alone is not enough.
 */
export function isCompletedAppointment(
  snapshot: Pick<FsmAppointmentSnapshot, "status" | "actualEnd">,
  config: FsmAutomationConfig = AMC_FSM_AUTOMATION,
): boolean {
  if (!snapshot.status || !snapshot.actualEnd) return false;
  const status = norm(snapshot.status);
  return config.completedStatuses.some((s) => norm(s) === status);
}

/* ------------------------------------------------------------------ */
/* Customer and service mapping                                        */
/* ------------------------------------------------------------------ */

export type FsmCustomerCheck = "match" | "mismatch" | "contract_unlinked" | "appointment_without_contact";

/** Compares the contract's linked FSM contact with the work's contact. Ids only, never names. */
export function checkFsmCustomer(contractFsmContactId: string | null | undefined, workContactId: string | null | undefined): FsmCustomerCheck {
  if (!contractFsmContactId) return "contract_unlinked";
  if (!workContactId) return "appointment_without_contact";
  return contractFsmContactId.trim() === workContactId.trim() ? "match" : "mismatch";
}

export interface FsmServiceMapping {
  amcServiceId: string;
  fsmServiceId: string;
  fsmServiceName?: string | null;
  active: boolean;
}

/** The AMC service an FSM service maps to, or null when unmapped. */
export function amcServiceForFsmService(
  fsmServiceId: string | null | undefined,
  mappings: ReadonlyArray<FsmServiceMapping>,
): string | null {
  if (!fsmServiceId) return null;
  return mappings.find((m) => m.active && m.fsmServiceId === fsmServiceId)?.amcServiceId ?? null;
}

export type FsmServiceCheck = "mapped" | "mismatch" | "unmapped" | "no_service";

/** Does the FSM service of the linked line belong to the entitlement's AMC service? */
export function checkFsmService(
  fsmServiceId: string | null | undefined,
  entitlementServiceId: string,
  mappings: ReadonlyArray<FsmServiceMapping>,
): FsmServiceCheck {
  if (!fsmServiceId) return "no_service";
  const amc = amcServiceForFsmService(fsmServiceId, mappings);
  if (!amc) return "unmapped";
  return amc === entitlementServiceId ? "mapped" : "mismatch";
}

/** How many of a contract's countable services have an active FSM mapping. */
export function mappingCoverage(
  entitlements: ReadonlyArray<Pick<ContractEntitlement, "serviceId" | "entitlementType">>,
  mappings: ReadonlyArray<FsmServiceMapping>,
): { mapped: number; total: number; unmapped: string[] } {
  const relevant = entitlements.filter((e) => e.entitlementType !== "informational");
  const active = new Set(mappings.filter((m) => m.active).map((m) => m.amcServiceId));
  const unmapped = relevant.filter((e) => !active.has(e.serviceId)).map((e) => e.serviceId);
  return { mapped: relevant.length - unmapped.length, total: relevant.length, unmapped };
}

/* ------------------------------------------------------------------ */
/* Quantity                                                            */
/* ------------------------------------------------------------------ */

export type QuantityDecision =
  | { ok: true; quantity: number; source: "per_appointment" | "actual_duration" }
  | { ok: false; code: "informational" | "hours_unavailable"; reason: string; suggestedHours: number | null };

/** What one completed appointment consumes, by entitlement type. */
export function consumptionQuantity(
  type: EntitlementType,
  snapshot: Pick<FsmAppointmentSnapshot, "actualDurationSeconds">,
  config: FsmAutomationConfig = AMC_FSM_AUTOMATION,
): QuantityDecision {
  if (type === "informational") {
    return { ok: false, code: "informational", reason: "Informational services are not consumed.", suggestedHours: null };
  }
  if (type === "visits" || type === "unlimited") {
    /* Unlimited is recorded for reporting; it never exhausts. */
    return { ok: true, quantity: config.visitsPerAppointment, source: "per_appointment" };
  }
  const suggestedHours =
    snapshot.actualDurationSeconds !== null ? Math.round((snapshot.actualDurationSeconds / 3600) * 100) / 100 : null;
  if (config.hoursSource === "actual_duration" && suggestedHours !== null && suggestedHours > 0) {
    return { ok: true, quantity: suggestedHours, source: "actual_duration" };
  }
  return {
    ok: false,
    code: "hours_unavailable",
    reason:
      "FSM does not record approved handyman hours. Enter the hours; FSM's actual duration is shown for reference only.",
    suggestedHours,
  };
}

/* ------------------------------------------------------------------ */
/* The plan for one appointment                                        */
/* ------------------------------------------------------------------ */

export type FsmPlanCode =
  | "completed"
  | "already_recorded"
  | "not_completed"
  | "reversal_candidate"
  | "customer_mismatch"
  | "customer_unverified"
  | "service_mismatch"
  | "service_unmapped"
  | "informational"
  | "hours_unavailable"
  | "usage_refused"
  | "automation_disabled"
  | "already_reversed";

export type FsmUsagePlan =
  | {
      action: "consume";
      quantity: number;
      occurredAt: string;
      /** May run without a person: automation on, customer and service verified. */
      autoAllowed: boolean;
      code: FsmPlanCode;
      reason: string;
      warnings: FsmPlanCode[];
    }
  | {
      action: "reverse";
      quantity: number;
      correctsUsageId: string;
      autoAllowed: boolean;
      code: "reversal_candidate";
      reason: string;
      warnings: FsmPlanCode[];
    }
  | {
      action: "review";
      code: FsmPlanCode;
      reason: string;
      /** Hours: FSM's elapsed time, for reference only. */
      suggestedQuantity: number | null;
      occurredAt: string | null;
      warnings: FsmPlanCode[];
    }
  | { action: "skip"; code: FsmPlanCode; reason: string; warnings: FsmPlanCode[] };

export interface FsmPlanInput {
  snapshot: FsmAppointmentSnapshot;
  contract: Pick<ContractForRules, "status" | "startDate" | "endDate"> & { fsmContactId: string | null };
  entitlement: Pick<ContractEntitlement, "serviceId" | "entitlementType" | "includedQuantity" | "usedQuantity">;
  /** The FSM service on the linked line, when the link names one. */
  linkFsmServiceId: string | null;
  mappings: ReadonlyArray<FsmServiceMapping>;
  /** This appointment's consumption already in the ledger for this entitlement, net of corrections. */
  existing: { usageId: string | null; netQuantity: number };
  /** A person is confirming (and, for hours, entering the quantity). */
  confirm?: { quantity?: number | null } | null;
  config?: FsmAutomationConfig;
}

/**
 * Decides what one FSM appointment means for one entitlement. Pure: the
 * caller reads FSM and the ledger, then writes what this returns.
 *
 * Coverage checking and consumption stay separate: this never writes, and
 * a "consume" plan is still refused by the database if the allowance was
 * used meanwhile.
 */
export function planFsmUsage(input: FsmPlanInput): FsmUsagePlan {
  const config = input.config ?? AMC_FSM_AUTOMATION;
  const { snapshot, contract, entitlement, existing } = input;
  const warnings: FsmPlanCode[] = [];

  /* 1. Is this the contract's customer? A different FSM contact is never consumed. */
  const customer = checkFsmCustomer(contract.fsmContactId, snapshot.contactId);
  if (customer === "mismatch") {
    return {
      action: "skip",
      code: "customer_mismatch",
      reason: "The appointment's FSM contact is not the contract's linked FSM customer.",
      warnings,
    };
  }
  if (customer !== "match") warnings.push("customer_unverified");

  /* 2. Is the linked FSM service this entitlement's service? */
  const service = checkFsmService(input.linkFsmServiceId, entitlement.serviceId, input.mappings);
  if (service === "mismatch") {
    return {
      action: "skip",
      code: "service_mismatch",
      reason: "The FSM service on this work is mapped to a different AMC service.",
      warnings,
    };
  }
  if (service !== "mapped") warnings.push("service_unmapped");

  const completed = isCompletedAppointment(snapshot, config);

  /* 3. No longer completed, but consumed: a reversal candidate. */
  if (!completed) {
    if (existing.usageId && existing.netQuantity > 0) {
      const state = appointmentState(snapshot);
      return {
        action: "reverse",
        quantity: existing.netQuantity,
        correctsUsageId: existing.usageId,
        autoAllowed: config.autoReverse,
        code: "reversal_candidate",
        reason: `The appointment was recorded as used but FSM now shows it as ${snapshot.status ?? "no status"} (${state.replace("_", " ")}).`,
        warnings,
      };
    }
    if (existing.usageId && existing.netQuantity <= 0) {
      return { action: "skip", code: "already_reversed", reason: "Already recorded and taken back.", warnings };
    }
    return {
      action: "skip",
      code: "not_completed",
      reason: snapshot.status
        ? `FSM shows ${snapshot.status}${snapshot.actualEnd ? "" : " with no actual end time"}: not completed.`
        : "FSM shows no status: not completed.",
      warnings,
    };
  }

  /* 4. Completed and already recorded: nothing to do (idempotent). */
  if (existing.usageId) {
    return {
      action: "skip",
      code: existing.netQuantity > 0 ? "already_recorded" : "already_reversed",
      reason:
        existing.netQuantity > 0
          ? "This appointment is already recorded against this service."
          : "This appointment was recorded and then taken back; record it again by hand if it should count.",
      warnings,
    };
  }

  /* 5. How much. */
  const occurredAt = usageDate(snapshot.actualEnd ?? snapshot.scheduledStart ?? "");
  let quantity: number;
  const decided = consumptionQuantity(entitlement.entitlementType, snapshot, config);
  if (decided.ok) {
    quantity = input.confirm?.quantity ?? decided.quantity;
  } else if (decided.code === "hours_unavailable" && input.confirm?.quantity) {
    quantity = input.confirm.quantity;
  } else if (decided.code === "hours_unavailable") {
    return {
      action: "review",
      code: "hours_unavailable",
      reason: decided.reason,
      suggestedQuantity: decided.suggestedHours,
      occurredAt,
      warnings,
    };
  } else {
    return { action: "skip", code: decided.code, reason: decided.reason, warnings };
  }

  /* 6. Would the ledger accept it (in force on the work date, allowance left)? */
  const check = checkUsage({
    contract,
    entitlement,
    kind: "consumption",
    quantity,
    occurredAt,
  });
  if (!check.ok) {
    return { action: "skip", code: "usage_refused", reason: check.error, warnings };
  }

  /* 7. Automatic only when switched on AND the customer and service are verified. */
  const typeAuto =
    entitlement.entitlementType === "hours"
      ? config.autoConsume.hours && decided.ok
      : entitlement.entitlementType === "visits"
        ? config.autoConsume.visits
        : config.autoConsume.unlimited;
  const autoAllowed = typeAuto && customer === "match" && service === "mapped";
  if (!autoAllowed && !input.confirm) {
    return {
      action: "review",
      code: typeAuto ? warnings[0] ?? "automation_disabled" : "automation_disabled",
      reason: typeAuto
        ? "Completed in FSM, but the customer or service mapping is not verified. Confirm to record it."
        : "Completed in FSM. Automatic usage is switched off: confirm to record it.",
      suggestedQuantity: check.quantity,
      occurredAt,
      warnings,
    };
  }
  return {
    action: "consume",
    quantity: check.quantity,
    occurredAt,
    autoAllowed,
    code: "completed",
    reason: `Completed in FSM (${snapshot.status}).`,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* SLA from FSM data                                                   */
/* ------------------------------------------------------------------ */

/**
 * Which FSM fields stand for the SLA's events. Null: not confirmed, so the
 * SLA reads UNKNOWN. requested_at always comes from the AMC link (entered
 * by staff when the customer asked); FSM has no request time and
 * Created_Time is not one.
 */
export interface SlaFieldMapping {
  /** Attendance (emergency): e.g. "actual_start", once confirmed to mean arrival. */
  arrivedAt: null | "actual_start";
  /** Scheduling (non-emergency): when the visit was booked. FSM has no field for that. */
  scheduledAt: null;
}

export const AMC_SLA_FSM_FIELDS: SlaFieldMapping = { arrivedAt: null, scheduledAt: null };

export interface VisitSla extends SlaEvaluation {
  /** Why the state is unknown, when it is. */
  missing: string | null;
  actualMinutes: number | null;
}

export function slaForVisit(
  callOutClass: CallOutClass | null,
  input: {
    requestedAt: string | null;
    snapshot: Pick<FsmAppointmentSnapshot, "actualStart"> | null;
    completed: boolean;
  },
  { mapping = AMC_SLA_FSM_FIELDS, now = new Date() }: { mapping?: SlaFieldMapping; now?: Date } = {},
): VisitSla {
  const unknown = (missing: string): VisitSla => ({
    state: "unknown",
    definition: null,
    targetAt: null,
    actualAt: null,
    minutesFromTarget: null,
    missing,
    actualMinutes: null,
  });
  if (!callOutClass) return unknown("No response target for this kind of work.");
  if (!input.requestedAt) return unknown("No request time recorded.");
  const field = callOutClass === "emergency" ? mapping.arrivedAt : mapping.scheduledAt;
  if (!field) {
    return {
      ...unknown(
        callOutClass === "emergency"
          ? "The attendance time is not mapped to an FSM field yet."
          : "FSM has no time for when the visit was booked.",
      ),
      definition: evaluateSla(callOutClass, { requestedAt: input.requestedAt }, { now }).definition,
    };
  }
  const arrivedAt = field === "actual_start" ? input.snapshot?.actualStart ?? null : null;
  /* A finished visit with no measured time is unknown, not breached. */
  if (!arrivedAt && input.completed) return unknown("FSM has no actual start time for this visit.");
  const evaluation = evaluateSla(
    callOutClass,
    callOutClass === "emergency"
      ? { requestedAt: input.requestedAt, arrivedAt }
      : { requestedAt: input.requestedAt, scheduledAt: arrivedAt },
    { now },
  );
  const actualMinutes =
    arrivedAt && input.requestedAt
      ? Math.round((Date.parse(arrivedAt) - Date.parse(input.requestedAt)) / 60_000)
      : null;
  return { ...evaluation, missing: null, actualMinutes };
}
