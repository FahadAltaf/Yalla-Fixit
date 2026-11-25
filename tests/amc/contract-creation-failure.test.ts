import assert from "node:assert/strict";
import test from "node:test";

import { AMC_CONFIG_DEFAULTS } from "@/lib/amc/config";
import { createContractFromApproval } from "@/lib/server/amc/contract-lifecycle";
import { fakeSupabase } from "./fake-supabase";

/* DEV-505 (20 Nov 2026): a contract that is not created after the client's approval is shown to the owner, not swallowed. */
test("a failed creation is logged on the proposal, told to its owner and returned with the reason", async () => {
  const w = fakeSupabase(
    {
      amc_submissions: [{ id: "s1", owner_id: "owner-1", proposal_number: "AMC-2026-0042", status: "proposal_approved", form_data: null, current_version: 1 }],
      amc_contracts: [],
      amc_notifications: [],
    },
    { unique: { amc_notifications: [["dedupe_key", "channel", "recipient_key"]] }, generated: { amc_notifications: (r) => ({ recipient_key: r.recipient_user_id }) } },
  );
  const result = await createContractFromApproval(w.client as never, "s1", { id: null, label: "Client" }, AMC_CONFIG_DEFAULTS);
  assert.equal(result.contractId, null);
  assert.equal(result.created, false);
  assert.ok(result.reason && result.reason !== "not approved", `a failure reason (${result.reason})`);
  assert.match(String(result.message), /^The contract record was not created/);
  const audit = w.table("amc_audit_events").filter((e) => e.event_type === "contract_creation_failed");
  assert.equal(audit.length, 1);
  assert.equal(audit[0].entity_id, "s1");
  const notes = w.table("amc_notifications").filter((n) => n.event === "contract_creation_failed");
  assert.equal(notes.length, 1);
  assert.equal(notes[0].recipient_user_id, "owner-1");
  assert.equal(notes[0].link, "/extensions/amc/s1");
});
