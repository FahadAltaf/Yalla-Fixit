import { NextResponse } from "next/server";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

/*
  FR-17: who can be @-mentioned in a task comment. Active users only, with
  just the fields the picker needs, so the browser is not handed the whole
  user directory for an autocomplete. A disabled account is left out: a
  mention emails a link to the task, and a disabled account cannot open it.
*/
export type MentionableUser = { id: string; name: string; email: string | null };

export async function GET() {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.TODOS, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = await createAdminServerClient();
    const { data, error } = await admin
      .from("user_profile")
      .select("id,email,first_name,last_name,full_name")
      .eq("is_active", true)
      .order("full_name", { ascending: true });
    if (error) throw new Error(error.message);

    const users: MentionableUser[] = (data ?? []).map(
      (row: { id: string; email: string | null; first_name: string | null; last_name: string | null; full_name: string | null }) => ({
        id: row.id,
        name: row.full_name || [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email || row.id,
        email: row.email,
      }),
    );
    return NextResponse.json({ data: users });
  } catch (error) {
    console.error("Todo mentionable-users GET error:", error);
    return NextResponse.json({ error: "Failed to load users" }, { status: 500 });
  }
}
