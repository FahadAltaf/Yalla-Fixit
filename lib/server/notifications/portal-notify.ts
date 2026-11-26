import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * An in-portal notice for Snagging, Scheduling and To-dos (26 Nov 2026): a
 * row in portal_notifications that shows in the recipient's inbox, under
 * its module. In-app only: these modules already email the client where
 * they should, and a notice never leaves the portal.
 *
 * At most once: the same dedupe key, channel and recipient is the same
 * row (the table's unique index), so a retry or a double click adds
 * nothing. The person who did the thing is never told about it. Never
 * throws: the action it follows has already happened.
 */
export interface PortalNotice {
  /** e.g. snagging.submitted, scheduling.approved, todos.assigned. */
  event: string;
  userIds: Array<string | null | undefined>;
  title: string;
  body: string;
  /** A portal path, e.g. /snagging/123. */
  link?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /** The same key for the same moment (a resubmission needs a new one). */
  dedupeKey: string;
  /** The person acting: never notified about their own action. */
  actorId?: string | null;
  requiresAction?: boolean;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export async function notifyInPortal(admin: SupabaseClient, notice: PortalNotice): Promise<number> {
  try {
    const ids = [...new Set(notice.userIds.filter((id): id is string => Boolean(id)))].filter((id) => id !== notice.actorId);
    if (!ids.length) return 0;
    const link = notice.link && /^\/[^/]/.test(notice.link) ? notice.link : null;
    const rows = ids.map((id) => ({
      event: notice.event,
      entity_type: notice.entityType ?? null,
      entity_id: notice.entityId ?? null,
      recipient_user_id: id,
      recipient_email: null,
      channel: "in_app",
      dedupe_key: clip(notice.dedupeKey, 300),
      title: clip(notice.title, 200),
      body: notice.body,
      link,
      requires_action: notice.requiresAction ?? false,
      status: "delivered",
      status_reason: null,
    }));
    const { data, error } = await admin
      .from("portal_notifications")
      .upsert(rows, { onConflict: "dedupe_key,channel,recipient_key", ignoreDuplicates: true })
      .select("id");
    if (error) {
      console.error(`[notifications] ${notice.event} not written:`, error.message);
      return 0;
    }
    return data?.length ?? 0;
  } catch (e) {
    console.error(`[notifications] ${notice.event} failed:`, e instanceof Error ? e.message : e);
    return 0;
  }
}
