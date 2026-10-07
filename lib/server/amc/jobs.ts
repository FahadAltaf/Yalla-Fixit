import type { SupabaseClient } from "@supabase/supabase-js";

import type { AmcConfig } from "@/lib/amc/config";
import { readAmcConfig } from "@/lib/server/amc/config";
import { runEnquiryFollowUpSweep, runEnquiryIdleSweep } from "@/lib/server/amc/enquiries";
import { runExpiryReminderSweep } from "@/lib/server/amc/reminders";
import { escalateDueAmcTodos } from "@/lib/server/amc/todos";

/**
 * The AMC scheduled jobs (timed BRD rules: escalations, reminders, idle
 * enquiries, overdue instalments, SLA at risk, the 48-hour report…). One
 * endpoint runs them all (/api/amc-jobs/run), called by the same external
 * scheduler as the Snagging escalations, or by an admin with "Run now".
 *
 * Every job is idempotent on its own (stamps or unique keys before any side
 * effect), so overlapping runs and retries are harmless. A failing job is
 * recorded and the others still run. Later phases add their jobs here.
 */

type Admin = SupabaseClient;

export interface AmcJobContext {
  admin: Admin;
  config: AmcConfig;
  now: Date;
  trigger: "scheduled" | "manual";
}

export interface AmcJob {
  key: string;
  label: string;
  run: (ctx: AmcJobContext) => Promise<Record<string, unknown>>;
}

export const AMC_JOBS: AmcJob[] = [
  {
    key: "todo_escalations",
    label: "Escalate overdue AMC to-dos",
    run: async ({ admin, config, now }) => ({ ...(await escalateDueAmcTodos(admin, config, now)) }),
  },
  {
    key: "enquiry_follow_ups",
    label: "Tell owners about enquiry follow-ups that are due",
    run: async ({ admin, now }) => ({ ...(await runEnquiryFollowUpSweep(admin, now)) }),
  },
  {
    key: "enquiry_idle",
    label: "Flag idle enquiries; escalate to management after the escalation days",
    run: async ({ admin, config, now }) => ({ ...(await runEnquiryIdleSweep(admin, config, now)) }),
  },
  {
    key: "expiry_reminders",
    label: "Contract expiry reminders (only when automatic reminders are on)",
    run: async ({ admin }) => ({ ...(await runExpiryReminderSweep(admin, { trigger: "automatic", actor: null })) }),
  },
];

export interface AmcJobRunSummary {
  runId: string | null;
  status: "succeeded" | "partial" | "failed";
  jobs: Record<string, { ok: boolean; result?: Record<string, unknown>; error?: string }>;
}

export async function runAmcJobs(
  admin: Admin,
  opts: { trigger: "scheduled" | "manual"; actorId: string | null; now?: Date; only?: string[] },
): Promise<AmcJobRunSummary> {
  const now = opts.now ?? new Date();
  const { data: run } = await admin
    .from("amc_job_runs")
    .insert({ trigger: opts.trigger, actor_id: opts.actorId })
    .select("id")
    .single<{ id: string }>();

  const jobs: AmcJobRunSummary["jobs"] = {};
  let config: AmcConfig | null = null;
  try {
    config = await readAmcConfig(admin);
  } catch (error) {
    jobs.config = { ok: false, error: error instanceof Error ? error.message : "Could not read configuration" };
  }
  if (config) {
    for (const job of AMC_JOBS.filter((j) => !opts.only || opts.only.includes(j.key))) {
      try {
        jobs[job.key] = { ok: true, result: await job.run({ admin, config, now, trigger: opts.trigger }) };
      } catch (error) {
        jobs[job.key] = { ok: false, error: error instanceof Error ? error.message.slice(0, 500) : "Failed" };
      }
    }
  }

  const results = Object.values(jobs);
  const status: AmcJobRunSummary["status"] = results.every((r) => r.ok)
    ? "succeeded"
    : results.some((r) => r.ok)
      ? "partial"
      : "failed";
  if (run?.id) {
    await admin
      .from("amc_job_runs")
      .update({ finished_at: new Date().toISOString(), status, summary: jobs })
      .eq("id", run.id);
  }
  return { runId: run?.id ?? null, status, jobs };
}

export async function listAmcJobRuns(admin: Admin, limit = 10) {
  const { data, error } = await admin
    .from("amc_job_runs")
    .select("id, trigger, started_at, finished_at, status, summary")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return data ?? [];
}

/**
 * The scheduler's secret, as the Snagging escalation runner checks it:
 * `x-cron-secret` or `Authorization: Bearer`. No secret configured means
 * closed, never open.
 */
export function isScheduledJobRequest(headers: Pick<Headers, "get">, secret: string | undefined = process.env.CRON_SECRET): boolean {
  if (!secret) return false;
  const header = headers.get("x-cron-secret");
  const bearer = headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return header === secret || bearer === secret;
}
