import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { signMediaPaths } from "@/lib/server/snagging/media";
import { syncPullSchema } from "@/modules/snagging/schemas";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Reference pack + assigned work for the inspector app (FR-1.05, §6.3).
 *
 * The device sends the `server_time` it got from the previous pull and
 * receives everything that changed since. The lean schema merged property,
 * floor plan and the single inspector into `snagging_jobs`; this route
 * still emits the exact wire shape the app already parses (a `property`
 * sub-object, a `team` list, task_id/origin_task_id keys), so the mobile
 * side did not have to change.
 */
type Admin = Awaited<ReturnType<typeof createAdminServerClient>>;

export async function GET(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = syncPullSchema.safeParse({
      since: req.nextUrl.searchParams.get("since") ?? undefined,
      include_catalogue:
        req.nextUrl.searchParams.get("include_catalogue") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { since } = parsed.data;
    const coldStart = !since;

    const admin = await createAdminServerClient();
    const serverTime = new Date().toISOString();

    const empty = {
      server_time: serverTime,
      cold_start: coldStart,
      catalogue: coldStart ? await loadCatalogue(admin) : null,
      tasks: [] as unknown[],
      areas: [] as unknown[],
      snags: [] as unknown[],
      photos: [] as unknown[],
      floor_plans: [] as unknown[],
      verifications: [] as unknown[],
      checklist: [] as unknown[],
    };

    // 1. Which jobs is this inspector on? (single inspector per job now)
    const { data: assigned, error: assignedError } = await admin
      .from("snagging_jobs")
      .select("id")
      .eq("inspector_id", profile.id)
      .in("status", [
        "assigned",
        "in_progress",
        "submitted",
        "in_review",
        "rejected",
        "approved",
        "delivered",
      ]);
    if (assignedError) throw new Error(assignedError.message);

    /*
      An inspector booked onto an additional VISIT gets the job as well
      (BA v2, change 25).

      A visit is an appointment on the job now, and it carries its own
      inspector — which may not be the one who did the original pass.
      Selecting on snagging_jobs.inspector_id alone would hand that
      inspector an empty device on the morning of a trip they are booked
      for.
    */
    const { data: visitJobs, error: visitJobsError } = await admin
      .from("snagging_job_visits")
      .select("job_id, id, visit_number, status, scheduled_date")
      .eq("inspector_id", profile.id)
      .in("status", ["scheduled", "in_progress"]);
    if (visitJobsError) throw new Error(visitJobsError.message);

    const assignedIds = Array.from(
      new Set([
        ...(assigned ?? []).map((r) => r.id as string),
        ...(visitJobs ?? []).map((r) => r.job_id as string),
      ]),
    );
    if (assignedIds.length === 0) return NextResponse.json({ data: empty });

    /*
      The live visit per job, so the handset knows which pass it is on.

      Change 29 turns on this: during a visit the checklist shows only the
      items an earlier pass could not answer. Without it the app has no
      way to tell a return trip from the original inspection, because they
      are now the same job.
    */
    const { data: liveVisits, error: liveVisitError } = await admin
      .from("snagging_job_visits")
      .select("id, job_id, visit_number, review_note, scheduled_date, appointment_at")
      .in("job_id", assignedIds)
      .in("status", ["scheduled", "in_progress"])
      .order("visit_number", { ascending: false });
    if (liveVisitError) throw new Error(liveVisitError.message);

    const activeVisit = new Map<
      string,
      {
        id: string;
        visit_number: number;
        review_note: string | null;
        scheduled_date: string | null;
        appointment_at: string | null;
      }
    >();
    for (const v of liveVisits ?? []) {
      const jobId = v.job_id as string;
      // Ordered highest-first, so the first one seen is the current pass.
      if (!activeVisit.has(jobId)) {
        activeVisit.set(jobId, {
          id: v.id as string,
          visit_number: v.visit_number as number,
          review_note: (v.review_note as string | null) ?? null,
          scheduled_date: (v.scheduled_date as string | null) ?? null,
          appointment_at: (v.appointment_at as string | null) ?? null,
        });
      }
    }

    /*
      The most recent FINISHED visit per job: submitted for review, or
      approved. Once submitted a visit is no longer live, so the phone lost
      it -- the job fell back to being the original approved inspection,
      dated weeks ago, with that round's old send-back note on the card,
      and the inspector could not find the visit they had just submitted.
    */
    const { data: doneVisits, error: doneVisitError } = await admin
      .from("snagging_job_visits")
      .select(
        "id, job_id, visit_number, status, scheduled_date, appointment_at, submitted_at, completed_at, updated_at",
      )
      .in("job_id", assignedIds)
      .in("status", ["submitted", "completed"])
      .order("visit_number", { ascending: false });
    if (doneVisitError) throw new Error(doneVisitError.message);

    const lastVisit = new Map<
      string,
      { visit_number: number; status: string; at: string | null }
    >();
    for (const v of doneVisits ?? []) {
      const jobId = v.job_id as string;
      if (lastVisit.has(jobId)) continue;
      const row = v as Record<string, unknown>;
      lastVisit.set(jobId, {
        visit_number: v.visit_number as number,
        status: v.status as string,
        at:
          (row.submitted_at as string | null) ??
          (row.completed_at as string | null) ??
          (row.updated_at as string | null) ??
          null,
      });
    }

    /*
      Every finished visit per job, newest first, each with its own date,
      appointment and what it found.

      The phone had only the latest one, so a job with Visits 2 and 3
      listed Visit 3 alone under Done, and opening it showed the original
      inspection's appointment -- nothing on the phone said Visit 2 had
      ever happened. Sent whatever else is live on the job: an earlier
      visit stays history while the next one is being worked.
    */
    const doneVisitIds = (doneVisits ?? []).map((v) => v.id as string);
    const visitSnagCount = new Map<string, number>();
    if (doneVisitIds.length > 0) {
      const { data: visitSnags, error: visitSnagError } = await admin
        .from("snagging_snags")
        .select("visit_id")
        .in("visit_id", doneVisitIds)
        .neq("status", "withdrawn");
      if (visitSnagError) throw new Error(visitSnagError.message);
      for (const row of visitSnags ?? []) {
        const key = row.visit_id as string;
        visitSnagCount.set(key, (visitSnagCount.get(key) ?? 0) + 1);
      }
    }
    const gstDay = (value: unknown) => {
      if (!value) return null;
      const at = new Date(value as string);
      return Number.isNaN(at.getTime())
        ? null
        : at.toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
    };
    const finishedVisits = new Map<string, Array<Record<string, unknown>>>();
    for (const v of doneVisits ?? []) {
      const row = v as Record<string, unknown>;
      const list = finishedVisits.get(v.job_id as string) ?? [];
      list.push({
        id: v.id,
        number: v.visit_number,
        status: v.status,
        date: gstDay(
          row.scheduled_date ?? row.appointment_at ?? row.submitted_at,
        ),
        appointment_at: (row.appointment_at as string | null) ?? null,
        submitted_at: (row.submitted_at as string | null) ?? null,
        completed_at: (row.completed_at as string | null) ?? null,
        snag_count: visitSnagCount.get(v.id as string) ?? 0,
      });
      finishedVisits.set(v.job_id as string, list);
    }

    /*
      An additional visit also needs its ORIGINAL inspection on the device.

      The visit exists to cover rooms the first pass could not reach, and
      an inspector walking it needs to see what is already on record —
      otherwise the property reads as having no known defects on a unit
      that has several, and they log the same ones again. The original is
      frequently assigned to somebody else, so it would never arrive.

      Read-only context: the app shows these as "already on record" and
      the sync only ever writes back to the job the inspector is on.
    */
    const { data: parents, error: parentError } = await admin
      .from("snagging_jobs")
      .select("parent_job_id")
      .in("id", assignedIds)
      .eq("visit_type", "additional")
      .not("parent_job_id", "is", null);
    if (parentError) throw new Error(parentError.message);

    const jobIds = [
      ...new Set([
        ...assignedIds,
        ...(parents ?? []).map((row) => row.parent_job_id as string),
      ]),
    ];

    // 2. Jobs -> wire "tasks" (with a property sub-object + team list).
    let jobQuery = admin
      .from("snagging_jobs")
      .select(
        `id, code, status, round_number, visit_type, visit_charge, parent_job_id, scheduled_date, notes,
         locked, rejection_reason, rejection_category, remediation_due_at, updated_at, created_at,
         unit_label, building_name, community, property_type, developer_name,
         appointment_at, bedrooms, built_up_area_sqft, plot_area_sqft, floors,
         external_areas_in_scope, location_lat, location_lng, noc_required,
         developer_contact_name, developer_contact_phone,
         client_contact_name, client_contact_phone,
         property_record:property_id(unit_label, building_name, community, property_type,
           developer_name, bedrooms, built_up_area_sqft, plot_area_sqft, floors,
           external_areas_in_scope, location_lat, location_lng, noc_required),
         client:client_id(name, email, phone),
         inspector:inspector_id(full_name, email)`,
      )
      .in("id", jobIds);

    /*
      A delta is "jobs that changed", and a visit changing is the job
      changing, as far as the phone is concerned.

      This was only the job's own updated_at. Booking a visit, putting an
      inspector on it, the client approving its quotation, a send-back —
      every one of those writes the VISIT row and never touches the job.
      So a phone that had already synced never re-received the job, kept
      it as "approved, nothing to do", and the inspector booked onto the
      visit never saw it in Today.
    */
    if (since) {
      const [
        { data: changedJobs, error: changedError },
        { data: changedVisits, error: visitsError },
      ] = await Promise.all([
        admin
          .from("snagging_jobs")
          .select("id")
          .in("id", jobIds)
          .gt("updated_at", since),
        admin
          .from("snagging_job_visits")
          .select("job_id")
          .in("job_id", jobIds)
          .gt("updated_at", since),
      ]);
      if (changedError) throw new Error(changedError.message);
      if (visitsError) throw new Error(visitsError.message);

      const changedIds = [
        ...new Set([
          ...(changedJobs ?? []).map((row) => row.id as string),
          ...(changedVisits ?? []).map((row) => row.job_id as string),
        ]),
      ];
      // Nothing changed: an id no job has keeps the query shape and returns
      // no rows, rather than an empty IN list PostgREST would reject.
      jobQuery = jobQuery.in(
        "id",
        changedIds.length > 0
          ? changedIds
          : ["00000000-0000-0000-0000-000000000000"],
      );
    }
    const { data: jobs, error: jobError } = await jobQuery;
    if (jobError) throw new Error(jobError.message);

    const tasks = (jobs ?? []).map((job) => {
      const j = job as JobRow;
      const client = firstOf(j.client);
      const insp = firstOf(j.inspector);
      /*
        BR-1 — the property record is canonical and the job carries a
        snapshot for anything raised before the link existed. The portal
        already resolved it this way; the app was reading the snapshot
        only, which is why a unit with a pinned location still reached
        the phone with no coordinates.
      */
      const rec = firstOf(j.property_record) as Record<string, unknown> | null;
      const pick = (key: string) =>
        rec?.[key] ?? (j as unknown as Record<string, unknown>)[key] ?? null;
      const team = [insp?.full_name || insp?.email].filter((n): n is string =>
        Boolean(n),
      );
      const live = activeVisit.get(j.id as string) ?? null;
      // A live visit outranks a finished one: it is the work in hand.
      const last = live ? null : (lastVisit.get(j.id as string) ?? null);
      return {
        id: j.id,
        code: j.code,
        /*
          Null on an ordinary inspection; set while a return visit is
          booked or under way (change 29). The app reads it to decide
          which checklist items to show and to stamp what it captures.
        */
        active_visit_id: live?.id ?? null,
        active_visit_number: live?.visit_number ?? null,
        /*
          Why the manager sent the visit back, when they did. The inspector
          reopens the job to it, so it has to be on the phone, not only on
          the portal page the inspector never sees.
        */
        active_visit_note: live?.review_note ?? null,
        /*
          When the visit is, which is not when the job was. The job's own
          date is the original inspection's, weeks ago, so the phone filed
          a booked return trip under Done with the approved job and the
          inspector booked onto it never saw it in Today.
        */
        // A GST calendar date (YYYY-MM-DD), which is what the phone files
        // and compares by. The visit's scheduled_date is a timestamptz, so
        // it is converted too, not passed through as a timestamp.
        active_visit_date: (() => {
          const when = live?.scheduled_date ?? live?.appointment_at ?? null;
          if (!when) return null;
          const at = new Date(when);
          return Number.isNaN(at.getTime())
            ? null
            : at.toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
        })(),
        active_visit_at: live?.appointment_at ?? null,
        // The latest visit handed in ("submitted") or approved ("completed"),
        // when none is live -- so the phone lists it under Done as that visit.
        last_visit_number: last?.visit_number ?? null,
        last_visit_status: last?.status ?? null,
        last_visit_date: last?.at
          ? new Date(last.at).toLocaleDateString("en-CA", {
              timeZone: "Asia/Dubai",
            })
          : null,
        finished_visits: finishedVisits.get(j.id as string) ?? [],
        task_type: "single_unit",
        status: j.status,
        round_number: j.round_number,
        visit_type: j.visit_type ?? "initial",
        visit_charge: j.visit_charge,
        parent_task_id: j.parent_job_id,
        scheduled_date: j.scheduled_date,
        notes: j.notes,
        /*
          Open for the length of a live visit (change 28).

          The job was locked when the original inspection was submitted,
          and that lock reached the phone during a return trip too — so
          the whole workspace was read-only and the inspector could not
          add a snag on the visit they had travelled for. Each earlier
          snag keeps its own lock, so opening the job does not open the
          approved findings.
        */
        locked: live ? false : j.locked,
        catalogue_version: "v1.0",
        rejection_category: j.rejection_category,
        rejection_reason: j.rejection_reason,
        remediation_due_at: j.remediation_due_at,
        updated_at: j.updated_at,
        // When the job was raised. The device sorts its list on this, so
        // a job never moves just because something about it changed.
        created_at: j.created_at,
        /*
          Everything an inspector needs to find the unit, get into it and
          call someone when they cannot.

          This used to stop at the unit label and the client's name, so
          the app could say which flat but not where it was, who to ring
          at the gate, or how big the place they were about to walk is.
          The columns were already on the job; only the wire shape was
          short.
        */
        property: {
          client_name: client?.name ?? "",
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
          // FR-3.03 — the two people an inspector actually calls: the
          // developer's rep who opens the unit and the client who owns it.
          developer_contact_name: j.developer_contact_name,
          developer_contact_phone: j.developer_contact_phone,
          client_contact_name: j.client_contact_name,
          client_contact_phone: j.client_contact_phone,
          // Where it is, so the app can show a map instead of an address.
          location_lat: pick("location_lat"),
          location_lng: pick("location_lng"),
          noc_required: pick("noc_required"),
        },
        appointment_at: j.appointment_at,
        team,
      };
    });

    // 3. Children. Remap the new column names onto the wire keys the app reads.
    const [areaRows, snagRows, photoRows, checklistRows] = await Promise.all([
      loadChanged(
        admin,
        "snagging_areas",
        `id, job_id, name, catalogue_area_code, sort_order, created_at, status, note,
         confirmed_at, access_state, access_reason, floor_plan_id, pin_x, pin_y, zone,
         started_at, elements_not_checked`,
        "job_id",
        jobIds,
        since,
        "updated_at",
      ),
      loadChanged(
        admin,
        "snagging_snags",
        `id, job_id, area_id, snag_code, catalogue_entry_id, catalogue_code, element_label,
         defect_label, severity, note, floor_plan_id, pin_x, pin_y, status, round_created,
         created_at, locked`,
        "job_id",
        jobIds,
        since,
        "updated_at",
      ),
      // Not the GPS or EXIF: the phone keeps its own for what it shot, and
      // stores neither for a photo it pulls.
      loadChanged(
        admin,
        "snagging_snag_photos",
        `id, snag_id, job_id, storage_path, media_type, bytes, width, height, taken_at,
         round_number, created_at, marker_x, marker_y`,
        "job_id",
        jobIds,
        since,
        "created_at",
      ),
      loadChanged(
        admin,
        "snagging_job_checklist",
        "id, job_id, code, group_name, label, mandatory, status, reason, sort_order, visit_id",
        "job_id",
        jobIds,
        since,
        "updated_at",
      ),
    ]);

    const areas = areaRows.map((a) => ({
      id: a.id,
      task_id: a.job_id,
      name: a.name,
      catalogue_area_code: a.catalogue_area_code,
      sort_order: a.sort_order,
      // The device orders rooms on this, with sort_order as the tie-break.
      created_at: a.created_at ?? null,
      status: a.status,
      note: a.note,
      confirmed_at: a.confirmed_at,
      access_state: a.access_state ?? "accessible",
      access_reason: a.access_reason ?? null,
      // Area pin on a floor plan (FR-3.05/3.07).
      floor_plan_id: a.floor_plan_id ?? null,
      pin_x: a.pin_x ?? null,
      pin_y: a.pin_y ?? null,
      /*
        The room's outline, for tap-to-open on the plan (BA change 6).
        Null on every job drawn before zones existed, so the app falls back
        to the pin — both paths stay live permanently.
      */
      zone: a.zone ?? null,
      // Field inspection (Module 4): area start time + limited-access elements.
      started_at: a.started_at ?? null,
      elements_not_checked: a.elements_not_checked ?? null,
    }));

    const snags = snagRows.map((s) => ({
      id: s.id,
      origin_task_id: s.job_id,
      area_id: s.area_id,
      snag_code: s.snag_code,
      catalogue_entry_id: s.catalogue_entry_id,
      catalogue_code: s.catalogue_code,
      area_code: null,
      element_code: null,
      defect_code: null,
      element_label: s.element_label,
      defect_label: s.defect_label,
      severity: s.severity,
      note: s.note,
      floor_plan_id: s.floor_plan_id ?? null,
      pin_x: s.pin_x,
      pin_y: s.pin_y,
      status: s.status,
      round_created: s.round_created,
      captured_at: s.created_at,
      locked: s.locked,
    }));

    const checklist = checklistRows.map((c) => ({
      id: c.id,
      task_id: c.job_id,
      code: c.code,
      group_name: c.group_name,
      label: c.label,
      mandatory: c.mandatory,
      status: c.status,
      reason: c.reason,
      sort_order: c.sort_order,
      /*
        Which visit gave this answer (BA v2, change 29).

        The column has been on the table since visits became appointments
        and the handset has been stamping it, but it was never sent back
        — so a device that had not seen the job before, or one restored
        from a cold pull, had every answer with no visit against it. The
        report can then no longer say which pass found what, which is the
        only reason the stamp exists.
      */
      visit_id: c.visit_id ?? null,
    }));

    const photos = photoRows.map((p) => ({
      id: p.id as string,
      snag_id: p.snag_id as string,
      task_id: p.job_id,
      storage_path: p.storage_path as string,
      media_type: p.media_type as string,
      bytes: (p.bytes as number | null) ?? null,
      width: (p.width as number | null) ?? null,
      height: (p.height as number | null) ?? null,
      taken_at: p.taken_at as string,
      round_number: (p.round_number as number) ?? 1,
      created_at: (p.created_at as string | null) ?? null,
      // Exact defect spot on the photo (FR-4.06).
      marker_x: (p.marker_x as number | null) ?? null,
      marker_y: (p.marker_y as number | null) ?? null,
    }));

    // Every floor plan for the inspector's jobs, each with its own id so a
    // pinned snag can point at the right floor (G3). Sent in full each pull
    // rather than by delta — plans are few and rarely change, and the app
    // upserts them by id.
    const { data: planData, error: planError } = await admin
      .from("snagging_floor_plans")
      .select("id, job_id, label, storage_path, width, height, sort_order")
      .in("job_id", jobIds)
      .order("created_at", { ascending: true })
      .order("sort_order", { ascending: true });
    if (planError) throw new Error(planError.message);

    const planRows = (planData ?? []).map((p) => ({
      id: p.id,
      task_id: p.job_id,
      label: p.label,
      storage_path: p.storage_path,
      width: p.width,
      height: p.height,
      sort_order: p.sort_order,
    }));

    const [signedPlans, signedPhotos] = await Promise.all([
      signMediaPaths(admin, planRows),
      signMediaPaths(admin, photos),
    ]);

    const catalogueChanged =
      coldStart ||
      parsed.data.include_catalogue === true ||
      (await catalogueChangedSince(admin, since!));

    return NextResponse.json({
      data: {
        server_time: serverTime,
        cold_start: coldStart,
        catalogue: catalogueChanged ? await loadCatalogue(admin) : null,
        tasks,
        areas,
        snags,
        photos: signedPhotos,
        floor_plans: signedPlans,
        verifications: [],
        checklist,
      },
    });
  } catch (error) {
    console.error("Snagging sync pull error:", error);
    return NextResponse.json({ error: "Failed to sync" }, { status: 500 });
  }
}

type Joined =
  | { full_name: string | null; email: string | null }
  | { full_name: string | null; email: string | null }[]
  | null;
type JobRow = {
  id: string;
  code: string;
  status: string;
  round_number: number;
  visit_type: string | null;
  visit_charge: number | null;
  parent_job_id: string | null;
  scheduled_date: string | null;
  notes: string | null;
  locked: boolean;
  rejection_reason: string | null;
  rejection_category: string | null;
  remediation_due_at: string | null;
  updated_at: string;
  created_at: string;
  unit_label: string;
  building_name: string | null;
  community: string | null;
  property_type: string | null;
  developer_name: string | null;
  appointment_at: string | null;
  bedrooms: number | null;
  built_up_area_sqft: number | null;
  plot_area_sqft: number | null;
  floors: number | null;
  external_areas_in_scope: boolean | null;
  location_lat: number | null;
  location_lng: number | null;
  noc_required: boolean | null;
  developer_contact_name: string | null;
  developer_contact_phone: string | null;
  client_contact_name: string | null;
  client_contact_phone: string | null;
  property_record: Record<string, unknown> | Record<string, unknown>[] | null;
  client:
    | { name: string | null; email: string | null; phone: string | null }
    | { name: string | null; email: string | null; phone: string | null }[]
    | null;
  inspector: Joined;
};

function firstOf<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

type ChildRow = Record<string, unknown> & { id: string; job_id: string };

/* `columns` is what the mapping below reads of each table, and no more. */
async function loadChanged(
  admin: Admin,
  table: string,
  columns: string,
  foreignKey: string,
  jobIds: string[],
  since: string | undefined,
  timestampColumn: string,
): Promise<ChildRow[]> {
  let query = admin.from(table).select<string, ChildRow>(columns).in(foreignKey, jobIds);
  if (since) query = query.gt(timestampColumn, since);
  const { data, error } = await query;
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []) as ChildRow[];
}

