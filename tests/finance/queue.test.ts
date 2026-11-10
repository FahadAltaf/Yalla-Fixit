import { test } from "node:test";
import assert from "node:assert/strict";

import { QueueError, toQueueError } from "@/lib/server/finance/queue";
import { holdersOf } from "@/lib/server/finance/recipients";
import { ActionType, ResourceType } from "@/types/types";

// The database's refusals, as answers a person can act on.

test("someone else got there first: 409, and a hint to reload", () => {
  const error = toQueueError({ code: "40001", message: "apply_action: the item is in_progress now, not pending" });
  assert.ok(error instanceof QueueError);
  assert.equal((error as QueueError).status, 409);
  assert.equal(error.message, "The item is in_progress now, not pending. Reload to see the latest.");
});

test("a rule refusal is a 400 with the function's own words", () => {
  const error = toQueueError({ code: "23514", message: "record_invoice: an exclusion request is waiting for verification" });
  assert.equal((error as QueueError).status, 400);
  assert.equal(error.message, "An exclusion request is waiting for verification");
});

test("a second open exclusion request is a 409; a missing item is a 404", () => {
  assert.equal((toQueueError({ code: "23505", message: "duplicate key" }) as QueueError).status, 409);
  assert.equal((toQueueError({ code: "P0002", message: "apply_action: no item x" }) as QueueError).status, 404);
});

test("anything unexpected stays an ordinary error (a 500), not a user message", () => {
  const error = toQueueError({ code: "XX000", message: "internal" });
  assert.ok(!(error instanceof QueueError));
});

// Who N3 and N4 go to.

const row = (id: string, roleName: string, grants: [ResourceType, ActionType][], active = true) => ({
  id,
  email: `${id}@yfi.ae`,
  full_name: id,
  is_active: active,
  roles: { name: roleName, role_access: grants.map(([resource, action]) => ({ resource, action, enabled: true })) },
});

test("N3 goes to whoever may verify exclusions, and not to admins by default", () => {
  const people = [
    row("behrouz", "verifier", [[ResourceType.FINANCE_EXCLUSIONS, ActionType.APPROVE]]),
    row("admin", "admin", []),
    row("coord", "coordinator", [[ResourceType.FINANCE_EXCLUSIONS, ActionType.CREATE]]),
    row("left", "verifier", [[ResourceType.FINANCE_EXCLUSIONS, ActionType.APPROVE]], false),
  ];
  assert.deepEqual(
    holdersOf(people, ResourceType.FINANCE_EXCLUSIONS, ActionType.APPROVE).map((r) => r.userId),
    ["behrouz"],
  );
});

test("N4 goes to coordinators; an admin is included because Create is inherited", () => {
  const people = [
    row("coord", "coordinator", [[ResourceType.FINANCE_EXCLUSIONS, ActionType.CREATE]]),
    row("finance", "finance", [[ResourceType.FINANCE_QUEUE, ActionType.EDIT]]),
    row("admin", "admin", []),
  ];
  assert.deepEqual(
    holdersOf(people, ResourceType.FINANCE_EXCLUSIONS, ActionType.CREATE).map((r) => r.userId).sort(),
    ["admin", "coord"],
  );
});
