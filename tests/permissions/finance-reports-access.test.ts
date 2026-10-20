import { test } from "node:test";
import assert from "node:assert/strict";

import { buildUserFromAccess, hasResourceAction } from "@/lib/role-permissions";
import { planUserUpdate } from "@/lib/server/admin/users-roles";
import { ActionType, ResourceType } from "@/types/types";

const { VIEW, EDIT, APPROVE, CREATE, EXPORT } = ActionType;

const role = (name: string, grants: [ResourceType, ActionType][], enabled = true) =>
  buildUserFromAccess(
    { id: `user-${name}`, roles: { name } },
    grants.map(([resource, action]) => ({ resource, action, enabled })),
  );

const admin = role("admin", []);

test("admin does not inherit the four named-person acts (BRD §6.7)", () => {
  assert.equal(hasResourceAction(admin, ResourceType.FINANCE_QUEUE, APPROVE), false, "record invoice");
  assert.equal(hasResourceAction(admin, ResourceType.FINANCE_EXCLUSIONS, APPROVE), false, "verify exclusion");
  assert.equal(hasResourceAction(admin, ResourceType.COMPLIANCE, EDIT), false, "waive");
  assert.equal(hasResourceAction(admin, ResourceType.COMPLIANCE, APPROVE), false, "decide dispute");
});

test("admin keeps everything else, including Reporting Settings", () => {
  assert.equal(hasResourceAction(admin, ResourceType.FINANCE_QUEUE, VIEW), true);
  assert.equal(hasResourceAction(admin, ResourceType.FINANCE_QUEUE, EDIT), true);
  assert.equal(hasResourceAction(admin, ResourceType.REPORTS_UTILIZATION, VIEW), true);
  assert.equal(hasResourceAction(admin, ResourceType.REPORTING_SETTINGS, EDIT), true);
  assert.equal(hasResourceAction(admin, ResourceType.SNAGGING, APPROVE), false, "unchanged");
});

test("an admin granted a named-person act explicitly holds it", () => {
  const granted = role("admin", [[ResourceType.FINANCE_QUEUE, APPROVE]]);
  assert.equal(hasResourceAction(granted, ResourceType.FINANCE_QUEUE, APPROVE), true);
});

test("Finance works the queue and has no access to utilization", () => {
  const finance = role("finance", [
    [ResourceType.FINANCE_QUEUE, VIEW],
    [ResourceType.FINANCE_QUEUE, EDIT],
    [ResourceType.FINANCE_QUEUE, APPROVE],
  ]);
  assert.equal(hasResourceAction(finance, ResourceType.FINANCE_QUEUE, APPROVE), true);
  assert.equal(hasResourceAction(finance, ResourceType.REPORTS_UTILIZATION, VIEW), false);
  assert.equal(hasResourceAction(finance, ResourceType.REPORTING_SETTINGS, VIEW), false);
});

test("HR sees attendance and compliance and has no access to the queue", () => {
  const hr = role("hr", [
    [ResourceType.REPORTS_ATTENDANCE, VIEW],
    [ResourceType.COMPLIANCE, VIEW],
  ]);
  assert.equal(hasResourceAction(hr, ResourceType.COMPLIANCE, VIEW), true);
  assert.equal(hasResourceAction(hr, ResourceType.FINANCE_QUEUE, VIEW), false);
  assert.equal(hasResourceAction(hr, ResourceType.COMPLIANCE, EDIT), false);
});

test("a coordinator can request an exclusion but not verify it", () => {
  const coordinator = role("coordinator", [[ResourceType.FINANCE_EXCLUSIONS, CREATE]]);
  assert.equal(hasResourceAction(coordinator, ResourceType.FINANCE_EXCLUSIONS, CREATE), true);
  assert.equal(hasResourceAction(coordinator, ResourceType.FINANCE_EXCLUSIONS, APPROVE), false);
});

test("a technician's own-compliance grant gives nothing else", () => {
  const technician = role("technician", [[ResourceType.COMPLIANCE_SELF, VIEW]]);
  assert.equal(hasResourceAction(technician, ResourceType.COMPLIANCE_SELF, VIEW), true);
  assert.equal(hasResourceAction(technician, ResourceType.COMPLIANCE, VIEW), false);
  assert.equal(hasResourceAction(technician, ResourceType.REPORTS_ATTENDANCE, EXPORT), false);
});

test("a switched-off grant is no grant", () => {
  const off = role("finance", [[ResourceType.FINANCE_QUEUE, VIEW]], false);
  assert.equal(hasResourceAction(off, ResourceType.FINANCE_QUEUE, VIEW), false);
});

// DEV-458: who may hide an account.

const target = {
  id: "u-target",
  roleName: "user",
  roleId: "r-user",
  isActive: true,
  receivesApprovalEmail: false,
  hiddenFromLists: false,
};

test("a user manager can hide another account", () => {
  const plan = planUserUpdate(
    { id: "u-manager", canEdit: true, isAdmin: false } as never,
    target,
    { id: "u-target", hidden_from_lists: true },
    null,
  );
  assert.deepEqual(plan, { ok: true, patch: { hidden_from_lists: true } });
});

test("nobody can hide their own account, and a non-manager cannot hide anyone", () => {
  const self = planUserUpdate(
    { id: "u-target", canEdit: true, isAdmin: false } as never,
    target,
    { id: "u-target", hidden_from_lists: true },
    null,
  );
  assert.equal(self.ok, false);
  const other = planUserUpdate(
    { id: "u-other", canEdit: false, isAdmin: false } as never,
    target,
    { id: "u-target", hidden_from_lists: true },
    null,
  );
  assert.equal(other.ok, false);
});

test("an edit form that resends the current value changes nothing", () => {
  const plan = planUserUpdate(
    { id: "u-target", canEdit: false, isAdmin: false } as never,
    target,
    { id: "u-target", full_name: "Me", hidden_from_lists: false },
    null,
  );
  assert.deepEqual(plan, { ok: true, patch: { full_name: "Me" } });
});
