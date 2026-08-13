import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

const assignmentSchema = z.object({
  technicianFsmId: z.string().trim().min(1),
  tagId: z.string().uuid(),
});

// DASH-017/TAG-001: current tag assignments for every technician, keyed by
// technician id, for the scheduling dashboard and leave module to render.
export async function GET() {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = await createAdminServerClient();
    const { data, error } = await admin
      .from("technician_tag_assignments")
      .select("technician_fsm_id, tag_id, technician_tags(id, name)");
    if (error) throw new Error(error.message);

    const byTechnician = new Map<string, Array<{ id: string; name: string }>>();
    (data ?? []).forEach((row: any) => {
      const list = byTechnician.get(row.technician_fsm_id) ?? [];
      if (row.technician_tags) list.push(row.technician_tags);
      byTechnician.set(row.technician_fsm_id, list);
    });

    return NextResponse.json({ data: Object.fromEntries(byTechnician) });
  } catch (error) {
    console.error("Tag assignments GET error:", error);
    return NextResponse.json({ error: "Failed to load tag assignments" }, { status: 500 });
  }
}

// TAG-005: assign or remove one or more tags for a technician.
export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = assignmentSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const admin = await createAdminServerClient();
    const { error } = await admin.from("technician_tag_assignments").upsert(
      {
        technician_fsm_id: parsed.data.technicianFsmId,
        tag_id: parsed.data.tagId,
        assigned_by: profile.id,
      },
      { onConflict: "technician_fsm_id,tag_id", ignoreDuplicates: true },
    );
    if (error) throw new Error(error.message);

    await admin.from("schedule_audit_events").insert({
      event_type: "tag_assigned",
      actor_id: profile.id,
      origin: "portal",
      affected_entity_type: "technician_tag_assignment",
      affected_entity_id: `${parsed.data.technicianFsmId}:${parsed.data.tagId}`,
      after_value: parsed.data,
    });

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("Tag assignment POST error:", error);
    return NextResponse.json({ error: "Failed to assign tag" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const technicianFsmId = req.nextUrl.searchParams.get("technicianFsmId");
    const tagId = req.nextUrl.searchParams.get("tagId");
    if (!technicianFsmId || !tagId) {
      return NextResponse.json({ error: "technicianFsmId and tagId are required" }, { status: 400 });
    }

    const admin = await createAdminServerClient();
    const { error } = await admin
      .from("technician_tag_assignments")
      .delete()
      .eq("technician_fsm_id", technicianFsmId)
      .eq("tag_id", tagId);
    if (error) throw new Error(error.message);

    await admin.from("schedule_audit_events").insert({
      event_type: "tag_removed",
      actor_id: profile.id,
      origin: "portal",
      affected_entity_type: "technician_tag_assignment",
      affected_entity_id: `${technicianFsmId}:${tagId}`,
      before_value: { technicianFsmId, tagId },
    });

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("Tag assignment DELETE error:", error);
    return NextResponse.json({ error: "Failed to remove tag" }, { status: 500 });
  }
}
