import { test } from "node:test";
import assert from "node:assert/strict";

import { publicSettingsFor, toPublicSettings, toPublicStatus } from "@/lib/server/amc/public-dto";
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

test("a snapshot from before 28 Sep (no clauseList, no services) still renders", () => {
  // Shape of every sent proposal's snapshot in production on 5 Oct 2026.
  const full = getAmcSettingsDefaults();
  const old = {
    provider: { ...full.provider, contactNo: "800-PERFECT" },
    clauses: full.clauses,
    serviceScopes: full.serviceScopes,
    brochure: full.brochure,
    approval: { approvers: ["behrouz@yallafixit.ae"] },
  };
  const dto = publicSettingsFor(old as never, null, ["ac-ppm"]);
  assert.ok(dto.clauseList.length > 0, "clauses come back from the defaults");
  assert.deepEqual(dto.services.map((s) => s.id), ["ac-ppm"]);
  assert.equal(dto.provider.contactNo, "800-PERFECT", "the snapshot's own values win");
  assert.deepEqual(dto.approval, { approvers: [] });
});

test("with no snapshot, live settings are used (trimmed)", () => {
  const live = internalSettings();
  const dto = publicSettingsFor(null, live, ["handyman"]);
  assert.deepEqual(dto.services.map((s) => s.id), ["handyman"]);
  assert.deepEqual(dto.approval, { approvers: [] });
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

/*
  27 Nov 2026 (AMC-C-2026-0001 on live): the client's contract printed
  "Customer ID: —" and "Terms of Payment: Annual" on a 50/50 proposal the
  team's preview showed correctly. The link's document carries both now.
*/
test("the client's contract prints the Customer ID and the payment plan, as the team's preview does", async () => {
  const { readFileSync } = await import("node:fs");
  const route = readFileSync("app/api/amc/[token]/route.ts", "utf8");
  assert.doesNotMatch(route, /delete customer\.customerId/, "the printed Customer ID reaches the client");
  assert.match(route, /payment_plan: \(row\.payment_plan/, "the payment plan reaches the client");

  /* What computeAmcClientData does on the client page, without the renderer. */
  const { computeAmcData } = await import("@/components/dashboard/extensions/amc/amc-pricing");
  const { buildAmcDocumentModel } = await import("@/components/dashboard/extensions/amc/amc-document-model");
  const { getDefaultFormValues } = await import("@/components/dashboard/extensions/amc/amc-constants");
  const { formDataToSubmissionPayload, submissionToFormData } = await import("@/components/dashboard/extensions/amc/amc-submission-mapper");
  const form = { ...getDefaultFormValues(), customerId: "YFI1003", customerName: "A Client", startDate: "2026-12-01", endDate: "2027-12-01", paymentTerms: "annual" as const, paymentPlan: "fifty_fifty" as const };
  const payload = formDataToSubmissionPayload(form) as unknown as Record<string, unknown>;
  const source = { property: payload.property, customer: payload.customer, document_options: payload.document_options ?? {}, services: payload.services, discount_percent: 0, payment_plan: "fifty_fifty", payment_plan_custom: null };
  const data = computeAmcData(submissionToFormData(source as never), "contract", getAmcSettingsDefaults(), "2026-11-27T10:00:00Z");
  const text = JSON.stringify(buildAmcDocumentModel(data).blocks);
  assert.match(text, /YFI1003/);
  assert.match(text, /Terms of Payment.*?50\/50/);
  assert.doesNotMatch(text, /Terms of Payment","bold"?.{0,40}Annual/);
});

test("a signature on the link that signs the contract is announced once, by the contract, with who signed and when (27 Nov 2026)", async () => {
  const { readFileSync } = await import("node:fs");
  const route = readFileSync("app/api/amc/[token]/route.ts", "utf8");
  assert.match(route, /announced = await clientSignedOnLink\(/);
  assert.ok(route.indexOf("if (announced) return;") < route.indexOf("await notifyProposalEvent(admin, {"), "the proposal's own notice is skipped then");
  assert.ok(route.indexOf("archiveSignedContract(") < route.indexOf("if (announced) return;"), "the signed copy is still archived");
  const lifecycle = readFileSync("lib/server/amc/contract-lifecycle.ts", "utf8");
  assert.match(lifecycle, /event: "contract_signed"[^\n]*facts: typed/, "the contract's notice carries the typed name and time");
});
