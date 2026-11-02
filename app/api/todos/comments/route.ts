import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { buildTodoMentionEmail } from "@/lib/email-service";
import { canCommentTodoRecord, canViewTodoRecord, hasResourceAction, isAdminUser } from "@/lib/role-permissions";
import { sendEmail } from "@/lib/server/send-email";
import { loadTodoForAccess } from "@/lib/server/todos/access";
import { listCommentObjectPaths, removeObjects } from "@/lib/server/todos/attachments";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { extractMentionIds } from "@/lib/todos/mentions";
import { ActionType, ResourceType } from "@/types/types";

/*
  Task comments, with @-mentions (FR-17, Portal FRD 20 Oct 2026).

  A comment body carries `@[Name](uuid)` tokens (lib/todos/mentions.ts).
  On save the uuids are checked against active users, stored in
  todo_comment_mentions, and each mentioned user (other than the author)
  is emailed once. The email goes AFTER the comment is written, in process
  through lib/server/send-email.ts, and a failure never fails the request:
  it comes back as a warning.

  Who may comment: anyone who can edit the task, plus anyone mentioned on
  it (canCommentTodoRecord). Editing a comment is the author's alone and
  emails only the people newly mentioned.
*/

const MENTION_EMAIL_FAILED = "mention_email_failed";

const createCommentSchema = z.object({
  todoId: z.string().uuid(),
  body: z.string().trim().min(1).max(5000),
});

const updateCommentSchema = z.object({
  id: z.string().uuid(),
  todoId: z.string().uuid(),
  body: z.string().trim().min(1).max(5000),
});

type Admin = Awaited<ReturnType<typeof createAdminServerClient>>;
type Recipient = { id: string; email: string | null; full_name: string | null; first_name: string | null; last_name: string | null };

/** The mentioned ids that are real, active users. Anything else is dropped silently. */
async function resolveMentionedUsers(admin: Admin, ids: string[]): Promise<Recipient[]> {
  if (ids.length === 0) return [];
  const { data, error } = await admin
    .from("user_profile")
    .select("id,email,full_name,first_name,last_name")
    .in("id", ids)
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  return (data ?? []) as Recipient[];
}

