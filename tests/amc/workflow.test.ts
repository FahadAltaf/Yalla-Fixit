import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AMC_SELF_APPROVAL_ALLOWED,
  canDecideProposal,
  canSend,
  checkInternalTransition,
  clientTransition,
} from "@/lib/amc/workflow";

const STATUSES = [
  "draft",
  "awaiting_approval",
  "sent_back",
  "approved",
  "proposal_sent",
  "proposal_rejected",
  "proposal_approved",
  "contract_sent",
  "signed",
];

test("submit: only the owner, only from draft, sent back or client-rejected", () => {
  for (const from of STATUSES) {
    const owner = checkInternalTransition({ action: "submit", from, isOwner: true, canApprove: false });
    const allowed = ["draft", "sent_back", "proposal_rejected"].includes(from);
    assert.equal(owner.ok, allowed, from);
    if (owner.ok) assert.equal(owner.to, "awaiting_approval");
    else assert.equal(owner.status, 409);
  }
  const stranger = checkInternalTransition({ action: "submit", from: "draft", isOwner: false, canApprove: true });
  assert.deepEqual(stranger.ok ? null : stranger.status, 403);
});

test("approve / send back: approvers only, only while awaiting approval", () => {
  for (const action of ["approve", "send_back"] as const) {
    for (const from of STATUSES) {
      const r = checkInternalTransition({ action, from, isOwner: false, canApprove: true });
      assert.equal(r.ok, from === "awaiting_approval", `${action} from ${from}`);
      if (r.ok) assert.equal(r.to, action === "approve" ? "approved" : "sent_back");
    }
    const noRight = checkInternalTransition({ action, from: "awaiting_approval", isOwner: false, canApprove: false });
    assert.equal(noRight.ok ? null : noRight.status, 403);
  }
});

test("self-approval follows the single switch", () => {
  // Today's production behaviour, pending the business decision.
  assert.equal(AMC_SELF_APPROVAL_ALLOWED, true);
  assert.equal(canDecideProposal({ canApprove: true, isOwner: true }), true);
  assert.equal(
    checkInternalTransition({ action: "approve", from: "awaiting_approval", isOwner: true, canApprove: true }).ok,
    true,
  );

  // Switched off: the creator is refused, another approver is not.
  const off = { selfApprovalAllowed: false };
  assert.equal(canDecideProposal({ canApprove: true, isOwner: true, ...off }), false);
  assert.equal(canDecideProposal({ canApprove: true, isOwner: false, ...off }), true);
  const own = checkInternalTransition({
    action: "approve",
    from: "awaiting_approval",
    isOwner: true,
    canApprove: true,
    ...off,
  });
  assert.equal(own.ok ? null : own.status, 403);
  assert.equal(canDecideProposal({ canApprove: false, isOwner: false }), false);
});

test("sending: proposal after approval, contract after the client approves", () => {
  for (const from of STATUSES) {
    assert.equal(canSend("proposal", from), from === "approved" || from === "proposal_sent", from);
    assert.equal(canSend("contract", from), from === "proposal_approved" || from === "contract_sent", from);
  }
});

test("client answers: the right link, at the right stage", () => {
  assert.deepEqual(clientTransition("approve", "proposal", "proposal_sent"), { ok: true, to: "proposal_approved" });
  assert.deepEqual(clientTransition("reject", "proposal", "proposal_sent"), { ok: true, to: "proposal_rejected" });
  assert.deepEqual(clientTransition("sign", "contract", "contract_sent"), { ok: true, to: "signed" });

  // A proposal link cannot sign; a contract link cannot approve.
  assert.equal(clientTransition("sign", "proposal", "proposal_sent").ok, false);
  assert.equal(clientTransition("approve", "contract", "contract_sent").ok, false);

  // Answer once: a second answer is refused.
  for (const from of STATUSES.filter((s) => s !== "proposal_sent")) {
    assert.equal(clientTransition("approve", "proposal", from).ok, false, from);
  }
  assert.equal(clientTransition("sign", "contract", "signed").ok, false);
});
