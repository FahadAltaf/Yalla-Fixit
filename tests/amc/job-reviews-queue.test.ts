import assert from "node:assert/strict";
import test from "node:test";

import { reviewQueue } from "@/lib/server/amc/job-sheets";
import { fakeSupabase } from "./fake-supabase";

/* DEV-497 (BRD v0.4 5.12): job sheets of planned visits, call outs and additional work come to the same review screen. */
test("the review queue holds every kind of job sheet, with its client, number and page", async () => {
  const w = fakeSupabase({
    amc_visit_job_sheets: [
      { id: "s1", status: "submitted", visit_id: "v1", call_out_id: null, additional_work_id: null, contract_id: "c1", submitted_at: "2026-11-20T08:00:00Z", review_required: false, review_reasons: [], return_count: 0 },
      { id: "s2", status: "submitted", visit_id: null, call_out_id: "co1", additional_work_id: null, contract_id: "c1", submitted_at: "2026-11-20T09:00:00Z", review_required: true, review_reasons: ["pending_works"], return_count: 1 },
      { id: "s3", status: "submitted", visit_id: null, call_out_id: null, additional_work_id: "aw1", contract_id: "c1", submitted_at: "2026-11-20T10:00:00Z", review_required: false, review_reasons: [], return_count: 0 },
      { id: "s4", status: "closed", visit_id: "v2", call_out_id: null, additional_work_id: null, contract_id: "c1", submitted_at: "2026-11-19T10:00:00Z", review_required: false, review_reasons: [], return_count: 0 },
    ],
    amc_visits: [{ id: "v1", visit_no: 3, contract_id: "c1", report_due_at: null, report_sent_at: null }],
    amc_call_outs: [{ id: "co1", call_out_no: "CO-2026-0004", contract_id: "c1", report_due_at: null, report_sent_at: null }],
    amc_additional_works: [{ id: "aw1", work_no: "AW-2026-0001", contract_id: "c1", report_due_at: null, report_sent_at: null }],
    amc_contracts: [{ id: "c1", contract_number: "AMC-C-2026-0003", proposal_number: "AMC-2026-0022", customer_name: null, customer: { customerName: "Bert Porter" }, property_label: "14 East New Street" }],
  });
  const q = await reviewQueue(w.client as never, new Date("2026-11-21T00:00:00Z"));
  assert.equal(q.migrated, true);
  assert.equal(q.items.length, 3, "only submitted sheets, all three kinds");
  const byKind = Object.fromEntries(q.items.map((i) => [i.kind, i]));
  assert.equal(byKind.ppm.ref, "Visit 3");
  assert.equal(byKind.ppm.href, "/extensions/amc-contracts/visits/v1?tab=job_sheet");
  assert.equal(byKind.call_out.ref, "CO-2026-0004");
  assert.equal(byKind.call_out.href, "/extensions/amc-contracts/visits/co1?tab=job_sheet");
  assert.equal(byKind.additional_work.ref, "AW-2026-0001");
  assert.equal(byKind.additional_work.href, "/extensions/amc-contracts/additional-works/aw1?tab=job_sheet");
  for (const i of q.items) {
    assert.equal(i.customerName, "Bert Porter", "the client from the contract's record");
    assert.equal(i.contractNumber, "AMC-C-2026-0003");
    assert.equal(i.propertyLabel, "14 East New Street");
  }
  assert.deepEqual(byKind.call_out.reviewReasons, ["pending_works"]);
});
