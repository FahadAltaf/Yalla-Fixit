import type { SupabaseClient } from "@supabase/supabase-js";

import { complianceMonthPhase } from "@/lib/reports/compliance";
import {
  COMPLIANCE_ALERT_EVENTS,
  hrReportEmail,
  planComplianceAlerts,
  statementEmail,
  type CompliancePerson,
  type StatementRow,
} from "@/lib/reports/compliance-disputes";
import { clientEmailHtml } from "@/lib/email-brand";
import { addDaysToDateString, zonedDateString } from "@/lib/scheduling/org-time";
import { createNotifier, supabaseNotificationStore } from "@/lib/server/notifications/notifier";
import { readReportingSettings } from "@/lib/server/reporting/settings";
import { sendEmail } from "@/lib/server/send-email";
import { readAllRows } from "@/lib/server/snagging/read-all";

import { workOutMonth } from "./compliance";
import type { ReportTechnician } from "./data";

/**
 * The compliance messages (BRD §6.1, §6.2; DEV-447, 449, 450), once a day:
 *
 *   N9   to the technician, for each check-in missed on a settled day
 *        (the last three days, so a first run sends no backlog);
 *   N10  to the technician, their team leader and the supervisors, once a
 *        month, when settled compliance first falls below the threshold;
 *   N11  in-app, and E2 by email, to each technician at month close, while
 *        disputes are open; N11 stops showing when they close;
 *   E3   to HR and the managers, once the month is finalised (figures are
 *        final after disputes), from its frozen statements.
 *
 * In-app needs the technician's portal account (most have none: the
 * result counts them). E2 goes to the email FSM holds for the technician.
 * Every message has a dedupe key, so a repeat run sends nothing new; all
 * delivery goes through the notifier's safety rail.
 */

export type ComplianceAlertsResult = {
  today: string;
  months: { current: string; previous: string | null };
  planned: Record<string, number>;
  inApp: { delivered: number; suppressed: number; duplicate: number };
  email: { sent: number; failed: number; suppressed: number; duplicate: number };
  /** Misses whose technician has no portal account to be told in. */
  unreachable: number;
  /** Statements with no email for the technician in FSM. */
  noEmail: number;
  resolved: number;
  hrReport: "sent" | "already sent" | "not finalised" | "no recipients" | "not due";
};

const monthOf = (date: string) => date.slice(0, 7);

function people(roster: Map<string, ReportTechnician>): Map<string, CompliancePerson> {
  const out = new Map<string, CompliancePerson>();
  for (const t of roster.values()) {
    out.set(t.fsmId, {
      fsmId: t.fsmId,
      name: t.name,
      userId: t.userProfileId,
      email: t.email,
      teamLeaderUserId: t.teamLeaderId ? (roster.get(t.teamLeaderId)?.userProfileId ?? null) : null,
    });
  }
  return out;
}

export async function runComplianceAlerts(admin: SupabaseClient, now = new Date()): Promise<ComplianceAlertsResult> {
  const settings = await readReportingSettings(admin);
  const today = zonedDateString(now.getTime());
  const current = monthOf(today);
  const previous = monthOf(addDaysToDateString(`${current}-01`, -1));
  const previousPhase = complianceMonthPhase(previous, today, settings.compliance.disputeCutoffDay);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "").replace(/\/$/, "");

  const [currentWork, previousWork] = await Promise.all([
    workOutMonth(admin, current),
    previousPhase.phase === "disputes_open" ? workOutMonth(admin, previous) : Promise.resolve(null),
  ]);
  const roster = currentWork.roster;
  const plan = planComplianceAlerts({
    today,
    now: now.toISOString(),
    thresholdPercent: settings.compliance.thresholdPercent,
    people: people(roster),
    current: { month: current, results: [...currentWork.results.values()] },
    previous: previousWork ? { month: previous, cutoffDate: previousPhase.cutoffDate, results: [...previousWork.results.values()] } : null,
    closedMonth: previousPhase.phase === "final" ? previous : null,
    supervisorUserIds: settings.compliance.belowThresholdRecipientUserIds,
  });

  const notify = createNotifier({ store: supabaseNotificationStore(admin), sendEmail: (mail) => sendEmail(mail), appUrl });
  const result: ComplianceAlertsResult = {
    today,
    months: { current, previous: previousWork ? previous : null },
    planned: {
      n9: plan.misses.length,
      n10: plan.belowThreshold.length,
      n11: plan.statements.filter((s) => s.person.userId).length,
      e2: plan.statements.filter((s) => s.person.email).length,
    },
    inApp: { delivered: 0, suppressed: 0, duplicate: 0 },
    email: { sent: 0, failed: 0, suppressed: 0, duplicate: 0 },
    unreachable: plan.unreachable,
    noEmail: plan.statements.filter((s) => !s.person.email).length,
    resolved: 0,
    hrReport: "not due",
  };
  const add = (sent: Awaited<ReturnType<typeof notify>>) => {
    for (const k of ["delivered", "suppressed", "duplicate"] as const) result.inApp[k] += sent.inApp[k];
    for (const k of ["sent", "failed", "suppressed", "duplicate"] as const) result.email[k] += sent.email[k];
  };

  for (const m of plan.misses) {
    add(
      await notify({
        event: m.event,
        entityType: "technician",
        entityId: m.technicianFsmId,
        dedupeKey: m.dedupeKey,
        recipients: [{ userId: m.userId }],
        channels: ["in_app"],
        title: m.title,
        body: m.body,
        link: m.link,
      }),
    );
  }
  for (const m of plan.belowThreshold) {
    add(
      await notify({
        event: m.event,
        entityType: "technician",
        entityId: m.technicianFsmId,
        dedupeKey: m.dedupeKey,
        recipients: m.userIds.map((userId) => ({ userId })),
        channels: ["in_app"],
        title: m.title,
        body: m.body,
        link: m.link,
      }),
    );
  }
  for (const s of plan.statements) {
    if (s.person.userId) {
      add(
        await notify({
          event: s.n11.event,
          entityType: "technician",
          entityId: s.person.fsmId,
          dedupeKey: s.n11.dedupeKey,
          recipients: [{ userId: s.person.userId }],
          channels: ["in_app"],
          title: s.n11.title,
          body: s.n11.body,
          link: s.n11.link,
          requiresAction: s.compliance.missed > 0,
        }),
      );
    }
    if (s.person.email) {
      add(
        await notify({
          event: s.e2.event,
          entityType: "technician",
          entityId: s.person.fsmId,
          dedupeKey: s.e2.dedupeKey,
          recipients: [{ userId: s.person.userId, email: s.person.email }],
          channels: ["email"],
          title: s.e2.title,
          body: s.e2.body,
          html: clientEmailHtml(
            statementEmail({
              month: previous,
              cutoffDate: previousPhase.cutoffDate,
              name: s.person.name,
              compliance: s.compliance,
              thresholdPercent: settings.compliance.thresholdPercent,
              appUrl,
            }),
          ),
          link: s.e2.link,
        }),
      );
    }
  }

  /* N11 stops showing when the window closes. */
  if (plan.resolveStatementsOf) {
    const { data, error } = await admin
      .from("portal_notifications")
      .update({ resolved_at: now.toISOString() })
      .eq("event", COMPLIANCE_ALERT_EVENTS.statementReady)
      .like("dedupe_key", `n11:%:${plan.resolveStatementsOf}`)
      .is("resolved_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    result.resolved += data?.length ?? 0;
  }

  /* E3: last month once finalised, and the month before (finalised late). Finalising sends it too. */
  const beforeLast = monthOf(addDaysToDateString(`${previous}-01`, -1));
  const due = [...(previousPhase.phase === "final" ? [previous] : []), beforeLast];
  for (const month of due) {
    const outcome = await sendHrReport(admin, month, settings.compliance.hrRecipientUserIds, notify, appUrl, roster);
    if (result.hrReport === "not due" || outcome === "sent") result.hrReport = outcome;
  }
  return result;
}

