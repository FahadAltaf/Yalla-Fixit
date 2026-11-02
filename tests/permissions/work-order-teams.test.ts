import { test } from "node:test";
import assert from "node:assert/strict";

import { buildUserFromAccess } from "@/lib/role-permissions";
import { querySides, workOrderAbilities } from "@/lib/server/finance/route-helpers";
import { ActionType, ResourceType } from "@/types/types";

const { VIEW, EDIT, APPROVE, CREATE } = ActionType;

const role = (name: string, grants: [ResourceType, ActionType][]) =>
  buildUserFromAccess({ id: `user-${name}`, roles: { name } }, grants.map(([resource, action]) => ({ resource, action, enabled: true })));

test("Finance records invoices, raises queries, holds and marks not invoiceable (2 Nov: either side, the other is told); never % done or ready", () => {
  const finance = role("finance", [
    [ResourceType.FINANCE_QUEUE, VIEW],
    [ResourceType.FINANCE_QUEUE, EDIT],
    [ResourceType.FINANCE_QUEUE, APPROVE],
  ]);
  assert.deepEqual(workOrderAbilities(finance), {
    view: true,
    invoice: true,
    query: true,
    hold: true,
    exclude: true,
    progress: false,
    markReady: false,
    answer: false,
  });
  assert.deepEqual(querySides(finance), ["finance"]);
});

test("Operations records % done, marks ready, holds, marks not invoiceable and replies on queries; never invoices", () => {
  const operations = role("coordinator", [[ResourceType.FINANCE_EXCLUSIONS, CREATE]]);
  assert.deepEqual(workOrderAbilities(operations), {
    view: true,
    invoice: false,
    query: false,
    hold: true,
    exclude: true,
    progress: true,
    markReady: true,
    answer: true,
  });
  assert.deepEqual(querySides(operations), ["operations"]);
});
