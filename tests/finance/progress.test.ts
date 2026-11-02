import { test } from "node:test";
import assert from "node:assert/strict";

import { queueStatus } from "@/lib/finance/line-status";
import {
  completionRefusal,
  effectiveEntry,
  invoiceCap,
  invoicingStatus,
  isEnded,
  isFlaggedToInvoice,
  isNonBillable,
  isVoid,
  lineBillable,
  lineCompletion,
  readyForFinance,
  recognisedValue,
  workOrderCompletion,
  type ProgressEntry,
} from "@/lib/finance/progress";

const entry = (lineId: string | null, percent: number, purpose: ProgressEntry["purpose"], recordedAt: string): ProgressEntry => ({
  lineId,
  percent,
  purpose,
  recordedAt,
});

test("Finance's work: Completed in FSM and the quotation flagged To Be Invoiced", () => {
  assert.equal(isFlaggedToInvoice("To Be Invoiced"), true);
  assert.equal(isFlaggedToInvoice(" to be invoiced "), true);
  assert.equal(isFlaggedToInvoice(null), false);
  assert.equal(readyForFinance("Completed", "To Be Invoiced"), true);
  assert.equal(readyForFinance("Completed", null), false, "completed but not flagged");
  assert.equal(readyForFinance("In Progress", "To Be Invoiced"), false, "flagged but not completed");
});

test("FSM's Non-billable and Void are recognised however they are written", () => {
  assert.equal(isNonBillable("Non-billable"), true);
  assert.equal(isNonBillable("Non Billable"), true);
  assert.equal(isNonBillable("NonBillable"), true);
  assert.equal(isVoid("Void"), true);
  assert.equal(isVoid("Completed"), false);
});

test("the entry that counts for a line is the latest of its own and the whole work order's", () => {
  const entries = [entry(null, 30, "invoice", "2026-10-01T08:00:00Z"), entry("L1", 50, "invoice", "2026-10-02T08:00:00Z"), entry(null, 70, "revenue_only", "2026-10-03T08:00:00Z")];
  assert.equal(effectiveEntry("L1", entries)?.percent, 70, "a later whole-work-order entry wins");
  assert.equal(effectiveEntry("L2", entries)?.percent, 70);
  assert.equal(effectiveEntry("L1", entries.slice(0, 2))?.percent, 50, "the line's own later entry wins");
  assert.equal(effectiveEntry("L1", []), null);
});

test("what Finance may invoice now", () => {
  const line = { amount: 1000, invoicedAmount: 200 };
  assert.equal(invoiceCap(line, { workOrderStatus: "Completed", postToMaher: "To Be Invoiced", entry: null }), 800, "ready for Finance: all that is left");
  assert.equal(invoiceCap(line, { workOrderStatus: "In Progress", postToMaher: null, entry: null }), 0, "nothing recorded: nothing");
  assert.equal(
    invoiceCap(line, { workOrderStatus: "In Progress", postToMaher: null, entry: entry("L1", 60, "invoice", "2026-10-01T00:00:00Z") }),
    400,
    "60 % to invoice, less the 200 already invoiced",
  );
  assert.equal(
    invoiceCap(line, { workOrderStatus: "In Progress", postToMaher: null, entry: entry("L1", 60, "revenue_only", "2026-10-01T00:00:00Z") }),
    0,
    "revenue only: nothing to invoice",
  );
  assert.equal(
    invoiceCap(line, { workOrderStatus: "In Progress", postToMaher: null, entry: entry("L1", 10, "invoice", "2026-10-01T00:00:00Z") }),
    0,
    "a percentage below what is invoiced allows nothing more",
  );
  assert.equal(
    invoiceCap(line, { workOrderStatus: "Completed", postToMaher: null, entry: entry("L1", 50, "invoice", "2026-10-01T00:00:00Z") }),
    300,
    "completed but not flagged: still only the percentage",
  );
  assert.equal(invoiceCap(line, { workOrderStatus: "Non-billable", postToMaher: "To Be Invoiced", entry: null }), 0, "never Non-billable");
  assert.equal(invoiceCap(line, { workOrderStatus: "Void", postToMaher: "To Be Invoiced", entry: null }), 0, "never Void");
});

test("recognised revenue: all of a completed work order, else the latest percentage, never below what is invoiced", () => {
  const line = { amount: 1000, invoicedAmount: 200 };
  assert.equal(recognisedValue(line, { workOrderStatus: "Completed", entry: null }), 1000);
  assert.equal(recognisedValue(line, { workOrderStatus: "In Progress", entry: entry("L1", 60, "revenue_only", "2026-10-01T00:00:00Z") }), 600);
  assert.equal(recognisedValue(line, { workOrderStatus: "In Progress", entry: entry("L1", 10, "invoice", "2026-10-01T00:00:00Z") }), 200, "never below invoiced");
  assert.equal(recognisedValue(line, { workOrderStatus: "In Progress", entry: null }), 200);
  assert.equal(recognisedValue(line, { workOrderStatus: "Non-billable", entry: null }), 200, "Non-billable is not booked here");
});

