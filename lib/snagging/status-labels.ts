import type { SnaggingTaskStatus } from "@/types/types";

/**
 * How a job's status is written for a person to read.
 *
 * Lifted out of the client-only `shared.tsx` so the API can use it too:
 * the analytics drill-down names each row's status server-side, and a
 * route importing a "use client" module to get one object is how a
 * server bundle ends up dragging in React components it never renders.
 * `shared.tsx` re-exports this, so every screen still reads it from the
 * one place it always did.
 */
export const TASK_STATUS_LABELS: Record<SnaggingTaskStatus, string> = {
  draft: "Draft",
  assigned: "Assigned",
  in_progress: "In progress",
  submitted: "Submitted",
  in_review: "In review",
  rejected: "Sent back",
  approved: "Approved",
  delivered: "Delivered",
  cancelled: "Cancelled",
};
