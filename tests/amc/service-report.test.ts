import assert from "node:assert/strict";
import test from "node:test";

import { buildServiceReportModel, serviceReportFileName, shortCaption, type ServiceReportFacts } from "@/lib/amc/service-report";
import { withoutReportLink } from "@/lib/server/amc/job-sheets";

const facts: ServiceReportFacts = {
  kind: "call_out",
  ref: "CO-2026-0004",
  contractNumber: "AMC-C-2026-0003",
  customerName: "Test Client",
  propertyLabel: "14 East New Street",
  work: "Plumbing · Leak",
  arrivedAt: "2026-11-18T10:12:00Z",
  completedAt: "2026-11-18T10:29:00Z",
  outcome: "Completed",
  signedBy: "Test Client",
  lines: [],
  findings: "Fill valve seal perished.",
  notes: null,
  checklist: [{ label: "Fill valve", result: "fault", note: "Replaced" }],
  materials: [],
  pending: [],
  further: ["Isolation valve rusted"],
  photos: [{ url: "https://example.test/a.jpg", label: "Before", caption: "Cistern" }],
  closing: null,
};

const headings = (blocks: ReturnType<typeof buildServiceReportModel>["blocks"]) =>
  blocks.flatMap((b) => (b.kind === "heading" ? [`${b.number} ${b.text}`] : []));

test("service report: the AMC letterhead, banner, numbered sections and a photo grid", () => {
  const m = buildServiceReportModel(facts);
  assert.equal(m.blocks[0].kind, "contactStrip");
  assert.deepEqual(m.blocks[1], { kind: "banner", text: "CALL OUT SERVICE REPORT" });
  assert.deepEqual(headings(m.blocks), ["1 What was found", "2 Work done and notes", "3 Checklist", "4 Materials used", "5 Pending works", "6 Further work noted", "7 Photos"]);
  const photos = m.blocks.find((b) => b.kind === "photos");
  assert.ok(photos && photos.kind === "photos" && photos.items.length === 1);
  /* A planned visit's trades come first, as their own table. */
  const visit = buildServiceReportModel({ ...facts, kind: "visit", ref: "Visit 2 of 4", lines: [{ service: "AC", outcome: "Completed", reason: null }] });
  assert.equal(headings(visit.blocks)[0], "1 Work carried out");
  assert.equal(serviceReportFileName(facts), "Service report AMC-C-2026-0003 CO-2026-0004.pdf");
});

test("service report: the WhatsApp text loses its link and says the report is attached", () => {
  assert.equal(
    withoutReportLink("Dear A, the report of your AC visit on 1 Nov is ready: {Report link removed}"),
    "Dear A, the report of your AC visit on 1 Nov is ready. The report is attached.",
  );
  assert.equal(withoutReportLink("Dear A, please find attached the report."), "Dear A, please find attached the report.");
});

test("service report: a long photo caption is cut at a word", () => {
  assert.equal(shortCaption("Short"), "Short");
  assert.equal(shortCaption(null), null);
  const long = "Basin trap removed, cleaned of hair and soap build-up, refitted with new PTFE tape; drains freely and no leaks.";
  const cut = shortCaption(long)!;
  assert.ok(cut.length <= 91 && cut.endsWith("…") && long.startsWith(cut.slice(0, -1)));
});
