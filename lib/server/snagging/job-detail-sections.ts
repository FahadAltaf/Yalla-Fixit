import type { SupabaseClient } from "@supabase/supabase-js";

import { byCreation } from "@/lib/snagging/creation-order";
import {
  hasAreaInspector,
  hasJobInspectors,
  hasReviewNote,
  hasVerdictNote,
  hasVisitInspectors,
} from "@/lib/server/snagging/columns";
import { loadJobFamily, readOnRoot } from "@/lib/server/snagging/job-family";
import { listReportVersions } from "@/lib/server/snagging/report-versions";
import { signMediaPaths } from "@/lib/server/snagging/media";

/*
  The job detail, one section per endpoint.

  GET /api/snagging/tasks/[id] used to assemble all of this in one request,
  mostly in sequence -- the job, its checklist, the family, the visit
  states, the de-snag quotation, every snag with every photo signed, the
  floor plans, the documents and the signature -- so nothing on the page
  could render until the slowest part (the snags and their photos) had.

  Each section is now its own route, loading only what it owns:

    loadJobCore            GET /tasks/[id]                   the job, property, areas, sign-off
    loadJobChecklist       GET /tasks/[id]/checklist
    loadJobSnags           GET /tasks/[id]/snags             family + snags + photo signing
    loadJobVisitStatus     GET /tasks/[id]/visit-status      family + visit states
    loadJobDesnagQuotation GET /tasks/[id]/desnag-quotation  family + de-snag quotations
    (floor plans)          GET /floor-plans?task_id=         the existing standalone route

  The three that need the job's family each resolve it themselves. That is
  deliberate: a small repeated lookup is the price of the sections never
  waiting on one another. Don't make one depend on another's result.

  The logic and its explanations moved here unchanged from the single
  route; only the section boundaries are new.
*/

type Admin = SupabaseClient;

/*
  Column lists, not `*`.

  Each section selects exactly what something reads -- a page, the report
  or PDF, or this file while building the response -- so a column added to
  a table later does not ride along to every client unasked. The field
  audit behind each list (what reads what, file and line) is in the
  snagging API field audit; add a column here when a reader needs it.
*/

/* The job row: what the page, report and review read, plus what this file
   uses to build property / submissions / parent_task_id. The 15
   denormalised property columns are the fallback for jobs that predate the
   property record (pick() below); they are read here, not sent on. */
const JOB_DENORMALISED_PROPERTY = [
  "unit_label", "building_name", "community", "property_type", "developer_name",
  "bedrooms", "built_up_area_sqft", "plot_area_sqft", "external_areas_in_scope",
  "floors", "location_lat", "location_lng", "title_deed_path", "noc_required", "noc_path",
] as const;
const JOB_COLUMNS = [
  "id", "code", "status", "round_number", "parent_job_id", "visit_type", "visit_charge",
  "client_id", "property_id", "inspector_id", "approval_manager_id", "reviewer_id", "reviewed_at",
  "scheduled_date", "appointment_at",
  "developer_contact_name", "developer_contact_phone", "client_contact_name", "client_contact_phone",
  "locked", "submitted_at", "delivered_at", "delivery_channel", "delivery_recipient",
  "rejection_reason", "rejection_category", "rejection_count", "remediation_due_at",
  "signed_at", "signer_name", "signature_path",
  ...JOB_DENORMALISED_PROPERTY,
].join(", ");
const PROPERTY_COLUMNS =
  "id, client_id, unit_label, building_name, community, property_type, developer_name, " +
  "bedrooms, built_up_area_sqft, plot_area_sqft, external_areas_in_scope, floors, " +
  "location_lat, location_lng, title_deed_path, noc_required, noc_path";
/* The Areas tab reads its own endpoint; the job only needs what the header,
   snag list and report show, plus creation order. */
/* note: the inspector's closing note, shown on "Completed areas". */
/*
  The pin, the outline and (below) the room's own inspector come with the
  job's areas, so the Areas tab and the room-inspector picker start from
  the job the page already has instead of each reading the rooms again.
*/
const JOB_AREA_COLUMNS =
  "id, name, access_state, access_reason, confirmed_at, note, visit_id, created_at, sort_order, " +
  "floor_plan_id, pin_x, pin_y, zone";
