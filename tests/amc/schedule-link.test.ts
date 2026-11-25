import { test } from "node:test";
import assert from "node:assert/strict";

import { touchedIds } from "@/lib/server/amc/schedule-link";
import { AMC_ENTRY_READ_ONLY, amcEntryHref } from "@/lib/scheduling/amc-entries";

/* DEV-489 (25 Nov 2026): AMC work on the Scheduling board. */

test("an AMC entry opens its record in AMC", () => {
  assert.equal(amcEntryHref("ppm", "v1"), "/extensions/amc-contracts/visits/v1");
  assert.equal(amcEntryHref("call_out", "c1"), "/extensions/amc-contracts/visits/c1");
  assert.equal(amcEntryHref("additional_work", "w1"), "/extensions/amc-contracts/additional-works/w1");
  assert.equal(amcEntryHref(null, "x"), null, "an ordinary entry has no AMC page");
  assert.match(AMC_ENTRY_READ_ONLY, /change or remove it in AMC/);
});

test("the AMC records a board request touches: one, or a bulk move", () => {
  assert.deepEqual(touchedIds({ action: "place", visitId: "v1", date: "2026-11-25" }), ["v1"]);
  assert.deepEqual(touchedIds({ action: "move", visitIds: ["v1", "v2"], date: "2026-11-26" }), ["v1", "v2"]);
  assert.deepEqual(touchedIds(null), []);
});
