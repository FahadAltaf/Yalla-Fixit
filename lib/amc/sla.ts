/**
 * AMC service levels: definitions and evaluation. No scheduler: this only
 * answers "was this request handled within target?" for whichever
 * timestamps exist.
 *
 * The AMC customer requirements give two targets:
 *   emergency call-out:      attendance within 120 minutes of the request
 *   non-emergency call-out:  scheduled within 48 hours of the request
 *                            (BRD v0.3 5.13 and the contract; the old brochure
 *                            said 6 hours)
 *
 * The portal does not record request, scheduling or arrival times for FSM
 * work today (schedule_entries keeps FSM's raw status, not timestamps), so
 * nothing is evaluated automatically yet. Callers pass the timestamps they
 * have; missing ones give "pending" or "unknown", never an invented
 * answer.
 */
import type { CallOutClass } from "./contracts";

export type SlaMetric = "attendance" | "scheduling";

export interface SlaDefinition {
  callOutClass: CallOutClass;
  metric: SlaMetric;
  /** Minutes from request to the event the metric measures. */
  targetMinutes: number;
  label: string;
}

/**
 * Defaults from the AMC requirements. Overridable per call, so a contract
 * or a settings screen can supply its own later without code changes.
 */
export const AMC_SLA_DEFAULTS: Record<CallOutClass, SlaDefinition> = {
  emergency: {
    callOutClass: "emergency",
    metric: "attendance",
    targetMinutes: 120,
    label: "Emergency attendance within 2 hours",
  },
  non_emergency: {
    callOutClass: "non_emergency",
    metric: "scheduling",
    targetMinutes: 48 * 60,
    label: "Non-emergency scheduling within 48 hours",
  },
};

/** "120 minutes", "2 hours", "48 hours": a duration as a target reads. */
function minutesText(minutes: number): string {
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  return `${minutes} minutes`;
}

/**
 * The targets as AMC configuration sets them (Scheduling and SLA), with the
 * requirement defaults where none is given. 27 Nov 2026: the contract page,
 * the coverage check and the FSM visit list printed the defaults (and "6 h")
 * whatever the settings said.
 */
export function slaDefinitionsFrom(
  sla?: { emergencyAttendMinutes?: number | null; nonEmergencyScheduleHours?: number | null } | null,
): Record<CallOutClass, SlaDefinition> {
  const emergency = sla?.emergencyAttendMinutes ?? AMC_SLA_DEFAULTS.emergency.targetMinutes;
  const nonEmergency = (sla?.nonEmergencyScheduleHours ?? AMC_SLA_DEFAULTS.non_emergency.targetMinutes / 60) * 60;
  return {
    emergency: { ...AMC_SLA_DEFAULTS.emergency, targetMinutes: emergency, label: `Emergency attendance within ${minutesText(emergency)}` },
    non_emergency: { ...AMC_SLA_DEFAULTS.non_emergency, targetMinutes: nonEmergency, label: `Non-emergency scheduling within ${minutesText(nonEmergency)}` },
  };
}

/** "Emergency: 120 min", "Non-emergency: 48 h": the short form on a visit row. */
export function slaShortLabel(definition: SlaDefinition): string {
  const m = definition.targetMinutes;
  const target = m % 60 === 0 && m >= 180 ? `${m / 60} h` : `${m} min`;
  return `${definition.callOutClass === "emergency" ? "Emergency" : "Non-emergency"}: ${target}`;
}

export type SlaState =
  /* the measured event happened within target */
  | "met"
  /* it happened late, or the target passed without it */
  | "breached"
  /* not happened yet, target not yet passed */
  | "pending"
  /* no request time, or no SLA for this kind of work */
  | "unknown";

export interface SlaEvaluation {
  state: SlaState;
  definition: SlaDefinition | null;
  targetAt: string | null;
  actualAt: string | null;
  /** Positive when late (or overdue now); negative when early. */
  minutesFromTarget: number | null;
}

function parse(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const t = Date.parse(ts);
  return Number.isNaN(t) ? null : t;
}

export function evaluateSla(
  callOutClass: CallOutClass | null,
  times: { requestedAt?: string | null; scheduledAt?: string | null; arrivedAt?: string | null },
  {
    now = new Date(),
    definitions = AMC_SLA_DEFAULTS,
  }: { now?: Date; definitions?: Record<CallOutClass, SlaDefinition> } = {},
): SlaEvaluation {
  const definition = callOutClass ? definitions[callOutClass] : null;
  const requested = parse(times.requestedAt);
  if (!definition || requested === null) {
    return { state: "unknown", definition, targetAt: null, actualAt: null, minutesFromTarget: null };
  }
  const target = requested + definition.targetMinutes * 60_000;
  const actualIso = definition.metric === "attendance" ? times.arrivedAt : times.scheduledAt;
  const actual = parse(actualIso);
  const targetAt = new Date(target).toISOString();
  if (actual === null) {
    const overdue = now.getTime() > target;
    return {
      state: overdue ? "breached" : "pending",
      definition,
      targetAt,
      actualAt: null,
      minutesFromTarget: overdue ? Math.round((now.getTime() - target) / 60_000) : null,
    };
  }
  return {
    state: actual <= target ? "met" : "breached",
    definition,
    targetAt,
    actualAt: new Date(actual).toISOString(),
    minutesFromTarget: Math.round((actual - target) / 60_000),
  };
}
