import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { CARRY_FORWARD_STATUSES, roundCode } from "@/lib/server/snagging/workflow";
import { createRoundSchema } from "@/modules/snagging/schemas";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Opens a de-snagging round against an inspection (FR-6.01, FR-6.02).
 *
 * The round is a new task; the snags are not copied. A snag is a
 * persistent entity owned by the property (§5.2), so the round works
 * against the same rows and records a verdict per snag. What the round
 * does carry is its own area list, limited to the areas that still have
 * something outstanding, so the inspector is not walked through rooms
 * that were signed off clean.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.CREATE)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const parsed = createRoundSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const input = parsed.data;

    const admin = await createAdminServerClient();

    const { data: parent, error: parentError } = await admin
      .from("snagging_tasks")
      .select(
        `id, code, property_id, project_id, task_type, service_tier, round_number,
         parent_task_id, approval_manager_id, supervisor_id, catalogue_version, status`,
      )
      .eq("id", id)
      .maybeSingle();

    if (parentError) throw new Error(parentError.message);
    if (!parent) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });

    // A round only makes sense once the previous visit has been signed
    // off; otherwise the outstanding list is still moving.
    if (!["approved", "delivered"].includes(parent.status)) {
      return NextResponse.json(
        { error: "Approve the previous round before opening a re-inspection" },
        { status: 409 },
      );
    }

    // Rounds chain off the original inspection, not off each other, so
    // round 3 still points at round 1 as its parent.
    const rootId = parent.parent_task_id ?? parent.id;

    const { data: siblings, error: siblingError } = await admin
      .from("snagging_tasks")
      .select("round_number")
      .or(`id.eq.${rootId},parent_task_id.eq.${rootId}`)
      .order("round_number", { ascending: false })
      .limit(1);
    if (siblingError) throw new Error(siblingError.message);

    const nextRound = (siblings?.[0]?.round_number ?? 1) + 1;

    // FR-6.02: everything still outstanding across the property, unless
    // the reviewer narrowed the list to a chosen subset.
    let snagQuery = admin
      .from("snagging_snags")
      .select("id, area_id, status, snagging_areas!inner(name, catalogue_area_code, sort_order)")
      .eq("property_id", parent.property_id)
      .in("status", CARRY_FORWARD_STATUSES);

    if (input.snag_ids && input.snag_ids.length > 0) {
      snagQuery = snagQuery.in("id", input.snag_ids);
    }

    const { data: openSnags, error: snagError } = await snagQuery;
    if (snagError) throw new Error(snagError.message);

    if (!openSnags || openSnags.length === 0) {
      return NextResponse.json(
        { error: "Nothing outstanding on this property, so there is nothing to re-inspect" },
        { status: 409 },
      );
    }

    const { data: round, error: roundError } = await admin
      .from("snagging_tasks")
      .insert({
        code: roundCode(parent.code, nextRound),
        project_id: parent.project_id,
        property_id: parent.property_id,
        task_type: parent.task_type,
        service_tier: parent.service_tier,
        package_name: `De-snag round ${nextRound}`,
        round_number: nextRound,
        parent_task_id: rootId,
        status: "assigned",
        scheduled_date: input.scheduled_date?.trim() || null,
        supervisor_id: parent.supervisor_id,
        approval_manager_id: input.approval_manager_id ?? parent.approval_manager_id,
        catalogue_version: parent.catalogue_version,
        notes: input.notes?.trim() || null,
        created_by: profile.id,
      })
      .select("id, code")
      .single();

    if (roundError) throw new Error(roundError.message);

    // Only the rooms with something left to verify.
    const areaByName = new Map<
      string,
      { name: string; catalogue_area_code: string | null; sort_order: number }
    >();
    for (const snag of openSnags) {
      const area = (snag as unknown as {
        snagging_areas: { name: string; catalogue_area_code: string | null; sort_order: number };
      }).snagging_areas;
      if (area && !areaByName.has(area.name)) areaByName.set(area.name, area);
    }

    const areas = [...areaByName.values()]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((area) => ({
        task_id: round.id,
        name: area.name,
        catalogue_area_code: area.catalogue_area_code,
        sort_order: area.sort_order,
      }));

    if (areas.length > 0) {
      const { error: areaError } = await admin.from("snagging_areas").insert(areas);
      if (areaError) throw new Error(areaError.message);
    }

    if (input.technician_ids.length > 0) {
      const { error: assigneeError } = await admin.from("snagging_task_assignees").insert(
        input.technician_ids.map((userId) => ({
          task_id: round.id,
          user_id: userId,
          role: "technician" as const,
          assigned_by: profile.id,
        })),
      );
      if (assigneeError) throw new Error(assigneeError.message);
    }

    // §5.2: the developer has claimed these are fixed, and this round
    // is us going to check. That is exactly "pending verification".
    const { error: statusError } = await admin
      .from("snagging_snags")
      .update({ status: "pending_verification" })
      .in(
        "id",
        openSnags.map((snag) => snag.id),
      )
      .eq("status", "open");
    if (statusError) throw new Error(statusError.message);

    await recordAudit(admin, {
      entityType: "task",
      entityId: round.id,
      taskId: round.id,
      eventType: "round_created",
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email,
      payload: {
        code: round.code,
        round_number: nextRound,
        parent_task_id: rootId,
        carried_snags: openSnags.length,
        areas: areas.length,
      },
    });

    return NextResponse.json(
      {
        data: {
          id: round.id,
          code: round.code,
          round_number: nextRound,
          carried_snags: openSnags.length,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Snagging round POST error:", error);
    return NextResponse.json({ error: "Failed to open re-inspection round" }, { status: 500 });
  }
}
