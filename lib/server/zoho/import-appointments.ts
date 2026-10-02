// FR-4: bring appointments that already exist in Zoho FSM onto the board.
//
// The team books work in FSM directly (AMC visits, jobs dispatched by someone
// else). Those appointments used to be invisible here, so the board only ever
// showed what the portal itself had added. This imports them into the day's
// draft as ordinary entries, which is what makes them editable and syncable
// per FRD 8.4: they carry needs_sync = false, so approval leaves them alone
// unless a scheduler actually changes their time or technicians.
//
// Everything here works in the ORG's timezone (settings.org_timezone), never
// the server's. A deployed server usually runs on UTC, which would otherwise
// shift the day's window and the shift split by the Gulf offset.

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { resolveAppointmentState } from "@/lib/scheduling/appointment-status";
import { fsmFetch, fsmGetRecord, getFsmAccessToken } from "./fsm-client";
import { DEFAULT_ORG_TIMEZONE, zoneOffsetMinutes, zonedTimeToUtc } from "@/lib/scheduling/org-time";
import { configuredWindows, entryRange, homeShift } from "@/lib/scheduling/board-layout";

type Admin = Awaited<ReturnType<typeof createAdminServerClient>>;

// One day rarely has more than a few hundred appointments; this bounds the
// cost of a busy day (FRD 6: loading a date must stay responsive).
const MAX_PAGES = 5;
const PER_PAGE = 200;
// How many full appointment records to read from FSM at once.
const FSM_READ_CONCURRENCY = 8;
// FSM does not read the timestamps of a date search as the instants they
// are. It turns them into a wall clock in ITS OWN timezone (US Pacific on this
// account) and compares that with the appointment's wall clock in the org's.
// Measured on 29 Sep 2026: asking for 00:00 - 23:59 Gulf on the 29th returned
// 13:00 on the 28th to 12:59 on the 29th, eleven hours early. Every afternoon
// appointment was filed under the NEXT day and was missing from its own.
//
// The offset moves with daylight saving and is FSM's to change, so it is not
// corrected for. The search asks for a window wide enough to contain the day
// whatever the offset, and the day is cut out of the result by each
// appointment's own start time, which carries its offset and can be trusted.
const SEARCH_PAD_HOURS = 36;
const HOUR_MS = 60 * 60 * 1000;

type FsmAppointment = {
  id: string;
  Name?: string | null;
  Status?: string | null;
  Summary?: string | null;
  Type?: string | null;
  Schedule_Type?: string | null;
  Modified_Time?: string | null;
  Scheduled_Start_Date_Time?: string | null;
  Scheduled_End_Date_Time?: string | null;
  Work_Order?: { id?: string; name?: string } | null;
  Company?: { name?: string } | null;
  Contact?: { name?: string } | null;
  Service_Address?: Record<string, unknown> | null;
  Lead?: { id?: string; name?: string } | null;
  // FSM returns the assigned technicians under a $-prefixed key.
  $Service_Resources?: Array<{ id?: string; name?: string }> | null;
  Service_Resources?: Array<{ id?: string; name?: string }> | null;
};

type ShiftConfig = {
  org_timezone?: string | null;
  night_shift_start: string;
  night_shift_end: string;
  day_shift_start: string;
  day_shift_end: string;
};

// The technicians on an appointment: the lead first, then the rest of the
// crew. FSM lists the crew under $Service_Resources on the FULL record; the
// plain Service_Resources field comes back empty, and a search result carries
// neither -- only Lead. Importing from a search result alone therefore put
// every appointment on its lead technician only (AP-3863, 26 Sep 2026).
export function crewOf(appointment: {
  Lead?: { id?: string } | null;
  $Service_Resources?: Array<{ id?: string }> | null;
  Service_Resources?: Array<{ id?: string }> | null;
}): string[] {
  const ids = [
    appointment.Lead?.id,
    ...(appointment.$Service_Resources ?? []).map((r) => r.id),
    ...(appointment.Service_Resources ?? []).map((r) => r.id),
  ].filter((id): id is string => Boolean(id));
  return [...new Set(ids)];
}

