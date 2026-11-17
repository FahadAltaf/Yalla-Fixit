import type { FieldVisitStage } from "@/lib/amc/field-visits";

/**
 * What AMC -> Visits shows by default (16 Nov 2026): the visits that are
 * ready (planned or confirmed), in progress, awaiting review and done.
 * Visits still to plan and cancelled ones stay out of the way; the Stage
 * filter still shows them on their own, or with "All stages".
 */
export const ACTIVE_FIELD_VISIT_STAGES: readonly FieldVisitStage[] = ["planned", "confirmed", "in_progress", "review", "done"];
