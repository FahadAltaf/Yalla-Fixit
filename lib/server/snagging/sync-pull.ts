import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { hasAreaInspector } from "@/lib/server/snagging/columns";
import { loadSyncChildren } from "@/lib/server/snagging/sync-children";
import { readAllRows } from "@/lib/server/snagging/read-all";
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

/** The columns a job card is built from (view=list). */
const CARD_COLUMNS = `id, code, status, round_number, visit_type, scheduled_date,
  rejection_reason, created_at, unit_label, building_name, community,
  property_record:property_id(unit_label, building_name, community)`;

/** The statuses a job is still the inspector's to see on the handset. */
const WORKABLE_JOB_STATUSES = [
  "assigned",
  "in_progress",
  "submitted",
  "in_review",
  "rejected",
  "approved",
  "delivered",
] as const;

/*
  The statuses in which a job is still being worked on the handset, so its
  contents belong on the phone before the inspector opens it. Submitted,
  in review, approved and delivered jobs are finished as far as the phone
  is concerned -- unless a visit is live on them, which makes them work
  again (see activeIds below).
*/
const ACTIVE_JOB_STATUSES = new Set(["assigned", "in_progress", "rejected"]);

/**
 * The read side of the inspector sync, behind three routes:
 *   /api/snagging/sync/jobs       -- job cards (view=list)
 *   /api/snagging/sync/catalogue  -- the defect catalogue (view=catalogue)
 *   /api/snagging/sync/pull       -- everything, for older app builds
 * `forced` pins the parameters a route stands for; the rest come from the
 * query string. A job's contents are /api/snagging/sync/job/[id].
 */
