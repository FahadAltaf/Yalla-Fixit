import { NextResponse } from "next/server";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

// The people a submitter can send a day to for approval (E1): active users
// flagged with receives_schedule_approval_email. Same list that gets the email.
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
      .from("user_profile")
      .select("id, full_name, email")
      .eq("receives_schedule_approval_email", true)
      .eq("is_active", true)
      .order("full_name", { ascending: true });
    if (error) throw new Error(error.message);

    const approvers = (data ?? []).map((u: { id: string; full_name: string | null; email: string }) => ({
      id: u.id,
      name: u.full_name ?? u.email,
      email: u.email,
    }));
    return NextResponse.json({ data: approvers });
  } catch (error) {
    console.error("Approvers GET error:", error);
    return NextResponse.json({ error: "Failed to load approvers" }, { status: 500 });
  }
}
