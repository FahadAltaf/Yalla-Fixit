import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

const CONFIG_COLUMNS = "org_timezone, night_shift_start, night_shift_end, day_shift_start, day_shift_end";

// AUD-006: org timezone and day/night shift boundaries are portal-admin
// configurable (via public.settings); the dashboard reads them here rather
// than hardcoding shift hours.
export async function GET() {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = await createAdminServerClient();
    const { data: settings, error } = await admin.from("settings").select(CONFIG_COLUMNS).eq("id", 1).single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ data: settings });
  } catch (error) {
    console.error("Scheduling config GET error:", error);
    return NextResponse.json({ error: "Failed to load scheduling configuration" }, { status: 500 });
  }
}

// "HH:mm" or "HH:mm:ss", 24-hour.
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Expected a time as HH:mm");

const bodySchema = z
  .object({
    night_shift_start: clock.optional(),
    night_shift_end: clock.optional(),
    day_shift_start: clock.optional(),
    day_shift_end: clock.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to change" });

// The hours each shift's grid shows, set by the team from the board itself
// (2 Oct 2026). Anyone who may edit the schedule may change them; the change
// is for everyone and is recorded. An end at or before the start means the
// shift runs past midnight, which the board understands.
export async function PUT(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const admin = await createAdminServerClient();
    const { data: before, error: readError } = await admin.from("settings").select(CONFIG_COLUMNS).eq("id", 1).single();
    if (readError) throw new Error(readError.message);

    const { data: after, error: updateError } = await admin
      .from("settings")
      .update(parsed.data)
      .eq("id", 1)
      .select(CONFIG_COLUMNS)
      .single();
    if (updateError) throw new Error(updateError.message);

    await admin.from("schedule_audit_events").insert({
      event_type: "shift_hours_changed",
      actor_id: profile.id,
      origin: "portal",
      before_value: before,
      after_value: after,
    });

    return NextResponse.json({ data: after });
  } catch (error) {
    console.error("Scheduling config PUT error:", error);
    return NextResponse.json({ error: "Failed to save the shift hours" }, { status: 500 });
  }
}
