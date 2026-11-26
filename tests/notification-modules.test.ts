import { test } from "node:test";
import assert from "node:assert/strict";

import { moduleOfEvent } from "@/lib/notifications/modules";
import { notifyInPortal } from "@/lib/server/notifications/portal-notify";

/* 26 Nov 2026: one inbox for the whole portal, sorted by module. */

test("each notice belongs to the module it comes from", () => {
  assert.equal(moduleOfEvent("anything", "amc"), "amc");
  assert.equal(moduleOfEvent("finance.query_raised"), "invoicing");
  assert.equal(moduleOfEvent("snagging.submitted"), "snagging");
  assert.equal(moduleOfEvent("scheduling.approved"), "scheduling");
  assert.equal(moduleOfEvent("reports.capacity_overbooked"), "scheduling");
  assert.equal(moduleOfEvent("reports.shift_check_in_missed"), "workforce");
  assert.equal(moduleOfEvent("reports.compliance_missed"), "compliance");
  assert.equal(moduleOfEvent("todos.reminder"), "todos");
  assert.equal(moduleOfEvent("reports.quotation_aged"), "reports");
});

function fakeAdmin() {
  const calls: Array<{ rows: Array<Record<string, unknown>>; options: unknown }> = [];
  const admin = {
    from: (table: string) => {
      assert.equal(table, "portal_notifications");
      return {
        upsert: (rows: Array<Record<string, unknown>>, options: unknown) => {
          calls.push({ rows, options });
          return { select: async () => ({ data: rows.map((_, i) => ({ id: String(i) })), error: null }) };
        },
      };
    },
  };
  return { admin: admin as never, calls };
}

test("an in-portal notice goes to each person once, never to the one acting", async () => {
  const { admin, calls } = fakeAdmin();
  const n = await notifyInPortal(admin, {
    event: "snagging.approved",
    userIds: ["a", "b", "a", null, "me"],
    title: "Inspection approved: SNG-1",
    body: "Approved.",
    link: "/snagging/1",
    dedupeKey: "snagging.approved:1:t",
    actorId: "me",
  });
  assert.equal(n, 2);
  assert.deepEqual(calls[0].rows.map((r) => r.recipient_user_id), ["a", "b"]);
  assert.equal(calls[0].rows[0].channel, "in_app");
  assert.equal(calls[0].rows[0].status, "delivered");
  assert.deepEqual(calls[0].options, { onConflict: "dedupe_key,channel,recipient_key", ignoreDuplicates: true });
});

test("nobody to tell writes nothing; an outside link is dropped; a failure never throws", async () => {
  const { admin, calls } = fakeAdmin();
  assert.equal(await notifyInPortal(admin, { event: "todos.assigned", userIds: ["me"], title: "t", body: "b", dedupeKey: "k", actorId: "me" }), 0);
  assert.equal(calls.length, 0);
  await notifyInPortal(admin, { event: "todos.assigned", userIds: ["x"], title: "t", body: "b", dedupeKey: "k", link: "https://evil.example" });
  assert.equal(calls[0].rows[0].link, null);
  const broken = { from: () => ({ upsert: () => ({ select: async () => ({ data: null, error: { message: "down" } }) }) }) } as never;
  assert.equal(await notifyInPortal(broken, { event: "todos.assigned", userIds: ["x"], title: "t", body: "b", dedupeKey: "k" }), 0);
});
