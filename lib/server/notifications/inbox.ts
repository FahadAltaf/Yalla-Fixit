import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A user's in-app notifications (BRD §6.2): newest first, the unread count,
 * and marking them read. Every function takes the user id from the caller's
 * session; nothing here accepts another user's id from a request.
 *
 * Only 'delivered' rows are shown. A row the delivery policy suppressed
 * (development, a recipient off the allowlist) exists for the record and
 * never appears in anyone's inbox.
 */

export type InAppNotification = {
  id: string;
  event: string;
  title: string;
  body: string;
  link: string | null;
  requiresAction: boolean;
  createdAt: string;
  readAt: string | null;
  resolvedAt: string | null;
};

const TABLE = "portal_notifications";
const COLUMNS = "id, event, title, body, link, requires_action, created_at, read_at, resolved_at";

type Row = {
  id: string;
  event: string;
  title: string;
  body: string;
  link: string | null;
  requires_action: boolean;
  created_at: string;
  read_at: string | null;
  resolved_at: string | null;
};

function toNotification(row: Row): InAppNotification {
  return {
    id: row.id,
    event: row.event,
    title: row.title,
    body: row.body,
    link: row.link,
    requiresAction: row.requires_action,
    createdAt: row.created_at,
    readAt: row.read_at,
    resolvedAt: row.resolved_at,
  };
}

function inbox(admin: SupabaseClient, userId: string, columns: string, head = false) {
  return admin
    .from(TABLE)
    .select(columns, head ? { count: "exact", head: true } : undefined)
    .eq("recipient_user_id", userId)
    .eq("channel", "in_app")
    .eq("status", "delivered");
}

export async function listMyNotifications(
  admin: SupabaseClient,
  userId: string,
  options: { limit: number; offset: number; unreadOnly: boolean },
): Promise<{ notifications: InAppNotification[]; unread: number }> {
  let list = inbox(admin, userId, COLUMNS)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(options.offset, options.offset + options.limit - 1);
  if (options.unreadOnly) list = list.is("read_at", null);

  const [page, unread] = await Promise.all([list, inbox(admin, userId, "id", true).is("read_at", null)]);
  if (page.error) throw new Error(page.error.message);
  if (unread.error) throw new Error(unread.error.message);
  return {
    notifications: ((page.data ?? []) as unknown as Row[]).map(toNotification),
    unread: unread.count ?? 0,
  };
}

/** Marks the caller's own notifications read; other users' ids match nothing. */
export async function markNotificationsRead(
  admin: SupabaseClient,
  userId: string,
  which: "all" | string[],
): Promise<void> {
  let update = admin
    .from(TABLE)
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_user_id", userId)
    .eq("channel", "in_app")
    .is("read_at", null);
  if (which !== "all") update = update.in("id", which);
  const { error } = await update;
  if (error) throw new Error(error.message);
}

/**
 * Closes an action item for everyone it was sent to, when the thing it
 * asked for has been done (an exclusion verified, a query answered).
 * Called by the module that did it, not by the recipient.
 */
export async function resolveNotifications(
  admin: SupabaseClient,
  subject: { entityType: string; entityId: string; event?: string },
): Promise<void> {
  let update = admin
    .from(TABLE)
    .update({ resolved_at: new Date().toISOString() })
    .eq("entity_type", subject.entityType)
    .eq("entity_id", subject.entityId)
    .is("resolved_at", null);
  if (subject.event) update = update.eq("event", subject.event);
  const { error } = await update;
  if (error) throw new Error(error.message);
}
