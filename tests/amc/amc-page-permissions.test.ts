import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { canUseAmc } from "@/components/dashboard/extensions/amc/amc-constants";
import { hasResourceAction } from "@/lib/role-permissions";
import { ActionType, ResourceType, type User } from "@/types/types";

/* AMC per-page permissions, as Snagging and Extensions (main, 20261008100000). */

const userWith = (grants: Array<[ResourceType, ActionType]>): User =>
  ({
    roles: {
      name: "coordinator",
      role_accessCollection: { edges: grants.map(([resource, action]) => ({ node: { resource, action, enabled: true } })) },
    },
  }) as unknown as User;

test("a role with only one AMC page reaches the module, and only that page", () => {
  const reportsOnly = userWith([[ResourceType.AMC_REPORTS, ActionType.VIEW]]);
  assert.equal(canUseAmc(reportsOnly), true, "the AMC menu and APIs open for a page-only role");
  assert.equal(hasResourceAction(reportsOnly, ResourceType.AMC_REPORTS, ActionType.VIEW), true);
  assert.equal(hasResourceAction(reportsOnly, ResourceType.AMC_CONTRACTS, ActionType.VIEW), false, "Contracts is its own grant");
  assert.equal(canUseAmc(userWith([[ResourceType.SNAGGING, ActionType.VIEW]])), false);
});

test("the backfill gives every role that can use AMC today each new page, adds only, and runs twice safely", () => {
  const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/20261012100000_amc_per_page_permissions.sql"), "utf8")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  for (const page of ["amc_proposals", "amc_contracts", "amc_clients", "amc_site_visits", "amc_technicians", "amc_reports", "amc_fsm_mapping", "amc_operations_settings"]) {
    assert.match(sql, new RegExp(`'${page}'`), page);
  }
  assert.match(sql, /on conflict \(role_id, resource, action\) do nothing/);
  assert.doesNotMatch(sql, /\bupdate\b|\bdelete\b/i, "additive only");
  /* Exactly the grants canUseAmc reads today. */
  assert.match(sql, /ra\.resource = 'amc' and ra\.action in \('view', 'approve'\)/);
  assert.match(sql, /ra\.resource = 'amc_operations' and ra\.action in \('view', 'edit'\)/);
});

test("every AMC page asks about its own permission on the server", () => {
  const gates: Array<[string, string]> = [
    ["app/(dashboard)/extensions/amc/page.tsx", "AMC_PROPOSALS"],
    ["app/(dashboard)/extensions/amc-contracts/page.tsx", "AMC_CONTRACTS"],
    ["app/(dashboard)/extensions/amc-contracts/customers/page.tsx", "AMC_CLIENTS"],
    ["app/(dashboard)/extensions/amc-contracts/assessments/page.tsx", "AMC_SITE_VISITS"],
    ["app/(dashboard)/extensions/amc-contracts/reports/page.tsx", "AMC_REPORTS"],
    ["app/(dashboard)/extensions/amc-contracts/board/page.tsx", "AMC_VISITS"],
    ["app/(dashboard)/extensions/amc-contracts/payments/page.tsx", "AMC_PAYMENTS"],
  ];
  for (const [file, resource] of gates) {
    const src = readFileSync(path.join(process.cwd(), file), "utf8");
    assert.match(src, new RegExp(`canSeeAmcPage\\(ResourceType\\.${resource}\\)`), file);
  }
});