test("FSM's end states come next to the portal's", () => {
  assert.equal(queueStatus("open", "not_ready", "Void"), "void");
  assert.equal(queueStatus("open", "not_ready", "Non-billable"), "non_billable");
  assert.equal(queueStatus("excluded", "not_ready", "Void"), "excluded", "the portal's exclusion stands");
  assert.equal(queueStatus("open", "invoiced", "Non-billable"), "invoiced", "invoiced in full ends it");
  assert.equal(queueStatus("open", "ready", "Completed"), "pending");
});

test("FSM's Billing Status Non Billable makes the work order non-billable, whatever its status", () => {
  /* WO3000: In Progress, Billing Status Non Billable. */
  assert.equal(invoicingStatus("In Progress", "Non Billable"), "Non-billable");
  assert.equal(invoicingStatus("Completed", "Non Billable"), "Non-billable");
  assert.equal(invoicingStatus("Completed", "Billable"), "Completed");
  assert.equal(invoicingStatus("Completed", null), "Completed");
  assert.equal(invoicingStatus("Void", "Non Billable"), "Void");
  const wo = invoicingStatus("Completed", "Non Billable");
  assert.equal(readyForFinance(wo, "To Be Invoiced"), false);
  assert.equal(invoiceCap({ amount: 100, invoicedAmount: 0 }, { workOrderStatus: wo, postToMaher: "To Be Invoiced", entry: null }), 0);
});

test("a line's own Billing Status decides; the work order's when the line has none", () => {
  assert.equal(lineBillable("Not yet Invoiced", "Not yet Invoiced"), true);
  assert.equal(lineBillable("Non Billable", "Not yet Invoiced"), false);
  /* A billable line on a work order summarised as Non Billable is still billable. */
  assert.equal(lineBillable("Not yet Invoiced", "Non Billable"), true);
  assert.equal(lineBillable(null, "Non Billable"), false);
  assert.equal(lineBillable("", "Not yet Invoiced"), true);
  assert.equal(lineBillable(null, null), true);
});

test("30 Oct: a line is Complete at 100 %, Partially complete below it, Not started at 0 or with nothing", () => {
  assert.equal(lineCompletion(null), "not_started");
  assert.equal(lineCompletion({ percent: 0 }), "not_started");
  assert.equal(lineCompletion({ percent: 40 }), "partial");
  assert.equal(lineCompletion({ percent: 100 }), "complete");
});

test("30 Oct: the work order is Complete only when every billable line is", () => {
  const wo = (...c: Array<[boolean, "not_started" | "partial" | "complete"]>) => workOrderCompletion(c.map(([billable, completion]) => ({ billable, completion })));
  assert.deepEqual(wo([true, "complete"], [true, "complete"]), { completion: "complete", complete: 2, billable: 2 });
  assert.equal(wo([true, "complete"], [true, "partial"]).completion, "partial");
  assert.equal(wo([true, "complete"], [true, "not_started"]).completion, "partial");
  assert.equal(wo([true, "not_started"], [true, "not_started"]).completion, "not_started");
  assert.equal(wo([true, "complete"], [false, "not_started"]).completion, "complete", "a Non Billable line is not waited for");
});

test("30 Oct: completing the work order is refused until every line is complete; partial is per line", () => {
  const lines = [
    { id: "L1", name: "Paint", billable: true, completion: "complete" as const },
    { id: "L2", name: "Tiles", billable: true, completion: "partial" as const },
  ];
  assert.match(completionRefusal([{ line: null, percent: 100, purpose: "invoice" }], lines) ?? "", /Not complete yet: Tiles/);
  assert.equal(
    completionRefusal(
      [
        { line: "L2", percent: 100, purpose: "invoice" },
        { line: null, percent: 100, purpose: "invoice" },
      ],
      lines,
    ),
    null,
    "completing the last line and the work order together is fine",
  );
  assert.match(completionRefusal([{ line: null, percent: 60, purpose: "invoice" }], lines) ?? "", /line by line/);
  assert.equal(completionRefusal([{ line: "L2", percent: 100, purpose: "revenue_only" }], lines), null, "Complete may be revenue only (30 Oct)");
  assert.match(completionRefusal([{ line: "L2", percent: 0, purpose: "invoice" }], lines) ?? "", /above 0/);
  assert.equal(completionRefusal([{ line: "L2", percent: 60, purpose: "revenue_only" }], lines), null);
});

test("30 Oct: Cancelled and Closed work orders are over, like Void: nothing to invoice or newly recognise", () => {
  assert.equal(isEnded("Cancelled"), true);
  assert.equal(isEnded("Canceled"), true);
  assert.equal(isEnded("Closed"), true);
  assert.equal(isEnded("Void"), true);
  assert.equal(isEnded("In Progress"), false);
  assert.equal(isEnded("Completed"), false);
  const line = { amount: 650, invoicedAmount: 0 };
  const entry = { lineId: "L1", percent: 100, purpose: "invoice" as const, recordedAt: "2026-10-30T08:00:00Z" };
  assert.equal(invoiceCap(line, { workOrderStatus: "Cancelled", postToMaher: "To Be Invoiced", entry }), 0);
  assert.equal(invoiceCap(line, { workOrderStatus: "Closed", postToMaher: null, entry }), 0);
  assert.equal(recognisedValue({ amount: 650, invoicedAmount: 100 }, { workOrderStatus: "Cancelled", entry }), 100, "what was invoiced before stays");
  assert.equal(invoicingStatus("Cancelled", "Non Billable"), "Cancelled", "Cancelled stays Cancelled, not Non-billable");
});
