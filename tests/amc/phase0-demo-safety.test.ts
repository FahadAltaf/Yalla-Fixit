import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { applyEmailRedirect } from "@/lib/server/email-redirect";

/*
  Phase 0 of the BRD v0.3 plan: the demo runs on the production database,
  so outgoing email can be redirected, and the AMC audit trail refuses
  changes loudly instead of silently.
*/

const envelope = {
  to: ["client@example.com", "owner@example.com"],
  cc: ["coordinator@example.com"],
  subject: "Your AMC proposal AMC-2026-0001",
  html: "<p>Hello</p>",
};

test("email redirect: unset or blank leaves the email untouched", () => {
  assert.deepEqual(applyEmailRedirect(envelope, undefined), envelope);
  assert.deepEqual(applyEmailRedirect(envelope, "   "), envelope);
});

test("email redirect: everything goes to the demo inbox, recipients shown, no copies", () => {
  const out = applyEmailRedirect(envelope, "demo-inbox@example.com");
  assert.equal(out.to, "demo-inbox@example.com");
  assert.equal(out.cc, undefined);
  assert.equal(out.subject, "[DEMO] Your AMC proposal AMC-2026-0001");
  assert.match(out.html, /client@example\.com, owner@example\.com/);
  assert.match(out.html, /Cc: coordinator@example\.com/);
  assert.match(out.html, /<p>Hello<\/p>$/);
});

test("email redirect: recipient names are escaped in the banner", () => {
  const out = applyEmailRedirect({ to: "<script>@x", subject: "s", html: "" }, "demo@example.com");
  assert.doesNotMatch(out.html, /<script>/);
});

test("both email senders go through the redirect", () => {
  for (const f of ["lib/server/send-email.ts", "lib/server/schedule-approvers.ts"]) {
    assert.match(readFileSync(path.join(process.cwd(), f), "utf8"), /applyEmailRedirect\(/, f);
  }
});

test("audit guard migration: rules replaced by a raising trigger; actor kept on user deletion", () => {
  const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/20261007100000_amc_audit_events_guard.sql"), "utf8")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  assert.match(sql, /DROP RULE IF EXISTS amc_audit_events_no_update/);
  assert.match(sql, /DROP RULE IF EXISTS amc_audit_events_no_delete/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON public\.amc_audit_events/);
  assert.match(sql, /BEFORE TRUNCATE ON public\.amc_audit_events/);
  assert.match(sql, /ON DELETE NO ACTION NOT VALID/);
  assert.match(sql, /SET search_path = public, pg_temp/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.amc_audit_events_append_only\(\) FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(sql, /SECURITY DEFINER/);
});
