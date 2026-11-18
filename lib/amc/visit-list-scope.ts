import type { FieldVisitStage } from "@/lib/amc/field-visits";

/**
 * What AMC -> Visits shows by default (16 Nov 2026): the visits that are
 * ready (planned or confirmed), in progress, awaiting review and done.
 * Visits still to plan and cancelled ones stay out of the way; the Stage
 * filter still shows them on their own, or with "All stages".
 */
export const ACTIVE_FIELD_VISIT_STAGES: readonly FieldVisitStage[] = ["planned", "confirmed", "in_progress", "review", "done"];

/*
  And a call out, additional work or site visit still to plan (18 Nov 2026):
  the office has to act on it now -- a call out is logged and waits for its
  crew -- unlike a planned visit months away, which stays out of the way.
*/
export const ACTIVE_TO_PLAN_KINDS = ["call_out", "additional_work", "site_visit"] as const;

/** The default listing as a PostgREST or-filter: the active stages, or one of those kinds still to plan. */
export const ACTIVE_FIELD_VISIT_FILTER = `stage.in.(${ACTIVE_FIELD_VISIT_STAGES.join(",")}),and(kind.in.(${ACTIVE_TO_PLAN_KINDS.join(",")}),stage.eq.to_plan)`;
