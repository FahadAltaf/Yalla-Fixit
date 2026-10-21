import type { SupabaseClient } from "@supabase/supabase-js";

import { ALERT_EVENTS, planReportAlerts, type OpenAlert, type PlannedAlert } from "@/lib/reports/alerts-plan";
import { findUnflagged } from "@/lib/reports/exceptions";
import { buildQuotationRows } from "@/lib/reports/quotations";
import { todayInZone } from "@/lib/scheduling/org-time";
import { createNotifier, supabaseNotificationStore } from "@/lib/server/notifications/notifier";
import { readReportingSettings } from "@/lib/server/reporting/settings";
import { sendEmail } from "@/lib/server/send-email";
import { readAllRows } from "@/lib/server/snagging/read-all";

import { loadQuotationRecords, loadUnflaggedInputs } from "./data";

/**
 * Runs the daily report alerts N7, N8 and N13 (lib/reports/alerts-plan.ts
 * says what and to whom), and closes the ones that are over. In-app only.
 * Delivery goes through the notifier and its safety rail, so outside
 * production only the development allowlist receives anything.
 *
 * Safe to run every hour: every alert has a dedupe key, so a second run
 * sends nothing new.
 */

const EVENTS = Object.values(ALERT_EVENTS);

export type ReportAlertsResult = {
  planned: Record<string, number>;
  delivered: number;
  suppressed: number;
  duplicate: number;
  /** Alerts with nobody to send to: the owner has no portal account, or no N7 recipients are set. */
  noRecipient: Array<{ event: string; entityId: string; person: string | null }>;
  resolved: number;
  backlog: { quotationsAged: number; workOrdersUnflagged: number };
};

async function openAlerts(admin: SupabaseClient): Promise<OpenAlert[]> {
  const rows = await readAllRows<Record<string, unknown>>(
    (from, to) =>
      admin
        .from("portal_notifications")
        .select("id, event, entity_id, dedupe_key")
        .in("event", EVENTS)
        .is("resolved_at", null)
        .order("id")
        .range(from, to),
    "open report alerts",
  );
  const seen = new Map<string, OpenAlert>();
  for (const r of rows) {
    const key = String(r.dedupe_key);
    if (!seen.has(key)) seen.set(key, { event: String(r.event), entityId: String(r.entity_id), dedupeKey: key });
  }
  return [...seen.values()];
}

/** Active portal users by lower-case email, to reach an FSM owner. */
async function usersByEmail(admin: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await admin.from("user_profile").select("id, email, is_active").limit(2000);
  if (error) throw new Error(error.message);
  const out = new Map<string, string>();
  for (const u of data ?? []) {
    if (u.is_active === false || !u.email) continue;
    out.set(String(u.email).trim().toLowerCase(), String(u.id));
  }
  return out;
}

export async function runReportAlerts(admin: SupabaseClient): Promise<ReportAlertsResult> {
  const settings = await readReportingSettings(admin);
  const today = todayInZone();
  const [records, unflaggedInputs, open, emails] = await Promise.all([
    loadQuotationRecords(admin),
    loadUnflaggedInputs(admin),
    openAlerts(admin),
    usersByEmail(admin),
  ]);
  const quotations = buildQuotationRows(records, {
    today,
    limits: settings.quotations.ageingDaysByStatus,
    expiryWarningDays: settings.quotations.expiryWarningDays,
  });
  const afterDays = settings.exceptions.completedWithoutFlagAfterDays;
  const unflagged = findUnflagged({ ...unflaggedInputs, today, afterDays });
  const plan = planReportAlerts({ quotations, unflagged, open, unflaggedAfterDays: afterDays });

  const n7Recipients = settings.quotations.alertRecipientUserIds;
  const notify = createNotifier({
    store: supabaseNotificationStore(admin),
    sendEmail: (input) => sendEmail(input),
    appUrl: process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL,
  });

  const result: ReportAlertsResult = {
    planned: Object.fromEntries(EVENTS.map((e) => [e, plan.send.filter((s) => s.event === e).length])),
    delivered: 0,
    suppressed: 0,
    duplicate: 0,
    noRecipient: [],
    resolved: 0,
    backlog: plan.backlog,
  };

  const recipientsOf = (alert: PlannedAlert): string[] => {
    if (alert.to.kind === "recipients") return n7Recipients;
    const id = alert.to.email ? emails.get(alert.to.email.trim().toLowerCase()) : undefined;
    return id ? [id] : [];
  };

  for (const alert of plan.send) {
    const userIds = recipientsOf(alert);
    if (!userIds.length) {
      result.noRecipient.push({
        event: alert.event,
        entityId: alert.entityId,
        person: alert.to.kind === "person" ? (alert.to.name ?? alert.to.email) : null,
      });
      continue;
    }
    const sent = await notify({
      event: alert.event,
      entityType: alert.entityType,
      entityId: alert.entityId,
      dedupeKey: alert.dedupeKey,
      recipients: userIds.map((userId) => ({ userId })),
      channels: ["in_app"],
      title: alert.title,
      body: alert.body,
      link: alert.link,
      requiresAction: true,
    });
    result.delivered += sent.inApp.delivered;
    result.suppressed += sent.inApp.suppressed;
    result.duplicate += sent.inApp.duplicate;
  }

  for (const over of plan.resolve) {
    const { data, error } = await admin
      .from("portal_notifications")
      .update({ resolved_at: new Date().toISOString() })
      .eq("event", over.event)
      .eq("dedupe_key", over.dedupeKey)
      .is("resolved_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    result.resolved += data?.length ?? 0;
  }
  return result;
}
