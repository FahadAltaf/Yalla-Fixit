import assert from "node:assert/strict";
import test from "node:test";

import { AMC_CONFIG_DEFAULTS, escalationPeople, validateAmcConfigSection } from "@/lib/amc/config";

/* DEV-488 (20 Nov 2026): escalation contacts are named in configuration; until then the level 2, else level 1, approvers. */
const UUID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const withApprovals = (a: Partial<typeof AMC_CONFIG_DEFAULTS.approvals>) => ({ ...AMC_CONFIG_DEFAULTS, approvals: { ...AMC_CONFIG_DEFAULTS.approvals, ...a } });

test("escalations go to the named contacts, else level 2, else level 1", () => {
  assert.deepEqual(escalationPeople(withApprovals({ escalationUserIds: [UUID(1)], level2ApproverIds: [UUID(2)] })), [UUID(1)]);
  assert.deepEqual(escalationPeople(withApprovals({ escalationUserIds: [], level2ApproverIds: [UUID(2)], level1ApproverIds: [UUID(3)] })), [UUID(2)]);
  assert.deepEqual(escalationPeople(withApprovals({ escalationUserIds: [], level2ApproverIds: [], level1ApproverIds: [UUID(3)] })), [UUID(3)]);
  assert.deepEqual(escalationPeople(withApprovals({ escalationUserIds: [], level2ApproverIds: [], level1ApproverIds: [] })), []);
});

test("an approval ladder saved before escalation contacts existed still validates", () => {
  const { escalationUserIds: _dropped, ...older } = AMC_CONFIG_DEFAULTS.approvals;
  void _dropped;
  const result = validateAmcConfigSection("approvals", older);
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok ? (result.value as { escalationUserIds: string[] }).escalationUserIds : null, []);
});
