import type { SnaggingTask } from "@/types/types";

/**
 * The job as the client's report may show it: without anything recorded
 * by a visit the manager has not approved.
 *
 * A submitted visit's snags, the room it added and its checklist answers
 * went straight into this preview -- and into the PDF downloaded from it
 * -- before anybody had reviewed them. The server-built report applies the
 * same rule (report-data.ts), so the preview and the delivered document
 * agree.
 */
export function approvedOnly(task: SnaggingTask): SnaggingTask {
  const pending = new Set(task.unapproved_visit_ids ?? []);
  if (pending.size === 0) return task;
  const unapproved = (visitId?: string | null) =>
    Boolean(visitId && pending.has(visitId));
  return {
    ...task,
    snags: (task.snags ?? []).filter((snag) => !unapproved(snag.visit_id)),
    areas: (task.areas ?? []).filter((area) => !unapproved(area.visit_id)),
    // A visit answers an item the walk could not; until it is approved the
    // report says what the walk did -- not checked.
    checklist: (task.checklist ?? []).map((item) =>
      unapproved(item.visit_id)
        ? { ...item, status: "not_checked", reason: null }
        : item,
    ),
  };
}
