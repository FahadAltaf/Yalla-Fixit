import type { SupabaseClient } from "@supabase/supabase-js";

import { planEmail, planInApp } from "@/lib/server/finance/delivery-policy";

/**
 * Writes Finance & Reports notifications (BRD §6.1, §6.2) to
 * portal_notifications, one row per event, recipient and channel.
 *
 * Two guarantees:
 *
 *  1. At most once. The row is claimed first, on the unique
 *     (dedupe_key, channel, recipient_key) index, and only a newly claimed
 *     row is delivered. A retried run, a double click or a second sweep
 *     finds the row already there and does nothing.
 *  2. Nothing reaches a real person outside production. Every recipient
 *     goes through lib/server/finance/delivery-policy.ts: in-app rows for
 *     anyone off the development allowlist are written as 'suppressed' and
 *     never shown; email is blocked, or redirected to NOTIFY_REDIRECT_TO
 *     with a [DEV] subject, unless FINANCE_NOTIFY_LIVE=on.
 *
 * Storage and the email sender are passed in, so the rules are tested
 * without a database or a mail service (tests/notifications).
 */

export type NotificationChannel = "in_app" | "email";

export type NotificationRecipient = {
  userId?: string | null;
  email?: string | null;
};

export type NotificationRequest = {
  /** e.g. finance.digest, reports.quotation_aged. */
  event: string;
  entityType?: string | null;
  entityId?: string | null;
  /** Same key + channel + recipient = the same notification. */
  dedupeKey: string;
  recipients: NotificationRecipient[];
  channels: NotificationChannel[];
  title: string;
  body: string;
  /** Email body, if different from `body`. */
  html?: string;
  /** A portal path, e.g. /finance/queue/123. */
  link?: string | null;
  requiresAction?: boolean;
};

export type NotificationRow = {
  event: string;
  entity_type: string | null;
  entity_id: string | null;
  recipient_user_id: string | null;
  recipient_email: string | null;
  channel: NotificationChannel;
  dedupe_key: string;
  title: string;
  body: string;
  link: string | null;
  requires_action: boolean;
  status: "pending" | "delivered" | "suppressed";
  status_reason: string | null;
};

export type StoredNotification = NotificationRow & { id: string };

export interface NotificationStore {
  /** Insert, skipping any row whose dedupe key already exists for that
      channel and recipient. Returns only the rows actually inserted. */
  claim(rows: NotificationRow[]): Promise<StoredNotification[]>;
  update(
    id: string,
    patch: { status: "sent" | "failed" | "suppressed"; status_reason?: string | null; delivered_to?: string | null; sent_at?: string | null },
  ): Promise<void>;
}

export type EmailSender = (input: { to: string[]; subject: string; html: string }) => Promise<unknown>;

export type NotifyResult = {
  inApp: { delivered: number; suppressed: number; duplicate: number };
  email: { sent: number; failed: number; suppressed: number; duplicate: number };
};

const LINK = /^\/[^/]/;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

export function createNotifier(deps: {
  store: NotificationStore;
  sendEmail: EmailSender;
  env?: NodeJS.ProcessEnv;
  appUrl?: string;
}) {
  const env = deps.env ?? process.env;

  return async function notify(request: NotificationRequest): Promise<NotifyResult> {
    if (request.link && !LINK.test(request.link)) {
      throw new Error(`Notification link must be a portal path: ${request.link}`);
    }
    const result: NotifyResult = {
      inApp: { delivered: 0, suppressed: 0, duplicate: 0 },
      email: { sent: 0, failed: 0, suppressed: 0, duplicate: 0 },
    };
    const base = {
      event: request.event,
      entity_type: request.entityType ?? null,
      entity_id: request.entityId ?? null,
      dedupe_key: request.dedupeKey,
      title: request.title,
      body: request.body,
      link: request.link ?? null,
      requires_action: request.requiresAction ?? false,
    };

    if (request.channels.includes("in_app")) {
      const userIds = [...new Set(request.recipients.map((r) => r.userId).filter((id): id is string => Boolean(id)))];
      const plan = planInApp(userIds, env);
      const rows: NotificationRow[] = [
        ...plan.deliver.map((id) => ({ ...base, recipient_user_id: id, recipient_email: null, channel: "in_app" as const, status: "delivered" as const, status_reason: null })),
        ...plan.suppressed.map((id) => ({ ...base, recipient_user_id: id, recipient_email: null, channel: "in_app" as const, status: "suppressed" as const, status_reason: "recipient not on NOTIFY_INAPP_ALLOWLIST" })),
      ];
      const claimed = rows.length ? await deps.store.claim(rows) : [];
      result.inApp.delivered = claimed.filter((row) => row.status === "delivered").length;
      result.inApp.suppressed = claimed.filter((row) => row.status === "suppressed").length;
      result.inApp.duplicate = rows.length - claimed.length;
    }

    if (request.channels.includes("email")) {
      const seen = new Set<string>();
      const recipients = request.recipients.filter((r) => {
        const email = r.email?.trim().toLowerCase();
        if (!email || seen.has(email)) return false;
        seen.add(email);
        return true;
      });
      const rows: NotificationRow[] = recipients.map((r) => ({
        ...base,
        recipient_user_id: r.userId ?? null,
        recipient_email: (r.email as string).trim(),
        channel: "email",
        status: "pending",
        status_reason: null,
      }));
      const claimed = rows.length ? await deps.store.claim(rows) : [];
      result.email.duplicate = rows.length - claimed.length;

      const linkUrl = request.link && deps.appUrl ? `${deps.appUrl.replace(/\/$/, "")}${request.link}` : null;
      const html =
        request.html ??
        `<p>${escapeHtml(request.body).replace(/\n/g, "<br>")}</p>` +
          (linkUrl ? `<p><a href="${escapeHtml(linkUrl)}">Open in the portal</a></p>` : "");

      for (const row of claimed) {
        const plan = planEmail({ to: [row.recipient_email as string], subject: request.title }, env);
        if (!plan.send) {
          await deps.store.update(row.id, { status: "suppressed", status_reason: plan.reason });
          result.email.suppressed += 1;
          continue;
        }
        try {
          await deps.sendEmail({ to: plan.to, subject: plan.subject, html });
          await deps.store.update(row.id, {
            status: "sent",
            delivered_to: plan.to.join(", "),
            sent_at: new Date().toISOString(),
            status_reason: plan.redirectedFrom ? "redirected (development)" : null,
          });
          result.email.sent += 1;
        } catch (error) {
          await deps.store.update(row.id, {
            status: "failed",
            status_reason: error instanceof Error ? error.message.slice(0, 500) : "send failed",
          });
          result.email.failed += 1;
        }
      }
    }

    return result;
  };
}

/** The Supabase-backed store (service role, after the caller's own checks). */
export function supabaseNotificationStore(admin: SupabaseClient): NotificationStore {
  return {
    async claim(rows) {
      const { data, error } = await admin
        .from("portal_notifications")
        .upsert(rows, { onConflict: "dedupe_key,channel,recipient_key", ignoreDuplicates: true })
        .select("id, event, entity_type, entity_id, recipient_user_id, recipient_email, channel, dedupe_key, title, body, link, requires_action, status, status_reason");
      if (error) throw new Error(error.message);
      return (data ?? []) as StoredNotification[];
    },
    async update(id, patch) {
      const { error } = await admin.from("portal_notifications").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    },
  };
}
