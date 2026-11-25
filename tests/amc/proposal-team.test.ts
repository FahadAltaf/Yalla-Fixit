import assert from "node:assert/strict";
import test from "node:test";

import { canApproveAmc } from "@/components/dashboard/extensions/amc/amc-settings";
import { proposalRights, type ProposalViewerRoles } from "@/lib/amc/proposal-team";

/* DEV-368 (20 Nov 2026 review): proposals are visible to the team by role, and a colleague can take one over. */
const none: ProposalViewerRoles = { canApprove: false, operationsView: false, operationsEdit: false, proposalsView: false, proposalsEdit: false };

test("the owner sees and works on their own proposal", () => {
  assert.deepEqual(proposalRights(none, true), { see: true, act: true });
});

test("AMC Proposals (View) sees the team's proposals, drafts included, but does not work on them", () => {
  assert.deepEqual(proposalRights({ ...none, proposalsView: true }, false), { see: true, act: false });
  assert.deepEqual(proposalRights({ ...none, operationsView: true }, false), { see: true, act: false });
});

test("AMC Proposals (Edit), AMC Operations (Edit) or the approver right works on a colleague's proposal", () => {
  assert.deepEqual(proposalRights({ ...none, proposalsEdit: true }, false), { see: true, act: true });
  assert.deepEqual(proposalRights({ ...none, operationsEdit: true }, false), { see: true, act: true });
  assert.deepEqual(proposalRights({ ...none, canApprove: true }, false), { see: true, act: true });
});

test("someone with no AMC proposal rights sees nothing of others'", () => {
  assert.deepEqual(proposalRights(none, false), { see: false, act: false });
});

test("the role decides approval; the old Settings list no longer overrides it", () => {
  const listed = { approval: { approvers: ["a@x.com"] } };
  assert.equal(canApproveAmc(listed, "b@x.com", true), true, "role holder not on the list still approves");
  assert.equal(canApproveAmc(listed, "a@x.com", false), true, "someone on the list still approves");
  assert.equal(canApproveAmc(listed, "b@x.com", false), false);
  assert.equal(canApproveAmc({ approval: { approvers: [] } }, "b@x.com", true), true);
});
