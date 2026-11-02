// Employment status rules (FRD decision D11, follow-up F3).
//
// Deactivation is done in Zoho FSM. For an employee linked to an FSM
// technician, the portal computes the effective status at read time: if FSM
// shows the technician inactive, the employee is Inactive from that date,
// whatever the stored value says. The portal offers no deactivate action for
// linked staff. Employees without an FSM record keep whatever status is typed.

import type { ComplianceEmploymentStatus } from "./statuses";

export type TechnicianLinkState = {
  linked: boolean;
  /** technician_reference.is_active, when linked. */
  fsmActive: boolean | null;
  /** technician_reference.deactivated_at (ISO), when known. */
  deactivatedAt: string | null;
};

export type EffectiveEmployment = {
  status: ComplianceEmploymentStatus;
  /** "fsm" when FSM deactivation overrides the stored status. */
  source: "portal" | "fsm";
  /** ISO timestamp the FSM deactivation was observed, when available. */
  since: string | null;
};

export function effectiveEmploymentStatus(
  stored: ComplianceEmploymentStatus,
  link: TechnicianLinkState,
): EffectiveEmployment {
  if (link.linked && link.fsmActive === false) {
    // Resigned / Terminated typed by the team after FSM deactivation stay as
    // the more specific reason; anything else becomes Inactive.
    const status: ComplianceEmploymentStatus =
      stored === "resigned" || stored === "terminated" ? stored : "inactive";
    return { status, source: "fsm", since: link.deactivatedAt };
  }
  return { status: stored, source: "portal", since: null };
}

/**
 * Which statuses the form may offer. A linked technician who is active in
 * FSM can only be Active or On Leave: leaving is recorded in FSM first.
 */
export function allowedStatuses(link: TechnicianLinkState): ComplianceEmploymentStatus[] {
  if (link.linked && link.fsmActive === true) return ["active", "on_leave"];
  if (link.linked && link.fsmActive === false) return ["inactive", "resigned", "terminated"];
  return ["active", "on_leave", "inactive", "resigned", "terminated"];
}

/** Archive is refused for a linked technician still active in FSM (D11). */
export function canArchive(link: TechnicianLinkState): boolean {
  return !(link.linked && link.fsmActive === true);
}
