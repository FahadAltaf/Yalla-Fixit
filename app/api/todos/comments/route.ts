import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { createServerClientForApi } from "@/lib/supabase/supabase-server-client";
import { UserRoles } from "@/types/types";

const createCommentSchema = z.object({
  todoId: z.string().uuid(),
  body: z.string().trim().min(1),
});

async function getCurrentProfile() {
  const sessionClient = await createServerClientForApi();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();
  if (!user?.id) return null;

  const admin = await createAdminServerClient();
  const { data } = await admin
    .from("user_profile")
    .select("id,email,roles(name)")
    .eq("id", user.id)
    .single();

  return data as unknown as {
    id: string;
    email?: string;
    roles?: { name?: string } | Array<{ name?: string }>;
  } | null;
}

async function canAccessTodo(todoId: string, userId: string, isAdmin: boolean) {
  if (isAdmin) return true;
  const admin = await createAdminServerClient();
  const [{ data: owned }, { data: assigned }] = await Promise.all([
    admin.from("todos").select("id").eq("id", todoId).eq("owner_id", userId).maybeSingle(),
    admin.from("todo_assignees").select("todo_id").eq("todo_id", todoId).eq("user_id", userId).maybeSingle(),
  ]);
  return Boolean(owned || assigned);
}

export async function POST(req: NextRequest) {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = createCommentSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const role = Array.isArray(profile.roles) ? profile.roles[0] : profile.roles;
    const isAdmin = role?.name === UserRoles.ADMIN;
    const hasAccess = await canAccessTodo(parsed.data.todoId, profile.id, isAdmin);
    if (!hasAccess) return NextResponse.json({ error: "Todo not found" }, { status: 404 });

    const admin = await createAdminServerClient();
    const { error } = await admin.from("todo_comments").insert({
      todo_id: parsed.data.todoId,
      author_id: profile.id,
      body: parsed.data.body,
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({ data: { id: parsed.data.todoId } });
  } catch (error) {
    console.error("Todo comments POST error:", error);
    return NextResponse.json({ error: "Failed to add comment" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = req.nextUrl.searchParams.get("id");
    const todoId = req.nextUrl.searchParams.get("todoId");
    if (!id || !todoId) {
      return NextResponse.json({ error: "Comment ID and todo ID are required" }, { status: 400 });
    }

    const role = Array.isArray(profile.roles) ? profile.roles[0] : profile.roles;
    const isAdmin = role?.name === UserRoles.ADMIN;
    const hasAccess = await canAccessTodo(todoId, profile.id, isAdmin);
    if (!hasAccess) return NextResponse.json({ error: "Todo not found" }, { status: 404 });

    const admin = await createAdminServerClient();
    let query = admin.from("todo_comments").delete().eq("id", id).eq("todo_id", todoId);
    if (!isAdmin) {
      query = query.eq("author_id", profile.id);
    }
    const { error } = await query;
    if (error) throw new Error(error.message);

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("Todo comments DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete comment" }, { status: 500 });
  }
}
