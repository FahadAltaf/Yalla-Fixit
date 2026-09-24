import type { SupabaseClient } from "@supabase/supabase-js";

import { hasAreaInspector, hasReviewNote, hasVerdictNote } from "@/lib/server/snagging/columns";
import { signMediaPaths } from "@/lib/server/snagging/media";
import { loadJobRosters } from "@/lib/server/snagging/job-roster";
import { readAllRows } from "@/lib/server/snagging/read-all";

/**
 * What a job CONTAINS, in the shape the inspector app stores.
 *
 * The sync pull sends this for every assigned job at once; the per-job
 * route (/api/snagging/sync/job/[id]) sends it for one job, so opening a
 * job the handset has not fully synced yet costs one small request instead
 * of waiting for the whole workload. Both read it from here, so the two can
 * never drift into sending different shapes for the same row.
 */

type Admin = SupabaseClient;
type ChildRow = Record<string, unknown>;

export type SyncChildren = {
  areas: unknown[];
  snags: unknown[];
  photos: unknown[];
  checklist: unknown[];
  floor_plans: unknown[];
};

async function loadChanged(
  admin: Admin,
  table: string,
  columns: string,
  jobIds: string[],
  since: string | undefined,
  timestampColumn: string,
): Promise<ChildRow[]> {
  /* Paged: a single select stops at 1,000 rows without saying so, and the
     phone deletes whatever a snapshot leaves out (see read-all). */
  return readAllRows<ChildRow>((from, to) => {
    let query = admin
      .from(table)
      .select<string, ChildRow>(columns)
      .in("job_id", jobIds);
    if (since) query = query.gt(timestampColumn, since);
    return query.order("id", { ascending: true }).range(from, to);
  }, table);
}

/*
  Whether snagging_floor_plans has updated_at yet. The column arrives with
  20260920100000_floor_plan_updated_at; until then a delta filters on
  created_at, which still delivers new plans but not renamed or reordered
  ones (the reconciling snapshot carries those). Asked once per process.
*/
let planUpdatedAtColumn: Promise<boolean> | null = null;

function plansHaveUpdatedAt(admin: Admin): Promise<boolean> {
  planUpdatedAtColumn ??= Promise.resolve(
    admin.from("snagging_floor_plans").select("updated_at").limit(1),
  ).then(({ error }) => !error);
  return planUpdatedAtColumn;
}

