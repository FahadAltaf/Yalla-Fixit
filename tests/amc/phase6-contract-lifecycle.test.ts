import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { resolveAmcConfig } from "@/lib/amc/config";
import {
  canSignInternally,
  checkStatusChange,
  checkTerm,
  expiryFromCommencement,
  firstInstalment,
  lifecycleActionSchema,
  nextPendingSignatory,
  planSignatories,
  statusFromSignatures,
  templateForCategory,
  type SignatoryState,
} from "@/lib/amc/contract-lifecycle";
import { contractDisplayStatus } from "@/lib/amc/contracts";

/* Phase 6 of the BRD v0.3 plan: contract and signature (DEV-351, 372-376, 378, 420 Email 2, 423 #2). */

const UUID = "7b1f3c2a-4d5e-4f60-8a71-92b3c4d5e6f7";
const sig = (id: string, party: "client" | "internal", order: number, status: SignatoryState["status"], user_id: string | null = null) => ({ id, party, sign_order: order, status, user_id });

test("signatories: the client and the internal signatories in the configured order; the first is up", () => {
  const internal = [{ userId: "u1", name: "Rashid", email: "r@x.com" }, { userId: "u2", name: "Mona", email: null }];
  const clientFirst = planSignatories({ name: "Sara Ahmed", email: "sara@x.com" }, internal, "client_first");
  assert.deepEqual(clientFirst.map((s) => [s.sign_order, s.party, s.status]), [
    [1, "client", "pending"],
    [2, "internal", "waiting"],
    [3, "internal", "waiting"],
  ]);
  const internalFirst = planSignatories({ name: "Sara Ahmed", email: null }, internal, "internal_first");
  assert.deepEqual(internalFirst.map((s) => s.party), ["internal", "internal", "client"]);
  assert.equal(planSignatories({ name: "  ", email: null }, [], "client_first")[0].name, "Client");
});

test("the contract follows its signatures, and an internal signatory signs only in turn", () => {
  const rows = [sig("a", "client", 1, "pending"), sig("b", "internal", 2, "waiting", "u1"), sig("c", "internal", 3, "waiting", "u2")];
  assert.equal(statusFromSignatures(rows), "pending_client_signature");
  assert.equal(canSignInternally(rows, "u1"), null, "the client signs first");
  const afterClient = [sig("a", "client", 1, "signed"), sig("b", "internal", 2, "pending", "u1"), sig("c", "internal", 3, "waiting", "u2")];
  assert.equal(statusFromSignatures(afterClient), "pending_internal_signature");
  assert.equal(canSignInternally(afterClient, "u1")?.id, "b");
  assert.equal(canSignInternally(afterClient, "u2"), null, "not Mona's turn yet");
  assert.equal(nextPendingSignatory(afterClient)?.id, "b");
  assert.equal(statusFromSignatures(afterClient.map((s) => ({ ...s, status: "signed" as const }))), "signed");
});

test("term: commencement and months set the expiry; the minimum term is enforced", () => {
  assert.equal(expiryFromCommencement("2026-10-07", 12), "2027-10-06");
  assert.equal(expiryFromCommencement("2026-03-01", 12), "2027-02-28");
  assert.equal(expiryFromCommencement("2026-10-15", 24), "2028-10-14");
  assert.match(checkTerm(6, { minimumTermMonths: 12 }) ?? "", /at least 12 months/);
  assert.equal(checkTerm(12, { minimumTermMonths: 12 }), null);
  assert.equal(templateForCategory("commercial"), "commercial");
  assert.equal(templateForCategory(null), "residential");
});

test("status changes after signing: each from where it makes sense", () => {
  assert.equal(checkStatusChange("active", "on_hold"), null);
  assert.equal(checkStatusChange("on_hold", "active"), null, "resume");
  assert.equal(checkStatusChange("active", "terminated"), null);
  assert.equal(checkStatusChange("on_hold", "terminated"), null);
  assert.equal(checkStatusChange("signed", "cancelled"), null, "called off before it starts");
  assert.notEqual(checkStatusChange("draft", "on_hold"), null);
  assert.notEqual(checkStatusChange("active", "cancelled"), null, "an active contract is terminated, not called off");
  assert.notEqual(checkStatusChange("signed", "active"), null, "activation is its own step");
});

