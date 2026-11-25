import { test } from "node:test";
import assert from "node:assert/strict";

import { reportCsv, type ReportBlock } from "@/lib/amc/report-export";

/* The report export laid out like a report (25 Nov 2026), not one flat list. */
test("the CSV has the title, the period, then each block under its own heading", () => {
  const blocks: ReportBlock[] = [
    {
      sheet: "Summary",
      title: "At a glance (today)",
      columns: [
        { key: "measure", label: "Measure" },
        { key: "value", label: "Value" },
        { key: "unit", label: "Unit" },
      ],
      rows: [
        { measure: "Active contracts", value: 3, unit: "" },
        { measure: "Active contract value", value: 28980.4321, unit: "AED" },
      ],
    },
    {
      sheet: "Coordinators",
      title: "Coordinators",
      columns: [
        { key: "owner", label: "Coordinator" },
        { key: "signed", label: "Signed" },
      ],
      rows: [],
    },
  ];
  const lines = reportCsv("AMC report", ["Period: 1 Nov 2026 to 25 Nov 2026"], blocks).split("\r\n");
  assert.equal(lines[0], `"AMC report"`);
  assert.equal(lines[1], `"Period: 1 Nov 2026 to 25 Nov 2026"`);
  assert.ok(lines.includes(`"At a glance (today)"`), "a block starts with its title");
  assert.ok(lines.includes(`"Measure","Value","Unit"`), "then its own headings");
  assert.ok(lines.includes(`"Active contract value","28980.43","AED"`), "money to two decimals");
  assert.ok(lines.includes(`"COORDINATORS"`) === false, "a list whose sheet is its title has no extra heading");
  assert.ok(lines.includes(`"Nothing in this period."`), "an empty list says so");
});
