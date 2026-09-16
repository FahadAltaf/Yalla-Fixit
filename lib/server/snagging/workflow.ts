import type {
  SnaggingRejectionCategory,
  SnaggingSnagStatus,
  SnaggingTaskStatus,
  SnaggingVerdict,
} from "@/types/types";

/**
 * The rules that decide what a snagging task or snag is allowed to do
 * next. Kept out of the route handlers so the approval queue, the
 * mobile sync endpoint, and the dashboard all answer the same way.
 */

/** §6.4 — approvals not actioned in this window escalate (FR-4.06). */
export const APPROVAL_SLA_HOURS = 48;

/**
 * §2.3 — an approved report is expected in the client's hands within a
 * day. Drives the "Delivered within 24h" KPI on the analytics board.
 */
export const DELIVERY_SLA_HOURS = 24;

/** §5.3 — remediation windows per rejection category. */
export const REMEDIATION_SLA_HOURS: Record<SnaggingRejectionCategory, number> = {
  // "Same day" in the BRD. Eight working hours is the operational
  // reading of that; anything finer needs a working-calendar, which is
  // out of scope for Phase 1.
  minor: 8,
  data_correction: 24,
  critical: 72,
};

export const REJECTION_LABELS: Record<
  SnaggingRejectionCategory,
  { title: string; description: string; remediation: string }
> = {
  minor: {
    title: "Minor",
    description: "Cosmetic or descriptive issue, such as a typo or the wrong severity",
    remediation: "Edit in-system, no re-visit",
  },
  data_correction: {
    title: "Data correction",
    description: "Missing or wrong data the inspector can correct from evidence",
    remediation: "Technician edits in the app and resubmits",
  },
  critical: {
    title: "Critical",
    description: "Material gap, such as a missed area, the wrong unit, or inconclusive evidence",
    remediation: "Re-inspection task generated, technician returns on site",
  },
};

/**
 * Allowed status transitions (FR-1.06 plus the rejection branch).
 * Anything not listed here is rejected by the API rather than written
 * and cleaned up later.
 */
const TRANSITIONS: Record<SnaggingTaskStatus, SnaggingTaskStatus[]> = {
  draft: ["assigned", "cancelled"],
  assigned: ["in_progress", "cancelled"],
  in_progress: ["submitted", "cancelled"],
  // FR-6.01 — a submitted inspection has exactly one way forward: into
  // review. Approve and reject used to be reachable straight from here,
  // which let a manager sign work off without it ever having been checked
  // and made `in_review` an optional courtesy rather than a step.
  submitted: ["in_review"],
  in_review: ["approved", "rejected"],
  rejected: ["in_progress", "submitted", "cancelled"],
  approved: ["delivered"],
  delivered: [],
  cancelled: [],
};