test("Email 2's first instalment follows the plan (incl. VAT)", () => {
  assert.equal(firstInstalment("single", null, 10_000), 10_500);
  assert.equal(firstInstalment("fifty_fifty", null, 10_000), 5_250);
  assert.equal(firstInstalment("quarterly", null, 10_000), 2_625);
  assert.equal(firstInstalment("monthly", null, 10_000), 875);
  assert.equal(firstInstalment("custom", [{ label: "On signing", percent: 30 }, { label: "Later", percent: 70 }], 10_000), 3_150);
});

test("display: a contract shows the status it was put in; dates decide only once active", () => {
  const dates = { startDate: "2026-01-01", endDate: "2026-12-31" };
  assert.equal(contractDisplayStatus({ status: "draft", ...dates }, "2026-06-01"), "draft");
  assert.equal(contractDisplayStatus({ status: "pending_client_signature", ...dates }, "2026-06-01"), "pending_client_signature");
  assert.equal(contractDisplayStatus({ status: "on_hold", ...dates }, "2026-06-01"), "on_hold");
  assert.equal(contractDisplayStatus({ status: "expired", ...dates }, "2026-06-01"), "expired", "stored expired");
  assert.equal(contractDisplayStatus({ status: "active", ...dates }, "2026-06-01"), "active");
  assert.equal(contractDisplayStatus({ status: "active", ...dates }, "2027-01-02"), "expired", "derived as before");
  assert.equal(contractDisplayStatus({ status: "cancelled", ...dates }, "2026-06-01"), "cancelled");
});

test("configuration: a contracts section saved before Phase 6 still validates, with the new defaults", () => {
  const { config, invalid } = resolveAmcConfig([{ key: "contracts", value: { minimumTermMonths: 24, unsignedReminderDays: 5, unsignedReminderMax: 2 } }]);
  assert.deepEqual(invalid, []);
  assert.equal(config.contracts.minimumTermMonths, 24, "the saved value is kept");
  assert.deepEqual(config.contracts.internalSignatoryIds, []);
  assert.equal(config.contracts.signingOrder, "client_first");
});

test("lifecycle actions are checked", () => {
  assert.equal(lifecycleActionSchema.safeParse({ action: "activate", commencementDate: "2026-11-01", termMonths: 12 }).success, true);
  assert.equal(lifecycleActionSchema.safeParse({ action: "status", to: "on_hold", reason: "" }).success, false, "a reason is required");
  assert.equal(lifecycleActionSchema.safeParse({ action: "status", to: "expired", reason: "x y z" }).success, false, "expired is the system's");
  assert.equal(lifecycleActionSchema.safeParse({ action: "scan", documentId: UUID, signedDate: "2026-10-07", signedByName: "Sara" }).success, true);
  assert.equal(lifecycleActionSchema.safeParse({ action: "sign", typedName: "A" }).success, false);
});

test("migration: branch-only tables, 11 statuses, signed means signed, contract numbers", () => {
  const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/20261007160000_amc_contract_lifecycle.sql"), "utf8")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  for (const s of ["draft", "pending_client_signature", "pending_internal_signature", "signed", "pending_initial_payment", "active", "on_hold", "expired", "renewed", "cancelled", "terminated"]) {
    assert.match(sql, new RegExp(`'${s}'`), s);
  }
  assert.match(sql, /'AMC-C-'/);
  assert.match(sql, /amc_contracts_signed_shape/);
  assert.match(sql, /amc_contracts_hold_needs_reason/);
  assert.match(sql, /ALTER TABLE public\.amc_contract_signatories ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON public\.amc_contract_signatories FROM anon, authenticated/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
  assert.doesNotMatch(sql, /amc_submissions\s+ADD|ALTER TABLE public\.amc_submissions/, "the live table is not touched");
  assert.doesNotMatch(sql, /DROP TABLE|SECURITY DEFINER/);
});
