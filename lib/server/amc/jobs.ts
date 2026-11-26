import type { SupabaseClient } from "@supabase/supabase-js";

import type { AmcConfig } from "@/lib/amc/config";
import { readAmcConfig } from "@/lib/server/amc/config";
import { runEnquiryFollowUpSweep, runEnquiryIdleSweep } from "@/lib/server/amc/enquiries";
import { runProposalValiditySweep } from "@/lib/server/amc/proposal-share";
import { runContractExpirySweep, runUnsignedContractSweep } from "@/lib/server/amc/contract-lifecycle";
import { runPaymentSweep } from "@/lib/server/amc/payments";
import { runPpmOverdueSweep } from "@/lib/server/amc/ppm";
import { runVisitSweep } from "@/lib/server/amc/visits";
import { runJobSheetSweep } from "@/lib/server/amc/job-sheets";
import { runCallOutSweep } from "@/lib/server/amc/call-outs";
import { runRenewalSweep } from "@/lib/server/amc/renewals";
import { runExpiryReminderSweep } from "@/lib/server/amc/reminders";
import { escalateDueAmcTodos } from "@/lib/server/amc/todos";
import { renewalParts, scheduledJobs, visitParts, type DailyJobPart } from "@/lib/amc/daily-jobs";

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
  /** DEV-485: the parts switched on for a scheduled run; null for Run now (everything). */
  parts: readonly DailyJobPart[] | null;
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
    key: "proposal_validity",
    label: "Tell owners when a proposal with the client is about to lapse",
    run: async ({ admin, now }) => ({ ...(await runProposalValiditySweep(admin, now)) }),
  },
  {
    key: "unsigned_contracts",
    label: "Remind clients about unsigned contracts; open the follow-up to-do",
    run: async ({ admin, config, now }) => ({ ...(await runUnsignedContractSweep(admin, config, now)) }),
  },
  {
    key: "contract_expiry_status",
    label: "Mark active contracts past their end date as expired",
    run: async ({ admin, now }) => ({ ...(await runContractExpirySweep(admin, now)) }),
  },
  {
    key: "payments",
    label: "Instalment statuses, due and overdue reminders, cheque dates and late first payments",
    run: async ({ admin, config, now }) => ({ ...(await runPaymentSweep(admin, config, now)) }),
  },
  {
    key: "ppm_overdue",
    label: "Tell owners about PPM visits past their service window",
    run: async ({ admin, now }) => ({ ...(await runPpmOverdueSweep(admin, now)) }),
  },
  {
    key: "visits",
    label: "PPM confirmation to-dos, access alerts and the client reminder the day before",
    run: async ({ admin, config, now, parts }) => ({ ...(await runVisitSweep(admin, config, now, visitParts(parts))) }),
  },
  {
    key: "job_sheets",
    label: "Job sheets not submitted after the visit, and service reports at risk of missing 48 hours",
    run: async ({ admin, config, now }) => ({ ...(await runJobSheetSweep(admin, config, now)) }),
  },
  {
    key: "call_outs",
    label: "Call outs with the SLA at risk or missed (owner and supervisors)",
    run: async ({ admin, config, now }) => ({ ...(await runCallOutSweep(admin, config, now)) }),
  },
  {
    key: "renewals",
    label: "Expiry notices (60 and 30 days), renewal reminders and to-dos, idle escalation, renewed and lapsed outcomes, scheduled terminations",
    run: async ({ admin, config, now, parts }) => ({ ...(await runRenewalSweep(admin, config, now, renewalParts(parts))) }),
  },
  {
    key: "expiry_reminders",
    label: "Contract expiry reminders (only when automatic reminders are on)",
    /* A client email: held while client emails are off (DEV-485). */
    run: async ({ admin, config }) =>
      config.jobs.clientEmails ? { ...(await runExpiryReminderSweep(admin, { trigger: "automatic", actor: null })) } : { held: "Client emails from daily jobs are off." },
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
    /* DEV-485: the scheduler runs only the parts switched on in AMC configuration -> Daily jobs. */
    const parts = opts.trigger === "scheduled" ? config.jobs.scheduled : null;
    const allowed = parts ? new Set(scheduledJobs(parts)) : null;
    for (const job of AMC_JOBS.filter((j) => (!opts.only || opts.only.includes(j.key)) && (!allowed || allowed.has(j.key)))) {
      try {
        jobs[job.key] = { ok: true, result: await job.run({ admin, config, now, trigger: opts.trigger, parts }) };
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

export interface AmcRunRecipient {
  name: string;
  email: string | null;
  /** in_app: the bell (and the to-do list); email: an email went out. */
  channel: string;
  /** delivered, sent, held, failed ... as the notification records it. */
  status: string;
  count: number;
  /** What it was about (the notice titles, a few). */
  examples: string[];
}

/**
 * Who a run told (26 Nov 2026, the user): the AMC notifications created
 * while it ran, by person, channel and outcome. Read from the notification
 * records, so it says what really went out, not what the job meant to send.
 */
export async function amcRunRecipients(admin: Admin, runId: string): Promise<AmcRunRecipient[]> {
  const { data: run } = await admin.from("amc_job_runs").select("started_at, finished_at").eq("id", runId).maybeSingle<{ started_at: string; finished_at: string | null }>();
  if (!run) return [];
  /* A few seconds of slack after the end: the last notices are written as the run closes. */
  const to = new Date(Date.parse(run.finished_at ?? new Date().toISOString()) + 5_000).toISOString();
  const { data, error } = await admin
    .from("amc_notifications")
    .select("recipient_user_id, recipient_email, channel, status, title")
    .gte("created_at", run.started_at)
    .lte("created_at", to)
    .limit(2000);
  if (error || !data?.length) return [];
  const rows = data as Array<{ recipient_user_id: string | null; recipient_email: string | null; channel: string | null; status: string | null; title: string | null }>;
  const ids = [...new Set(rows.map((r) => r.recipient_user_id).filter((x): x is string => Boolean(x)))];
  const { data: people } = ids.length ? await admin.from("user_profile").select("id, full_name, email").in("id", ids) : { data: [] };
  const person = new Map(((people ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((p) => [p.id, p]));
  const groups = new Map<string, AmcRunRecipient>();
  for (const r of rows) {
    const p = r.recipient_user_id ? person.get(r.recipient_user_id) : undefined;
    const name = p?.full_name || p?.email || r.recipient_email || "Unknown recipient";
    const email = p?.email ?? r.recipient_email ?? null;
    const channel = r.channel || "in_app";
    const status = r.status || "created";
    const key = `${name}|${channel}|${status}`;
    const g = groups.get(key) ?? { name, email, channel, status, count: 0, examples: [] };
    g.count += 1;
    if (r.title && g.examples.length < 3) g.examples.push(r.title);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
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
