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
 * In the lean schema a round is simply a new snagging_jobs row that
 * points back at its parent. Areas belong to a job, so the round gets
 * its own copy of the parent's areas, and the outstanding snags are
 * carried forward as fresh rows against the new job (remapped onto the
 * copied areas) with status pending_verification: the developer has
 * claimed these are fixed and this round is us going to check.
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
      .from("snagging_jobs")
      .select(
        `id, code, status, round_number, client_id, property_id, unit_label, building_name, community,
         property_type, developer_name, inspector_id, approval_manager_id, scheduled_date`,
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

    const nextRound = (parent.round_number ?? 1) + 1;

    // FR-6.02: everything still outstanding on the parent job, unless the
    // reviewer narrowed the list to a chosen subset.
    let snagQuery = admin
      .from("snagging_snags")
      .select(
        `id, area_id, snag_code, catalogue_entry_id, catalogue_code, element_label,
         defect_label, severity, note, pin_x, pin_y, status`,
      )
      .eq("job_id", parent.id)
      .in("status", CARRY_FORWARD_STATUSES);

    if (input.snag_ids && input.snag_ids.length > 0) {
      snagQuery = snagQuery.in("id", input.snag_ids);
    }

    const { data: openSnags, error: snagError } = await snagQuery;
    if (snagError) throw new Error(snagError.message);

    if (!openSnags || openSnags.length === 0) {
      return NextResponse.json(
        { error: "Nothing outstanding on this job, so there is nothing to re-inspect" },
        { status: 409 },
      );
    }

    // 1) The round itself: a new job that inherits the parent's context.
    const inspectorId =
      input.technician_ids.length > 0 ? input.technician_ids[0] : parent.inspector_id;

    const { data: round, error: roundError } = await admin
      .from("snagging_jobs")
      .insert({
        code: roundCode(parent.code, nextRound),
        status: "assigned",
        visit_type: "desnag",
        round_number: nextRound,
        parent_job_id: parent.id,
        client_id: parent.client_id,
        property_id: parent.property_id,
        unit_label: parent.unit_label,
        building_name: parent.building_name,
        community: parent.community,
        property_type: parent.property_type,
        developer_name: parent.developer_name,
        inspector_id: inspectorId,
        approval_manager_id: input.approval_manager_id ?? parent.approval_manager_id,
        scheduled_date: input.scheduled_date?.trim() || parent.scheduled_date,
        notes: input.notes?.trim() || null,
        created_by: profile.id,
      })
      .select("id, code")
      .single();

    if (roundError) throw new Error(roundError.message);

    // 2) Copy the parent's areas into the new job, keeping an
    //    old-area-id -> new-area-id map so the carried snags can be
    //    re-pinned onto the round's own area rows.
    const { data: parentAreas, error: areaLoadError } = await admin
      .from("snagging_areas")
      .select("id, name, catalogue_area_code, sort_order")
      .eq("job_id", parent.id)
      .order("sort_order", { ascending: true });
    if (areaLoadError) throw new Error(areaLoadError.message);

    const areaIdMap = new Map<string, string>();
    for (const area of parentAreas ?? []) {
      const { data: newArea, error: areaInsertError } = await admin
        .from("snagging_areas")
        .insert({
          job_id: round.id,
          name: area.name,
          catalogue_area_code: area.catalogue_area_code,
          sort_order: area.sort_order,
        })
        .select("id")
        .single();
      if (areaInsertError) throw new Error(areaInsertError.message);
      areaIdMap.set(area.id, newArea.id);
    }

    // 3) Carry the outstanding snags forward as fresh rows on the round,
    //    remapped onto the copied areas and marked pending_verification.
    const carriedRows = openSnags.map((snag) => ({
      job_id: round.id,
      area_id: snag.area_id ? areaIdMap.get(snag.area_id) ?? null : null,
      snag_code: snag.snag_code,
      catalogue_entry_id: snag.catalogue_entry_id,
      catalogue_code: snag.catalogue_code,
      element_label: snag.element_label,
      defect_label: snag.defect_label,
      severity: snag.severity,
      note: snag.note,
      pin_x: snag.pin_x,
      pin_y: snag.pin_y,
      status: "pending_verification" as const,
      round_created: nextRound,
    }));

    const { error: carryError } = await admin.from("snagging_snags").insert(carriedRows);
    if (carryError) throw new Error(carryError.message);

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
        parent_job_id: parent.id,
        carried_snags: carriedRows.length,
        areas: areaIdMap.size,
      },
    });

    return NextResponse.json(
      {
        data: {
          id: round.id,
          code: round.code,
          round_number: nextRound,
          carried_snags: carriedRows.length,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Snagging round POST error:", error);
    return NextResponse.json({ error: "Failed to open re-inspection round" }, { status: 500 });
  }
}
