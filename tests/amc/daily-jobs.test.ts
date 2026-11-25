import assert from "node:assert/strict";
import test from "node:test";

import { AMC_CONFIG_DEFAULTS, validateAmcConfigSection } from "@/lib/amc/config";
import { CLIENT_EMAIL_PARTS, FIRST_RELEASE_PARTS, renewalParts, scheduledJobs, visitParts } from "@/lib/amc/daily-jobs";
import { AMC_JOBS, isScheduledJobRequest, runAmcJobs } from "@/lib/server/amc/jobs";
import { fakeSupabase } from "./fake-supabase";

/* DEV-485 (23 Nov 2026): the morning run does only what Jira names; client emails stay off. */
test("the first release runs the expiry notices and the PPM confirmation reminders only, with client emails off", () => {
  assert.deepEqual(AMC_CONFIG_DEFAULTS.jobs.scheduled, ["expiry_status", "expiry_notices", "ppm_confirmations"]);
  assert.equal(AMC_CONFIG_DEFAULTS.jobs.clientEmails, false);
  assert.deepEqual(scheduledJobs(FIRST_RELEASE_PARTS).sort(), ["contract_expiry_status", "renewals", "visits"]);
  assert.deepEqual(visitParts(FIRST_RELEASE_PARTS), { confirmations: true, accessAlerts: false, crewReminders: false, clientReminders: false });
  assert.deepEqual(renewalParts(FIRST_RELEASE_PARTS), { notices: true, followUp: false });
  assert.ok(FIRST_RELEASE_PARTS.every((p) => !CLIENT_EMAIL_PARTS.includes(p)), "no client email in the first release");
  /* Run now: everything (null parts). */
  assert.deepEqual(visitParts(null), { confirmations: true, accessAlerts: true, crewReminders: true, clientReminders: true });
});

test("the Daily jobs section validates", () => {
  assert.equal(validateAmcConfigSection("jobs", { scheduled: ["expiry_notices", "payments"], clientEmails: false }).ok, true);
  assert.equal(validateAmcConfigSection("jobs", { scheduled: ["send_everything"], clientEmails: false }).ok, false);
});

test("a scheduled run starts only the jobs switched on; Run now starts them all", async () => {
  const w = fakeSupabase({ amc_job_runs: [], amc_config: [] });
  const scheduled = await runAmcJobs(w.client as never, { trigger: "scheduled", actorId: null, now: new Date("2026-11-23T02:00:00Z") });
  assert.deepEqual(Object.keys(scheduled.jobs).sort(), ["contract_expiry_status", "renewals", "visits"]);
  const manual = await runAmcJobs(w.client as never, { trigger: "manual", actorId: "u1", now: new Date("2026-11-23T02:00:00Z") });
  assert.deepEqual(Object.keys(manual.jobs).sort(), AMC_JOBS.map((j) => j.key).sort());
  const held = manual.jobs.expiry_reminders?.result as { held?: string } | undefined;
  assert.match(String(held?.held), /Client emails from daily jobs are off/);
});

test("the scheduler must send the secret", () => {
  const h = (v: Record<string, string>) => ({ get: (k: string) => v[k.toLowerCase()] ?? null });
  assert.equal(isScheduledJobRequest(h({ "x-cron-secret": "s3cret" }), "s3cret"), true);
  assert.equal(isScheduledJobRequest(h({ authorization: "Bearer s3cret" }), "s3cret"), true);
  assert.equal(isScheduledJobRequest(h({ "x-cron-secret": "wrong" }), "s3cret"), false);
  assert.equal(isScheduledJobRequest(h({ "x-cron-secret": "" }), undefined), false, "no secret configured: closed");
});
