import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { canDecide } from "@/lib/amc/amendments";
import { canDecideProposal } from "@/lib/amc/workflow";
import { putClientInFsm } from "@/lib/server/snagging/fsm-clients";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

/* ------------------------------ DEV-417 ------------------------------ */
/* 26 Nov 2026, the user: "only one approver can do it". */

test("DEV-417: one approver is enough, the one who asked included", () => {
  assert.equal(canDecide("me", "me"), true, "the requester may decide their own amendment");
  assert.equal(canDecide("someone", "me"), true);
  assert.equal(canDecideProposal({ canApprove: true, isOwner: true }), true);
  assert.equal(canDecideProposal({ canApprove: false, isOwner: false }), false, "still only an AMC approver");
});

test("DEV-417: an AMC approver asks, approves and applies in one step; anyone else asks", () => {
  const route = read("app/api/amc-contracts/[id]/amendments/route.ts");
  assert.match(route, /decideNow === true/);
  assert.match(route, /if \(!gate\.canApprove\) return NextResponse\.json\(\{ error: "Only an AMC approver can do this in one step/);
  const server = read("lib/server/amc/amendments.ts");
  const oneStep = server.slice(server.indexOf("export async function requestAndApplyAmendment"));
  assert.match(oneStep, /notifyDeciders: false/, "nobody else is asked to approve it");
  assert.match(oneStep, /action: "approve"[\s\S]*action: "apply"/, "approved, then applied: both in the status history");
  assert.match(server, /row\.requested_by && row\.requested_by !== actor\.id/, "the approver is not told about their own decision");
});

test("DEV-417: no screen or route still says a contract needs two people", () => {
  for (const file of [
    "app/api/amc-contracts/[id]/cancel/route.ts",
    "app/api/amc-contracts/[id]/lifecycle/route.ts",
    "components/dashboard/extensions/amc-contracts/contract-detail.tsx",
    "components/dashboard/extensions/amc-contracts/contract-amendments-panel.tsx",
  ]) {
    assert.doesNotMatch(read(file), /needs two people|who is not you|Nobody ends a contract alone/, file);
  }
  const panel = read("components/dashboard/extensions/amc-contracts/contract-amendments-panel.tsx");
  assert.match(panel, /Approve and apply now/);
  assert.match(panel, /decideNow: true/);
});

/* ------------------------------ DEV-504 ------------------------------ */

test("DEV-504: saving an enquiry no longer creates the client in Zoho FSM", () => {
  const business = read("lib/server/amc/business.ts");
  const create = business.slice(business.indexOf("export async function createCustomer"), business.indexOf("export async function createCustomer") + 3000);
  assert.doesNotMatch(create, /createClientWithFsm|fsmClientWritesReady/);
});

test("DEV-504: the client becomes an FSM customer on the last signature, by link, portal or scan", () => {
  const lifecycle = read("lib/server/amc/contract-lifecycle.ts");
  assert.equal((lifecycle.match(/queueClientToFsmOnSigning\(/g) ?? []).length, 2, "afterSignature and recordSignedScan");
  const signing = read("lib/server/amc/fsm-on-signing.ts");
  assert.match(signing, /putClientInFsm\(/, "linked by email or created");
  assert.match(signing, /ensurePropertyInFsm\(admin, propertyId/, "the contract's property becomes their FSM address");
  assert.match(signing, /fsm_contact_id: contactId/, "the contract records its FSM customer");
  assert.match(signing, /after\(run\)/, "never slows or fails the signature");
});

test("DEV-504: with FSM writes off nothing is sent and nothing is asked of the database", async () => {
  const before = process.env.ZOHO_FSM;
  process.env.ZOHO_FSM = "read";
  try {
    const admin = { from: () => assert.fail("the database is not read while FSM writes are off") } as never;
    const result = await putClientInFsm(admin, "client-1", "me");
    assert.equal(result.state, "off");
  } finally {
    if (before === undefined) delete process.env.ZOHO_FSM;
    else process.env.ZOHO_FSM = before;
  }
});
