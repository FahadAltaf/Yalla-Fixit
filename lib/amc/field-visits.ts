import { ADDITIONAL_WORK_STATUS_LABELS, CALL_OUT_STATUS_LABELS } from "@/lib/amc/call-outs";
import { VISIT_STATUS_LABELS } from "@/lib/amc/ppm";

/*
  AMC -> Visits: every kind of AMC field visit in one list (read from the
  amc_field_visits view, migration 20261111100000). The kinds keep their own
  statuses; the STAGE is what they have in common, so one list can filter
  and count them the same way.
*/

export const FIELD_VISIT_KINDS = ["ppm", "call_out", "additional_work", "site_visit"] as const;
export type FieldVisitKind = (typeof FIELD_VISIT_KINDS)[number];

export const FIELD_VISIT_KIND_LABELS: Record<FieldVisitKind, string> = {
  ppm: "Planned visit",
  call_out: "Call out",
  additional_work: "Additional work",
  site_visit: "Site visit",
};

export const FIELD_VISIT_STAGES = ["to_plan", "planned", "confirmed", "in_progress", "review", "done", "cancelled"] as const;
export type FieldVisitStage = (typeof FIELD_VISIT_STAGES)[number];

export const FIELD_VISIT_STAGE_LABELS: Record<FieldVisitStage, string> = {
  to_plan: "To plan",
  planned: "Planned",
  confirmed: "Confirmed",
  in_progress: "In progress",
  review: "Awaiting review",
  done: "Done",
  cancelled: "Cancelled",
};

/** Still to be done: what "Open" shows, and what can be overdue. */
export const OPEN_FIELD_VISIT_STAGES: readonly FieldVisitStage[] = ["to_plan", "planned", "confirmed", "in_progress", "review"];
/** Late when its last day has passed and the crew has not finished on site. */
export const LATE_CAPABLE_STAGES: readonly FieldVisitStage[] = ["to_plan", "planned", "confirmed", "in_progress"];

/** The list's "when" filter. */
export const FIELD_VISIT_WHEN = ["any", "overdue", "today", "week", "past30"] as const;
export type FieldVisitWhen = (typeof FIELD_VISIT_WHEN)[number];

const SITE_VISIT_STATUS_LABELS: Record<string, string> = { draft: "Draft", completed: "Completed" };

/** The kind's own status, in words (the list shows it under the stage). */
export function fieldVisitStatusLabel(kind: FieldVisitKind, status: string): string {
  const labels: Record<string, string> =
    kind === "ppm" ? VISIT_STATUS_LABELS : kind === "call_out" ? CALL_OUT_STATUS_LABELS : kind === "additional_work" ? ADDITIONAL_WORK_STATUS_LABELS : SITE_VISIT_STATUS_LABELS;
  return labels[status] ?? status.replace(/_/g, " ");
}

/** Whether a visit is late on `today` (YYYY-MM-DD, Dubai). */
export function isFieldVisitLate(v: { stage: FieldVisitStage; dueOn: string | null }, today: string): boolean {
  return Boolean(v.dueOn && v.dueOn < today && LATE_CAPABLE_STAGES.includes(v.stage));
}

/** A visit's own page (planned visits and call outs). */
export const visitPageHref = (id: string) => `/extensions/amc-contracts/visits/${id}`;

/** An additional work's own page (at every status: a quotation before approval, a visit after). */
export const additionalWorkPageHref = (id: string) => `/extensions/amc-contracts/additional-works/${id}`;

/**
 * Where a visit opens: planned visits and call outs on the visit page,
 * additional work on its own page (it is a quotation before approval), a
 * site visit on its page.
 */
export function fieldVisitHref(v: { kind: FieldVisitKind; id: string; contractId: string | null }): string {
  switch (v.kind) {
    case "ppm":
    case "call_out":
      return visitPageHref(v.id);
    case "additional_work":
      return additionalWorkPageHref(v.id);
    case "site_visit":
      return `/extensions/amc-contracts/assessments/${v.id}`;
  }
}
