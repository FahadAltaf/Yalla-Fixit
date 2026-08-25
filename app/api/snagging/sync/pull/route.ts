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
      include_catalogue: req.nextUrl.searchParams.get("include_catalogue") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
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
      .in("status", ["assigned", "in_progress", "submitted", "in_review", "rejected", "approved", "delivered"]);
    if (assignedError) throw new Error(assignedError.message);

    const jobIds = (assigned ?? []).map((r) => r.id);
    if (jobIds.length === 0) return NextResponse.json({ data: empty });

    // 2. Jobs -> wire "tasks" (with a property sub-object + team list).
    let jobQuery = admin
      .from("snagging_jobs")
      .select(
        `id, code, status, round_number, visit_type, visit_charge, parent_job_id, scheduled_date, notes,
         locked, rejection_reason, rejection_category, remediation_due_at, updated_at,
         unit_label, building_name, community, property_type, developer_name,
         floor_plan_path, floor_plan_width, floor_plan_height,
         client:client_id(name, email, phone),
         inspector:inspector_id(full_name, email)`,
      )
      .in("id", jobIds);
    if (since) jobQuery = jobQuery.gt("updated_at", since);
    const { data: jobs, error: jobError } = await jobQuery;
    if (jobError) throw new Error(jobError.message);

    const tasks = (jobs ?? []).map((job) => {
      const j = job as JobRow;
      const client = firstOf(j.client);
      const insp = firstOf(j.inspector);
      const team = [insp?.full_name || insp?.email].filter((n): n is string => Boolean(n));
      return {
        id: j.id,
        code: j.code,
        task_type: "single_unit",
        status: j.status,
        round_number: j.round_number,
        visit_type: j.visit_type ?? "initial",
        visit_charge: j.visit_charge,
        parent_task_id: j.parent_job_id,
        scheduled_date: j.scheduled_date,
        notes: j.notes,
        locked: j.locked,
        catalogue_version: "v1.0",
        rejection_category: j.rejection_category,
        rejection_reason: j.rejection_reason,
        remediation_due_at: j.remediation_due_at,
        updated_at: j.updated_at,
        property: {
          client_name: client?.name ?? "",
          client_email: client?.email ?? null,
          client_phone: client?.phone ?? null,
          unit_label: j.unit_label,
          building_name: j.building_name,
          community: j.community,
          city: "Dubai",
          property_type: j.property_type,
          developer_name: j.developer_name,
        },
        team,
      };
    });

    // 3. Children. Remap the new column names onto the wire keys the app reads.
    const [areaRows, snagRows, photoRows, checklistRows] = await Promise.all([
      loadChanged(admin, "snagging_areas", "job_id", jobIds, since, "updated_at"),
      loadChanged(admin, "snagging_snags", "job_id", jobIds, since, "updated_at"),
      loadChanged(admin, "snagging_snag_photos", "job_id", jobIds, since, "created_at"),
      loadChanged(admin, "snagging_job_checklist", "job_id", jobIds, since, "updated_at"),
    ]);

    const areas = areaRows.map((a) => ({
      id: a.id,
      task_id: a.job_id,
      name: a.name,
      catalogue_area_code: a.catalogue_area_code,
      sort_order: a.sort_order,
      status: a.status,
      note: a.note,
      confirmed_at: a.confirmed_at,
      access_state: a.access_state ?? "accessible",
      access_reason: a.access_reason ?? null,
      // Area pin on a floor plan (FR-3.05/3.07).
      floor_plan_id: a.floor_plan_id ?? null,
      pin_x: a.pin_x ?? null,
      pin_y: a.pin_y ?? null,
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
      gps_lat: (p.gps_lat as number | null) ?? null,
      gps_lng: (p.gps_lng as number | null) ?? null,
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
      coldStart || parsed.data.include_catalogue === true || (await catalogueChangedSince(admin, since!));

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

type Joined = { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null;
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
  unit_label: string;
  building_name: string | null;
  community: string | null;
  property_type: string | null;
  developer_name: string | null;
  floor_plan_path: string | null;
  floor_plan_width: number | null;
  floor_plan_height: number | null;
  client: { name: string | null; email: string | null; phone: string | null } | { name: string | null; email: string | null; phone: string | null }[] | null;
  inspector: Joined;
};

function firstOf<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

type ChildRow = Record<string, unknown> & { id: string; job_id: string };

async function loadChanged(
  admin: Admin,
  table: string,
  foreignKey: string,
  jobIds: string[],
  since: string | undefined,
  timestampColumn: string,
): Promise<ChildRow[]> {
  let query = admin.from(table).select("*").in(foreignKey, jobIds);
  if (since) query = query.gt(timestampColumn, since);
  const { data, error } = await query;
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []) as ChildRow[];
}

async function catalogueChangedSince(admin: Admin, since: string): Promise<boolean> {
  const { count, error } = await admin
    .from("snagging_catalogue_entries")
    .select("id", { count: "exact", head: true })
    .gt("updated_at", since);
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

/**
 * The full controlled vocabulary. The area/element matrix now lives in
 * `snagging_catalogue_areas.element_codes[]`; it is expanded back into the
 * {area_code, element_code} pairs the app already stores.
 */
async function loadCatalogue(admin: Admin) {
  const [entries, areas] = await Promise.all([
    admin
      .from("snagging_catalogue_entries")
      .select(`id, code, element_code, element_label, defect_code, defect_label, default_severity, guidance, catalogue_version, active, sort_order`)
      .eq("active", true)
      .order("sort_order", { ascending: true }),
    admin
      .from("snagging_catalogue_areas")
      .select("code, label, sort_order, element_codes")
      .order("sort_order", { ascending: true }),
  ]);

  if (entries.error) throw new Error(entries.error.message);
  if (areas.error) throw new Error(areas.error.message);

  const areaRows = (areas.data ?? []) as Array<{ code: string; label: string; sort_order: number; element_codes: string[] | null }>;
  const area_elements: Array<{ area_code: string; element_code: string; sort_order: number }> = [];
  for (const area of areaRows) {
    (area.element_codes ?? []).forEach((element_code, index) => {
      area_elements.push({ area_code: area.code, element_code, sort_order: index });
    });
  }

  return {
    version: entries.data?.[0]?.catalogue_version ?? "v1.0",
    entries: entries.data ?? [],
    areas: areaRows.map(({ code, label, sort_order }) => ({ code, label, sort_order })),
    area_elements,
  };
}
