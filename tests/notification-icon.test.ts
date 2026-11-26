import { test } from "node:test";
import assert from "node:assert/strict";

import { notificationLook } from "@/components/dashboard/notifications/notification-icon";

/* 26 Nov 2026: each notification shows an icon for its kind, tinted by how urgent it is. */

const look = (e: string) => {
  const l = notificationLook(e);
  return `${l.icon.displayName ?? (l.icon as unknown as { name?: string }).name ?? "?"}:${l.tone}`;
};

test("good news, attention and problems get their own tone", () => {
  assert.equal(notificationLook("contract_signed").tone, "good");
  assert.equal(notificationLook("ppm_confirmation_due").tone, "warn");
  assert.equal(notificationLook("cheque_bounced").tone, "bad");
  assert.equal(notificationLook("finance.digest").tone, "neutral");
});

test("an event added later still gets its area's icon and a tone from its name", () => {
  assert.equal(notificationLook("ppm_new_thing_overdue").icon, notificationLook("ppm_confirmation_due").icon, "the PPM icon");
  assert.equal(notificationLook("ppm_new_thing_overdue").tone, "warn");
  assert.equal(notificationLook("call_out_new_failed").tone, "bad");
  assert.ok(look("something_unknown").endsWith(":neutral"), "the bell, neutral");
});
