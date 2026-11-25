import type { SupabaseClient } from "@supabase/supabase-js";

import { findOrCreateDraftVersion } from "@/lib/server/schedule-entries";
import { DEFAULT_ORG_TIMEZONE, addDaysToDateString, zonedDateString, zonedMinutesOfDay, zonedTimeToUtc } from "@/lib/scheduling/org-time";

/**
 * AMC work on the one Scheduling board (DEV-489, DEV-392; 25 Nov 2026).
 *
 * Every AMC PPM visit, call out and additional work that has a crew and a
 * time is shown on the Scheduling board as an entry tagged AMC: its type,
 * contract, client and reference, on its technicians' rows. The AMC record is
 * the source of truth; this writes, moves and removes the board entry to
 * match it after each change in AMC.
 *
 * The entry is free text (no FSM work order or appointment), so publishing a
 * day never sends it to Zoho FSM: technicians do AMC jobs in the YFI app (the
 * user's decision, 25 Nov 2026). On the board it is read only; it is changed
 * from AMC.
 *
 * Before migration 20261125100000 the columns are missing: nothing is written
 * and the board is as before. A past day with no version on the board is left
 * alone (the board never creates the past).
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
export type AmcEntryKind = "ppm" | "call_out" | "additional_work";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const one = (v: unknown): Row | null => (Array.isArray(v) ? ((v[0] as Row) ?? null) : ((v as Row) ?? null));
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
const missing = (e: { code?: string; message?: string } | null) =>
  Boolean(e) && (e!.code === "42703" || e!.code === "PGRST204" || /amc_kind|amc_record_id/.test(e!.message ?? ""));

/* Statuses that keep a job on the board; anything else takes it off. */
const LIVE: Record<AmcEntryKind, (status: string) => boolean> = {
  ppm: (s) => !["cancelled", "not_scheduled"].includes(s),
  call_out: (s) => s !== "cancelled",
  additional_work: (s) => ["scheduled", "completed", "invoiced", "paid"].includes(s),
};

interface Job {
  start: string;
  end: string;
  technicianIds: string[];
  status: string;
  contractId: string | null;
  ref: string;
  visitType: string;
  client: string | null;
  address: string | null;
  detail: string | null;
}

async function loadJob(admin: Admin, kind: AmcEntryKind, id: string): Promise<Job | null> {
  if (kind === "ppm") {
    const { data } = await admin
      .from("amc_visits")
      .select("id, visit_no, status, scheduled_start, scheduled_end, technician_ids, contract_id, contract:amc_contracts!amc_visits_contract_id_fkey(contract_number, customer_name, property_label), lines:amc_visit_lines(service_label)")
      .eq("id", id)
      .maybeSingle<Row>();
    if (!data) return null;
    const c = one(data.contract);
    const services = [...new Set(((data.lines as Row[] | null) ?? []).map((l) => str(l.service_label)).filter(Boolean))] as string[];
    return {
      start: String(data.scheduled_start ?? ""),
      end: String(data.scheduled_end ?? ""),
      technicianIds: ids(data.technician_ids),
      status: String(data.status ?? ""),
      contractId: str(data.contract_id),
      ref: `${str(c?.contract_number) ?? "AMC"} · visit ${String(data.visit_no ?? "")}`.trim(),
      visitType: "PPM visit",
      client: str(c?.customer_name),
      address: str(c?.property_label),
      detail: services.length ? services.join(", ") : null,
    };
  }
  if (kind === "call_out") {
    const { data } = await admin
      .from("amc_call_outs")
      .select("id, call_out_no, status, priority, issue, scheduled_start, scheduled_end, technician_ids, contract_id, contract:amc_contracts!amc_call_outs_contract_id_fkey(contract_number, customer_name, property_label)")
      .eq("id", id)
      .maybeSingle<Row>();
    if (!data) return null;
    const c = one(data.contract);
    /* A handyman job (DEV-495) is a call out on the free hours; the column is missing before 20261124120000. */
    const { data: hm } = await admin.from("amc_call_outs").select("handyman_teams").eq("id", id).maybeSingle<Row>();
    const handyman = hm?.handyman_teams !== null && hm?.handyman_teams !== undefined;
    return {
      start: String(data.scheduled_start ?? ""),
      end: String(data.scheduled_end ?? ""),
      technicianIds: ids(data.technician_ids),
      status: String(data.status ?? ""),
      contractId: str(data.contract_id),
      ref: `${str(c?.contract_number) ?? "AMC"} · call out ${String(data.call_out_no ?? "")}`.trim(),
      visitType: handyman ? "Handyman job" : data.priority === "emergency" ? "Emergency call out" : "Call out",
      client: str(c?.customer_name),
      address: str(c?.property_label),
      detail: str(data.issue),
    };
  }
  const { data } = await admin
    .from("amc_additional_works")
    .select("id, work_no, status, finding, scheduled_start, scheduled_end, technician_ids, contract_id, contract:amc_contracts!amc_additional_works_contract_id_fkey(contract_number, customer_name, property_label)")
    .eq("id", id)
    .maybeSingle<Row>();
  if (!data) return null;
  const c = one(data.contract);
  return {
    start: String(data.scheduled_start ?? ""),
    end: String(data.scheduled_end ?? ""),
    technicianIds: ids(data.technician_ids),
    status: String(data.status ?? ""),
    contractId: str(data.contract_id),
    ref: `${str(c?.contract_number) ?? "AMC"} · ${String(data.work_no ?? "additional work")}`.trim(),
    visitType: "Additional work",
    client: str(c?.customer_name),
    address: str(c?.property_label),
    detail: str(data.finding),
  };
}

