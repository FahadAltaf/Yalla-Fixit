import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { generateTaskCode } from "@/lib/server/snagging/workflow";
import { createTaskSchema } from "@/modules/snagging/schemas";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Inspection tasks (FR-1.01 to FR-1.06).
 *
 * GET reads the `snagging_task_summaries` view so the list screen gets
 * its per-row counters in one query instead of fanning out per task.
 */
export async function GET(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const params = req.nextUrl.searchParams;
    const page = Math.max(0, Number(params.get("page") ?? 0));
    const pageSize = Math.min(200, Math.max(1, Number(params.get("pageSize") ?? 25)));

    const admin = await createAdminServerClient();
    let query = admin
      .from("snagging_task_summaries")
      .select("*", { count: "exact" });

    const status = params.get("status");
    if (status && status !== "all") {
      query = query.in("status", status.split(","));
    }

    const search = params.get("search")?.trim();
    if (search) {
      const term = `%${search}%`;
      query = query.or(
        [
          `code.ilike.${term}`,
          `unit_label.ilike.${term}`,
          `building_name.ilike.${term}`,
          `client_name.ilike.${term}`,
          `community.ilike.${term}`,
        ].join(","),
      );
    }

    const developer = params.get("developer");
    if (developer && developer !== "all") query = query.eq("developer_name", developer);

    const from = params.get("from");
    if (from) query = query.gte("scheduled_date", from);

    const to = params.get("to");
    if (to) query = query.lte("scheduled_date", to);

    // The approval queue: submitted work, oldest SLA first (FR-4.06).
    if (params.get("queue") === "approval") {
      query = query
        .in("status", ["submitted", "in_review"])
        .order("approval_due_at", { ascending: true, nullsFirst: false });
    } else {
      const sortBy = params.get("sortBy") ?? "scheduled_date";
      const ascending = params.get("sortDirection") !== "desc";
      query = query.order(sortBy, { ascending, nullsFirst: false });
    }

    // An inspector without All Records access only ever sees their own
    // jobs; the mobile app relies on this rather than filtering client
    // side.
    const assigneeId = params.get("assigneeId");
    if (assigneeId) {
      const { data: assigned, error: assignedError } = await admin
        .from("snagging_task_assignees")
        .select("task_id")
        .eq("user_id", assigneeId);
      if (assignedError) throw new Error(assignedError.message);

      const ids = (assigned ?? []).map((row) => row.task_id);
      if (ids.length === 0) {
        return NextResponse.json({ data: [], totalCount: 0 });
      }
      query = query.in("id", ids);
    }

    const { data, error, count } = await query.range(
      page * pageSize,
      page * pageSize + pageSize - 1,
    );
    if (error) throw new Error(error.message);

    // The summary view carries the supervisor and manager but not the
    // technicians or the medium/low severity split, both of which the
    // jobs table shows. Two extra queries scoped to the page's task ids
    // rather than folding either into the view, which would fan the row
    // count out before it aggregates.
    const rows = (data ?? []) as SummaryRow[];
    const enriched = await enrichRows(admin, rows);

    return NextResponse.json({ data: enriched, totalCount: count ?? 0 });
  } catch (error) {
    console.error("Snagging tasks GET error:", error);
    return NextResponse.json({ error: "Failed to load inspections" }, { status: 500 });
  }
}

type SummaryRow = { id: string; [key: string]: unknown };
type EnrichedRow = SummaryRow & {
  inspector_name: string | null;
  medium_severity_count: number;
  low_severity_count: number;
};

/** Adds the first technician's name and the M/L severity split. */
async function enrichRows(
  admin: Awaited<ReturnType<typeof createAdminServerClient>>,
  rows: SummaryRow[],
): Promise<EnrichedRow[]> {
  if (rows.length === 0) return [];
  const taskIds = rows.map((row) => row.id);

  const [assignees, snags] = await Promise.all([
    admin
      .from("snagging_task_assignees")
      .select("task_id, user_profile:user_id(full_name, email)")
      .in("task_id", taskIds)
      .eq("role", "technician"),
    admin
      .from("snagging_snags")
      .select("origin_task_id, severity")
      .in("origin_task_id", taskIds)
      .neq("status", "withdrawn"),
  ]);

  if (assignees.error) throw new Error(assignees.error.message);
  if (snags.error) throw new Error(snags.error.message);

  const inspectorByTask = new Map<string, string>();
  for (const row of (assignees.data ?? []) as Array<{
    task_id: string;
    user_profile:
      | { full_name: string | null; email: string | null }
      | { full_name: string | null; email: string | null }[]
      | null;
  }>) {
    if (inspectorByTask.has(row.task_id)) continue;
    const profile = Array.isArray(row.user_profile) ? row.user_profile[0] : row.user_profile;
    const name = profile?.full_name ?? profile?.email ?? null;
    if (name) inspectorByTask.set(row.task_id, name);
  }

  const medium = new Map<string, number>();
  const low = new Map<string, number>();
  for (const snag of (snags.data ?? []) as Array<{ origin_task_id: string; severity: string }>) {
    const target = snag.severity === "medium" ? medium : snag.severity === "low" ? low : null;
    if (target) target.set(snag.origin_task_id, (target.get(snag.origin_task_id) ?? 0) + 1);
  }

  return rows.map((row) => ({
    ...row,
    inspector_name: inspectorByTask.get(row.id) ?? null,
    medium_severity_count: medium.get(row.id) ?? 0,
    low_severity_count: low.get(row.id) ?? 0,
  }));
}