/** The rooms, defects, photos and checklist answers, as the app stores them. */
export async function loadSyncChildren(
  admin: Admin,
  jobIds: string[],
  options: {
    since?: string;
    /*
      The first-paint pull: the rooms only. The job list shows how many are
      done and nothing else on it comes from these tables, while the
      defects, the photos signed one by one and the plans are what make a
      cold pull long.
    */
    rooms_only?: boolean;
    /*
      The jobs whose defects, photos, checklist and plans are sent; rooms
      still go for every job in `jobIds`. The scoped snapshot passes the
      jobs still being worked, so a finished job's contents are not re-sent
      on every reconcile. Omitted, every job is sent in full.
    */
    full_job_ids?: string[];
    /*
      Whose phone this is. A defect recorded by ANOTHER inspector on the
      same job is left out: several inspectors work one job, none senior,
      and one's findings are not another's to see. The portal and the
      report still read every snag; this narrows the phone only.

      Everything else still reaches them. Keeping to "only what I
      recorded" hid what a job needs its inspector to see:
        - a de-snag round's carried defects, which the office copies onto
          the round with no author -- every one of them, so the inspector
          of a round had nothing left to verify;
        - the original inspection a visit or round shows as already on
          record, recorded by whoever did that pass;
        - defects raised before the app recorded an author.
      None of those is a co-inspector's, so none is private.
    */
    viewer_id?: string;
  } = {},
): Promise<SyncChildren> {
  const { since, full_job_ids: fullJobIds, viewer_id: viewerId } = options;
  if (jobIds.length === 0) {
    return { areas: [], snags: [], photos: [], checklist: [], floor_plans: [] };
  }
  const heavyIds = fullJobIds ?? jobIds;
  const roomsOnly = (options.rooms_only ?? false) || heavyIds.length === 0;

  // The verdict comment, the note to the inspector, and a room's own
  // inspector: each once its migration has run.
  const [verdictNote, reviewNote, areaInspector] = await Promise.all([
    hasVerdictNote(admin),
    hasReviewNote(admin),
    hasAreaInspector(admin),
  ]);
  const verdict = !roomsOnly && verdictNote ? ", verdict_note" : "";
  // The note only: when it was left is read by nothing on the phone.
  const review = !roomsOnly && reviewNote ? ", review_note" : "";
  const none = Promise.resolve([] as ChildRow[]);
  const roomInspector = areaInspector ? ", inspector_id" : "";

  const [areaRows, snagRows, photoRows, checklistRows, planRows, rosters] = await Promise.all([
    loadChanged(
      admin,
      "snagging_areas",
      `id, job_id, name, catalogue_area_code, sort_order, created_at, status, note,
       confirmed_at, access_state, access_reason, floor_plan_id, pin_x, pin_y, zone,
       started_at, elements_not_checked${roomInspector}`,
      jobIds,
      since,
      "updated_at",
    ),
    roomsOnly
      ? none
      : loadChanged(
      admin,
      "snagging_snags",
      `id, job_id, area_id, snag_code, catalogue_entry_id, catalogue_code, element_label,
       defect_label, severity, note, floor_plan_id, pin_x, pin_y, status, round_created,
       created_at, created_by, locked${verdict}${review}`,
      heavyIds,
      since,
      "updated_at",
    ),
    // Not the GPS or EXIF: the phone keeps its own for what it shot, and
    // stores neither for a photo it pulls.
    roomsOnly
      ? none
      : loadChanged(
      admin,
      "snagging_snag_photos",
      `id, snag_id, job_id, storage_path, media_type, bytes, width, height, taken_at,
       round_number, marker_x, marker_y`,
      heavyIds,
      since,
      "created_at",
    ),
    roomsOnly
      ? none
      : loadChanged(
      admin,
      "snagging_job_checklist",
      "id, job_id, code, group_name, label, mandatory, status, reason, sort_order, visit_id",
      heavyIds,
      since,
      "updated_at",
    ),
    roomsOnly ? none : loadPlans(admin, heavyIds, since),
    // Who is on each job, to tell a co-inspector's defect from anyone else's.
    viewerId && !roomsOnly ? loadJobRosters(admin, heavyIds) : Promise.resolve(null),
  ]);

  /** Recorded by someone else who is on the same job. */
  const coInspectors = (jobId: unknown, authorId: unknown) =>
    Boolean(
      viewerId &&
        rosters &&
        typeof authorId === "string" &&
        authorId !== viewerId &&
        rosters.get(String(jobId))?.has(authorId),
    );

  const areas = areaRows.map(shapeArea);
  const snags = snagRows
    .filter((row) => !coInspectors(row.job_id, row.created_by))
    .map(shapeSnag);
  const checklist = checklistRows.map(shapeChecklistItem);
  const plans = planRows.map(shapePlan);

  /*
    A photo is only as private as the snag it belongs to.

    It cannot be filtered against the snags in THIS pull: a delta carries
    the photos added since the cursor, and the snag they hang off may not
    have changed since, so it is not in `snagRows`. Filtering on that would
    drop the inspector's own photos. So the question asked is the one that
    actually matters -- which snags on these jobs are mine -- over every
    snag on the job, not just the changed ones.

    One small read (id, job, author), and only when a phone is asking.
  */
  let visiblePhotoRows = photoRows;
  if (viewerId && rosters && !roomsOnly && photoRows.length > 0) {
    const authored = await readAllRows<{ id: string; job_id: string; created_by: string | null }>(
      (from, to) =>
        admin
          .from("snagging_snags")
          .select<string, { id: string; job_id: string; created_by: string | null }>(
            "id, job_id, created_by",
          )
          .in("job_id", heavyIds)
          .not("created_by", "is", null)
          .neq("created_by", viewerId)
          .order("id", { ascending: true })
          .range(from, to),
      "co-inspector snag ids",
    );
    const hidden = new Set(
      authored.filter((row) => coInspectors(row.job_id, row.created_by)).map((row) => row.id),
    );
    visiblePhotoRows = photoRows.filter(
      (row) => !hidden.has(String((row as Record<string, unknown>).snag_id)),
    );
  }
  const photos = visiblePhotoRows.map(shapePhoto);

  // Signed together: neither waits on the other.
  const [signedPlans, signedPhotos] = await Promise.all([
    signMediaPaths(admin, plans),
    signMediaPaths(admin, photos),
  ]);

  return {
    areas,
    snags,
    photos: signedPhotos.map(linkOnly),
    checklist,
    floor_plans: signedPlans.map(linkOnly),
  };
}

