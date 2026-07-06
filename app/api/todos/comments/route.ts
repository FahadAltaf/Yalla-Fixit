import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import {
  canEditTodoRecord,
  canViewTodoRecord,
  hasResourceAction,
  isAdminUser,
} from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

const createCommentSchema = z.object({
  todoId: z.string().uuid(),
  body: z.string().trim().min(1),
});

async function loadTodoForAccess(todoId: string) {
  const admin = await createAdminServerClient();
  const [{ data: todo }, { data: assignees }] = await Promise.all([
    admin.from("todos").select("id,owner_id").eq("id", todoId).maybeSingle(),
    admin.from("todo_assignees").select("user_id").eq("todo_id", todoId),
  ]);

  if (!todo) return null;

  return {
    id: todo.id,
    owner_id: todo.owner_id,
    assignees: (assignees ?? []).map((row) => ({ id: row.user_id })),
  };
}

export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.TODOS, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = createCommentSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const todo = await loadTodoForAccess(parsed.data.todoId);
    if (!todo || !canEditTodoRecord(accessUser, todo, profile.id)) {
      return NextResponse.json({ error: "Todo not found" }, { status: 404 });
    }

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
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.TODOS, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const id = req.nextUrl.searchParams.get("id");
    const todoId = req.nextUrl.searchParams.get("todoId");
    if (!id || !todoId) {
      return NextResponse.json({ error: "Comment ID and todo ID are required" }, { status: 400 });
    }

    const todo = await loadTodoForAccess(todoId);
    if (!todo || !canViewTodoRecord(accessUser, todo, profile.id)) {
      return NextResponse.json({ error: "Todo not found" }, { status: 404 });
    }

    const admin = await createAdminServerClient();
    let query = admin.from("todo_comments").delete().eq("id", id).eq("todo_id", todoId);
    if (!isAdminUser(accessUser)) {
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
