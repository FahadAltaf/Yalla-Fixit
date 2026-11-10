import { test } from "node:test";
import assert from "node:assert/strict";

import { deliveryMode, planEmail, planInApp } from "@/lib/server/finance/delivery-policy";

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

test("with nothing configured, delivery is blocked", () => {
  assert.equal(deliveryMode(env({})), "blocked");
  const plan = planEmail({ to: ["finance@yallafixit.ae"], subject: "Digest" }, env({}));
  assert.equal(plan.send, false);
});

test("a malformed redirect address does not open delivery", () => {
  for (const bad of ["", "  ", "not-an-email", "finance@", "@x.ae"]) {
    assert.equal(deliveryMode(env({ NOTIFY_REDIRECT_TO: bad })), "blocked", JSON.stringify(bad));
  }
});

test("redirect mode sends only to the redirect address and says who it was for", () => {
  const plan = planEmail(
    { to: ["finance@yallafixit.ae", "hr@yallafixit.ae"], subject: "Ready to invoice" },
    env({ NOTIFY_REDIRECT_TO: "dev@example.com" }),
  );
  assert.ok(plan.send);
  if (!plan.send) return;
  assert.deepEqual(plan.to, ["dev@example.com"]);
  assert.equal(plan.subject, "[DEV] Ready to invoice");
  assert.deepEqual(plan.redirectedFrom, ["finance@yallafixit.ae", "hr@yallafixit.ae"]);
});

test("no real recipient survives redirect mode", () => {
  const real = ["a@yallafixit.ae", "b@yallafixit.ae", "c@tphgroup.me"];
  const plan = planEmail({ to: real, subject: "x" }, env({ NOTIFY_REDIRECT_TO: "dev@example.com" }));
  assert.ok(plan.send);
  if (!plan.send) return;
  for (const r of real) assert.equal(plan.to.includes(r), false, r);
});

test("live mode is only switched on by exactly FINANCE_NOTIFY_LIVE=on", () => {
  for (const v of ["true", "1", "ON", "yes"]) {
    assert.notEqual(deliveryMode(env({ FINANCE_NOTIFY_LIVE: v })), "live", v);
  }
  assert.equal(deliveryMode(env({ FINANCE_NOTIFY_LIVE: "on" })), "live");
});

test("live mode sends to the intended recipients, de-duplicated", () => {
  const plan = planEmail(
    { to: ["a@x.ae", " a@x.ae ", "b@x.ae"], subject: "s" },
    env({ FINANCE_NOTIFY_LIVE: "on" }),
  );
  assert.ok(plan.send);
  if (!plan.send) return;
  assert.deepEqual(plan.to, ["a@x.ae", "b@x.ae"]);
  assert.equal(plan.subject, "s");
});

test("an email to nobody is not sent in any mode", () => {
  assert.equal(planEmail({ to: [], subject: "s" }, env({ FINANCE_NOTIFY_LIVE: "on" })).send, false);
});

test("in-app outside live mode reaches only allowlisted users", () => {
  const out = planInApp(
    ["u-real-1", "u-dev", "u-real-2"],
    env({ NOTIFY_REDIRECT_TO: "dev@example.com", NOTIFY_INAPP_ALLOWLIST: "u-dev" }),
  );
  assert.deepEqual(out.deliver, ["u-dev"]);
  assert.deepEqual(out.suppressed, ["u-real-1", "u-real-2"]);
});

test("in-app with no allowlist reaches nobody outside live mode", () => {
  const out = planInApp(["u1", "u2"], env({}));
  assert.deepEqual(out.deliver, []);
  assert.deepEqual(out.suppressed, ["u1", "u2"]);
});

test("in-app in live mode reaches everyone it is addressed to", () => {
  const out = planInApp(["u1", "u2", "u1"], env({ FINANCE_NOTIFY_LIVE: "on" }));
  assert.deepEqual(out.deliver, ["u1", "u2"]);
  assert.deepEqual(out.suppressed, []);
});
