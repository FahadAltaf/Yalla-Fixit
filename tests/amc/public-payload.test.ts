import { test } from "node:test";
import assert from "node:assert/strict";

import { toPublicSettings, toPublicStatus } from "@/lib/server/amc/public-dto";
import { getAmcSettingsDefaults } from "@/components/dashboard/extensions/amc/amc-settings";

function internalSettings() {
  const s = getAmcSettingsDefaults();
  s.approval = { approvers: ["behrouz@yallafixit.ae", "approver@yallafixit.ae"] };
  s.clauseList = s.clauseList.map((c, i) =>
    i === 0 ? { ...c, enabled: false, body: "SECRET DISABLED CLAUSE TEXT" } : c,
  );
  const firstRole = s.clauseList[0].role;
  if (firstRole) (s.clauses as Record<string, string>)[firstRole] = "SECRET DISABLED CLAUSE TEXT";
  return s;
}

test("internal approver emails are not exposed to the client", () => {
  const dto = toPublicSettings(internalSettings(), ["ac-ppm"]);
  assert.deepEqual(dto.approval, { approvers: [] });
  assert.ok(!JSON.stringify(dto).includes("behrouz@yallafixit.ae"));
  assert.ok(!JSON.stringify(dto).includes("approver@yallafixit.ae"));
});

test("disabled clauses are not sent", () => {
  const dto = toPublicSettings(internalSettings(), ["ac-ppm"]);
  assert.ok(!JSON.stringify(dto).includes("SECRET DISABLED CLAUSE TEXT"));
  assert.ok(dto.clauseList.every((c) => c.enabled !== false));
});

test("only this proposal's services and scopes are sent", () => {
  const dto = toPublicSettings(internalSettings(), ["ac-ppm", "handyman"]);
  assert.deepEqual(
    dto.services.map((s) => s.id).sort(),
    ["ac-ppm", "handyman"],
  );
  for (const id of Object.keys(dto.serviceScopes)) {
    assert.ok(["ac-ppm", "handyman"].includes(id), id);
  }
});

test("an open link carries the document facts; a closed one only the outcome", () => {
  const row = {
    status: "proposal_sent",
    proposal_number: "AMC-2026-6900",
    customer: { customerName: "A Client", customerId: "YFI1", customerEmail: "c@example.com" },
    property: { propertyAddress: "Villa 1" },
    final_price: 1000,
    signed_by_name: null,
    signed_at: null,
    owner_id: "internal-owner",
    proposal_token_hash: "hash",
  };
  const open = toPublicStatus(row, "proposal");
  assert.equal(open.closed, false);
  assert.equal(open.customerName, "A Client");
  assert.equal(open.finalPrice, 1000);

  const closed = toPublicStatus({ ...row, status: "proposal_approved" }, "proposal");
  assert.equal(closed.closed, true);
  assert.equal(closed.customerName, null);
  assert.equal(closed.property, null);
  assert.equal(closed.finalPrice, 0);

  const serialized = JSON.stringify([open, closed]);
  for (const internal of ["internal-owner", "YFI1", "hash", "c@example.com"]) {
    assert.ok(!serialized.includes(internal), internal);
  }
});

test("the signer's own name and time come back only for a signed contract", () => {
  const signed = toPublicStatus(
    { status: "signed", signed_by_name: "A Client", signed_at: "2026-10-05T10:00:00Z" },
    "contract",
  );
  assert.equal(signed.signedByName, "A Client");
  const proposal = toPublicStatus(
    { status: "signed", signed_by_name: "A Client", signed_at: "2026-10-05T10:00:00Z" },
    "proposal",
  );
  assert.equal(proposal.signedByName, null);
});
