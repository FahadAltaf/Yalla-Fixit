import assert from "node:assert/strict";
import test from "node:test";

import { clientReportHtml, type ClientReport } from "@/lib/server/amc/client-report";
import { buildClientReportModel } from "@/components/dashboard/extensions/amc-contracts/client-report-document";

/* DEV-503: a client report variant with the PPM visits and call outs and their dates, without financial figures or additional work costs. */
const base = {
  contract: { id: "c1", number: "AMC-C-1", propertyLabel: "Villa 4", startDate: "2026-01-01", endDate: "2026-12-31", customerName: "Client", customerEmail: null, customerPhone: null, submissionId: "s1" },
  intro: "Here is your AMC so far.",
  closing: "Thank you.",
  owner: null,
  scope: [],
  visitsDone: [{ visitNo: 1, date: "2026-03-01", status: "completed", services: ["AC service"], photos: [] }],
  visitsRemaining: [],
  callOuts: [{ number: "CO-1", priority: "emergency", issue: "Leak", reportedAt: "2026-04-01T08:00:00Z", attendedAt: "2026-04-01T10:00:00Z", covered: false, slaMet: true }],
  additionalWork: [{ number: "AW-1", finding: "Replace valve", status: "completed", total: 0 }],
  asOf: "2026-11-22",
} as unknown as ClientReport;

test("without prices: no amounts, no 'chargeable', the visits and call outs with their dates stay", () => {
  const html = clientReportHtml({ ...base, financials: false } as ClientReport);
  assert.doesNotMatch(html, /AED/);
  assert.doesNotMatch(html, /Chargeable|Coverage/);
  assert.match(html, /CO-1/);
  assert.match(html, /AW-1/);
  assert.match(html, /Visit 1/);
  const doc = JSON.stringify(buildClientReportModel({ ...base, financials: false } as ClientReport));
  assert.doesNotMatch(doc, /AED|Chargeable|COVERAGE/);
  assert.match(doc, /CO-1/);
});

test("the full report still shows the costs", () => {
  const html = clientReportHtml({ ...base, financials: true, additionalWork: [{ number: "AW-1", finding: "Replace valve", status: "completed", total: 525 }] } as ClientReport);
  assert.match(html, /AED incl\. VAT/);
  assert.match(html, /Chargeable/);
});