/** The board entries showing this AMC record on any day's current version. */
async function currentEntries(admin: Admin, kind: AmcEntryKind, id: string): Promise<{ rows: Row[]; ready: boolean }> {
  const { data, error } = await admin
    .from("schedule_entries")
    .select("id, schedule_version_id, schedule_versions!inner(schedule_date, is_current)")
    .eq("amc_kind", kind)
    .eq("amc_record_id", id)
    .eq("schedule_versions.is_current", true);
  if (error) return { rows: [], ready: !missing(error) ? true : false };
  return { rows: (data ?? []) as Row[], ready: true };
}

/**
 * Puts one AMC record on the board as it stands now: on its day, at its time,
 * on its crew's rows; or off the board when it has no crew or time, or is
 * cancelled. Never throws: the AMC change has already been saved.
 */
export async function syncAmcScheduleEntry(admin: Admin, kind: AmcEntryKind, id: string, actorId: string | null): Promise<void> {
  try {
    const [job, existing] = await Promise.all([loadJob(admin, kind, id), currentEntries(admin, kind, id)]);
    if (!existing.ready) return; /* not migrated */
    const placed = Boolean(job && job.start && job.end && job.technicianIds.length && Date.parse(job.end) > Date.parse(job.start) && LIVE[kind](job.status));
    const date = placed ? zonedDateString(job!.start, DEFAULT_ORG_TIMEZONE) : null;
    const version = date && actorId ? await findOrCreateDraftVersion(admin as never, date, actorId, DEFAULT_ORG_TIMEZONE).catch(() => null) : null;

    /* Off every other day it was on (moved, or no longer placed). */
    const stale = existing.rows.filter((r) => !version || String(r.schedule_version_id) !== version.version.id).map((r) => String(r.id));
    if (stale.length) await admin.from("schedule_entries").delete().in("id", stale);
    if (!placed || !version || !job) return;

    const minutes = zonedMinutesOfDay(job.start, DEFAULT_ORG_TIMEZONE);
    const row = {
      schedule_version_id: version.version.id,
      entry_type: "free_text",
      shift: minutes >= 18 * 60 || minutes < 6 * 60 ? "night" : "day",
      operating_date: date,
      start_at: job.start,
      end_at: job.end,
      title: `AMC ${job.visitType}: ${job.client ?? job.ref}`,
      client_name: job.client,
      address: job.address,
      notes: [job.ref, job.detail].filter(Boolean).join(" · ") || null,
      origin: "system",
      sync_status: "not_ready",
      needs_sync: false,
      amc_kind: kind,
      amc_record_id: id,
      amc_contract_id: job.contractId,
      amc_visit_type: job.visitType,
      amc_ref: job.ref,
      updated_by: actorId,
    };
    const { data: kept } = await admin
      .from("schedule_entries")
      .select("id")
      .eq("schedule_version_id", version.version.id)
      .eq("amc_kind", kind)
      .eq("amc_record_id", id)
      .maybeSingle<Row>();
    let entryId = kept ? String(kept.id) : null;
    if (entryId) {
      const { error } = await admin.from("schedule_entries").update(row).eq("id", entryId);
      if (error) throw error;
    } else {
      const { data: made, error } = await admin.from("schedule_entries").insert({ ...row, created_by: actorId }).select("id").single<Row>();
      if (error) throw error;
      entryId = String(made.id);
    }
    /* The crew's rows: replaced, so a reassignment moves the entry. */
    await admin.from("schedule_entry_assignments").delete().eq("schedule_entry_id", entryId);
    const { error: assignError } = await admin
      .from("schedule_entry_assignments")
      .insert(job.technicianIds.map((t) => ({ schedule_entry_id: entryId, technician_fsm_id: t })));
    if (assignError) console.warn("[amc:schedule-link] crew not placed on the board:", assignError.message);
  } catch (e) {
    console.error(`[amc:schedule-link] ${kind} ${id} not mirrored on the Scheduling board:`, e instanceof Error ? e.message : e);
  }
}

