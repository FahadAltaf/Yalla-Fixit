/**
 * The AMC proposal workflow, as rules the server enforces and the UI
 * reads. No imports: usable from route handlers, components and tests.
 *
 *   draft | sent_back --submit (owner)--------------------> awaiting_approval
 *   awaiting_approval --approve (approver)--------------> approved
 *   awaiting_approval --send_back (approver, reason)----> sent_back
 *   approved | proposal_sent --send proposal (owner)----> proposal_sent
 *   proposal_sent --client approves----------------------> proposal_approved
 *   proposal_sent --client rejects (reason)-------------> proposal_rejected
 *   proposal_approved | contract_sent --send contract (owner)--> contract_sent
 *   contract_sent --client signs-------------------------> signed
 *
 * `signed` is final. There is no delete, cancel or withdraw.
 *
 * A proposal the client has seen (proposal_sent, proposal_rejected,
 * proposal_approved) is changed by revising it (BRD 5.4, DEV-367): the
 * shared version is locked and V(n+1) opens as a draft, which is then
 * submitted like any draft.
 */

export type AmcInternalAction = "submit" | "approve" | "send_back";
export type AmcSendDocument = "proposal" | "contract";
export type AmcClientAction = "approve" | "reject" | "sign";

/* ------------------------------------------------------------------ */
/* Self-approval: the single switch                                    */
/* ------------------------------------------------------------------ */

/**
 * Decided by BRD v0.3 (5.5, 6.7): nobody approves their own proposal.
 * The approval API refuses the creator, and Approve / Send back are hidden
 * on the creator's own proposals. (Production allowed it until Oct 2026;
 * three proposals were approved by their own author by 5 Oct 2026.)
 */
export const AMC_SELF_APPROVAL_ALLOWED = false;

/** Whether this viewer may approve or send back this proposal. */
export function canDecideProposal({
  canApprove,
  isOwner,
  selfApprovalAllowed = AMC_SELF_APPROVAL_ALLOWED,
}: {
  canApprove: boolean;
  isOwner: boolean;
  selfApprovalAllowed?: boolean;
}): boolean {
  if (!canApprove) return false;
  return selfApprovalAllowed || !isOwner;
}

/* ------------------------------------------------------------------ */
/* Internal transitions                                                */
/* ------------------------------------------------------------------ */

const SUBMITTABLE = new Set(["draft", "sent_back"]);

export type TransitionCheck =
  | { ok: true; to: string }
  | { ok: false; status: 400 | 403 | 409; error: string };

/**
 * Whether `action` may move a proposal from `from`, for this caller.
 * Mirrors app/api/amc-submissions/approval/route.ts, which calls it.
 */
export function checkInternalTransition({
  action,
  from,
  isOwner,
  canApprove,
  selfApprovalAllowed = AMC_SELF_APPROVAL_ALLOWED,
}: {
  action: AmcInternalAction;
  from: string;
  isOwner: boolean;
  canApprove: boolean;
  selfApprovalAllowed?: boolean;
}): TransitionCheck {
  const label = from.replace(/_/g, " ");
  if (action === "submit") {
    if (!isOwner) {
      return { ok: false, status: 403, error: "Only the owner can submit this proposal" };
    }
    if (!SUBMITTABLE.has(from)) {
      return {
        ok: false,
        status: 409,
        error: `A proposal that is ${label} cannot be submitted for approval`,
      };
    }
    return { ok: true, to: "awaiting_approval" };
  }

  if (!canApprove) {
    return {
      ok: false,
      status: 403,
      error: "You do not have permission to approve AMC proposals",
    };
  }
  if (!canDecideProposal({ canApprove, isOwner, selfApprovalAllowed })) {
    return {
      ok: false,
      status: 403,
      error: "A proposal has to be approved by someone other than the person who wrote it",
    };
  }
  if (from !== "awaiting_approval") {
    return { ok: false, status: 409, error: `A proposal that is ${label} is not awaiting approval` };
  }
  return { ok: true, to: action === "approve" ? "approved" : "sent_back" };
}

/* ------------------------------------------------------------------ */
/* Sending and the client's answer                                     */
/* ------------------------------------------------------------------ */

/** The statuses a document may be sent (or re-sent) from. */
export const SEND_FROM: Record<AmcSendDocument, readonly string[]> = {
  proposal: ["approved", "proposal_sent"],
  contract: ["proposal_approved", "contract_sent"],
};

export const SEND_TO: Record<AmcSendDocument, string> = {
  proposal: "proposal_sent",
  contract: "contract_sent",
};

export function canSend(document: AmcSendDocument, from: string): boolean {
  return SEND_FROM[document].includes(from);
}

/** The status a client's answer requires, and the one it produces. */
export function clientTransition(
  action: AmcClientAction,
  linkKind: AmcSendDocument,
  from: string,
): TransitionCheck {
  if ((action === "sign") !== (linkKind === "contract")) {
    return { ok: false, status: 400, error: "That action does not apply to this link" };
  }
  const expected = linkKind === "contract" ? "contract_sent" : "proposal_sent";
  if (from !== expected) {
    return { ok: false, status: 409, error: "This document is no longer awaiting your answer." };
  }
  const to =
    action === "sign" ? "signed" : action === "approve" ? "proposal_approved" : "proposal_rejected";
  return { ok: true, to };
}

/**
 * Fields that describe the client's answer to a previous version. Cleared
 * whenever a new version is submitted or sent, so a re-sent proposal does
 * not still read "rejected" while it waits for a fresh answer.
 */
export const STALE_CLIENT_DECISION_FIELDS = {
  client_decision: null,
  client_decided_at: null,
  client_decided_by_name: null,
  client_rejected_reason: null,
} as const;
