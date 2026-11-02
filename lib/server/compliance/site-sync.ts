// Current site from FSM (Sharon's action point C3). Rule (Sami, 29 Oct 2026):
// the client and address of the appointment the employee's FSM technician is
// on now; blank when there is none. Source (Sami, 30 Oct 2026, Q2): Zoho FSM
// directly, not the scheduling board, run every six hours and on demand.
//
// "On now" = an appointment that is not cancelled, completed or "cannot
// complete", and either FSM marks it In Progress, or its scheduled window
// covers this moment. Two at once: the one that started last wins.
//
// Cost: one or two FSM searches for the window, then one full-record read per
// appointment on now (a search result names only the lead; the full record
// carries the crew). Only employees linked to a technician are touched.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getFsmAccessToken, fsmGetRecord } from "@/lib/server/zoho/fsm-client";
import { addressText, crewOf, fetchAppointmentsBetween, type FsmAppointment } from "@/lib/server/zoho/import-appointments";
import { resolveAppointmentState } from "@/lib/scheduling/appointment-status";
import { DEFAULT_ORG_TIMEZONE, zoneOffsetMinutes } from "@/lib/scheduling/org-time";

export type SiteSyncSummary = {
  linked: number;
  on_appointment: number;
  blank: number;
  changed: number;
  appointments_scanned: number;
  appointments_on_now: number;
  fsm_calls: number;
};

type Current = {
  appointment_id: string;
  appointment_name: string | null;
  work_order_id: string | null;
  work_order_name: string | null;
  client_name: string;
  address: string | null;
  start: string;
  end: string | null;
};

const HOUR = 3_600_000;

function isOnNow(a: FsmAppointment, nowMs: number): boolean {
  const state = resolveAppointmentState(a.Status);
  if (state === "cancelled" || state === "completed" || state === "cannot_complete") return false;
  const start = a.Scheduled_Start_Date_Time ? Date.parse(a.Scheduled_Start_Date_Time) : NaN;
  const end = a.Scheduled_End_Date_Time ? Date.parse(a.Scheduled_End_Date_Time) : NaN;
  if (Number.isNaN(start) || start > nowMs) return false;
  if (state === "in_progress") return true;
  return !Number.isNaN(end) && end > nowMs;
}

export async function syncCurrentSites(admin: SupabaseClient, now: Date = new Date()): Promise<SiteSyncSummary> {
  const nowMs = now.getTime();
  const token = await getFsmAccessToken(admin);

  // FSM date searches drift by hours against the Gulf (project memory, 29 Sep
  // 2026), so the window is padded and each record is judged by its own times.
  const from = new Date(nowMs - 36 * HOUR);
  const to = new Date(nowMs + 12 * HOUR);
  const { rows } = await fetchAppointmentsBetween(token, from, to, zoneOffsetMinutes(now, DEFAULT_ORG_TIMEZONE));
  let fsmCalls = 2;

  const onNow = rows.filter((a) => isOnNow(a, nowMs));
  const current = new Map<string, Current>();
  for (const a of onNow) {
    const full = await fsmGetRecord<FsmAppointment>(token, "Service_Appointments", a.id);
    fsmCalls += 1;
    const record = full.ok && full.record ? full.record : a;
    if (!isOnNow(record, nowMs)) continue;
    const client = record.Company?.name ?? record.Contact?.name ?? null;
    if (!client) continue;
    const entry: Current = {
      appointment_id: record.id,
      appointment_name: record.Name ?? null,
      work_order_id: record.Work_Order?.id ?? null,
      work_order_name: record.Work_Order?.name ?? null,
      client_name: client,
      address: addressText(record.Service_Address) || null,
      start: record.Scheduled_Start_Date_Time as string,
      end: record.Scheduled_End_Date_Time ?? null,
    };
    for (const tech of crewOf(record)) {
      const prev = current.get(tech);
      if (!prev || Date.parse(entry.start) > Date.parse(prev.start)) current.set(tech, entry);
    }
  }

  const { data: employees, error } = await admin
    .from("compliance_employees")
    .select("id, fsm_resource_id, site_source, site_fsm_appointment_id, site_client_name")
    .not("fsm_resource_id", "is", null)
    .is("archived_at", null);
  if (error) throw new Error(error.message);

  const summary: SiteSyncSummary = { linked: 0, on_appointment: 0, blank: 0, changed: 0, appointments_scanned: rows.length, appointments_on_now: onNow.length, fsm_calls: fsmCalls };
  const stamp = now.toISOString();
  for (const emp of (employees ?? []) as { id: string; fsm_resource_id: string; site_source: string; site_fsm_appointment_id: string | null; site_client_name: string | null }[]) {
    summary.linked += 1;
    const c = current.get(emp.fsm_resource_id);
    if (c) summary.on_appointment += 1;
    else summary.blank += 1;
    const next = {
      site_source: c ? "fsm" : "none",
      site_client_name: c?.client_name ?? null,
      site_address: c?.address ?? null,
      site_fsm_appointment_id: c?.appointment_id ?? null,
      site_fsm_appointment_name: c?.appointment_name ?? null,
      site_fsm_work_order_id: c?.work_order_id ?? null,
      site_fsm_work_order_name: c?.work_order_name ?? null,
      site_appointment_start: c?.start ?? null,
      site_appointment_end: c?.end ?? null,
      site_client_id: null,
      site_property_id: null,
    };
    if (emp.site_source !== next.site_source || emp.site_fsm_appointment_id !== next.site_fsm_appointment_id || emp.site_client_name !== next.site_client_name) summary.changed += 1;
    let { error: upError } = await admin.from("compliance_employees").update({ ...next, site_synced_at: stamp }).eq("id", emp.id);
    if (upError && (upError.code === "42703" || upError.code === "PGRST204")) {
      // The appointment and work order number columns are not there yet
      // (re-run 20261029130000): save the site without them.
      const withoutNames: Partial<typeof next> = { ...next };
      delete withoutNames.site_fsm_appointment_name;
      delete withoutNames.site_fsm_work_order_name;
      ({ error: upError } = await admin.from("compliance_employees").update({ ...withoutNames, site_synced_at: stamp }).eq("id", emp.id));
    }
    if (upError) throw new Error(`Updating ${emp.id}: ${upError.message}`);
  }
  return summary;
}

/** Run a job with a row in compliance_job_runs; a failure is logged, then rethrown. */
export async function runLoggedJob<T>(admin: SupabaseClient, job: "site_sync" | "reminders", trigger: "cron" | "manual", work: () => Promise<T>): Promise<T> {
  const { data: run } = await admin.from("compliance_job_runs").insert({ job, trigger }).select("id").single();
  const runId = (run as { id: string } | null)?.id;
  try {
    const result = await work();
    if (runId) await admin.from("compliance_job_runs").update({ finished_at: new Date().toISOString(), ok: true, summary: result as unknown as object }).eq("id", runId);
    return result;
  } catch (error) {
    if (runId) await admin.from("compliance_job_runs").update({ finished_at: new Date().toISOString(), ok: false, error: error instanceof Error ? error.message : String(error) }).eq("id", runId);
    throw error;
  }
}