const CHECKLIST_COLUMNS =
  "id, status, label, group_name, mandatory, reason, visit_id, created_at, sort_order";
/* job_id stays: it decides from_earlier_visit. locked has no reader today
   but is kept as a business-rule field. */
const SNAG_COLUMNS =
  "id, job_id, area_id, category_label, element_label, defect_label, severity, note, " +
  "pin_x, pin_y, floor_plan_id, status, round_created, visit_id, created_at, locked";
/* Photo metadata the lightbox shows (gps, exif, marker, size) stays;
   bytes and the ids that repeat the parent do not. */
const SNAG_PHOTO_COLUMNS =
  "id, storage_path, media_type, round_number, taken_at, gps_lat, gps_lng, exif, " +
  "marker_x, marker_y, width, height";

// Composed select strings are beyond the client's select-string type
// parser, so these queries name their row type (Row) instead of inferring it.
type Row = Record<string, any>;
const coreSelect = (withRoomInspector: boolean, withRoster: boolean) => `${JOB_COLUMNS},
  client:client_id(name, email, phone),
  inspector:inspector_id(id, full_name, email),
  manager:approval_manager_id(full_name, email),
  reviewer:reviewer_id(full_name, email),
  property_record:property_id(${PROPERTY_COLUMNS}),
  areas:snagging_areas(${JOB_AREA_COLUMNS}${withRoomInspector ? ", inspector_id" : ""})${
    /*
      Everyone on the job, embedded rather than read in a second trip.
      Left out entirely where 20260923100000 has not run, and the job's
      own inspector_id is then the whole answer (see `roster` below).
    */
    withRoster ? ",\n  roster:snagging_job_inspectors(user_profile:inspector_id(id, full_name, email))" : ""
  }`;
/*
  The snags, with the de-snag verdict comment and the reviewer's note to
  the inspector once their migrations have run.
*/
function snagsSelect(verdict: boolean, review: boolean) {
  return `${SNAG_COLUMNS}${verdict ? ", verdict_note" : ""}${
    review
      ? ", review_note, review_note_at, review_note_author:review_note_by(full_name, email)"
      : ""
  },
  area:snagging_areas(id, name),
  recorded_by:created_by(id, full_name, email),
  photos:snagging_snag_photos(${SNAG_PHOTO_COLUMNS})`;
}

function firstOf<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
}

/**
 * The job itself: everything the page header and the Setup tab read, with
 * nothing that depends on the family or on photo signing.
 * Null when there is no such job.
 */
