import type { SupabaseClient } from "@supabase/supabase-js";

import { hasJobInspectors } from "@/lib/server/snagging/columns";
import { readAllRows } from "@/lib/server/snagging/read-all";

/**
 * The part of a job the card does not show, for when the job is opened.
 *
 * The job list (/sync/jobs) sends cards: status, dates, the unit's name
 * and the visit state. Everything the job screen adds -- who to call, the
 * unit's size and location, the NOC, the lead inspector, the notes, whether it is
 * locked, when its visits were booked and what each found, and
 * the job it was raised against -- comes here, with the job's contents,
 * from /sync/job/[id]. Same wire keys as the full pull's task, so the app
 * merges it onto the card it already holds.
 */

type Row = Record<string, unknown>;

const DETAIL_COLUMNS = `id, parent_job_id, notes, locked,
  remediation_due_at, appointment_at, inspector_id,
  unit_label, building_name, community, property_type, developer_name,
  bedrooms, built_up_area_sqft, plot_area_sqft, floors, external_areas_in_scope,
  location_lat, location_lng, noc_required, noc_path,
  developer_contact_name, developer_contact_phone,
  client_contact_name, client_contact_phone,
  property_record:property_id(unit_label, building_name, community, property_type,
    developer_name, bedrooms, built_up_area_sqft, plot_area_sqft, floors,
    external_areas_in_scope, location_lat, location_lng, noc_required, noc_path),
  client:client_id(name, email, phone),
  lead:inspector_id(full_name, email)`;

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export async function loadTaskDetail(admin: SupabaseClient, jobId: string) {
  // The job, its visits and what each finished visit found, read together.
  const [{ data, error }, visits, visitSnags, roster] = await Promise.all([
    admin.from("snagging_jobs").select<string, Row>(DETAIL_COLUMNS).eq("id", jobId).maybeSingle(),
    admin
      .from("snagging_job_visits")
      .select("id, visit_number, status, scheduled_date, appointment_at, submitted_at")
      .eq("job_id", jobId)
      .in("status", ["scheduled", "in_progress", "submitted", "completed"])
      .order("visit_number", { ascending: false }),
    readAllRows<{ visit_id: string | null }>(
      (from, to) =>
        admin
          .from("snagging_snags")
          .select("id, visit_id")
          .eq("job_id", jobId)
          .not("visit_id", "is", null)
          .neq("status", "withdrawn")
          .order("id", { ascending: true })
          .range(from, to),
      "visit snag counts",
    ),
    // Everyone on the job, so each inspector can see who they share it with.
    (async () =>
      (await hasJobInspectors(admin))
        ? ((
            await admin
              .from("snagging_job_inspectors")
              .select("inspector_id, inspector:inspector_id(full_name, email)")
              .eq("job_id", jobId)
              .order("created_at", { ascending: true })
          ).data ?? [])
        : [])(),
  ]);
  if (error) throw new Error(error.message);
  if (visits.error) throw new Error(visits.error.message);
  if (!data) return null;

  const snagsOnVisit: Record<string, number> = {};
  for (const snag of visitSnags) {
    if (snag.visit_id) snagsOnVisit[snag.visit_id] = (snagsOnVisit[snag.visit_id] ?? 0) + 1;
  }
  const allVisits = (visits.data ?? []) as Row[];

  /*
    The job's inspectors by name, the one who submits (inspector_id) first.
    Only names: the phone shows who shares the job, and says who submits.
  */
  const nameOf = (person: Row | null) =>
    ((person?.full_name as string | null) || (person?.email as string | null) || null);
  const lead = firstOf(data?.lead as Row | Row[] | null);
  const inspectors: string[] = [];
  const leadName = nameOf(lead);
  if (leadName) inspectors.push(leadName);
  for (const row of roster as Row[]) {
    if (row.inspector_id === data?.inspector_id) continue;
    const name = nameOf(firstOf(row.inspector as Row | Row[] | null));
    if (name && !inspectors.includes(name)) inspectors.push(name);
  }
  // Highest number first, so the first live one is the current pass.
  const live = allVisits.find((v) => v.status === "scheduled" || v.status === "in_progress") ?? null;
  const gstDay = (value: unknown) => {
    if (!value) return null;
    const at = new Date(value as string);
    return Number.isNaN(at.getTime())
      ? null
      : at.toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
  };

  const job = data;
  // BR-1: the property record is canonical, the job's own copy the fallback.
  const record = firstOf(job.property_record as Row | Row[] | null);
  const pick = (key: string) => record?.[key] ?? job[key] ?? null;
  const client = firstOf(job.client as Row | Row[] | null);

  return {
    id: job.id,
    parent_task_id: job.parent_job_id ?? null,
    notes: job.notes ?? null,
    // Open for the length of a live visit (change 28); otherwise the job's own lock.
    locked: live ? false : Boolean(job.locked),
    // When the live visit is booked for, for the job screen's appointment row.
    active_visit_at: (live?.appointment_at as string | null) ?? null,
    // Every finished visit, with when it was booked and what it found.
    finished_visits: allVisits
      .filter((v) => v.status === "submitted" || v.status === "completed")
      .map((v) => ({
        id: v.id,
        number: v.visit_number,
        status: v.status,
        date: gstDay(v.scheduled_date ?? v.appointment_at ?? v.submitted_at),
        appointment_at: (v.appointment_at as string | null) ?? null,
        snag_count: snagsOnVisit[v.id as string] ?? 0,
      })),
    remediation_due_at: job.remediation_due_at ?? null,
    appointment_at: job.appointment_at ?? null,
    lead_inspector_id: job.inspector_id ?? null,
    inspectors,
    property: {
      client_name: (client?.name as string | null) ?? "",
      client_email: client?.email ?? null,
      client_phone: client?.phone ?? null,
      unit_label: pick("unit_label"),
      building_name: pick("building_name"),
      community: pick("community"),
      city: "Dubai",
      property_type: pick("property_type"),
      developer_name: pick("developer_name"),
      bedrooms: pick("bedrooms"),
      built_up_area_sqft: pick("built_up_area_sqft"),
      plot_area_sqft: pick("plot_area_sqft"),
      floors: pick("floors"),
      external_areas_in_scope: pick("external_areas_in_scope"),
      developer_contact_name: job.developer_contact_name ?? null,
      developer_contact_phone: job.developer_contact_phone ?? null,
      client_contact_name: job.client_contact_name ?? null,
      client_contact_phone: job.client_contact_phone ?? null,
      location_lat: pick("location_lat"),
      location_lng: pick("location_lng"),
      noc_required: pick("noc_required"),
      // Whether there is a NOC to open; the file itself is fetched on demand.
      noc_on_file: Boolean(pick("noc_path")),
    },
  };
}
