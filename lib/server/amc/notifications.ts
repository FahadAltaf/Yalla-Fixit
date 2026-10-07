import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AMC_EVENT_POLICY,
  AMC_NOTIFICATION_DEFAULTS,
  amcMessage,
  dedupeKey,
  emailEnabledFor,
  entitlementAlert,
  type AmcNotificationEvent,
  type AmcNotificationFacts,
  type AmcNotificationSettings,
} from "@/lib/amc/notifications";
import { canApproveAmc } from "@/components/dashboard/extensions/amc/amc-settings";
import { clientEmailHtml, escapeEmailHtml } from "@/lib/email-brand";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { readAmcSettings } from "@/lib/server/amc/settings";
import { sendEmail } from "@/lib/server/send-email";

/**
 * Writes AMC notifications and delivers their emails. Best effort by
 * design: a notification failure is logged and never fails the business
 * action that caused it (an approval, a signature). Idempotent through the
 * unique (dedupe_key, channel, recipient) key on amc_notifications.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;

export interface Recipient {
  userId: string | null;
  email: string | null;
  name: string;
}

const TABLE = "amc_notifications";
const missing = (error: { code?: string } | null | undefined) =>
  error?.code === "42P01" || error?.code === "PGRST205" || error?.code === "42703" || error?.code === "PGRST204";

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

/** The one settings row, or the defaults on a database without it. */
export async function readNotificationSettings(admin: Admin): Promise<AmcNotificationSettings> {
  const { data, error } = await admin
    .from("amc_notification_settings")
    .select(
      "workflow_email_enabled, entitlement_email_enabled, reminder_auto_enabled, reminder_thresholds, reminder_recipients, reminder_channels, reminder_extra_emails",
    )
    .eq("id", 1)
    .maybeSingle<Row>();
  if (error || !data) return { ...AMC_NOTIFICATION_DEFAULTS };
  return {
    workflowEmailEnabled: data.workflow_email_enabled !== false,
    entitlementEmailEnabled: data.entitlement_email_enabled === true,
    reminderAutoEnabled: data.reminder_auto_enabled === true,
    reminderThresholds: ((data.reminder_thresholds as number[] | null) ?? []).map(Number),
    reminderRecipients: ((data.reminder_recipients as string[] | null) ?? []).filter(
      (r): r is "owner" | "approvers" => r === "owner" || r === "approvers",
    ),
    reminderChannels: ((data.reminder_channels as string[] | null) ?? []).filter(
      (c): c is "in_app" | "email" => c === "in_app" || c === "email",
    ),
    reminderExtraEmails: ((data.reminder_extra_emails as string[] | null) ?? []).filter(Boolean),
  };
}

