import assert from "node:assert/strict";
import test from "node:test";

import { nextClientRef } from "@/lib/server/amc/business";

/* Just enough of the database for the read nextClientRef makes. */
const adminWith = (refs: string[]) =>
  ({
    from: () => ({
      select: () => ({
        ilike: async () => ({ data: refs.map((customer_ref) => ({ customer_ref })), error: null }),
      }),
    }),
  }) as never;

test("the first Client ID the portal gives is YFI1001", async () => {
  assert.equal(await nextClientRef(adminWith([])), "YFI1001");
});

test("it continues after the highest short number on file", async () => {
  assert.equal(await nextClientRef(adminWith(["YFI1001", "YFI1806", "yfi1200"])), "YFI1807");
});

test("Zoho FSM's long numbers (YFI and its contact id) are not counted", async () => {
  assert.equal(await nextClientRef(adminWith(["YFI33246000001262791", "YFI1010"])), "YFI1011");
});

test("anything else typed as a Client ID is ignored", async () => {
  assert.equal(await nextClientRef(adminWith(["12311231", "YFI-12", "YFI12A"])), "YFI1001");
});