/**
 * A day on the board brought in step with AMC (opened from the Scheduling
 * board, at most every few minutes): every AMC job with a slot that day is
 * put on it, and an AMC entry whose job moved, lost its crew or was cancelled
 * is taken off. Picks up jobs placed before the link existed. Never throws.
 */
export async function mirrorAmcDay(admin: Admin, date: string, versionId: string, actorId: string | null): Promise<void> {
  try {
    const start = zonedTimeToUtc(date, "00:00:00", DEFAULT_ORG_TIMEZONE).toISOString();
    const end = zonedTimeToUtc(addDaysToDateString(date, 1), "00:00:00", DEFAULT_ORG_TIMEZONE).toISOString();
    const inDay = (table: string) => admin.from(table).select("id").gte("scheduled_start", start).lt("scheduled_start", end).not("technician_ids", "is", null);
    const [visits, calls, works, onBoard] = await Promise.all([
      inDay("amc_visits"),
      inDay("amc_call_outs"),
      inDay("amc_additional_works"),
      admin.from("schedule_entries").select("amc_kind, amc_record_id").eq("schedule_version_id", versionId).not("amc_kind", "is", null),
    ]);
    if (onBoard.error) return; /* not migrated */
    const jobs = new Map<string, { kind: AmcEntryKind; id: string }>();
    const add = (kind: AmcEntryKind, id: unknown) => typeof id === "string" && jobs.set(`${kind}:${id}`, { kind, id });
    for (const r of (visits.data ?? []) as Row[]) add("ppm", r.id);
    for (const r of (calls.data ?? []) as Row[]) add("call_out", r.id);
    for (const r of (works.data ?? []) as Row[]) add("additional_work", r.id);
    for (const r of (onBoard.data ?? []) as Row[]) add(r.amc_kind as AmcEntryKind, r.amc_record_id);
    for (const j of jobs.values()) await syncAmcScheduleEntry(admin, j.kind, j.id, actorId);
  } catch (e) {
    console.error(`[amc:schedule-link] day ${date} not brought in step with AMC:`, e instanceof Error ? e.message : e);
  }
}

/** Several records of one kind (a bulk move or reassignment on the AMC board). */
export async function syncAmcScheduleEntries(admin: Admin, kind: AmcEntryKind, recordIds: readonly string[], actorId: string | null): Promise<void> {
  for (const id of [...new Set(recordIds)]) await syncAmcScheduleEntry(admin, kind, id, actorId);
}

/** The AMC record ids an AMC board or visit request touches, from its body. */
export function touchedIds(body: unknown): string[] {
  const b = (body ?? {}) as Row;
  return [...ids(b.visitIds), ...(str(b.visitId) ? [str(b.visitId)!] : []), ...(str(b.id) ? [str(b.id)!] : [])];
}