export async function handleSyncPull(
  req: NextRequest,
  forced: Record<string, string> = {},
) {
  const param = (key: string) =>
    forced[key] ?? req.nextUrl.searchParams.get(key) ?? undefined;
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = syncPullSchema.safeParse({
      since: param("since"),
      include_catalogue: param("include_catalogue"),
      catalogue_since: param("catalogue_since"),
      slim: param("slim"),
      scope: param("scope"),
      view: param("view"),
      list: param("list"),
      limit: param("limit"),
      before: param("before"),
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { since } = parsed.data;
    const coldStart = !since;
    /*
      First paint: jobs and rooms only. What makes a cold pull long is
      everything a job CONTAINS -- its defects, the photos and plans signed
      one by one, the catalogue -- and none of that is on the job list. A
      handset with nothing on it asks for this first, paints the day, and
      runs the full pull behind it.
    */
    const slim = parsed.data.slim === true;
    /*
      The scoped snapshot (the app opts in): full contents for the jobs
      still being worked, rooms only for the finished ones. Only on a pull
      without a cursor -- a delta is already just what changed.
    */
    const scoped = !since && !slim && parsed.data.scope === "active";
    /*
      The job list: cards only (see the schema). `listKind` picks the tab
      on a pull without a cursor; a delta sends every changed job whichever
      tab it is on, so a job moving from Today to Done is heard about.
    */
    const listView = parsed.data.view === "list";
    const listKind = parsed.data.list ?? "active";
    const pageSize = parsed.data.limit ?? 30;

    const admin = await createAdminServerClient();
    const serverTime = new Date().toISOString();

    /*
      The capture sheet's catalogue, on its own: asked for when a job is
      opened, sent only when the device has none or it changed since the
      device last received it. No jobs are read at all.
    */
    if (parsed.data.view === "catalogue") {
      const catalogueSince = parsed.data.catalogue_since;
      const wanted =
        parsed.data.include_catalogue === true ||
        !catalogueSince ||
        (await catalogueChangedSince(admin, catalogueSince));
      /*
        Every row the catalogue sends is active (inactive ones are never
        read), so the flag is dropped here -- a thousand "active": true
        for nothing. The app treats a row without it as active. The full
        pull keeps it: builds before this route store it as sent.
      */
      const catalogue = wanted ? await loadCatalogue(admin) : null;
      const bare = <T extends { active?: boolean }>(rows: T[]) =>
        rows.map(({ active: _active, ...row }) => {
          void _active;
          return row;
        });
      return NextResponse.json({
        data: {
          server_time: serverTime,
          catalogue: catalogue
            ? {
                categories: bare(catalogue.categories as Array<{ active?: boolean }>),
                subcategories: bare(catalogue.subcategories as Array<{ active?: boolean }>),
                defects: bare(catalogue.defects as Array<{ active?: boolean }>),
              }
            : null,
        },
      });
    }

    /*
      The catalogue: decided once and read alongside everything else.

      It used to be loaded twice on a cold start -- once for the empty
      response below (then thrown away when the inspector had jobs) and
      again at the end. A pull without `since` sent it whole every time,
      which included the reconciling snapshot every ten minutes and the
      first pull after any app update. Now it goes when the device asks
      (it has none), when it changed since the cursor, or -- on a pull
      without a cursor -- when it changed since `catalogue_since`, the last
      time the device received it.
    */
    const cataloguePromise = started(
      (async () => {
        const catalogueSince = since ?? parsed.data.catalogue_since;
        const wanted =
          !slim &&
          !listView &&
          (parsed.data.include_catalogue === true ||
            (catalogueSince
              ? await catalogueChangedSince(admin, catalogueSince)
              : true));
        return wanted ? loadCatalogue(admin) : null;
      })(),
    );

    const empty = {
      server_time: serverTime,
      cold_start: coldStart,
      catalogue: null as Awaited<typeof cataloguePromise>,
      tasks: [] as unknown[],
      areas: [] as unknown[],
      snags: [] as unknown[],
      photos: [] as unknown[],
      floor_plans: [] as unknown[],
      verifications: [] as unknown[],
      checklist: [] as unknown[],
    };

    // 1. Which jobs is this inspector on? (lead, a visit, or a room)
    const assignedQuery = admin
      .from("snagging_jobs")
      .select("id, status, parent_job_id")
      .eq("inspector_id", profile.id)
      .in("status", WORKABLE_JOB_STATUSES);

    /*
      An inspector booked onto an additional VISIT gets the job as well
      (BA v2, change 25).

      A visit is an appointment on the job now, and it carries its own
      inspector — which may not be the one who did the original pass.
      Selecting on snagging_jobs.inspector_id alone would hand that
      inspector an empty device on the morning of a trip they are booked
      for.
    */
    const visitJobsQuery = admin
      .from("snagging_job_visits")
      .select("job_id")
      .eq("inspector_id", profile.id)
      .in("status", ["scheduled", "in_progress"]);

    /*
      Several inspectors on one job (point 6): an inspector given only
      some of the rooms still gets the job, in the same statuses the lead
      inspector would.

      One query, and it runs WITH the two above rather than after them:
      the room's job is joined and filtered in the database (!inner), which
      is what the two extra round trips here used to do. On the first pull
      of the day those two were the first thing every handset waited on.
    */
    const roomJobsQuery = (await hasAreaInspector(admin))
      ? admin
          .from("snagging_areas")
          .select("job_id, job:job_id!inner(id, status)")
          .eq("inspector_id", profile.id)
          .in("job.status", WORKABLE_JOB_STATUSES)
      : Promise.resolve({
          data: [] as Array<{ job_id: string; job: unknown }>,
          error: null,
        });

    // None depends on the others, so all three go together.
    const [
      { data: assigned, error: assignedError },
      { data: visitJobs, error: visitJobsError },
      { data: roomRows, error: roomError },
    ] = await Promise.all([assignedQuery, visitJobsQuery, roomJobsQuery]);
    if (assignedError) throw new Error(assignedError.message);
    if (visitJobsError) throw new Error(visitJobsError.message);
    if (roomError) throw new Error(roomError.message);
    const roomJobIds = [...new Set((roomRows ?? []).map((r) => r.job_id as string))];

    const assignedIds = Array.from(
      new Set([
        ...(assigned ?? []).map((r) => r.id as string),
        ...(visitJobs ?? []).map((r) => r.job_id as string),
        ...roomJobIds,
      ]),
    );
    if (assignedIds.length === 0) {
      return NextResponse.json({
        data: { ...empty, catalogue: await cataloguePromise },
      });
    }

    /*
      The live visit per job, so the handset knows which pass it is on.

      Change 29 turns on this: during a visit the checklist shows only the
      items an earlier pass could not answer. Without it the app has no
      way to tell a return trip from the original inspection, because they
      are now the same job.
    */
    const liveVisitsQuery = admin
      .from("snagging_job_visits")
      .select("id, job_id, visit_number, review_note, scheduled_date, appointment_at")
      .in("job_id", assignedIds)
      .in("status", ["scheduled", "in_progress"])
      .order("visit_number", { ascending: false });

    /*
      The most recent FINISHED visit per job: submitted for review, or
      approved. Once submitted a visit is no longer live, so the phone lost
      it -- the job fell back to being the original approved inspection,
      dated weeks ago, with that round's old send-back note on the card,
      and the inspector could not find the visit they had just submitted.
    */
    const doneVisitsQuery = admin
      .from("snagging_job_visits")
      .select(
        "id, job_id, visit_number, status, scheduled_date, appointment_at, submitted_at, completed_at, updated_at",
      )
      .in("job_id", assignedIds)
      .in("status", ["submitted", "completed"])
      .order("visit_number", { ascending: false });

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
    const parentsQuery = admin
      .from("snagging_jobs")
      .select("id, parent_job_id")
      .in("id", assignedIds)
      .eq("visit_type", "additional")
      .not("parent_job_id", "is", null);

    // All three hang off the assigned jobs only, so they run together.
    const [
      { data: liveVisits, error: liveVisitError },
      { data: doneVisits, error: doneVisitError },
      { data: parents, error: parentError },
    ] = await Promise.all([liveVisitsQuery, doneVisitsQuery, parentsQuery]);
    if (liveVisitError) throw new Error(liveVisitError.message);
    if (doneVisitError) throw new Error(doneVisitError.message);
    if (parentError) throw new Error(parentError.message);

    const jobIds = [
      ...new Set([
        ...assignedIds,
        ...(parents ?? []).map((row) => row.parent_job_id as string),
      ]),
    ];

    /*
      The jobs whose contents a scoped snapshot sends in full: still being
      worked, or with a visit live on them, plus the original of each such
      job (what the visit shows as already on record). Null when every job
      is sent in full.
    */
    const activeSet = (() => {
          const statusOf = new Map<string, string>();
          for (const row of assigned ?? []) {
            statusOf.set(row.id as string, row.status as string);
          }
          for (const row of roomRows ?? []) {
            const job = firstOf(row.job as { status?: string } | { status?: string }[] | null);
            if (job?.status) statusOf.set(row.job_id as string, job.status);
          }
          const active = new Set<string>();
          for (const id of assignedIds) {
            if (ACTIVE_JOB_STATUSES.has(statusOf.get(id) ?? "")) active.add(id);
          }
          for (const v of visitJobs ?? []) active.add(v.job_id as string);
          for (const v of liveVisits ?? []) active.add(v.job_id as string);
          return active;
        })();
    const activeIds = scoped
      ? (() => {
          const active = new Set(activeSet);
          // The original of each: a round or visit shows it as already on record.
          for (const row of assigned ?? []) {
            if (active.has(row.id as string) && row.parent_job_id) {
              active.add(row.parent_job_id as string);
            }
          }
          for (const p of parents ?? []) {
            if (active.has(p.id as string)) active.add(p.parent_job_id as string);
          }
          // Never a job this pull does not already hand the inspector.
          const sent = new Set(jobIds);
          return [...active].filter((id) => sent.has(id));
        })()
      : null;

    /*
      Everything below needs only the job ids, so it is all started now and
      awaited where it is used: the per-visit snag counts, which jobs
      changed, the four child tables and the floor plans.
    */
    const doneVisitIds = (doneVisits ?? []).map((v) => v.id as string);
    // Per-visit snag counts are for the job screen, so a card pull skips them.
    const visitSnagsPromise = started(
      listView ? Promise.resolve(new Map<string, number>()) : countVisitSnags(admin, doneVisitIds),
    );
    const changedPromise = started(
      since
        ? changedJobIds(admin, jobIds, since, { rooms: listView })
        : Promise.resolve(null),
    );
    /*
      What the jobs contain -- rooms, defects, photos, checklist answers,
      plans -- shaped and signed by the same module the per-job route uses
      (lib/server/snagging/sync-children), so the two can never send
      different shapes for the same row.

      `slim` is the first-paint pull: rooms only.
    */
    /*
      The jobs this response lists. A list pull without a cursor sends one
      tab: the active jobs, or a page of the finished ones (paged in the
      jobs read below, which orders them).
    */
    const listIds = listView && !since
      ? jobIds.filter((id) =>
          listKind === "active" ? activeSet.has(id) : !activeSet.has(id),
        )
      : jobIds;

    // The list sends no contents at all: they come with the job, on open.
    const childrenPromise = started(
      listView
        ? Promise.resolve({ areas: [], snags: [], photos: [], checklist: [], floor_plans: [] })
        : loadSyncChildren(admin, jobIds, {
        since,
        rooms_only: slim,
        ...(activeIds ? { full_job_ids: activeIds } : {}),
      }),
    );
    // Rooms done / total for each card, counted here instead of sending rooms.
    const roomCountsPromise = started(
      listView && !since && listKind === "active"
        ? countRooms(admin, listIds)
        : Promise.resolve(null),
    );

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
    const visitSnagCount = await visitSnagsPromise;
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
      /*
        A card needs which visit, its state and its date -- enough to list
        it under Done. When it was booked and what it found are the job
        screen's, and come with the job (/sync/job/[id]). The submitted and
        completed times were sent too and read by nothing on the phone.
      */
      list.push({
        id: v.id,
        number: v.visit_number,
        status: v.status,
        date: gstDay(
          row.scheduled_date ?? row.appointment_at ?? row.submitted_at,
        ),
        ...(listView
          ? {}
          : {
              appointment_at: (row.appointment_at as string | null) ?? null,
              snag_count: visitSnagCount.get(v.id as string) ?? 0,
            }),
      });
      finishedVisits.set(v.job_id as string, list);
    }


    // 2. Jobs -> wire "tasks" (with a property sub-object + team list).
    let jobQuery = admin
      .from("snagging_jobs")
      // Typed loosely: the column list depends on the view.
      .select<string, Record<string, unknown>>(
        listView
          ? CARD_COLUMNS
          : `id, code, status, round_number, visit_type, visit_charge, parent_job_id, scheduled_date, notes,
         locked, rejection_reason, rejection_category, remediation_due_at, updated_at, created_at,
         unit_label, building_name, community, property_type, developer_name,
         appointment_at, bedrooms, built_up_area_sqft, plot_area_sqft, floors,
         external_areas_in_scope, location_lat, location_lng, noc_required, noc_path,
         developer_contact_name, developer_contact_phone,
         client_contact_name, client_contact_phone,
         property_record:property_id(unit_label, building_name, community, property_type,
           developer_name, bedrooms, built_up_area_sqft, plot_area_sqft, floors,
           external_areas_in_scope, location_lat, location_lng, noc_required, noc_path),
         client:client_id(name, email, phone),
         inspector_id,
         inspector:inspector_id(full_name, email)`,
      )
      .in("id", listView ? listIds : jobIds);
    /* Done, a page at a time, newest first -- one more row than the page,
       to know whether there is another. */
    const donePage = listView && !since && listKind === "done";
    if (donePage) {
      jobQuery = jobQuery
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(pageSize + 1);
      if (parsed.data.before) jobQuery = jobQuery.lt("created_at", parsed.data.before);
    }

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
    /*
      Read together, and the delta filtered here rather than in the query:
      the jobs read used to wait for the check to finish, one more round
      trip to the database on every pull. The inspector's own jobs are a
      handful of rows, so reading the unchanged ones costs less than the
      wait did.
    */
    const [{ data: allJobs, error: jobError }, changedIds] = await Promise.all([
      jobQuery,
      changedPromise,
    ]);
    if (jobError) throw new Error(jobError.message);
    const changedSet = changedIds ? new Set(changedIds) : null;
    const hasMore = donePage && (allJobs ?? []).length > pageSize;
    const pageJobs = donePage ? (allJobs ?? []).slice(0, pageSize) : allJobs;
    const jobs = changedSet
      ? (pageJobs ?? []).filter((job) => changedSet.has((job as { id: string }).id))
      : pageJobs;
    const roomCounts =
      (await roomCountsPromise) ??
      (listView
        ? await countRooms(
            admin,
            (jobs ?? []).map((job) => (job as { id: string }).id),
          )
        : null);

    const fullTask = (job: unknown) => {
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
        /*
          The job's own inspector. With rooms split between several, only
          the lead submits, once every room is done (point 6).
        */
        lead_inspector_id: j.inspector_id ?? null,
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
          // Whether there is a NOC to open; the phone fetches the file
          // itself on demand (/api/snagging/tasks/[id]/noc), never the path.
          noc_on_file: Boolean(pick("noc_path")),
        },
        appointment_at: j.appointment_at,
        team,
      };
    };

    /*
      A job card: what the list shows and what decides which tab it sits in,
      and nothing else. Who to call, the unit's size and location, the NOC,
      the team and the notes come with the job when it is opened
      (/sync/job/[id], `task`).
    */
    const cardTask = (job: unknown) => {
      const j = job as JobRow;
      const rec = firstOf(j.property_record) as Record<string, unknown> | null;
      const pick = (key: string) =>
        rec?.[key] ?? (j as unknown as Record<string, unknown>)[key] ?? null;
      const live = activeVisit.get(j.id as string) ?? null;
      const last = live ? null : (lastVisit.get(j.id as string) ?? null);
      const when = live?.scheduled_date ?? live?.appointment_at ?? null;
      const whenAt = when ? new Date(when) : null;
      return {
        id: j.id,
        code: j.code,
        status: j.status,
        task_type: "single_unit",
        round_number: j.round_number,
        visit_type: j.visit_type ?? "initial",
        scheduled_date: j.scheduled_date,
        created_at: j.created_at,
        rejection_reason: j.rejection_reason,
        active_visit_id: live?.id ?? null,
        active_visit_number: live?.visit_number ?? null,
        active_visit_note: live?.review_note ?? null,
        active_visit_date:
          whenAt && !Number.isNaN(whenAt.getTime())
            ? whenAt.toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" })
            : null,
        last_visit_number: last?.visit_number ?? null,
        last_visit_status: last?.status ?? null,
        last_visit_date: last?.at
          ? new Date(last.at).toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" })
          : null,
        finished_visits: finishedVisits.get(j.id as string) ?? [],
        property: {
          unit_label: pick("unit_label"),
          building_name: pick("building_name"),
          community: pick("community"),
        },
        // "2/5 rooms", counted here instead of sending the rooms.
        area_total: roomCounts?.get(j.id as string)?.total ?? 0,
        area_done: roomCounts?.get(j.id as string)?.done ?? 0,
      };
    };

    const tasks = (jobs ?? []).map((job) => (listView ? cardTask(job) : fullTask(job)));

    // 3. Children, already in the shape the app stores.
    const { areas, snags, photos, checklist, floor_plans } = await childrenPromise;

    const catalogue = await cataloguePromise;

    return NextResponse.json({
      data: {
        server_time: serverTime,
        cold_start: coldStart,
        catalogue,
        tasks,
        areas,
        snags,
        photos,
        floor_plans,
        verifications: [],
        checklist,
        /*
          The jobs whose defects, photos, checklist and plans this response
          carries in full; null when it carries every job's. A scoped
          snapshot reconciles deletions against these jobs only.
        */
        children_scope: activeIds,
        ...(listView
          ? {
              list: since ? "changes" : listKind,
              // The next Done page starts before the last card on this one.
              has_more: hasMore,
              next_before:
                hasMore && jobs && jobs.length > 0
                  ? ((jobs[jobs.length - 1] as { created_at: string }).created_at ?? null)
                  : null,
            }
          : {}),
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
  /** The lead inspector (point 6). */
  inspector_id: string | null;
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
  noc_path: string | null;
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


/*
  Marks a promise that is started early and awaited later as handled, so
  that if an earlier await throws first its rejection is not reported as
  unhandled. The caller still awaits it and still sees the error.
*/
function started<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => undefined);
  return promise;
}

/** Live (not withdrawn) snags found on each finished visit, by visit id. */
async function countVisitSnags(
  admin: Admin,
  visitIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (visitIds.length === 0) return counts;
  // Paged: an unpaged select undercounts past 1,000 rows (see read-all).
  const data = await readAllRows<{ visit_id: string }>(
    (from, to) =>
      admin
        .from("snagging_snags")
        .select("id, visit_id")
        .in("visit_id", visitIds)
        .neq("status", "withdrawn")
        .order("id", { ascending: true })
        .range(from, to),
    "visit snag counts",
  );
  for (const row of data) {
    const key = row.visit_id as string;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Which of these jobs changed since the cursor: the job row itself, or any
 * of its visits (booking one, the client approving its quotation and a
 * send-back all write the visit row and never touch the job).
 */
async function changedJobIds(
  admin: Admin,
  jobIds: string[],
  since: string,
  options: { rooms?: boolean } = {},
): Promise<string[]> {
  const [
    { data: changedJobs, error: changedError },
    { data: changedVisits, error: visitsError },
    { data: changedRooms, error: roomsError },
  ] = await Promise.all([
    admin.from("snagging_jobs").select("id").in("id", jobIds).gt("updated_at", since),
    admin
      .from("snagging_job_visits")
      .select("job_id")
      .in("job_id", jobIds)
      .gt("updated_at", since),
    /* A card shows rooms done, and confirming a room writes the room, not
       the job -- so on the list, a changed room is a changed job. */
    options.rooms
      ? admin
          .from("snagging_areas")
          .select("job_id")
          .in("job_id", jobIds)
          .gt("updated_at", since)
      : Promise.resolve({ data: [] as Array<{ job_id: string }>, error: null }),
  ]);
  if (changedError) throw new Error(changedError.message);
  if (visitsError) throw new Error(visitsError.message);
  if (roomsError) throw new Error(roomsError.message);
  return [
    ...new Set([
      ...(changedJobs ?? []).map((row) => row.id as string),
      ...(changedVisits ?? []).map((row) => row.job_id as string),
      ...(changedRooms ?? []).map((row) => row.job_id as string),
    ]),
  ];
}

/** Rooms done and in total, per job, for the cards. */
async function countRooms(
  admin: Admin,
  jobIds: string[],
): Promise<Map<string, { total: number; done: number }>> {
  const counts = new Map<string, { total: number; done: number }>();
  if (jobIds.length === 0) return counts;
  const rows = await readAllRows<{ job_id: string; confirmed_at: string | null }>(
    (from, to) =>
      admin
        .from("snagging_areas")
        .select("id, job_id, confirmed_at")
        .in("job_id", jobIds)
        .order("id", { ascending: true })
        .range(from, to),
    "room counts",
  );
  for (const row of rows) {
    const count = counts.get(row.job_id) ?? { total: 0, done: 0 };
    count.total += 1;
    if (row.confirmed_at) count.done += 1;
    counts.set(row.job_id, count);
  }
  return counts;
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
  // All three at once; they were counted one after another.
  const results = await Promise.all(
    tables.map((table) =>
      admin
        .from(table)
        .select("id", { count: "exact", head: true })
        .gt("updated_at", since),
    ),
  );
  for (const { count, error } of results) {
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