/**
 * Whether any level of the catalogue has moved since the device last looked.
 *
 * All three are checked, not just defects: renaming a category or retiring
 * a sub-category changes what an inspector may choose just as much as
 * editing a defect does, and a device that only watched the leaves would
 * keep offering a branch that had been withdrawn.
 */
async function catalogueChangedSince(
  admin: Admin,
  since: string,
): Promise<boolean> {
  const tables = [
    "snagging_catalogue_categories",
    "snagging_catalogue_subcategories",
    "snagging_catalogue_defects",
  ];
  for (const table of tables) {
    const { count, error } = await admin
      .from(table)
      .select("id", { count: "exact", head: true })
      .gt("updated_at", since);
    if (error) throw new Error(error.message);
    if ((count ?? 0) > 0) return true;
  }
  return false;
}

/**
 * The full controlled vocabulary, on its three levels (Action Points P1).
 *
 * Areas are no longer part of it. Every category applies in every area
 * (P2), so the {area_code, element_code} matrix the device used to store
 * has nothing left to narrow and is not sent — the app drops its copy in
 * migration 18.
 *
 * Paged, because the library is larger than one PostgREST response: it
 * caps a request at 1,000 rows and the seeded catalogue holds more than
 * that, so a single select would quietly hand the device a short
 * catalogue with no error to notice.
 */
async function loadCatalogue(admin: Admin) {
  async function readAll<T>(table: string, columns: string): Promise<T[]> {
    const size = 1000;
    const rows: T[] = [];
    for (let from = 0; ; from += size) {
      const { data, error } = await admin
        .from(table)
        .select(columns)
        .eq("active", true)
        .order("sort_order", { ascending: true })
        .range(from, from + size - 1);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as T[];
      rows.push(...page);
      if (page.length < size) return rows;
    }
  }

  const [categories, subcategories, defects] = await Promise.all([
    readAll(
      "snagging_catalogue_categories",
      "id, code, label, sort_order, active",
    ),
    readAll(
      "snagging_catalogue_subcategories",
      "id, category_id, code, label, sort_order, active",
    ),
    readAll(
      "snagging_catalogue_defects",
      "id, subcategory_id, code, label, default_severity, guidance, sort_order, active",
    ),
  ]);

  return { categories, subcategories, defects };
}
