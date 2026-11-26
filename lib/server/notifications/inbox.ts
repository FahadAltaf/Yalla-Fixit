import type { SupabaseClient } from "@supabase/supabase-js";
import { SCHEDULING_REPORT_EVENTS, WORKFORCE_EVENTS, moduleOfEvent, type NotificationModule } from "@/lib/notifications/modules";

import {
  listMyNotifications as listAmcNotifications,
  markNotificationsRead as markAmcNotificationsRead,
} from "@/lib/server/amc/notifications";

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
  /** The part of the portal it comes from (26 Nov 2026). */
  module: NotificationModule;
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
    module: moduleOfEvent(row.event, "portal"),
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

/* Narrows the portal store to one module's events (AMC is its own store). */
function forModule(query: any, module: NotificationModule): any {
  switch (module) {
    case "invoicing":
      return query.like("event", "finance.%");
    case "snagging":
      return query.like("event", "snagging.%");
    case "todos":
      return query.like("event", "todos.%");
    case "compliance":
      return query.like("event", "reports.compliance%");
    case "workforce":
      return query.in("event", [...WORKFORCE_EVENTS]);
    case "scheduling":
      return query.or(`event.like.scheduling.%,event.in.(${SCHEDULING_REPORT_EVENTS.join(",")})`);
    case "reports":
      return query
        .like("event", "reports.%")
        .not("event", "like", "reports.compliance%")
        .not("event", "in", `(${[...WORKFORCE_EVENTS, ...SCHEDULING_REPORT_EVENTS].join(",")})`);
    default:
      return query;
  }
}

/** How many are unread in each module, for the inbox's module filter. */
async function unreadByModule(admin: SupabaseClient, userId: string, amcUnread: number): Promise<Partial<Record<NotificationModule, number>>> {
  const { data } = await inbox(admin, userId, "event").is("read_at", null).limit(5000);
  const counts: Partial<Record<NotificationModule, number>> = {};
  for (const r of (data ?? []) as unknown as Array<{ event: string }>) {
    const m = moduleOfEvent(r.event, "portal");
    counts[m] = (counts[m] ?? 0) + 1;
  }
  if (amcUnread) counts.amc = (counts.amc ?? 0) + amcUnread;
  return counts;
}

export async function listMyNotifications(
  admin: SupabaseClient,
  userId: string,
  options: { limit: number; offset: number; unreadOnly: boolean; module?: NotificationModule | null },
): Promise<{ notifications: InAppNotification[]; unread: number; unreadByModule: Partial<Record<NotificationModule, number>> }> {
  /*
    Two stores feed one inbox: portal_notifications (Finance, Reports) and
    AMC's own amc_notifications (approvals, client decisions, signatures,
    payments), which predates it. Each is read down to the end of the page
    asked for, the two are merged newest first, and the page is cut from
    the merge, so paging stays correct across both.
  */
  const upTo = options.offset + options.limit;
  const only = options.module ?? null;
  /* One module: only its store (AMC's own, or the portal's narrowed to that module's events). */
  const wantPortal = only !== "amc";
  const wantAmc = only === null || only === "amc";
  let list = inbox(admin, userId, COLUMNS)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(0, upTo - 1);
  if (options.unreadOnly) list = list.is("read_at", null);
  if (only && only !== "amc") list = forModule(list, only);

  const [page, unread, amc] = await Promise.all([
    wantPortal ? list : Promise.resolve({ data: [], error: null }),
    inbox(admin, userId, "id", true).is("read_at", null),
    listAmcNotifications(admin as never, userId, wantAmc ? upTo : 1, { offset: 0, unreadOnly: options.unreadOnly }),
  ]);
  if (page.error) throw new Error(page.error.message);
  if (unread.error) throw new Error(unread.error.message);
  const merged = [
    ...((page.data ?? []) as unknown as Row[]).map(toNotification),
    ...(wantAmc
      ? amc.notifications.map((n): InAppNotification => ({ ...n, module: "amc", requiresAction: false, resolvedAt: null }))
      : []),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
  return {
    notifications: merged.slice(options.offset, upTo),
    unread: (unread.count ?? 0) + amc.unread,
    unreadByModule: await unreadByModule(admin, userId, amc.unread),
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
  /* AMC's notifications sit in their own table; an id from the other store matches nothing there. */
  await markAmcNotificationsRead(admin as never, userId, which);
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
