import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

// Saves the team-arranged technician order for the schedule board (the
// "Custom" sort). The body is the full list of technician ids, top to bottom;
// position = index + 1.
const schema = z.object({
  order: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(5000)
    .refine((ids) => new Set(ids).size === ids.length, "Each technician can only appear once"),
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
    const { order } = parsed.data;

    const admin = await createAdminServerClient();
    const { data, error } = await admin.rpc("set_technician_board_order", { p_fsm_resource_ids: order });
    if (error) {
      // PGRST202 = function not found: the migration hasn't been applied yet.
      if (error.code === "PGRST202" || error.code === "42883") {
        return NextResponse.json(
          {
            error:
              "Saving the technician order needs migration 20260917090000_technician_board_order.sql applied first.",
          },
          { status: 500 },
        );
      }
      throw new Error(error.message);
    }

    await admin.from("schedule_audit_events").insert({
      event_type: "technician_order_updated",
      actor_id: profile.id,
      origin: "portal",
      affected_entity_type: "technician_reference",
      after_value: { order },
    });

    return NextResponse.json({ data: { updated: typeof data === "number" ? data : order.length } });
  } catch (error) {
    console.error("Technician order PUT error:", error);
    const message = error instanceof Error ? error.message : "Failed to save the technician order";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