function displayName(user: Recipient | { full_name?: string | null; first_name?: string | null; last_name?: string | null; email?: string | null }) {
  return user.full_name || [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email || "A colleague";
}

async function emailMentions(
  recipients: Recipient[],
  todo: { todo_key: string; title: string },
  author: { full_name?: string | null; first_name?: string | null; last_name?: string | null; email?: string | null },
  body: string,
): Promise<string[]> {
  const targets = recipients.filter((user) => user.email);
  if (targets.length === 0) return [];
  const results = await Promise.allSettled(
    targets.map((user) => sendEmail({ to: user.email!, ...buildTodoMentionEmail(todo, displayName(author), body) })),
  );
  const failed = results.filter((result) => result.status === "rejected");
  failed.forEach((result) =>
    console.error(`Todo ${todo.todo_key}: mention email failed:`, (result as PromiseRejectedResult).reason),
  );
  return failed.length > 0 ? [MENTION_EMAIL_FAILED] : [];
}

export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // The View action is the floor: a mentioned user comments with it alone.
    if (!hasResourceAction(accessUser, ResourceType.TODOS, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = createCommentSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const todo = await loadTodoForAccess(parsed.data.todoId);
    if (!todo || !canCommentTodoRecord(accessUser, todo, profile.id)) {
      return NextResponse.json({ error: "Todo not found" }, { status: 404 });
    }

    const admin = await createAdminServerClient();
    // A self-mention is neither stored nor emailed: stored, it would let
    // someone keep access to a task they were taken off.
    const mentioned = (await resolveMentionedUsers(admin, extractMentionIds(parsed.data.body))).filter(
      (user) => user.id !== profile.id,
    );

    const { data: comment, error } = await admin
      .from("todo_comments")
      .insert({
        todo_id: parsed.data.todoId,
        author_id: profile.id,
        body: parsed.data.body,
      })
      .select("id")
      .single();
    if (error || !comment) throw new Error(error?.message ?? "Comment was not created");

    if (mentioned.length > 0) {
      const { error: mentionError } = await admin
        .from("todo_comment_mentions")
        .insert(mentioned.map((user) => ({ comment_id: comment.id, user_id: user.id })));
      if (mentionError) {
        // The comment must not survive without its mentions: the screen
        // would report a failure, the user would retry, and the comment
        // would be there twice. Take it back out and fail cleanly.
        await admin.from("todo_comments").delete().eq("id", comment.id);
        throw new Error(mentionError.message);
      }
    }

    // Emails go out after the response, so posting is not held up by the
    // mail service; a failure is logged, never shown as a failed post.
    after(() => emailMentions(mentioned, todo, profile, parsed.data.body));

    return NextResponse.json({ data: { id: parsed.data.todoId, commentId: comment.id, warnings: [] } });
  } catch (error) {
    console.error("Todo comments POST error:", error);
    return NextResponse.json({ error: "Failed to add comment" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.TODOS, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = updateCommentSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const todo = await loadTodoForAccess(parsed.data.todoId);
    if (!todo || !canCommentTodoRecord(accessUser, todo, profile.id)) {
      return NextResponse.json({ error: "Todo not found" }, { status: 404 });
    }

    const admin = await createAdminServerClient();
    const { data: existing, error: existingError } = await admin
      .from("todo_comments")
      .select("id,author_id,body")
      .eq("id", parsed.data.id)
      .eq("todo_id", parsed.data.todoId)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (!existing) return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    if (existing.author_id !== profile.id) {
      return NextResponse.json({ error: "Only the author can edit a comment" }, { status: 403 });
    }

    const { data: currentRows, error: currentError } = await admin
      .from("todo_comment_mentions")
      .select("user_id")
      .eq("comment_id", existing.id);
    if (currentError) throw new Error(currentError.message);
    const currentIds = new Set((currentRows ?? []).map((row: { user_id: string }) => row.user_id));

    const mentioned = (await resolveMentionedUsers(admin, extractMentionIds(parsed.data.body))).filter(
      (user) => user.id !== profile.id,
    );
    const wantedIds = new Set(mentioned.map((user) => user.id));
    const added = mentioned.filter((user) => !currentIds.has(user.id));
    const removed = [...currentIds].filter((id) => !wantedIds.has(id));

    const { error: updateError } = await admin
      .from("todo_comments")
      .update({ body: parsed.data.body, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (updateError) throw new Error(updateError.message);

    if (added.length > 0) {
      const { error: addError } = await admin
        .from("todo_comment_mentions")
        .insert(added.map((user) => ({ comment_id: existing.id, user_id: user.id })));
      if (addError) throw new Error(addError.message);
    }
    if (removed.length > 0) {
      const { error: removeError } = await admin
        .from("todo_comment_mentions")
        .delete()
        .eq("comment_id", existing.id)
        .in("user_id", removed);
      if (removeError) throw new Error(removeError.message);
    }

    // Only the newly mentioned hear about an edit (FR-17 point 6).
    after(() => emailMentions(added, todo, profile, parsed.data.body));

    return NextResponse.json({ data: { id: parsed.data.todoId, commentId: existing.id, warnings: [] } });
  } catch (error) {
    console.error("Todo comments PATCH error:", error);
    return NextResponse.json({ error: "Failed to update comment" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.TODOS, ActionType.VIEW)) {
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
    // Mentions and attachment rows cascade with the comment, which also ends
    // the access the mentions granted. The stored files are removed after
    // the row is gone, so a failed delete never loses a file.
    const objectPaths = await listCommentObjectPaths(admin, id);
    let query = admin.from("todo_comments").delete().eq("id", id).eq("todo_id", todoId).select("id");
    if (!isAdminUser(accessUser)) {
      query = query.eq("author_id", profile.id);
    }
    const { data: deleted, error } = await query;
    if (error) throw new Error(error.message);
    if ((deleted ?? []).length > 0) await removeObjects(admin, objectPaths, todoId);

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("Todo comments DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete comment" }, { status: 500 });
  }
}
