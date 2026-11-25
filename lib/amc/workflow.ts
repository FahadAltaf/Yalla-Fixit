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
export type AmcClientAction = "approve" | "reject" | "request_revision" | "sign";

/* ------------------------------------------------------------------ */
/* Self-approval: the single switch                                    */
/* ------------------------------------------------------------------ */

/**
 * An approver may approve their own request (24 Nov 2026, Sami Farah: "They
 * should. I think it's rare tho." -- and the same when they are the only
 * approver). Covers proposals and contract amendments. Until then BRD v0.3
 * (5.5, 6.7) applied: nobody approved their own proposal.
 *
 * Being the requester is no longer a bar; being an approver still is: a
 * level is decided by the people it names (the requester included), or,
 * when it names nobody, by the AMC approvers.
 */
export const AMC_SELF_APPROVAL_ALLOWED = true;

/**
 * Whether a requester may decide their own request. Always now (above);
 * NEXT_PUBLIC_AMC_SELF_APPROVAL=on was the local testing switch before
 * that decision (16 Nov 2026), kept so a local setup reads the same.
 */
export function amcSelfApprovalOn(): boolean {
  return AMC_SELF_APPROVAL_ALLOWED || (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_AMC_SELF_APPROVAL === "on");
}

/** Whether this viewer may approve or send back this proposal. */
export function canDecideProposal({
  canApprove,
  isOwner,
  selfApprovalAllowed = AMC_SELF_APPROVAL_ALLOWED || amcSelfApprovalOn(),
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
  selfApprovalAllowed = AMC_SELF_APPROVAL_ALLOWED || amcSelfApprovalOn(),
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

/**
 * The contract is shown (previewed, downloaded) only once the client has
 * approved the proposal (23 Nov 2026, the user): before that it is not a
 * document anyone should see or pass on.
 */
export const CONTRACT_VISIBLE_FROM: readonly string[] = ["proposal_approved", "contract_sent", "signed"];

export function contractVisible(status: string | null | undefined): boolean {
  return CONTRACT_VISIBLE_FROM.includes(String(status ?? ""));
}

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
  /* A rejection and a revision request both return it to the owner (BRD 5.6); client_answer says which. */
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
