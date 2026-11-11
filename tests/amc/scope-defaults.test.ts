import { test } from "node:test";
import assert from "node:assert/strict";

import { AMC_SCOPE_LIBRARY } from "@/components/dashboard/extensions/amc/amc-scope-library";
import { effectiveExclusions, libraryEntry, standardExclusions, standardFrequency, standardUnit } from "@/lib/amc/scope-defaults";

test("the library gives every one of its 33 services exclusions, a unit and a default frequency", () => {
  assert.equal(AMC_SCOPE_LIBRARY.length, 33);
  for (const entry of AMC_SCOPE_LIBRARY) {
    assert.ok(standardExclusions(entry.id), `${entry.ref} exclusions`);
    assert.ok(standardUnit(entry.id), `${entry.ref} unit`);
    assert.ok(standardFrequency(entry.id), `${entry.ref} frequency`);
  }
});

test("a contract's own exclusions win; without them the library's standard text is used and marked", () => {
  assert.deepEqual(effectiveExclusions("ac-ppm", "Only the ducts"), { text: "Only the ducts", standard: false });
  const fallback = effectiveExclusions("ac-ppm", null);
  assert.equal(fallback.standard, true);
  assert.match(fallback.text ?? "", /refrigerant top-up/);
  assert.deepEqual(effectiveExclusions("ac-ppm", "   "), fallback, "blank counts as none");
});

test("a service the library does not cover (the hotline) has no standard text", () => {
  assert.equal(libraryEntry("helpdesk"), null);
  assert.deepEqual(effectiveExclusions("helpdesk", null), { text: null, standard: false });
});