// The names FSM has on an appointment, for saying who is missing from the
// portal's technician list.
function crewNamesOf(appointment: {
  Lead?: { id?: string; name?: string } | null;
  $Service_Resources?: Array<{ id?: string; name?: string }> | null;
  Service_Resources?: Array<{ id?: string; name?: string }> | null;
}): string[] {
  const names = [
    appointment.Lead?.name,
    ...(appointment.$Service_Resources ?? []).map((r) => r.name),
    ...(appointment.Service_Resources ?? []).map((r) => r.name),
  ].filter((name): name is string => Boolean(name));
  return [...new Set(names)];
}

// An appointment FSM has for the date that the board has no row for.
export type UnplacedAppointment = {
  id: string;
  name: string | null;
  workOrderId: string | null;
  workOrderName: string | null;
  status: string | null;
  startAt: string | null;
  endAt: string | null;
  reason: "no_technician" | "not_in_technician_list";
  technicians: string[];
};

// Why appointments were left out, so an empty board can explain itself.
export type ImportSkipReasons = {
  alreadyOnBoard: number;
  cancelled: number;
  noWorkOrder: number;
  noTimes: number;
  noKnownTechnician: number;
};

export type ImportResult = {
  imported: number;
  // Entries taken off this day's list because they are not on this day.
  movedOff?: number;
  skipped: number;
  scanned: number;
  reasons: ImportSkipReasons;
  // Resource ids FSM gave that the portal roster does not know.
  unknownResourceIds?: string[];
  // Appointments with nobody assigned, or nobody the portal knows. They used
  // to be dropped silently, which read as "the portal lost my appointment".
  unplaced?: UnplacedAppointment[];
  error?: string;
};

// The shift an appointment is filed under: the one that covers most of it,
// which is the board's own rule (lib/scheduling/board-layout.ts). Filing by
// start time alone put a 05:00 - 17:00 job under Night (AP-3869).
function shiftFor(
  startIso: string,
  endIso: string,
  date: string,
  config: ShiftConfig,
  timeZone: string,
): "day" | "night" {
  return homeShift(entryRange({ start_at: startIso, end_at: endIso }, date, timeZone), configuredWindows(config));
}

function addressText(addr?: Record<string, unknown> | null): string {
  if (!addr) return "";
  return Object.entries(addr)
    .filter(([k]) => /street|city|state|country|zip/i.test(k))
    .map(([, v]) => (typeof v === "string" ? v : ""))
    .filter(Boolean)
    .join(" ");
}

