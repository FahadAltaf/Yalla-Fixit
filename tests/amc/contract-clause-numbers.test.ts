import { test } from "node:test";
import assert from "node:assert/strict";

import { getDefaultFormValues } from "@/components/dashboard/extensions/amc/amc-constants";
import { buildAmcDocumentModel, contractClauseNumbers } from "@/components/dashboard/extensions/amc/amc-document-model";
import { computeAmcData } from "@/components/dashboard/extensions/amc/amc-pricing";
import { getAmcSettingsDefaults } from "@/components/dashboard/extensions/amc/amc-settings";

/*
  27 Nov 2026 (AMC-2026-0001 on live): the proposal's wording step listed
  "6.1 Bank Details" and "7.1 Confirmation" while the contract printed 6.1
  as the first general term and the confirmation under clause 7 with no
  number. A clause printed as part of the one above carries that number.
*/
test("a clause printed as part of the one above carries its number, and takes no sub-number", () => {
  const settings = getAmcSettingsDefaults();
  const data = computeAmcData({ ...getDefaultFormValues(), startDate: "2026-12-01", endDate: "2027-12-01" }, "contract", settings);
  const numbers = contractClauseNumbers(data);
  const parentOf = (role: string) => {
    const list = settings.clauseList;
    const at = list.findIndex((c) => c.role === role);
    assert.ok(at > 0, `${role} is in the standard clauses`);
    const parent = [...list.slice(0, at)].reverse().find((c) => c.level === 1)!;
    return numbers.get(parent.id);
  };
  for (const role of ["bankDetails", "invoiceTerms", "contractConfirmation"]) {
    const n = numbers.get(role);
    assert.ok(n, `${role} is on the contract`);
    assert.doesNotMatch(n!, /\./, `${role} has no sub-number of its own`);
    assert.equal(n, parentOf(role), `${role} carries the number of the clause it prints under`);
  }

  /* Every number the wording step can show for a clause with a heading is one the contract prints. */
  const printed = new Set(buildAmcDocumentModel(data).blocks.flatMap((b) => ((b.kind === "heading" || b.kind === "subheading") && b.number ? [b.number] : [])));
  const headed = settings.clauseList.filter((c) => numbers.get(c.id) && !["bankDetails", "invoiceTerms", "contractConfirmation", "excludedOffer", "signatures", "scopeServices"].includes(c.role ?? ""));
  assert.ok(headed.length > 3);
  for (const c of headed) assert.ok(printed.has(numbers.get(c.id)!), `${c.title} (${numbers.get(c.id)}) is printed with that number`);
});
