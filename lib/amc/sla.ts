/**
 * AMC service levels: definitions and evaluation. No scheduler: this only
 * answers "was this request handled within target?" for whichever
 * timestamps exist.
 *
 * The AMC customer requirements give two targets:
 *   emergency call-out:      attendance within 120 minutes of the request
 *   non-emergency call-out:  scheduled within 6 hours of the request
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
    targetMinutes: 360,
    label: "Non-emergency scheduling within 6 hours",
  },
};

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