export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.CREATE)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = createTaskSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const input = parsed.data;

    const admin = await createAdminServerClient();

    // 1. Resolve the property (BR-1 — never free-form).
    let propertyId = input.property_id ?? null;
    if (!propertyId && input.property) {
      const p = input.property;
      const { data: created, error: propertyError } = await admin
        .from("snagging_properties")
        .insert({
          client_name: p.client_name,
          client_email: emptyToNull(p.client_email),
          client_phone: emptyToNull(p.client_phone),
          unit_label: p.unit_label,
          building_name: emptyToNull(p.building_name),
          community: emptyToNull(p.community),
          city: emptyToNull(p.city) ?? "Dubai",
          property_type: p.property_type,
          developer_name: emptyToNull(p.developer_name),
          handover_date: emptyToNull(p.handover_date),
          crm_contact_id: emptyToNull(p.crm_contact_id),
          crm_property_id: emptyToNull(p.crm_property_id),
          created_by: profile.id,
        })
        .select("id, unit_label, building_name, property_type")
        .single();
      if (propertyError) throw new Error(propertyError.message);
      propertyId = created.id;
    }

    const { data: property, error: propertyLoadError } = await admin
      .from("snagging_properties")
      .select("id, unit_label, building_name, property_type")
      .eq("id", propertyId)
      .single();
    if (propertyLoadError || !property) {
      return NextResponse.json({ error: "Property not found" }, { status: 400 });
    }

    // FR-1.02: a full-building engagement without a floor plan is not a
    // valid deliverable, so the task cannot be created assigned. It is
    // created as a draft until a plan is attached.
    const needsFloorPlan = input.task_type === "full_building";

    // 2. Create the task. The unique index on `code` is the arbiter;
    // a collision on the random suffix is retried rather than surfaced.
    let task: { id: string; code: string } | null = null;
    let lastError: string | null = null;
    for (let attempt = 0; attempt < 5 && !task; attempt += 1) {
      const code = generateTaskCode(property.unit_label, property.building_name);
      const { data, error } = await admin
        .from("snagging_tasks")
        .insert({
          code,
          property_id: property.id,
          task_type: input.task_type,
          service_tier: input.service_tier ?? null,
          package_name: emptyToNull(input.package_name),
          status: needsFloorPlan ? "draft" : "assigned",
          scheduled_date: emptyToNull(input.scheduled_date),
          scheduled_start_at: emptyToNull(input.scheduled_start_at),
          scheduled_end_at: emptyToNull(input.scheduled_end_at),
          supervisor_id: input.supervisor_id ?? null,
          approval_manager_id: input.approval_manager_id ?? null,
          notes: emptyToNull(input.notes),
          created_by: profile.id,
        })
        .select("id, code")
        .single();

      if (!error) {
        task = data;
        break;
      }
      lastError = error.message;
      // 23505 is a unique violation — only the code can collide here.
      if (error.code !== "23505") throw new Error(error.message);
    }

    if (!task) {
      throw new Error(lastError ?? "Could not allocate an inspection code");
    }

    // 3. Areas: explicit list wins, otherwise seed from the template for
    // the property type (FR-1.03).
    const areas = input.areas?.length
      ? input.areas.map((area, index) => ({
          task_id: task!.id,
          name: area.name,
          catalogue_area_code: area.catalogue_area_code ?? null,
          sort_order: (index + 1) * 10,
        }))
      : await areasFromTemplate(
          admin,
          task.id,
          input.area_template_property_type ?? property.property_type,
        );

    if (areas.length > 0) {
      const { error: areaError } = await admin.from("snagging_areas").insert(areas);
      if (areaError) throw new Error(areaError.message);
    }

    // 4. Assignees (FR-1.04).
    const assignees = [
      ...input.technician_ids.map((userId) => ({
        task_id: task!.id,
        user_id: userId,
        role: "technician" as const,
        assigned_by: profile.id,
      })),
      ...(input.supervisor_id
        ? [
            {
              task_id: task.id,
              user_id: input.supervisor_id,
              role: "supervisor" as const,
              assigned_by: profile.id,
            },
          ]
        : []),
    ];

    if (assignees.length > 0) {
      const { error: assigneeError } = await admin
        .from("snagging_task_assignees")
        .upsert(assignees, { onConflict: "task_id,user_id" });
      if (assigneeError) throw new Error(assigneeError.message);
    }

    await recordAudit(admin, {
      entityType: "task",
      entityId: task.id,
      taskId: task.id,
      eventType: "task_created",
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email,
      payload: {
        code: task.code,
        task_type: input.task_type,
        area_count: areas.length,
        technician_count: input.technician_ids.length,
      },
    });

    return NextResponse.json({ data: { id: task.id, code: task.code } }, { status: 201 });
  } catch (error) {
    console.error("Snagging tasks POST error:", error);
    return NextResponse.json({ error: "Failed to create inspection" }, { status: 500 });
  }
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

async function areasFromTemplate(
  admin: Awaited<ReturnType<typeof createAdminServerClient>>,
  taskId: string,
  propertyType: string,
) {
  const { data, error } = await admin
    .from("snagging_area_templates")
    .select("id, snagging_area_template_items(name, catalogue_area_code, sort_order)")
    .eq("property_type", propertyType)
    .eq("active", true)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return [];

  const items = (data.snagging_area_template_items ?? []) as Array<{
    name: string;
    catalogue_area_code: string;
    sort_order: number;
  }>;

  return items
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((item) => ({
      task_id: taskId,
      name: item.name,
      catalogue_area_code: item.catalogue_area_code,
      sort_order: item.sort_order,
    }));
}
