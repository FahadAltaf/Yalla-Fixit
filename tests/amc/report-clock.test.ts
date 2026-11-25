import assert from "node:assert/strict";
import test from "node:test";

import { reportDueAt } from "@/lib/amc/job-sheets";
import { reachedClient } from "@/lib/amc/send-channels";
import { markFieldReportSent } from "@/lib/server/amc/field-job-sheets";
import { fakeSupabase } from "./fake-supabase";

/* DEV-404 (20 Nov 2026 review). */
test("only an email that went stops the report clock; a WhatsApp text or a link does not", () => {
  assert.equal(reachedClient("sent"), true);
  assert.equal(reachedClient("prepared"), false, "WhatsApp prepared, nothing reached the client yet");
  assert.equal(reachedClient("link_created"), false, "link copied, nothing reached the client yet");
  assert.equal(reachedClient("failed"), false);
  assert.equal(reachedClient("no_recipient"), false);
});

test("the clock runs for the configured hours, not a fixed 48", () => {
  assert.equal(reportDueAt("2026-11-20T10:00:00.000Z", 24), "2026-11-21T10:00:00.000Z");
  assert.equal(reportDueAt("2026-11-20T10:00:00.000Z", 72), "2026-11-23T10:00:00.000Z");
});

test("the coordinator marks a report sent once, and only when one was made", async () => {
  const actor = { id: "u1", label: "Coordinator" };
  const w = fakeSupabase({
    amc_call_outs: [
      { id: "co1", report_document_id: "doc1", report_sent_at: null },
      { id: "co2", report_document_id: null, report_sent_at: null },
    ],
  });
  const r = await markFieldReportSent(w.client as never, "call_out", "co1", { channel: "whatsapp", note: "Sent to the tenant" }, actor);
  assert.equal(r.ok, true);
  assert.ok(w.table("amc_call_outs").find((c) => c.id === "co1")?.report_sent_at);
  await assert.rejects(markFieldReportSent(w.client as never, "call_out", "co1", { channel: "whatsapp", note: null }, actor), /already marked sent/);
  await assert.rejects(markFieldReportSent(w.client as never, "call_out", "co2", { channel: "other", note: null }, actor), /no service report yet/);
});
