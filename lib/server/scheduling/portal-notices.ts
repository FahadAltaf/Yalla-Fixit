import type { SupabaseClient } from "@supabase/supabase-js";

import { notifyInPortal } from "@/lib/server/notifications/portal-notify";

/**
 * Scheduling's notices in the portal inbox (26 Nov 2026, the user: the inbox
 * covers every module). A day sent for approval reaches its approvers (the
 * one chosen at submit, else everyone flagged to receive schedule
 * approvals, as the email does); the decision reaches whoever submitted it.
 * Never throws: the step it follows has already happened.
 */
export type SchedulingNoticeKind = "submitted" | "approved" | "rejected";

const dayLabel = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? date : new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(d);
};

export async function notifyScheduleDay(admin: SupabaseClient, versionId: string, kind: SchedulingNoticeKind, actor: { id: string; name: string | null }, comment?: string | null): Promise<void> {
  try {
    const { data: v } = await admin
      .from("schedule_versions")
      .select("id, schedule_date, submitted_by, submitted_at, requested_approver_id, decided_at")
      .eq("id", versionId)
      .maybeSingle<{ id: string; schedule_date: string | null; submitted_by: string | null; submitted_at: string | null; requested_approver_id: string | null; decided_at: string | null }>();
    if (!v?.schedule_date) return;
    const day = dayLabel(v.schedule_date);
    const link = `/scheduling?date=${v.schedule_date}`;
    const who = actor.name ?? "Someone";

    if (kind === "submitted") {
      let to: string[] = v.requested_approver_id ? [v.requested_approver_id] : [];
      if (!to.length) {
        const { data: flagged } = await admin
          .from("user_profile")
          .select("id")
          .eq("receives_schedule_approval_email", true)
          .eq("is_active", true)
          .eq("hidden_from_lists", false);
        to = ((flagged ?? []) as Array<{ id: string }>).map((u) => u.id);
      }
      await notifyInPortal(admin, {
        event: "scheduling.submitted",
        userIds: to,
        title: `Schedule to approve: ${day}`,
        body: `${who} sent the schedule for ${day} for approval.`,
        link,
        entityType: "schedule_version",
        entityId: v.id,
        dedupeKey: `scheduling.submitted:${v.id}:${v.submitted_at ?? ""}`,
        actorId: actor.id,
      });
      return;
    }

    await notifyInPortal(admin, {
      event: `scheduling.${kind}`,
      userIds: [v.submitted_by],
      title: kind === "approved" ? `Schedule approved: ${day}` : `Schedule rejected: ${day}`,
      body:
        kind === "approved"
          ? `${who} approved the schedule for ${day}; it is being published to Zoho FSM.`
          : `${who} rejected the schedule for ${day}${comment ? `: ${comment}` : ""}. Change it and send it again.`,
      link,
      entityType: "schedule_version",
      entityId: v.id,
      dedupeKey: `scheduling.${kind}:${v.id}:${v.decided_at ?? new Date().toISOString()}`,
      actorId: actor.id,
    });
  } catch (e) {
    console.error(`[scheduling] ${kind} notice for ${versionId} failed:`, e instanceof Error ? e.message : e);
  }
}
