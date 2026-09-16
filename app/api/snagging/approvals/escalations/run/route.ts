import { NextRequest, NextResponse } from "next/server";

import { emailService } from "@/lib/email-service";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { recordAudit } from "@/lib/server/snagging/audit";
import { APPROVAL_SLA_HOURS } from "@/lib/server/snagging/workflow";

/**
 * Escalates approvals still open after 48 hours (FR-6.07).
 *
 * Driven by an external scheduler rather than pg_cron, matching the todos
 * reminder runner: this project removed its database cron jobs deliberately,
 * and a secret-guarded POST is the pattern already in use here.
 *
 * The clock runs from `submitted_at` -- the moment the work left the
 * inspector's hands -- and is stored on the row as `approval_due_at` when the
 * job is submitted. Reading a stored deadline rather than recomputing one
 * means a job keeps the deadline it was given even if the SLA constant is
 * later changed.
 *
 * Idempotent by construction. A job is a candidate only while
 * `escalated_at is null`, and the stamp is written in the same statement
 * that selects it, so running the sweep twice -- or twice at once -- sends
 * one notification and writes one audit row per job.
 */

/** Runs hourly; the deadline itself is per-job, so cadence only affects lag. */
export const dynamic = "force-dynamic";

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // No secret configured means the endpoint is closed, not open.
  if (!secret) return false;
  const headerSecret = req.headers.get("x-cron-secret");
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return headerSecret === secret || bearer === secret;
}

type OpenJob = {
  id: string;
  code: string;
  unit_label: string | null;
  building_name: string | null;
  submitted_at: string | null;
  approval_due_at: string | null;
  status: string;
  reviewer_id: string | null;
  approval_manager_id: string | null;
};

export async function POST(req: NextRequest) {
  try {
    if (!authorised(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = await createAdminServerClient();
    const now = new Date().toISOString();

    const { data: due, error: dueError } = await admin
      .from("snagging_jobs")
      .select(
        "id, code, unit_label, building_name, submitted_at, approval_due_at, status, reviewer_id, approval_manager_id",
      )
      // Only a decision that is still outstanding can be late. A job
      // approved or rejected inside the window is never a candidate.
      .in("status", ["submitted", "in_review"])
      .lt("approval_due_at", now)
      .is("escalated_at", null)
      .order("approval_due_at", { ascending: true })
      .limit(200);

    if (dueError) throw new Error(dueError.message);

    const jobs = (due ?? []) as OpenJob[];
    if (jobs.length === 0) {
      return NextResponse.json({ data: { checked: 0, escalated: 0, notified: 0 } });
    }

    // One lookup for every recipient across the batch, rather than a query
    // per job: an escalation goes to the people named on the job.
    const recipientIds = [
      ...new Set(
        jobs.flatMap((job) => [job.reviewer_id, job.approval_manager_id]).filter(Boolean) as string[],
      ),
    ];
    const { data: people } = recipientIds.length
      ? await admin
          .from("user_profile")
          .select("id, full_name, email")
          .in("id", recipientIds)
      : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }> };

    const byId = new Map((people ?? []).map((p) => [p.id, p]));

    let escalated = 0;
    let notified = 0;

    for (const job of jobs) {
      /*
        Claim the job before doing anything with side effects.

        The stamp is the lock: the update only matches while `escalated_at`
        is still null, so a second sweep running concurrently updates zero
        rows and skips the job entirely. Sending the mail first and stamping
        afterwards would let a crash between the two send the same
        escalation on every subsequent run.
      */
      const { data: claimed, error: claimError } = await admin
        .from("snagging_jobs")
        .update({ escalated_at: now })
        .eq("id", job.id)
        .is("escalated_at", null)
        .in("status", ["submitted", "in_review"])
        .select("id");

      if (claimError) {
        console.error("Escalation claim failed:", job.code, claimError.message);
        continue;
      }
      if (!claimed || claimed.length === 0) continue;

      escalated += 1;

      const recipients = [
        byId.get(job.approval_manager_id ?? ""),
        byId.get(job.reviewer_id ?? ""),
      ]
        .filter(Boolean)
        .map((p) => p!.email)
        .filter((email): email is string => Boolean(email));

      const unit =
        [job.unit_label, job.building_name].filter(Boolean).join(", ") || job.code;
      const waitingHours = job.submitted_at
        ? Math.floor((Date.parse(now) - Date.parse(job.submitted_at)) / 3_600_000)
        : APPROVAL_SLA_HOURS;

      if (recipients.length > 0) {
        try {
          await emailService.sendSnaggingEscalationEmail({
            to: [...new Set(recipients)],
            code: job.code,
            unit,
            status: job.status,
            waitingHours,
            jobUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/snagging/${job.id}`,
          });
          notified += 1;
        } catch (emailError) {
          // The job stays escalated: the record of lateness is the point,
          // and a mail failure must not make it escalate again tomorrow.
          console.error("Escalation email failed:", job.code, emailError);
        }
      }

      await recordAudit(admin, {
        entityType: "task",
        entityId: job.id,
        taskId: job.id,
        eventType: "approval_escalated",
        actorLabel: "System",
        origin: "system",
        payload: {
          code: job.code,
          status: job.status,
          submitted_at: job.submitted_at,
          approval_due_at: job.approval_due_at,
          waiting_hours: waitingHours,
          notified: recipients.length,
        },
      });
    }

    return NextResponse.json({
      data: { checked: jobs.length, escalated, notified },
    });
  } catch (error) {
    console.error("Snagging escalation sweep error:", error);
    return NextResponse.json({ error: "Escalation sweep failed" }, { status: 500 });
  }
}
