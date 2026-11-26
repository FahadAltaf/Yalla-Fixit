import type { SupabaseClient } from "@supabase/supabase-js";

import { notifyInPortal } from "@/lib/server/notifications/portal-notify";

/**
 * Snagging's notices in the portal inbox (26 Nov 2026, the user: the inbox
 * covers every module). The office side of a job's journey: whoever has to
 * act next is told, and the people who handed it on hear the outcome. The
 * inspector's own alerts stay in the mobile app (snagging_notifications).
 *
 *   assigned_reviewer / assigned_approver  the new reviewer / approval manager
 *   submitted                              the reviewer (else the approval manager)
 *   reviewed                               the approval manager
 *   approved / rejected                    the reviewer and whoever created the job
 *
 * The person acting is never told about their own step. Never throws.
 */
export type SnaggingNoticeKind = "assigned_reviewer" | "assigned_approver" | "submitted" | "reviewed" | "approved" | "rejected";

type Job = {
  id: string;
  code: string | null;
  unit_label: string | null;
  building_name: string | null;
  reviewer_id: string | null;
  approval_manager_id: string | null;
  created_by: string | null;
};

const place = (j: Job) => [j.unit_label, j.building_name].filter(Boolean).join(", ");

export async function notifySnaggingJob(
  admin: SupabaseClient,
  jobId: string,
  kind: SnaggingNoticeKind,
  /** The moment, so a second submission after a send-back is a new notice. */
  moment: string,
  actorId: string | null,
  /** For an assignment: who was assigned. */
  assigneeId?: string | null,
): Promise<void> {
  try {
    const { data } = await admin
      .from("snagging_jobs")
      .select("id, code, unit_label, building_name, reviewer_id, approval_manager_id, created_by")
      .eq("id", jobId)
      .maybeSingle<Job>();
    if (!data) return;
    const ref = data.code ?? "Inspection";
    const where = place(data);
    const at = where ? `${where}: ` : "";
    const notice = (() => {
      switch (kind) {
        case "assigned_reviewer":
          return { to: [assigneeId], title: `You are the reviewer on ${ref}`, body: `${at}review the inspection once the inspector submits it.` };
        case "assigned_approver":
          return { to: [assigneeId], title: `You are the approval manager on ${ref}`, body: `${at}approve or send it back once it has been reviewed.` };
        case "submitted":
          return {
            to: [data.reviewer_id ?? data.approval_manager_id],
            title: `Inspection submitted: ${ref}`,
            body: `${at}the inspector submitted it${data.reviewer_id ? "; it is ready for your review" : "; it is ready for your approval"}.`,
          };
        case "reviewed":
          return { to: [data.approval_manager_id], title: `Ready for your approval: ${ref}`, body: `${at}the review is done; approve it or send it back.` };
        case "approved":
          return { to: [data.reviewer_id, data.created_by], title: `Inspection approved: ${ref}`, body: `${at}approved; the report can go to the client.` };
        case "rejected":
          return { to: [data.reviewer_id, data.created_by], title: `Inspection sent back: ${ref}`, body: `${at}sent back to the inspector to put right.` };
      }
    })();
    await notifyInPortal(admin, {
      event: `snagging.${kind}`,
      userIds: notice.to,
      title: notice.title,
      body: notice.body,
      link: `/snagging/${jobId}`,
      entityType: "snagging_job",
      entityId: jobId,
      dedupeKey: `snagging.${kind}:${jobId}:${assigneeId ?? ""}:${moment}`,
      actorId,
    });
  } catch (e) {
    console.error(`[snagging] ${kind} notice for ${jobId} failed:`, e instanceof Error ? e.message : e);
  }
}