export async function loadJobCore(admin: Admin, id: string) {
  /*
    Which optional columns this database has, asked once per process and
    remembered (columns.ts), so they cost nothing per request.
  */
  const [withRoomInspector, withRoster] = await Promise.all([
    hasAreaInspector(admin),
    hasJobInspectors(admin),
  ]);
  const { data: job, error } = await admin
    .from("snagging_jobs")
    .select<string, Row>(coreSelect(withRoomInspector, withRoster))
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!job) return null;

  // Creation order, with sort_order breaking the tie for the rooms a
  // job is set up with, which are all written in one batch.
  const areas = byCreation(
    (job.areas ?? []) as Array<{ created_at?: string | null; sort_order?: number | null }>,
  );

  const client = firstOf(job.client as { name?: string; email?: string; phone?: string } | null);
  const inspector = firstOf(
    job.inspector as { id?: string; full_name?: string; email?: string; profile_image?: string } | null,
  );

  // The property record is canonical now (BR-1); fall back to the job's
  // denormalised snapshot for any job that predates the property link.
  const rec = firstOf(job.property_record as Record<string, unknown> | null) as
    | Record<string, unknown>
    | null;
  const pick = (key: string) => (rec ? rec[key] : (job as Record<string, unknown>)[key]);
  const property = {
    id: (rec?.id as string | undefined) ?? job.property_id ?? job.client_id,
    /*
      Who the record belongs to, and by its presence, whether this
      property can be edited from the job at all.

      Carried because the properties PATCH validates a complete record,
      so anything editing a property here — the location pin — has to
      send the client back with it. Null when there is no property
      record: `id` above then falls back to the job's own client id,
      which would PATCH a snagging_properties row that does not exist.
    */
    client_id: rec ? ((rec.client_id as string | undefined) ?? job.client_id ?? null) : null,
    client_name: client?.name ?? "",
    client_email: client?.email ?? null,
    client_phone: client?.phone ?? null,
    unit_label: pick("unit_label"),
    building_name: pick("building_name"),
    community: pick("community"),
    city: "Dubai",
    property_type: pick("property_type"),
    developer_name: pick("developer_name"),
    // Full attributes for the job detail / property edit (portal only).
    bedrooms: pick("bedrooms") ?? null,
    built_up_area_sqft: pick("built_up_area_sqft") ?? null,
    plot_area_sqft: pick("plot_area_sqft") ?? null,
    external_areas_in_scope: pick("external_areas_in_scope") ?? false,
    floors: pick("floors") ?? null,
    location_lat: pick("location_lat") ?? null,
    location_lng: pick("location_lng") ?? null,
    title_deed_path: pick("title_deed_path") ?? null,
    noc_required: pick("noc_required") ?? false,
    noc_path: pick("noc_path") ?? null,
  };

  /*
    The NOC, the title deed and the signature are signed together. They
    were three separate waits -- the documents in parallel, then the
    signature after them -- and none depends on another.
  */
  const [nocSigned, deedSigned, signatureSigned] = await Promise.all([
    // Sign the property's NOC and title deed (FR-3.04 / FR-1.09) so the job can
    // show "on file" with a view/download link — reusing the existing
    // property-level document, never a second upload.
    property.noc_path
      ? signMediaPaths(admin, [{ id: "noc", storage_path: property.noc_path as string }])
      : Promise.resolve([]),
    property.title_deed_path
      ? signMediaPaths(admin, [{ id: "deed", storage_path: property.title_deed_path as string }])
      : Promise.resolve([]),
    // Sign the signature image so the report can render the sign-off; the
    // stored path is private like every other object in the bucket.
    job.signature_path
      ? signMediaPaths(admin, [{ id: job.id, storage_path: job.signature_path }])
      : Promise.resolve([]),
  ]);
  const propertyWithDocs = {
    ...property,
    noc_url: (nocSigned[0] as { signed_url?: string } | undefined)?.signed_url ?? null,
    title_deed_url: (deedSigned[0] as { signed_url?: string } | undefined)?.signed_url ?? null,
  };

  /*
    Everyone on the job, not just the one the job row names.

    Several inspectors work a job now and none is senior to another, so
    the set lives in snagging_job_inspectors. jobs.inspector_id is the
    first of them and stays readable for submission and the report; this
    reads the table and falls back to that column where the table is not
    there yet (20260923100000) or has nothing for the job.
  */
  const inspectorRows = job.roster as Array<Record<string, unknown>> | null;

  const roster =
    !inspectorRows?.length
      ? []
      : (inspectorRows as Array<Record<string, unknown>>)
          .map((row) => {
            const found = row.user_profile;
            return (Array.isArray(found) ? found[0] : found) as
              | { id: string; full_name: string | null; email: string | null }
              | null;
          })
          .filter(
            (profile): profile is { id: string; full_name: string | null; email: string | null } =>
              Boolean(profile),
          );

  const people = roster.length > 0 ? roster : inspector ? [inspector] : [];

  const assignees = people.map((person) => ({
    id: person.id,
    task_id: job.id,
    user_id: person.id,
    role: "technician" as const,
    user_profile: person,
  }));

  const signatureRow = job.signature_path ? (signatureSigned[0] ?? null) : null;
  const submissions = job.signed_at
    ? [{
        id: job.id,
        task_id: job.id,
        attempt: 1,
        signed_at: job.signed_at,
        signer_name: job.signer_name,
        signature_path: job.signature_path,
        signature_url: (signatureRow as { signed_url?: string } | null)?.signed_url ?? null,
      }]
    : [];

  /*
    The raw relations and the denormalised property copies were read to
    build `property`, `assignees` and `submissions` above; nothing reads
    them in the response, so they are not sent twice.
  */
  const sent: Record<string, unknown> = { ...job };
  for (const key of [
    "client",
    "inspector",
    "property_record",
    // The embedded roster, already lifted into `assignees`.
    "roster",
    ...JOB_DENORMALISED_PROPERTY,
  ]) {
    delete sent[key];
  }

  return {
    ...(sent as typeof job),
    task_type: "single_unit",
    parent_task_id: job.parent_job_id,
    property: propertyWithDocs,
    areas,
    assignees,
    approvals: [],
    submissions,
  };
}

