import type { SupabaseClient } from "@supabase/supabase-js";

import type { OpenAlert } from "@/lib/reports/alerts-plan";
import { computeAvailability } from "@/lib/reports/available-hours";
import { CHECK_IN_ALERT_EVENTS, planCheckInAlerts, type CheckInAlertDay } from "@/lib/reports/checkin-alerts";
import { todayInZone } from "@/lib/scheduling/org-time";
import { createNotifier, supabaseNotificationStore } from "@/lib/server/notifications/notifier";
import { readReportingSettings } from "@/lib/server/reporting/settings";
import { sendEmail } from "@/lib/server/send-email";
import { readAllRows } from "@/lib/server/snagging/read-all";

import { loadAvailabilityInput, loadComplianceAppointments, loadShiftCheckIns, loadTechnicians } from "./data";

/**
 * Runs the check-in alerts N5 and N6 (BRD B3; lib/reports/checkin-alerts.ts
 * says when and what) and closes the ones that are over. In-app, to the
 * check-in alert recipients in Reporting Settings (the coordinators).
 *
 * Meant to run every five minutes: the alerts are due 15 minutes after a
 * start, so they go out within 20. FSM is read fresh each run (today's
 * appointments and attendance only, a page or two each), and every alert
 * has a dedupe key, so a run sends nothing twice. With nobody set to
 * receive them and nothing open, a run reads nothing at all.
 *
 * Delivery goes through the notifier and its safety rail, so outside
 * production only the development allowlist receives anything.
 */

const EVENTS = Object.values(CHECK_IN_ALERT_EVENTS);

export type CheckInAlertsResult = {
  skipped?: "no recipients";
  planned: { shift: number; appointment: number };
  delivered: number;
  suppressed: number;
  duplicate: number;
  resolved: number;
};

async function openCheckInAlerts(admin: SupabaseClient): Promise<OpenAlert[]> {
  const rows = await readAllRows<Record<string, unknown>>(
    (from, to) =>
      admin
        .from("portal_notifications")
        .select("id, event, entity_id, dedupe_key")
        .in("event", EVENTS)
        .is("resolved_at", null)
        .order("id")
        .range(from, to),
    "open check-in alerts",
  );
  const seen = new Map<string, OpenAlert>();
  for (const r of rows) {
    const key = String(r.dedupe_key);
    if (!seen.has(key)) seen.set(key, { event: String(r.event), entityId: String(r.entity_id), dedupeKey: key });
  }
  return [...seen.values()];
}

/* Where each appointment is, as the Scheduling module holds it (FSM gives only an address record id). */
async function locations(admin: SupabaseClient, appointmentIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!appointmentIds.length) return out;
  const { data, error } = await admin.from("schedule_entries").select("fsm_appointment_id, address").in("fsm_appointment_id", appointmentIds);
  if (error) throw new Error(`schedule entries: ${error.message}`);
  for (const r of data ?? []) if (r.address && r.fsm_appointment_id) out.set(String(r.fsm_appointment_id), String(r.address));
  return out;
}

export async function runCheckInAlerts(admin: SupabaseClient, now = new Date()): Promise<CheckInAlertsResult> {
  const settings = await readReportingSettings(admin);
  const recipients = settings.attendance.checkInAlertRecipientUserIds;
  const open = await openCheckInAlerts(admin);
  const result: CheckInAlertsResult = { planned: { shift: 0, appointment: 0 }, delivered: 0, suppressed: 0, duplicate: 0, resolved: 0 };
  if (!recipients.length && !open.length) return { ...result, skipped: "no recipients" };

  const today = todayInZone();
  const [roster, loaded, checkIns] = await Promise.all([
    loadTechnicians(admin),
    loadComplianceAppointments(admin, { from: today, to: today }, { refresh: true }),
    loadShiftCheckIns(admin, { from: today, to: today }, { refresh: true }),
  ]);
  /* Active technicians only: a leaver or an inactive account is never raised. */
  const active = [...roster.values()].filter((t) => t.isActive);
  const input = await loadAvailabilityInput(admin, {
    from: today,
    to: today,
    technicians: active,
    unpaidBreakMinutes: settings.attendance.unpaidBreakMinutes,
    standardDailyHours: settings.attendance.standardDailyHours,
    dataCentreDailyHours: settings.attendance.dataCentreDailyHours,
  });
  const availability = computeAvailability(input);
  const days: CheckInAlertDay[] = availability.map((a) => {
    const tech = roster.get(a.fsmId)!;
    const day = a.days[0];
    return {
      technicianFsmId: a.fsmId,
      name: tech.name,
      /* Leave of any length that day is "on leave" (B3): a morning off is no missed check-in. */
      working: day?.status === "working" && day.leaveMinutes === 0,
      restDaySet: !day?.restDaysAssumed,
      shift: tech.shift === "night" ? "night" : "morning",
      shiftStart: day?.windowStart ?? null,
    };
  });
  const where = await locations(
    admin,
    loaded.appointments.map((a) => a.id),
  );

  const plan = planCheckInAlerts({
    now: now.toISOString(),
    shiftDelayMinutes: settings.attendance.shiftCheckInAlertDelayMinutes,
    appointmentDelayMinutes: settings.attendance.appointmentCheckInAlertDelayMinutes,
    days,
    checkIns: checkIns.filter((c) => c.kind === "shift_check_in").map((c) => ({ technicianFsmId: c.technicianFsmId, at: c.at })),
    appointments: loaded.appointments.map((a) => ({
      id: a.id,
      number: a.number,
      workOrderNumber: a.workOrderNumber,
      clientName: a.clientName,
      location: where.get(a.id) ?? null,
      status: a.status,
      scheduledStart: a.scheduledStart,
      actualStart: a.actualStart,
      leadId: a.leadId,
      crew: a.technicianIds,
    })),
    open,
  });
  result.planned = {
    shift: plan.send.filter((s) => s.event === CHECK_IN_ALERT_EVENTS.shift).length,
    appointment: plan.send.filter((s) => s.event === CHECK_IN_ALERT_EVENTS.appointment).length,
  };

  if (recipients.length) {
    const notify = createNotifier({
      store: supabaseNotificationStore(admin),
      sendEmail: (mail) => sendEmail(mail),
      appUrl: process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL,
    });
    for (const alert of plan.send) {
      const sent = await notify({
        event: alert.event,
        entityType: alert.entityType,
        entityId: alert.entityId,
        dedupeKey: alert.dedupeKey,
        recipients: recipients.map((userId) => ({ userId })),
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