/** E3 for a finalised month, from its frozen statements. Once per month (dedupe). */
export async function sendHrReport(
  admin: SupabaseClient,
  month: string,
  recipientIds: string[],
  notify: ReturnType<typeof createNotifier>,
  appUrl: string,
  roster: Map<string, ReportTechnician>,
): Promise<ComplianceAlertsResult["hrReport"]> {
  if (!recipientIds.length) return "no recipients";
  const { data: monthRow, error } = await admin.schema("hr").from("compliance_months").select("month, settings").eq("month", month).maybeSingle();
  if (error) throw new Error(error.message);
  if (!monthRow) return "not finalised";
  const statements = await readAllRows<Record<string, unknown>>(
    (from, to) => admin.schema("hr").from("compliance_statements").select("*").eq("month", month).order("technician_fsm_id").range(from, to),
    "compliance statements",
  );
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const teamName = (fsmId: string) => {
    const leader = roster.get(fsmId)?.teamLeaderId;
    return leader ? `${roster.get(leader)?.name ?? leader}'s team` : "No team";
  };
  const rows: StatementRow[] = statements
    .filter((s) => Number(s.required) + Number(s.waived) > 0)
    .map((s) => ({
      fsmId: String(s.technician_fsm_id),
      name: String(s.technician_name ?? s.technician_fsm_id),
      teamName: teamName(String(s.technician_fsm_id)),
      required: Number(s.required),
      performed: Number(s.performed),
      missed: Number(s.missed),
      waived: Number(s.waived),
      compliancePercent: n(s.compliance_percent),
      belowThreshold: (s.below_threshold as boolean | null) ?? null,
      penaltyBeforeCapAed: n(s.penalty_before_cap),
      penaltyPayableAed: n(s.penalty_payable),
    }));
  const thresholdPercent = ((monthRow.settings as { thresholdPercent?: number | null }) ?? {}).thresholdPercent ?? null;

  const { data: people, error: peopleError } = await admin.from("user_profile").select("id, email, is_active").in("id", recipientIds);
  if (peopleError) throw new Error(peopleError.message);
  const recipients = (people ?? [])
    .filter((p) => p.is_active !== false)
    .map((p) => ({ userId: String(p.id), email: (p.email as string | null) ?? null }));
  const parts = hrReportEmail({ month, rows, thresholdPercent, appUrl });
  const sent = await notify({
    event: COMPLIANCE_ALERT_EVENTS.hrReport,
    entityType: "compliance_month",
    entityId: month,
    dedupeKey: `e3:${month}`,
    recipients,
    channels: ["email", "in_app"],
    title: parts.heading,
    body: `${rows.length} technicians; the figures are final. Open the report for the detail.`,
    html: clientEmailHtml(parts),
    link: `/reports/compliance?month=${month}`,
  });
  return sent.email.sent + sent.email.suppressed + sent.inApp.delivered + sent.inApp.suppressed > 0 ? "sent" : "already sent";
}