/** The job's checklist, in creation order. */
export async function loadJobChecklist(admin: Admin, id: string) {
  /*
    Ordered by creation, in code rather than in the query.

    snagging_job_checklist gained created_at in a later migration, so a
    SQL `order("created_at")` would be a 400 on any environment that has
    not run it yet and would take the whole job record down with it.
    Selecting the row and sorting here works either way, and starts
    ordering by creation the moment the column exists.

    See byCreation for why sort_order still breaks the tie.
  */
  const { data: checklistRows, error: checklistError } = await admin
    .from("snagging_job_checklist")
    .select<string, Row>(CHECKLIST_COLUMNS)
    .eq("job_id", id);
  if (checklistError) throw new Error(checklistError.message);
  const checklist = byCreation(checklistRows ?? []);
  return checklist ?? [];
}

/**
 * Fills in what a snag's own row is missing, for display.
 *
 * Category: a snag stores the category it was classified under, but older
 * rows, older app builds and every copy a de-snag round carried had none,
 * so the detail showed "—". The catalogue code says it anyway -- SN03-03-03
 * is category SN03 -- so it is read from there.
 *
 * Recorded by: a round's copy of a defect has no author of its own (it was
 * copied, not recorded), so the detail showed "—" for a defect somebody
 * plainly raised. It shows whoever recorded the original, found through the
 * snag code the copies share. Display only: the copy's created_by stays
 * empty, because the phone and the sync treat created_by as "only this
 * inspector may change it", and the round may be someone else's to walk.
 */
async function fillFromOriginals(admin: Admin, familyIds: string[], rows: Row[]): Promise<Row[]> {
  const noCategory = rows.some((r) => !r.category_label && r.catalogue_code);
  const noRecorder = rows.filter((r) => !r.recorded_by && r.snag_code);
  if (!noCategory && noRecorder.length === 0) return rows;

  const [categories, originals] = await Promise.all([
    noCategory
      ? admin.from("snagging_catalogue_categories").select("code, label")
      : Promise.resolve({ data: [] as Row[], error: null }),
    noRecorder.length > 0 && familyIds.length > 1
      ? admin
          .from("snagging_snags")
          .select("snag_code, created_at, recorded_by:created_by(id, full_name, email)")
          .in("job_id", familyIds)
          .in("snag_code", [...new Set(noRecorder.map((r) => r.snag_code as string))])
          .not("created_by", "is", null)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as Row[], error: null }),
  ]);
  if (categories.error) throw new Error(categories.error.message);
  if (originals.error) throw new Error(originals.error.message);

  const categoryByCode = new Map(
    ((categories.data ?? []) as Row[]).map((c) => [c.code as string, c.label as string]),
  );
  // The earliest recorded copy of each defect is the original.
  const recorderByCode = new Map<string, unknown>();
  for (const o of (originals.data ?? []) as Row[]) {
    if (!recorderByCode.has(o.snag_code)) recorderByCode.set(o.snag_code, o.recorded_by);
  }

  return rows.map((r) => ({
    ...r,
    category_label:
      r.category_label ??
      categoryByCode.get(String(r.catalogue_code ?? "").split("-")[0]) ??
      null,
    recorded_by: r.recorded_by ?? recorderByCode.get(r.snag_code) ?? null,
  }));
}

/**
 * Who worked on each defect, round by round.
 *
 * A defect is one row per round it was carried into, all sharing its snag
 * code. The round-1 row says who recorded it (created_by, or a round's
 * row for a defect born there); each round's verdict is in the audit trail
 * against that round's row, with whoever gave it. Round 1 might be one
 * inspector and round 2 another, and the detail showed only a single
 * "Recorded by" -- so the office could not tell who had passed the fix.
 *
 * Two queries for the whole list, whatever its length: every copy of these
 * defects across the family, and the verdicts given on them.
 */