export function canTransition(from: SnaggingTaskStatus, to: SnaggingTaskStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: SnaggingTaskStatus, to: SnaggingTaskStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Cannot move an inspection from ${from} to ${to}`);
  }
}

/**
 * FR-3.08 / FR-6.01 — the manager gate on the approval chain.
 *
 * Review, approval, rejection and delivery are reserved for the job's
 * designated approval manager. Holding the `approve` permission is not
 * enough on its own, because the BRD makes the approval manager a named,
 * mandatory role per job ("no bypass"). Admins are the deliberate
 * operational override.
 */
export function isDesignatedApprovalManager(
  actorId: string,
  approvalManagerId: string | null | undefined,
  isAdmin: boolean,
): boolean {
  if (isAdmin) return true;
  return approvalManagerId != null && actorId === approvalManagerId;
}

/**
 * FR-6.01 — the reviewer's hand-off gate.
 *
 * `in_review` spans two jobs of work: the reviewer checking the evidence,
 * then the approval manager deciding on it. `reviewed_at` is the line
 * between them, so a decision taken before the reviewer has finished is
 * refused rather than quietly accepted.
 */
export function isReviewComplete(reviewedAt: string | null | undefined): boolean {
  return Boolean(reviewedAt);
}

/**
 * Who may act as the reviewer on a job.
 *
 * The named reviewer, the named approval manager (a manager reviewing their
 * own queue is the smaller team's normal case, and they are already trusted
 * with the decision), or an admin. An inspector never qualifies -- they hold
 * no approve permission, which every review route checks first.
 */
export function isDesignatedReviewer(
  actorId: string,
  reviewerId: string | null | undefined,
  approvalManagerId: string | null | undefined,
  isAdmin: boolean,
): boolean {
  if (isAdmin) return true;
  if (reviewerId) return actorId === reviewerId;
  // Nobody named: the approval manager owns their own queue by default, so
  // an unassigned job is never stuck waiting for an assignment nobody made.
  return approvalManagerId != null && actorId === approvalManagerId;
}

/** BR-6: once submitted, the record is read-only to the device. */
export function isTaskEditableByInspector(status: SnaggingTaskStatus): boolean {
  return status === "assigned" || status === "in_progress" || status === "rejected";
}

export function addHours(from: Date, hours: number): Date {
  return new Date(from.getTime() + hours * 60 * 60 * 1000);
}

export function approvalDueAt(submittedAt: Date = new Date()): string {
  return addHours(submittedAt, APPROVAL_SLA_HOURS).toISOString();
}

export function remediationDueAt(
  category: SnaggingRejectionCategory,
  rejectedAt: Date = new Date(),
): string {
  return addHours(rejectedAt, REMEDIATION_SLA_HOURS[category]).toISOString();
}

/**
 * A verification verdict maps straight onto the snag's status (§5.2).
 * Only `verified_closed` and `withdrawn` are terminal; the other two
 * leave the defect effectively open and carry into the next round.
 */
export function statusFromVerdict(verdict: SnaggingVerdict): SnaggingSnagStatus {
  return verdict;
}

const CARRY_FORWARD: SnaggingSnagStatus[] = [
  "open",
  "pending_verification",
  "verified_poor_quality",
  "verified_not_done",
];

/** FR-6.02 — what a new round pre-populates with. */
export function carriesIntoNextRound(status: SnaggingSnagStatus): boolean {
  return CARRY_FORWARD.includes(status);
}

export const CARRY_FORWARD_STATUSES = CARRY_FORWARD;

/**
 * Builds the code for a de-snagging round from its parent, e.g.
 * VIL42 -> VIL42-R2. Round codes are derived rather than sequential so
 * an inspector can tell at a glance which visit a report belongs to.
 */
export function roundCode(parentCode: string, roundNumber: number): string {
  const base = parentCode.replace(/-[RV]\d+$/, "");
  return `${base}-R${roundNumber}`;
}

/**
 * Builds the code for an additional (chargeable) visit, e.g.
 * VIL42 -> VIL42-V2. A -V suffix tells it apart from a -R de-snag round
 * at a glance on a report or in a list.
 */
export function visitCode(parentCode: string, visitNumber: number): string {
  const base = parentCode.replace(/-[RV]\d+$/, "");
  return `${base}-V${visitNumber}`;
}

/**
 * Task code for a new inspection: initials of the unit label plus a
 * short random suffix, uppercased. Collisions are caught by the unique
 * index and retried by the caller.
 */
export function generateTaskCode(unitLabel: string, buildingName?: string | null): string {
  const source = `${buildingName ?? ""} ${unitLabel}`.trim() || "JOB";
  const letters = source
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.slice(0, 3))
    .join("")
    .toUpperCase()
    .slice(0, 8);

  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${letters || "JOB"}-${suffix}`;
}

/** FR-2.05 — the device generates the same shape offline. */
export function formatSnagCode(taskCode: string, sequence: number): string {
  return `${taskCode}-S${String(sequence).padStart(3, "0")}`;
}
