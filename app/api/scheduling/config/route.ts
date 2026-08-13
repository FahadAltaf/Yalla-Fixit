import { NextResponse } from "next/server";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";

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
    const { data: settings, error } = await admin
      .from("settings")
      .select("org_timezone, night_shift_start, night_shift_end, day_shift_start, day_shift_end")
      .eq("id", 1)
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ data: settings });
  } catch (error) {
    console.error("Scheduling config GET error:", error);
    return NextResponse.json({ error: "Failed to load scheduling configuration" }, { status: 500 });
  }
}