async function attachPeople(
  admin: Admin,
  familyIds: string[],
  roundOf: Map<string, number>,
  rows: Row[],
): Promise<Row[]> {
  const codes = [...new Set(rows.map((r) => r.snag_code as string).filter(Boolean))];
  if (codes.length === 0) return rows;

  const { data: copies, error: copyError } = await admin
    .from("snagging_snags")
    .select("id, job_id, snag_code, created_at, round_created, recorded_by:created_by(full_name, email)")
    .in("job_id", familyIds)
    .in("snag_code", codes);
  if (copyError) throw new Error(copyError.message);

  const copyIds = (copies ?? []).map((c) => c.id as string);
  const { data: verdicts, error: verdictError } = copyIds.length
    ? await admin
        .from("snagging_audit_events")
        .select("entity_id, actor_label, created_at, payload")
        .eq("event_type", "snag_verified")
        .in("entity_id", copyIds)
        .order("created_at", { ascending: false })
    : { data: [] as Row[], error: null };
  if (verdictError) throw new Error(verdictError.message);

  // The latest verdict on each copy is the one that stands.
  const latest = new Map<string, Row>();
  for (const v of (verdicts ?? []) as Row[]) {
    if (!latest.has(v.entity_id)) latest.set(v.entity_id, v);
  }

  type Person = NonNullable<import("@/types/types").SnaggingSnag["people"]>[number];
  const byCode = new Map<string, Person[]>();
  for (const copy of (copies ?? []) as Row[]) {
    const list = byCode.get(copy.snag_code) ?? [];
    const round = roundOf.get(copy.job_id) ?? 1;
    const who = firstOf(copy.recorded_by as { full_name?: string; email?: string } | null);
    const name = who?.full_name ?? who?.email ?? null;
    // Recorded: only on the round the defect was raised on (a carried copy has no author).
    if (name && (copy.round_created ?? 1) === round) {
      list.push({ round, action: "recorded", name, at: copy.created_at ?? null });
    }
    const verdict = latest.get(copy.id);
    if (verdict?.actor_label) {
      list.push({
        round,
        action: "verified",
        name: verdict.actor_label as string,
        at: (verdict.created_at as string) ?? null,
        verdict: ((verdict.payload as { verdict?: string } | null)?.verdict as string) ?? null,
      });
    }
    byCode.set(copy.snag_code, list);
  }

  return rows.map((r) => ({
    ...r,
    people: (byCode.get(r.snag_code) ?? []).sort(
      (a, b) => a.round - b.round || (a.action === "recorded" ? -1 : 1),
    ),
  }));
}

/**
 * The snags this record shows, with their photos signed. The heaviest
 * section: it resolves the family and signs every photo.
 */