/**
 * The inspector's floor plans, each with its own id so a pinned snag can
 * point at the right floor (G3).
 *
 * On a delta, only the plans that changed since the cursor. Every plan used
 * to be re-sent and re-signed on every pull, changed or not -- the whole
 * payload of a pull that otherwise brought nothing. A pull without a cursor
 * (cold start, the reconciling snapshot, the offline pack) still sends them
 * all, freshly signed, which is also what renews a plan's signed URL for a
 * device that has not cached it to disk.
 */
async function loadPlans(
  admin: Admin,
  jobIds: string[],
  since: string | undefined,
): Promise<ChildRow[]> {
  const column = since
    ? (await plansHaveUpdatedAt(admin))
      ? "updated_at"
      : "created_at"
    : null;
  return readAllRows<ChildRow>((from, to) => {
    let query = admin
      .from("snagging_floor_plans")
      .select<string, ChildRow>("id, job_id, label, storage_path, width, height, sort_order")
      .in("job_id", jobIds);
    if (since && column) query = query.gt(column, since);
    /* id last, so rows with the same created_at and sort_order still page
       in a fixed order. */
    return query
      .order("created_at", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
  }, "snagging_floor_plans");
}

/*
  One address per file. The app stores the signed link and falls back to
  the storage path only when there is no link, so sending both put every
  photo's and plan's path on the wire for nothing.
*/
function linkOnly<T extends { storage_path?: string; signed_url?: string | null }>(row: T) {
  if (!row.signed_url) return row;
  const { storage_path: _path, ...rest } = row;
  void _path;
  return rest;
}

/* The wire keys the app reads, mapped off the server's column names. */

export function shapeArea(a: ChildRow) {
  return {
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
      to the pin -- both paths stay live permanently.
    */
    zone: a.zone ?? null,
    // Field inspection (Module 4): area start time + limited-access elements.
    started_at: a.started_at ?? null,
    elements_not_checked: a.elements_not_checked ?? null,
    // Which inspector this room belongs to, where a job has several.
    inspector_id: a.inspector_id ?? null,
  };
}

export function shapeSnag(s: ChildRow) {
  return {
    id: s.id,
    origin_task_id: s.job_id,
    area_id: s.area_id,
    snag_code: s.snag_code,
    catalogue_entry_id: s.catalogue_entry_id,
    catalogue_code: s.catalogue_code,
    // area_code / element_code / defect_code were always sent as null; the
    // app writes null when they are absent, so they are left off the wire.
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
    // The inspector's comment on the round's verdict (null until given).
    verdict_note: s.verdict_note ?? null,
    // The reviewer or approver's note to the inspector.
    review_note: s.review_note ?? null,
  };
}

export function shapeChecklistItem(c: ChildRow) {
  return {
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
      -- so a device that had not seen the job before, or one restored
      from a cold pull, had every answer with no visit against it. The
      report can then no longer say which pass found what, which is the
      only reason the stamp exists.
    */
    visit_id: c.visit_id ?? null,
  };
}

export function shapePhoto(p: ChildRow) {
  return {
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
    // Exact defect spot on the photo (FR-4.06).
    marker_x: (p.marker_x as number | null) ?? null,
    marker_y: (p.marker_y as number | null) ?? null,
  };
}

export function shapePlan(p: ChildRow) {
  return {
    id: p.id as string,
    task_id: p.job_id,
    label: p.label,
    storage_path: p.storage_path as string,
    width: p.width,
    height: p.height,
    sort_order: p.sort_order,
  };
}
