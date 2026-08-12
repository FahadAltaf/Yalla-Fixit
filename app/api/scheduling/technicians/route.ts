import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

// Set managed attributes (role, service type, shift, team leader) on one or
// many technicians at once (#13 fields, #15 bulk edit). Only the keys present
// in `attributes` are changed, so a bulk edit can set just the role without
// clearing the rest. A key set to null explicitly clears that attribute.
const schema = z.object({
  fsmResourceIds: z.array(z.string().trim().min(1)).min(1),
  attributes: z.object({
    roleId: z.string().uuid().nullable().optional(),
    serviceTypeId: z.string().uuid().nullable().optional(),
    shift: z.enum(["morning", "night"]).nullable().optional(),
    teamLeaderFsmId: z.string().trim().min(1).nullable().optional(),
  }),
});

export async function PUT(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { fsmResourceIds, attributes } = parsed.data;

    const patch: Record<string, unknown> = {};
    if ("roleId" in attributes) patch.role_id = attributes.roleId ?? null;
    if ("serviceTypeId" in attributes) patch.service_type_id = attributes.serviceTypeId ?? null;
    if ("shift" in attributes) patch.shift = attributes.shift ?? null;
    if ("teamLeaderFsmId" in attributes) patch.team_leader_fsm_id = attributes.teamLeaderFsmId ?? null;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No attributes to update" }, { status: 400 });
    }

    // A technician can't be their own team leader.
    if (patch.team_leader_fsm_id && fsmResourceIds.includes(patch.team_leader_fsm_id as string)) {
      return NextResponse.json(
        { error: "A technician can't be their own team leader" },
        { status: 400 },
      );
    }

    const admin = await createAdminServerClient();
    const { data, error } = await admin
      .from("technician_reference")
      .update(patch)
      .in("fsm_resource_id", fsmResourceIds)
      .select("fsm_resource_id");
    if (error) throw new Error(error.message);

    await admin.from("schedule_audit_events").insert({
      event_type: "technician_attributes_updated",
      actor_id: profile.id,
      origin: "portal",
      affected_entity_type: "technician_reference",
      after_value: { fsmResourceIds, patch },
    });

    return NextResponse.json({ data: { updated: data?.length ?? 0 } });
  } catch (error) {
    console.error("Technicians PUT error:", error);
    const message = error instanceof Error ? error.message : "Failed to update technicians";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