// FSM's datetime pattern is YYYY-MM-DDThh:mm:ssTZD -- no milliseconds, which
// toISOString() always adds. It also rejects the value when the colons and
// comma are percent-encoded, so the query is built by hand.
function utcStamp(at: Date) {
  return at.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// The same instant written with an explicit offset (2026-09-18T00:00:00+04:00).
// The "+" has to be percent-encoded or a query string reads it as a space.
function offsetStamp(at: Date, offsetMinutes: number) {
  const shifted = new Date(at.getTime() + offsetMinutes * 60_000);
  const base = shifted.toISOString().replace(/\.\d{3}Z$/, "");
  const sign = offsetMinutes >= 0 ? "%2B" : "-";
  const abs = Math.abs(offsetMinutes);
  return `${base}${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

// Every appointment whose scheduled start falls inside the window. FSM's list
// endpoint can't filter by date (it only pages, newest-created first), so this
// uses the search endpoint's `between` comparator on Scheduled_Start_Date_Time.
async function fetchAppointmentsBetween(token: string, from: Date, to: Date, offsetMinutes: number) {
  // Zoho's accepted spelling differs between tenants, so try UTC first and
  // fall back to the explicit offset rather than failing the whole import.
  const formats = [
    { label: "utc", from: utcStamp(from), to: utcStamp(to) },
    { label: "offset", from: offsetStamp(from, offsetMinutes), to: offsetStamp(to, offsetMinutes) },
  ];

  let lastError = "Zoho FSM rejected the appointment search";
  for (const format of formats) {
    const rows: FsmAppointment[] = [];
    let rejected = false;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const path =
        `/Service_Appointments/search?api_name=Scheduled_Start_Date_Time` +
        `&value=${format.from},${format.to}&comparator=between&per_page=${PER_PAGE}&page=${page}`;
      const res = await fsmFetch(token, path);
      // 204 is FSM's "no matching records".
      if (res.status === 204) {
        return { rows, note: `no records in the window (${format.label} timestamps)` };
      }
      if (!res.ok) {
        lastError = typeof res.json?.message === "string" ? res.json.message : lastError;
        rejected = true;
        break;
      }
      const data: FsmAppointment[] = res.json?.data ?? [];
      rows.push(...data);
      if (!res.json?.info?.more_records) break;
    }
    if (!rejected) return { rows, note: `${format.label} timestamps` };
  }
  throw new Error(lastError);
}

// The day's unplaced appointments are kept as an audit event, written only
// when the list changes. The day route reads the latest one, so the board can
// say why an appointment is missing on every load, not just on the load that
// happened to re-read FSM.
const UNPLACED_EVENT = "fsm_appointments_not_placed";

function unplacedSignature(list: UnplacedAppointment[]) {
  return list
    .map((a) => `${a.id}:${a.reason}:${a.startAt ?? ""}:${a.endAt ?? ""}:${a.status ?? ""}`)
    .sort()
    .join("|");
}

export async function readUnplacedAppointments(admin: Admin, versionId: string): Promise<UnplacedAppointment[]> {
  const { data, error } = await admin
    .from("schedule_audit_events")
    .select("after_value")
    .eq("schedule_version_id", versionId)
    .eq("event_type", UNPLACED_EVENT)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return [];
  const list = (data.after_value as { appointments?: UnplacedAppointment[] } | null)?.appointments;
  return Array.isArray(list) ? list : [];
}

async function rememberUnplaced(
  admin: Admin,
  input: { date: string; versionId: string },
  unplaced: UnplacedAppointment[],
) {
  try {
    const previous = await readUnplacedAppointments(admin, input.versionId);
    if (unplacedSignature(previous) === unplacedSignature(unplaced)) return;
    await admin.from("schedule_audit_events").insert({
      event_type: UNPLACED_EVENT,
      origin: "fsm",
      schedule_version_id: input.versionId,
      schedule_date: input.date,
      after_value: { count: unplaced.length, appointments: unplaced },
    });
  } catch (error) {
    // A note for the board; never a reason to fail the import.
    console.error("[zoho:rememberUnplaced]", error);
  }
}

/**
 * Import the selected day's FSM appointments into its schedule version.
 *
 * Only appointments missing from the version are added, so it is safe to run
 * again (Refresh does). Cancelled appointments, appointments with no work
 * order, and appointments whose technicians aren't in the portal roster are
 * skipped -- there is no row to place those on.
 */
export async function importFsmAppointmentsForDay(
  admin: Admin,
  input: { date: string; versionId: string },
): Promise<ImportResult> {
  const skips: ImportSkipReasons = {
    alreadyOnBoard: 0,
    cancelled: 0,
    noWorkOrder: 0,
    noTimes: 0,
    noKnownTechnician: 0,
  };
  const empty: ImportResult = { imported: 0, skipped: 0, scanned: 0, reasons: skips };
  try {
    const token = await getFsmAccessToken(admin);

    const { data: config } = await admin
      .from("settings")
      .select("org_timezone, night_shift_start, night_shift_end, day_shift_start, day_shift_end")
      .eq("id", 1)
      .single();
    if (!config) return { ...empty, error: "Scheduling shift configuration is missing" };
    const timeZone = (config as ShiftConfig).org_timezone || DEFAULT_ORG_TIMEZONE;

    // The day as the ORG sees it.
    const from = zonedTimeToUtc(input.date, "00:00:00", timeZone);
    const dayStartMs = from.getTime();
    const dayEndMs = zonedTimeToUtc(input.date, "23:59:59", timeZone).getTime() + 1000;
    const offsetMinutes = zoneOffsetMinutes(from, timeZone);
    const { rows: found } = await fetchAppointmentsBetween(
      token,
      new Date(dayStartMs - SEARCH_PAD_HOURS * HOUR_MS),
      new Date(dayEndMs + SEARCH_PAD_HOURS * HOUR_MS),
      offsetMinutes,
    );
    // Only what truly starts on the day (see SEARCH_PAD_HOURS).
    const appointments = found.filter((a) => {
      const startMs = a.Scheduled_Start_Date_Time ? Date.parse(a.Scheduled_Start_Date_Time) : NaN;
      return Number.isFinite(startMs) && startMs >= dayStartMs && startMs < dayEndMs;
    });

    const { data: existing } = await admin
      .from("schedule_entries")
      .select("id, fsm_appointment_id, fsm_appointment_name, start_at, end_at, origin, needs_sync")
      .eq("schedule_version_id", input.versionId)
      .not("fsm_appointment_id", "is", null);

    // Entries on this day's list that are not on this day at all: filed here
    // by the old search window, or moved to another date in FSM since. They
    // are FSM's appointments and nobody has edited them here, so the list is
    // simply put right; each is picked up by the day it is really on. An entry
    // created in the portal, or holding an edit that is not approved yet, is
    // left alone and flagged on the board instead.
    const misfiled = (existing ?? []).filter(
      (e) =>
        e.origin === "fsm" &&
        e.needs_sync !== true &&
        (Date.parse(e.end_at as string) <= dayStartMs || Date.parse(e.start_at as string) >= dayEndMs),
    );
    if (misfiled.length > 0) {
      const { error: removeError } = await admin
        .from("schedule_entries")
        .delete()
        .in(
          "id",
          misfiled.map((e) => e.id as string),
        );
      if (removeError) {
        console.error("[zoho:importFsmAppointmentsForDay] could not take off-day entries off the list:", removeError.message);
      } else {
        await admin.from("schedule_audit_events").insert({
          event_type: "fsm_entries_moved_to_their_own_day",
          origin: "fsm",
          schedule_version_id: input.versionId,
          schedule_date: input.date,
          before_value: {
            entries: misfiled.map((e) => ({
              appointment: e.fsm_appointment_name,
              fsm_appointment_id: e.fsm_appointment_id,
              start_at: e.start_at,
              end_at: e.end_at,
            })),
          },
        });
      }
    }
    const removedIds = new Set(misfiled.map((e) => e.id as string));
    const alreadyOnBoard = new Set(
      (existing ?? []).filter((e) => !removedIds.has(e.id as string)).map((e) => e.fsm_appointment_id as string),
    );

    const { data: technicians } = await admin
      .from("technician_reference")
      .select("fsm_resource_id")
      .eq("is_active", true);
    const knownTechnicians = new Set((technicians ?? []).map((t) => t.fsm_resource_id as string));

    // Read the full record of every appointment we may add, for its crew.
    const candidates = appointments.filter(
      (a) => !alreadyOnBoard.has(a.id) && resolveAppointmentState(a.Status) !== "cancelled",
    );
    const crewByAppointment = new Map<string, string[]>();
    const crewNamesByAppointment = new Map<string, string[]>();
    for (let i = 0; i < candidates.length; i += FSM_READ_CONCURRENCY) {
      await Promise.all(
        candidates.slice(i, i + FSM_READ_CONCURRENCY).map(async (a) => {
          const full = await fsmGetRecord<FsmAppointment>(token, "Service_Appointments", a.id);
          if (full.ok && full.record) {
            crewByAppointment.set(a.id, crewOf(full.record));
            crewNamesByAppointment.set(a.id, crewNamesOf(full.record));
          }
        }),
      );
    }
    const now = new Date().toISOString();
    const rows: Record<string, unknown>[] = [];
    const assignmentsByAppointment = new Map<string, string[]>();
    const unknownResourceIds = new Set<string>();
    const unplaced: UnplacedAppointment[] = [];

    for (const appointment of appointments) {
      const workOrderId = appointment.Work_Order?.id;
      const startAt = appointment.Scheduled_Start_Date_Time;
      const endAt = appointment.Scheduled_End_Date_Time;
      const resources = crewByAppointment.get(appointment.id) ?? crewOf(appointment);
      const technicianIds = [...new Set(resources.filter((resourceId) => knownTechnicians.has(resourceId)))];

      if (alreadyOnBoard.has(appointment.id)) {
        skips.alreadyOnBoard += 1;
        continue;
      }
      if (resolveAppointmentState(appointment.Status) === "cancelled") {
        skips.cancelled += 1;
        continue;
      }
      if (!workOrderId) {
        skips.noWorkOrder += 1;
        continue;
      }
      if (!startAt || !endAt) {
        skips.noTimes += 1;
        continue;
      }
      if (technicianIds.length === 0) {
        skips.noKnownTechnician += 1;
        resources.forEach((resourceId) => unknownResourceIds.add(resourceId));
        unplaced.push({
          id: appointment.id,
          name: appointment.Name ?? null,
          workOrderId,
          workOrderName: appointment.Work_Order?.name ?? null,
          status: appointment.Status ?? null,
          startAt,
          endAt,
          reason: resources.length === 0 ? "no_technician" : "not_in_technician_list",
          technicians: crewNamesByAppointment.get(appointment.id) ?? crewNamesOf(appointment),
        });
        continue;
      }

      // The table requires end > start; an FSM All-Day record can share both.
      const start = new Date(startAt);
      const end = new Date(endAt);
      const safeEnd = end.getTime() > start.getTime() ? end : new Date(start.getTime() + 30 * 60 * 1000);

      assignmentsByAppointment.set(appointment.id, technicianIds);
      rows.push({
        schedule_version_id: input.versionId,
        entry_type: "existing_appointment",
        shift: shiftFor(start.toISOString(), safeEnd.toISOString(), input.date, config as ShiftConfig, timeZone),
        operating_date: input.date,
        start_at: start.toISOString(),
        end_at: safeEnd.toISOString(),
        fsm_work_order_id: workOrderId,
        fsm_work_order_name: appointment.Work_Order?.name ?? null,
        fsm_appointment_id: appointment.id,
        fsm_appointment_name: appointment.Name ?? null,
        fsm_appointment_type: appointment.Type ?? null,
        fsm_schedule_type: appointment.Schedule_Type === "All Day" ? "All Day" : "Time-bound",
        fsm_last_modified_marker: appointment.Modified_Time ?? null,
        fsm_status: appointment.Status ?? null,
        fsm_status_checked_at: now,
        title: appointment.Summary ?? null,
        client_name: appointment.Company?.name ?? null,
        contact_name: appointment.Contact?.name ?? null,
        address: addressText(appointment.Service_Address) || null,
        origin: "fsm",
        sync_status: "synced",
        // Already in FSM and untouched here, so approval must leave it alone
        // until someone edits it on the board.
        needs_sync: false,
      });
    }

    const skipped = Object.values(skips).reduce((a, b) => a + b, 0);


    unplaced.sort((a, b) => (a.startAt ?? "").localeCompare(b.startAt ?? ""));
    await rememberUnplaced(admin, input, unplaced);

    if (rows.length === 0) {
      return {
        imported: 0,
        skipped,
        scanned: appointments.length,
        reasons: skips,
        unknownResourceIds: [...unknownResourceIds].slice(0, 5),
        unplaced,
        movedOff: misfiled.length,
      };
    }

    const { data: inserted, error: insertError } = await admin
      .from("schedule_entries")
      .insert(rows)
      .select("id, fsm_appointment_id");
    if (insertError) {
      // PGRST204: the API schema has no such column -- the seniors' fsm_status
      // migration is missing from this database (or its cache is stale).
      const missingStatusColumns = /fsm_status/.test(insertError.message) && /schema cache/.test(insertError.message);
      throw new Error(
        missingStatusColumns
          ? `Found ${rows.length} appointment${rows.length === 1 ? "" : "s"} in FSM, but the database has no fsm_status column to save them into. Apply migration 20260828090000_add_fsm_status_to_schedule_entries.sql (or run NOTIFY pgrst, 'reload schema' if it was just applied).`
          : insertError.message,
      );
    }

    const assignmentRows = (inserted ?? []).flatMap((entry) =>
      (assignmentsByAppointment.get(entry.fsm_appointment_id as string) ?? []).map((technicianFsmId) => ({
        schedule_entry_id: entry.id,
        technician_fsm_id: technicianFsmId,
      })),
    );
    if (assignmentRows.length > 0) {
      const { error: assignError } = await admin.from("schedule_entry_assignments").insert(assignmentRows);
      if (assignError) throw new Error(assignError.message);
    }

    await admin.from("schedule_audit_events").insert({
      event_type: "fsm_appointments_imported",
      origin: "fsm",
      schedule_version_id: input.versionId,
      schedule_date: input.date,
      after_value: {
        imported: inserted?.length ?? 0,
        skipped,
        scanned: appointments.length,
        appointments: (inserted ?? []).map((e) => e.fsm_appointment_id),
      },
    });

    return {
      imported: inserted?.length ?? 0,
      skipped,
      scanned: appointments.length,
      reasons: skips,
      unknownResourceIds: [...unknownResourceIds].slice(0, 5),
      unplaced,
      movedOff: misfiled.length,
    };
  } catch (error) {
    // Never block loading a day because FSM is unreachable or slow.
    console.error("[zoho:importFsmAppointmentsForDay]", error);
    return { ...empty, error: error instanceof Error ? error.message : "Failed to import FSM appointments" };
  }
}