export async function loadJobSnags(admin: Admin, id: string) {
  /*
    Which jobs' snags this record shows.

    FR-9.03 — an additional visit is a return to the same property, so
    what it finds belongs to the original inspection record rather than
    to a report of its own. Its snags are read alongside the parent's.

    A de-snag round keeps its own list: it is a re-verification pass,
    and its rows carry the verdicts given during that round. The row
    that survives as the defect's lasting record is the parent's — the
    round writes its verdict through to it (BRD 5.2), so the two never
    disagree even though both exist.
  */
  /*
    The job's own snags are read at the same time as its family, not after:
    they are always part of the list, and the family only ever ADDS jobs
    (additional visits). The extra jobs are read afterwards, only when there
    are any -- so the usual job is two round trips, not three.
  */
  const select = snagsSelect(await hasVerdictNote(admin), await hasReviewNote(admin));
  const readSnags = async (jobIds: string[]) => {
    const { data, error } = await admin
      .from("snagging_snags")
      .select<string, Row>(select)
      .in("job_id", jobIds)
      // Newest first for the working views. The client report has its
      // own route and still orders by code within each area, so the
      // delivered document is unaffected.
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  };
  const [family, ownRows] = await Promise.all([loadJobFamily(admin, id), readSnags([id])]);

  /*
    Viewing an ADDITIONAL VISIT also shows the original's defects.

    A visit opened with an empty snag list, which reads as a property
    with no known problems — on a unit that already has three. The
    inspector is going back to cover rooms the first pass could not
    reach, and what is already on record is exactly the context they
    need: it tells them what has been seen, so they log what has not.

    Read-only reference, NOT copied. Copying would duplicate every
    defect into the visit and double-count it in the merged report,
    which is the thing FR-9.03 exists to prevent. They are tagged below
    so the UI can say plainly where each one came from.
  */
  // This job's own visit_type, read from the family rather than the core
  // job query so this section never waits on it: a child of the root is in
  // additionalVisitIds exactly when its visit_type is "additional".
  const isAdditionalVisit = id !== family.rootId && family.additionalVisitIds.includes(id);
  const snagJobIds =
    id === family.rootId
      ? [id, ...family.additionalVisitIds]
      : isAdditionalVisit
        ? [id, family.rootId]
        : [id];

  const extraIds = snagJobIds.filter((jobId) => jobId !== id);
  const snagRows =
    extraIds.length === 0
      ? ownRows
      : [...ownRows, ...(await readSnags(extraIds))].sort((x, y) =>
          String(y.created_at ?? "").localeCompare(String(x.created_at ?? "")),
        );

  const signedSnags = await signMediaPaths(
    admin,
    await attachPeople(
      admin,
      family.allIds,
      family.roundOf,
      await fillFromOriginals(admin, family.allIds, snagRows ?? []),
    ),
  );
  /*
    origin_task_id and photo.task_id -- the pre-merge aliases of job_id --
    are no longer sent: nothing in the app reads either, and job_id is on
    the snag already.
  */
  return signedSnags.map((snag) => {
    const s = snag as Record<string, unknown> & { photos?: Array<Record<string, unknown>> };
    return {
      ...s,
      /*
        Where this defect was raised, relative to the record being
        viewed. On an additional visit the list mixes what is already
        known with what this visit finds, and the two must never look
        alike: one is history the inspector reads, the other is their
        own work.
      */
      from_earlier_visit: s.job_id !== id,
    };
  });
}

