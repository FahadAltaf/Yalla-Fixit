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
 * receives everything that changed since. The cursor is the server's
 * own clock rather than the phone's, because a handset that has been
 * offline on a site for two days is frequently the one with the wrong
 * time.
 *
 * The catalogue is the largest part of a cold start and almost never
 * changes, so it is sent only on a cold pull, when the caller asks, or
 * when an entry has actually moved since the cursor.
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
    // Captured before any read, so a row written mid-request is picked
    // up by the next pull rather than skipped by both.
    const serverTime = new Date().toISOString();

    // 1. Which jobs is this inspector on?
    const { data: assignments, error: assignmentError } = await admin
      .from("snagging_task_assignees")
      .select("task_id")
      .eq("user_id", profile.id);
    if (assignmentError) throw new Error(assignmentError.message);

    const taskIds = (assignments ?? []).map((row) => row.task_id);

    if (taskIds.length === 0) {
      return NextResponse.json({
        data: {
          server_time: serverTime,
          cold_start: coldStart,
          catalogue: coldStart ? await loadCatalogue(admin) : null,
          tasks: [],
          areas: [],
          snags: [],
          photos: [],
          floor_plans: [],
          verifications: [],
        },
      });
    }

    // 2. Tasks. A delivered job stays on the device for a week so the
    // inspector can still show the client what was recorded, then falls
    // out of the pull and is pruned locally.
    let taskQuery = admin
      .from("snagging_tasks")
      .select(
        `id, code, task_type, status, round_number, parent_task_id, scheduled_date,
         scheduled_start_at, scheduled_end_at, package_name, service_tier, notes,
         locked, catalogue_version, rejection_category, rejection_reason,
         remediation_due_at, updated_at, property_id,
         property:snagging_properties(id, client_name, unit_label, building_name,
           community, city, property_type, developer_name),
         assignees:snagging_task_assignees(user_profile:user_id(full_name, email))`,
      )
      .in("id", taskIds)
      .in("status", [
        "assigned",
        "in_progress",
        "submitted",
        "in_review",
        "rejected",
        "approved",
        "delivered",
      ]);

    if (since) taskQuery = taskQuery.gt("updated_at", since);

    const { data: tasks, error: taskError } = await taskQuery;
    if (taskError) throw new Error(taskError.message);

    // Children are pulled for every assigned task, not only the ones
    // whose own row changed: a snag edited by the office does not touch
    // its task's updated_at.
    const [areas, snags, photos, plans, verifications] = await Promise.all([
      loadChanged(admin, "snagging_areas", "task_id", taskIds, since, "updated_at"),
      loadChanged(admin, "snagging_snags", "origin_task_id", taskIds, since, "updated_at"),
      loadChanged(admin, "snagging_snag_photos", "task_id", taskIds, since, "created_at"),
      loadChanged(admin, "snagging_floor_plans", "task_id", taskIds, since, "created_at"),
      loadChanged(
        admin,
        "snagging_snag_verifications",
        "round_task_id",
        taskIds,
        since,
        "created_at",
      ),
    ]);

    // Floor plans and photos are both signed so a device that did not
    // capture them — a second inspector on the job, or a phone that was
    // reinstalled — can still show them. A phone that took a photo has it
    // locally and simply ignores the URL.
    const [signedPlans, signedPhotos] = await Promise.all([
      signMediaPaths(admin, plans),
      signMediaPaths(admin, photos),
    ]);

    // Fold each task's assignees into a plain list of names for the app.
    const tasksWithTeam = (tasks ?? []).map((task) => {
      const assignees = (task as { assignees?: Array<{ user_profile?: { full_name?: string | null; email?: string | null } | null }> }).assignees ?? [];
      const team = assignees
        .map((row) => row.user_profile?.full_name || row.user_profile?.email)
        .filter((name): name is string => Boolean(name));
      const { assignees: _drop, ...rest } = task as Record<string, unknown> & { assignees?: unknown };
      return { ...rest, team };
    });

    const catalogueChanged =
      coldStart ||
      parsed.data.include_catalogue === true ||
      (await catalogueChangedSince(admin, since!));

    return NextResponse.json({
      data: {
        server_time: serverTime,
        cold_start: coldStart,
        catalogue: catalogueChanged ? await loadCatalogue(admin) : null,
        tasks: tasksWithTeam,
        areas,
        snags,
        photos: signedPhotos,
        floor_plans: signedPlans,
        verifications,
      },
    });
  } catch (error) {
    console.error("Snagging sync pull error:", error);
    return NextResponse.json({ error: "Failed to sync" }, { status: 500 });
  }
}

type Admin = Awaited<ReturnType<typeof createAdminServerClient>>;

async function loadChanged(
  admin: Admin,
  table: string,
  foreignKey: string,
  taskIds: string[],
  since: string | undefined,
  timestampColumn: string,
) {
  let query = admin.from(table).select("*").in(foreignKey, taskIds);
  if (since) query = query.gt(timestampColumn, since);

  const { data, error } = await query;
  if (error) throw new Error(`${table}: ${error.message}`);
  return data ?? [];
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
 * The full controlled vocabulary: defect entries, the area list, and
 * the applicability matrix that tells the capture sheet which elements
 * to offer in which room.
 */
async function loadCatalogue(admin: Admin) {
  const [entries, areas, matrix] = await Promise.all([
    admin
      .from("snagging_catalogue_entries")
      .select(
        `id, code, element_code, element_label, defect_code, defect_label,
         default_severity, guidance, catalogue_version, active, sort_order`,
      )
      .eq("active", true)
      .order("sort_order", { ascending: true }),
    admin
      .from("snagging_catalogue_areas")
      .select("code, label, sort_order")
      .eq("active", true)
      .order("sort_order", { ascending: true }),
    admin
      .from("snagging_catalogue_area_elements")
      .select("area_code, element_code, sort_order")
      .order("sort_order", { ascending: true }),
  ]);

  if (entries.error) throw new Error(entries.error.message);
  if (areas.error) throw new Error(areas.error.message);
  if (matrix.error) throw new Error(matrix.error.message);

  return {
    version: entries.data?.[0]?.catalogue_version ?? "v1.0",
    entries: entries.data ?? [],
    areas: areas.data ?? [],
    area_elements: matrix.data ?? [],
  };
}