export async function writeNotificationSettings(
  admin: Admin,
  settings: AmcNotificationSettings,
  actorId: string,
): Promise<void> {
  const { error } = await admin.from("amc_notification_settings").upsert({
    id: 1,
    workflow_email_enabled: settings.workflowEmailEnabled,
    entitlement_email_enabled: settings.entitlementEmailEnabled,
    reminder_auto_enabled: settings.reminderAutoEnabled,
    reminder_thresholds: [...new Set(settings.reminderThresholds)].sort((a, b) => b - a),
    reminder_recipients: settings.reminderRecipients,
    reminder_channels: settings.reminderChannels,
    reminder_extra_emails: settings.reminderExtraEmails.map((e) => e.trim().toLowerCase()).filter(Boolean),
    updated_by: actorId,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(missing(error) ? "Notification settings are not set up on this database yet." : error.message);
}

/* ------------------------------------------------------------------ */
/* Recipients                                                          */
/* ------------------------------------------------------------------ */

function toRecipient(row: Row): Recipient {
  const email = typeof row.email === "string" && row.email.trim() ? row.email.trim() : null;
  return { userId: String(row.id), email, name: String(row.full_name ?? "").trim() || email || "AMC user" };
}

export async function ownerRecipient(admin: Admin, ownerId: string | null | undefined): Promise<Recipient[]> {
  if (!ownerId) return [];
  const { data } = await admin
    .from("user_profile")
    .select("id, email, full_name, is_active")
    .eq("id", ownerId)
    .maybeSingle<Row>();
  return data && data.is_active !== false ? [toRecipient(data)] : [];
}

/**
 * The AMC approvers, by the same rule the approval route applies
 * (canApproveAmc): the people listed in AMC Settings, or, when nobody is
 * listed, admins and every role with the AMC approve permission.
 */
export async function approverRecipients(admin: Admin): Promise<Recipient[]> {
  const settings = await readAmcSettings(admin);
  const listed = (settings.approval?.approvers ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean);
  const { data } = await admin
    .from("user_profile")
    .select("id, email, full_name, is_active, roles(name, role_access(resource, action, enabled))")
    .not("email", "is", null)
    .limit(1000);
  type RoleRow = { name?: string | null; role_access?: { resource: string; action: string; enabled?: boolean | null }[] | null };
  return ((data ?? []) as Row[])
    .filter((row) => row.is_active !== false)
    .filter((row) => {
      const email = String(row.email ?? "").trim().toLowerCase();
      const joined = row.roles as RoleRow | RoleRow[] | null;
      const role = Array.isArray(joined) ? joined[0] : joined;
      const hasRolePermission =
        role?.name === "admin" ||
        (role?.role_access ?? []).some((a) => a.resource === "amc" && a.action === "approve" && a.enabled !== false);
      return listed.length > 0 ? listed.includes(email) : canApproveAmc(settings, email, hasRolePermission);
    })
    .map(toRecipient);
}

function uniqueRecipients(list: Recipient[]): Recipient[] {
  const seen = new Set<string>();
  return list.filter((r) => {
    const key = r.userId ?? r.email?.toLowerCase() ?? "";
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* Notify                                                              */
/* ------------------------------------------------------------------ */

export interface NotifyInput {
  event: AmcNotificationEvent;
  submissionId?: string | null;
  contractId?: string | null;
  entitlementId?: string | null;
  ownerId?: string | null;
  /** Who caused it (skipped as a recipient where the policy says so). */
  actor?: { id: string | null; label: string | null } | null;
  /** The moment, for events that can recur (a resubmission). */
  at?: string | null;
  threshold?: number | null;
  facts: AmcNotificationFacts;
  /** A portal path, e.g. /extensions/amc-contracts/<id>. */
  link?: string | null;
  /** Replaces the policy's audience (renewal reminders are configured). */
  recipients?: Recipient[];
  /** Overrides the email switch (renewal reminders are configured). */
  emailEnabled?: boolean;
}

export interface NotifyResult {
  created: number;
  emailed: number;
  failed: number;
}

/**
 * Records the event for each recipient (in-app, and email when that
 * channel is on) and sends the emails it newly created. A row that already
 * exists for the same event, subject, recipient and channel is skipped,
 * along with its email: that is what makes retries safe.
 */
export async function notifyAmc(admin: Admin, input: NotifyInput): Promise<NotifyResult> {
  const result: NotifyResult = { created: 0, emailed: 0, failed: 0 };
  try {
    const policy = AMC_EVENT_POLICY[input.event];
    const settings = await readNotificationSettings(admin);
    const withEmail = input.emailEnabled ?? emailEnabledFor(input.event, settings);

    let recipients = input.recipients;
    if (!recipients) {
      const owner = policy.audience === "approvers" ? [] : await ownerRecipient(admin, input.ownerId);
      const approvers = policy.audience === "owner" ? [] : await approverRecipients(admin);
      recipients = [...owner, ...approvers];
    }
    recipients = uniqueRecipients(recipients).filter(
      (r) => !(policy.skipActor && input.actor?.id && r.userId === input.actor.id),
    );
    if (recipients.length === 0) return result;

    const message = amcMessage(input.event, input.facts);
    const key = dedupeKey(input.event, input);
    const base = {
      event: input.event,
      submission_id: input.submissionId ?? null,
      contract_id: input.contractId ?? null,
      entitlement_id: input.entitlementId ?? null,
      dedupe_key: key,
      title: message.title,
      body: message.body,
      link: input.link ?? null,
    };
    const rows: Row[] = [];
    for (const r of recipients) {
      if (r.userId) rows.push({ ...base, recipient_user_id: r.userId, recipient_email: r.email, channel: "in_app", status: "delivered" });
      if (withEmail && r.email) {
        rows.push({ ...base, recipient_user_id: r.userId, recipient_email: r.email, channel: "email", status: "pending" });
      }
    }
    if (rows.length === 0) return result;

    const { data, error } = await admin
      .from(TABLE)
      .upsert(rows, { onConflict: "dedupe_key,channel,recipient_key", ignoreDuplicates: true })
      .select("id, channel, recipient_email");
    if (error) {
      if (!missing(error)) console.error(`AMC notification ${input.event} not recorded:`, error.message);
      return result;
    }
    const created = (data ?? []) as Array<{ id: string; channel: string; recipient_email: string | null }>;
    result.created = created.length;
    if (created.length === 0) return result;

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "").replace(/\/$/, "");
    for (const row of created.filter((r) => r.channel === "email" && r.recipient_email)) {
      try {
        await sendEmail({
          to: row.recipient_email!,
          subject: message.title,
          html: clientEmailHtml({
            eyebrow: "AMC",
            heading: message.title,
            paragraphs: [escapeEmailHtml(message.body)],
            cta: input.link && appUrl ? { label: "Open in the portal", url: `${appUrl}${input.link}` } : undefined,
            footnote: "You receive this because of your role in the AMC workflow at Yalla Fix It.",
          }),
        });
        await admin.from(TABLE).update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", row.id);
        result.emailed += 1;
      } catch (mailError) {
        result.failed += 1;
        await admin
          .from(TABLE)
          .update({ status: "failed", status_reason: mailError instanceof Error ? mailError.message.slice(0, 300) : "Email failed" })
          .eq("id", row.id);
      }
    }

    const entityId = input.contractId ?? input.submissionId;
    if (entityId) {
      await recordAmcAudit(admin, {
        entityType: input.contractId ? "contract" : "submission",
        entityId,
        eventType: "notification_created",
        actorId: input.actor?.id ?? null,
        actorLabel: input.actor?.label ?? null,
        origin: input.actor?.id ? "portal" : "system",
        /* Who and how many, never message contents beyond the event. */
        payload: {
          event: input.event,
          inApp: created.filter((r) => r.channel === "in_app").length,
          email: created.filter((r) => r.channel === "email").length,
          emailed: result.emailed,
          failed: result.failed,
        },
      });
    }
  } catch (error) {
    console.error(`AMC notification ${input.event} failed:`, error instanceof Error ? error.message : error);
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Proposal events: the facts come from the proposal itself            */
/* ------------------------------------------------------------------ */

/** Notifies about a proposal, reading its number, customer and owner. */
export async function notifyProposalEvent(
  admin: Admin,
  input: Omit<NotifyInput, "facts" | "ownerId" | "link"> & { submissionId: string; facts?: AmcNotificationFacts },
): Promise<NotifyResult> {
  const { data } = await admin
    .from("amc_submissions")
    .select("id, owner_id, proposal_number, customer, property")
    .eq("id", input.submissionId)
    .maybeSingle<Row>();
  if (!data) return { created: 0, emailed: 0, failed: 0 };
  const customer = (data.customer ?? {}) as Row;
  const property = (data.property ?? {}) as Row;
  return notifyAmc(admin, {
    ...input,
    ownerId: String(data.owner_id),
    link: `/extensions/amc/${input.submissionId}`,
    facts: {
      proposalNumber: (data.proposal_number as string | null) ?? null,
      customerName: (customer.customerName as string | null) ?? null,
      propertyLabel: (property.propertyAddress as string | null) ?? null,
      actorName: input.actor?.label ?? null,
      ...input.facts,
    },
  });
}

/* ------------------------------------------------------------------ */
/* The in-app list                                                     */
/* ------------------------------------------------------------------ */

export interface InAppNotification {
  id: string;
  /* A workflow event (lib/amc/notifications.ts) or a later-phase event name. */
  event: AmcNotificationEvent | (string & {});
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

export async function listMyNotifications(
  admin: Admin,
  userId: string,
  limit = 30,
  options: { offset?: number; unreadOnly?: boolean } = {},
): Promise<{ notifications: InAppNotification[]; unread: number; migrated: boolean }> {
  const offset = Math.max(0, options.offset ?? 0);
  let listQuery = admin
    .from(TABLE)
    .select("id, event, title, body, link, created_at, read_at")
    .eq("recipient_user_id", userId)
    .eq("channel", "in_app");
  if (options.unreadOnly) listQuery = listQuery.is("read_at", null);
  const [list, count] = await Promise.all([
    listQuery.order("created_at", { ascending: false }).range(offset, offset + limit - 1),
    admin
      .from(TABLE)
      .select("id", { count: "exact", head: true })
      .eq("recipient_user_id", userId)
      .eq("channel", "in_app")
      .is("read_at", null),
  ]);
  if (list.error) {
    if (missing(list.error)) return { notifications: [], unread: 0, migrated: false };
    throw new Error(list.error.message);
  }
  return {
    notifications: ((list.data ?? []) as Row[]).map((r) => ({
      id: String(r.id),
      event: r.event as AmcNotificationEvent,
      title: String(r.title),
      body: String(r.body),
      link: (r.link as string | null) ?? null,
      createdAt: String(r.created_at),
      readAt: (r.read_at as string | null) ?? null,
    })),
    unread: count.count ?? 0,
    migrated: true,
  };
}

/** Marks the caller's own notifications read (all, or the ids given). */
export async function markNotificationsRead(admin: Admin, userId: string, ids: string[] | "all"): Promise<void> {
  let q = admin
    .from(TABLE)
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_user_id", userId)
    .eq("channel", "in_app")
    .is("read_at", null);
  if (ids !== "all") q = q.in("id", ids.slice(0, 200));
  const { error } = await q;
  if (error && !missing(error)) throw new Error(error.message);
}

/* ------------------------------------------------------------------ */
/* Named users, any AMC record (Phase 1 base for BRD 6.2)              */
/* ------------------------------------------------------------------ */

export interface NotifyUsersInput {
  /** lowercase_with_underscores (the table checks the pattern). */
  event: string;
  userIds: string[];
  title: string;
  body: string;
  /** A portal path; never a client token link. */
  link?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  contractId?: string | null;
  submissionId?: string | null;
  /** Same key + recipient = same notification (retries write nothing). */
  dedupeKey: string;
}

/**
 * In-app notifications for named users about any AMC record: to-do
 * escalations, enquiries, visits, call outs, payments. BRD 6.2 asks for
 * portal notifications, none as SMS; emails stay limited to the BRD
 * emails. Best effort: never throws.
 */
export async function notifyUsers(admin: Admin, input: NotifyUsersInput): Promise<number> {
  const userIds = [...new Set(input.userIds.filter(Boolean))];
  if (userIds.length === 0) return 0;
  try {
    const rows = userIds.map((userId) => ({
      event: input.event,
      recipient_user_id: userId,
      channel: "in_app",
      status: "delivered",
      dedupe_key: input.dedupeKey.slice(0, 300),
      title: input.title.slice(0, 300),
      body: input.body.slice(0, 2000),
      link: input.link ?? null,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      contract_id: input.contractId ?? null,
      submission_id: input.submissionId ?? null,
    }));
    const { data, error } = await admin
      .from(TABLE)
      .upsert(rows, { onConflict: "dedupe_key,channel,recipient_key", ignoreDuplicates: true })
      .select("id");
    if (error) {
      if (!missing(error)) console.error(`AMC notification ${input.event} not recorded:`, error.message);
      return 0;
    }
    return (data ?? []).length;
  } catch (error) {
    console.error(`AMC notification ${input.event} failed:`, error instanceof Error ? error.message : error);
    return 0;
  }
}

/* ------------------------------------------------------------------ */
/* Contract events                                                     */
/* ------------------------------------------------------------------ */

/** The contract's reference, customer and owner, for its notifications. */
async function contractFacts(admin: Admin, contractId: string) {
  const { data } = await admin
    .from("amc_contracts")
    .select("id, proposal_number, customer_name, property_label, end_date, amc_submissions!amc_contracts_submission_id_fkey(owner_id)")
    .eq("id", contractId)
    .maybeSingle<Row>();
  if (!data) return null;
  const joined = data.amc_submissions as Row | Row[] | null;
  const owner = Array.isArray(joined) ? joined[0] : joined;
  return {
    ownerId: (owner?.owner_id as string | null) ?? null,
    facts: {
      proposalNumber: (data.proposal_number as string | null) ?? null,
      customerName: (data.customer_name as string | null) || null,
      propertyLabel: (data.property_label as string | null) || null,
      endDate: (data.end_date as string | null) ?? null,
    } satisfies AmcNotificationFacts,
  };
}

/** Notifies about a contract, reading its reference, customer and owner. */
export async function notifyContractEvent(
  admin: Admin,
  input: Omit<NotifyInput, "facts" | "ownerId" | "link"> & { contractId: string; facts?: AmcNotificationFacts },
): Promise<NotifyResult> {
  const found = await contractFacts(admin, input.contractId);
  if (!found) return { created: 0, emailed: 0, failed: 0 };
  return notifyAmc(admin, {
    ...input,
    ownerId: found.ownerId,
    link: `/extensions/amc-contracts/${input.contractId}`,
    facts: { ...found.facts, actorName: input.actor?.label ?? null, ...input.facts },
  });
}

/**
 * After usage is recorded: tells the owner when a visits/hours allowance
 * has just become low or used up. State based, not view based: it runs on
 * a ledger write, and the dedupe key (event + entitlement) means each
 * state is announced once, however often the page is opened.
 */
export async function notifyEntitlementState(
  admin: Admin,
  contractId: string,
  entitlementId: string,
  actor: { id: string | null; label: string | null } | null,
): Promise<NotifyResult | null> {
  try {
    const { data } = await admin
      .from("amc_contract_entitlements")
      .select("id, service_label, entitlement_type, included_quantity, used_quantity")
      .eq("id", entitlementId)
      .eq("contract_id", contractId)
      .maybeSingle<Row>();
    if (!data) return null;
    const e = {
      entitlementType: data.entitlement_type as "visits" | "hours" | "unlimited" | "informational",
      includedQuantity: data.included_quantity === null ? null : Number(data.included_quantity),
      usedQuantity: Number(data.used_quantity ?? 0),
    };
    const alert = entitlementAlert(e);
    if (!alert) return null;
    const remaining = Math.max(0, Math.round(((e.includedQuantity ?? 0) - e.usedQuantity) * 100) / 100);
    return notifyContractEvent(admin, {
      event: alert,
      contractId,
      entitlementId,
      actor,
      facts: {
        serviceLabel: String(data.service_label ?? ""),
        remaining,
        unit: e.entitlementType === "hours" ? (remaining === 1 ? "hour" : "hours") : remaining === 1 ? "visit" : "visits",
      },
    });
  } catch (error) {
    console.error("AMC allowance notification failed:", error instanceof Error ? error.message : error);
    return null;
  }
}