/** Which of the family's additional visits the manager has not approved. */
export async function loadJobVisitStatus(admin: Admin, id: string) {

  /*
    Visits whose findings the manager has not approved yet. The job page
    shows everything, labelled; the report view leaves these out, so the
    client's report never carries a visit before it is signed off.
  */
  const { result: visitStates } = await readOnRoot(admin, id, async (rootId) => {
    const { data, error } = await admin
      .from("snagging_job_visits")
      .select("id, status")
      .eq("job_id", rootId);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
  const unapprovedVisitIds = visitStates
    .filter((visit) => visit.status !== "completed")
    .map((visit) => visit.id as string);

  return { unapproved_visit_ids: unapprovedVisitIds };
}

/** The de-snag quotation that matters now, or null when there is none. */
export async function loadJobDesnagQuotation(admin: Admin, id: string) {

  /*
    Where this job's de-snag stands (change 31). A de-snag is a new job
    raised through Quotations, and the job page offers the step it is
    actually at -- quote it, wait for the client, open it -- instead of
    a round dialog that could only fail until a quotation existed.
  */
  const { result: desnagQuotes } = await readOnRoot(admin, id, async (rootId) => {
    const { data, error } = await admin
      .from("snagging_quotations")
      .select("id, status, job_id, created_at")
      .eq("source_job_id", rootId)
      .eq("quote_kind", "desnag")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });
  const desnagRow =
    (desnagQuotes ?? []).find((q) => q.status === "approved" && !q.job_id) ??
    (desnagQuotes ?? []).find((q) => q.status === "draft" || q.status === "sent") ??
    (desnagQuotes ?? [])[0] ??
    null;

  return desnagRow
    ? {
        id: desnagRow.id as string,
        status: desnagRow.status as string,
        job_id: (desnagRow.job_id as string | null) ?? null,
      }
    : null;
}

/*
  What the visits tab, the visit alerts and the edit dialog read, plus
  quotation_id to join the visit's quotation. The review fields
  (submitted_at, review_note) came with 20260918100000_visit_review, which
  every environment now has; the audit columns (created_by, updated_at,
  reviewed_by, ...) have no reader here.
*/
const VISIT_COLUMNS =
  "id, visit_number, status, scheduled_date, appointment_at, inspector_id, charge, " +
  "charge_method, payment_reference, quotation_id, started_at, submitted_at, review_note, " +
  "notes, created_at, inspector:inspector_id(id, full_name, email), " +
  // The visit's quotation, embedded rather than fetched in a second round trip.
  "quotation_ref:quotation_id(id, quote_number, status)";

/*
  Everyone attending the visit, embedded rather than fetched per row.
  Left out entirely where 20260924140000 has not run, so a missing table
  costs the extra names rather than the tab -- `inspector` above is then
  the whole answer.
*/
const visitRosterSelect = async (admin: Admin) =>
  (await hasVisitInspectors(admin))
    ? ", roster:snagging_visit_inspectors(user_profile:inspector_id(id, full_name, email))"
    : "";

function firstOfVisit<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

/** The additional visits and report versions of the job's family. */
export async function loadJobVisits(admin: Admin, id: string) {
  /*
    Visits belong to the ORIGINAL inspection, so opening this tab on a
    de-snag job shows the same list rather than an empty one. A de-snag
    is still its own job (change 31); a visit is not.

    Everything below needs only the root, so it goes in one parallel
    round trip -- started on this job's id alongside the family lookup,
    since most jobs are their own root (readOnRoot). The quotation used
    to be a further query after the visits; it is embedded now.
  */
  const rosterSelect = await visitRosterSelect(admin);
  const {
    result: [{ data: visits, error }, { data: visitSnags }, versions],
  } = await readOnRoot(admin, id, (rootId) =>
    Promise.all([
      admin
        .from("snagging_job_visits")
        .select(`${VISIT_COLUMNS}${rosterSelect}`)
        .eq("job_id", rootId)
        .order("visit_number", { ascending: true }),
      // What each visit actually found, counted on the job it was written to.
      admin
        .from("snagging_snags")
        .select("id, visit_id")
        .eq("job_id", rootId)
        .not("visit_id", "is", null),
      listReportVersions(admin, rootId),
    ]),
  );
  if (error) throw new Error(error.message);

  const rows = (visits ?? []) as unknown as Array<Record<string, unknown>>;
  const snagCount = new Map<string, number>();
  for (const snag of visitSnags ?? []) {
    const key = snag.visit_id as string;
    snagCount.set(key, (snagCount.get(key) ?? 0) + 1);
  }

  return {
    visits: rows.map((visit) => {
      const quote = firstOfVisit(
        visit.quotation_ref as { id: string; quote_number: string | null; status: string } | null,
      );
      const { quotation_ref: _embedded, roster: _roster, ...rest } = visit;
      void _embedded;
      const lead = firstOfVisit(
        visit.inspector as { id?: string } | null,
      ) as { id?: string } | null;
      /*
        Every inspector on the visit, the lead first so the row still
        reads the same where only one attends.
      */
      const crew = ((_roster ?? []) as Array<Record<string, unknown>>)
        .map((row) => firstOfVisit(row.user_profile as { id?: string } | null))
        .filter((person): person is { id?: string } => Boolean(person));
      const inspectors = lead
        ? [lead, ...crew.filter((person) => person.id !== lead.id)]
        : crew;
      return {
        ...rest,
        inspector: lead,
        inspectors,
        quotation: quote
          ? {
              id: quote.id,
              quote_number: quote.quote_number,
              status: quote.status,
            }
          : null,
        snag_count: snagCount.get(visit.id as string) ?? 0,
      };
    }),
    versions,
  };
}

/** The job's own floor plans, each with a signed URL. */
export async function loadJobFloorPlans(admin: Admin, taskId: string) {
  const { data, error } = await admin
    .from("snagging_floor_plans")
    .select("id, label, storage_path, width, height, sort_order")
    .eq("job_id", taskId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return signMediaPaths(admin, data ?? []);
}
