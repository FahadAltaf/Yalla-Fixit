import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import type { TodoAccessRecord } from "@/lib/role-permissions";

/**
 * The slice of a todo every permission check needs (lib/role-permissions.ts):
 * its owner with the FR-20 task-manager flag, its assignees, and (FR-17)
 * who is mentioned in its comments. Shared by the comments and attachments
 * routes so none of them can forget the owner flag, which would make a
 * private task look public.
 */
export async function loadTodoForAccess(
  todoId: string,
): Promise<(TodoAccessRecord & { id: string; todo_key: string; title: string }) | null> {
  const admin = await createAdminServerClient();
  const [{ data: todo }, { data: assignees }, { data: comments }] = await Promise.all([
    admin.from("todos").select("id,todo_key,title,owner_id").eq("id", todoId).maybeSingle(),
    admin.from("todo_assignees").select("user_id").eq("todo_id", todoId),
    admin.from("todo_comments").select("id,author_id").eq("todo_id", todoId),
  ]);

  if (!todo) return null;

  const commentRows = (comments ?? []) as { id: string; author_id: string }[];
  const authorByComment = new Map(commentRows.map((row) => [row.id, row.author_id]));
  const [{ data: owner }, mentions] = await Promise.all([
    admin.from("user_profile").select("id,is_task_manager").eq("id", todo.owner_id).maybeSingle(),
    loadMentions(admin, commentRows.map((row) => row.id)),
  ]);

  const mentioned = new Set<string>();
  const mentionedByOwner = new Set<string>();
  mentions.forEach((row) => {
    mentioned.add(row.user_id);
    if (authorByComment.get(row.comment_id) === todo.owner_id) mentionedByOwner.add(row.user_id);
  });

  return {
    id: todo.id,
    todo_key: todo.todo_key,
    title: todo.title,
    owner_id: todo.owner_id,
    owner: owner ? { is_task_manager: Boolean(owner.is_task_manager) } : null,
    assignees: (assignees ?? []).map((row: { user_id: string }) => ({ id: row.user_id })),
    mentioned_user_ids: [...mentioned],
    owner_mentioned_user_ids: [...mentionedByOwner],
  };
}

/** PostgREST's answers for a table that is not there yet (migration not applied). */
export function isMissingTable(code: string | undefined): boolean {
  return code === "42P01" || code === "PGRST205";
}

/**
 * Mention rows for a set of comments, read in chunks so the `in` list never
 * outgrows a URL, and empty (not an error) while the mentions table does not
 * exist yet.
 */
export async function loadMentions(
  admin: Awaited<ReturnType<typeof createAdminServerClient>>,
  commentIds: string[],
): Promise<{ comment_id: string; user_id: string }[]> {
  const CHUNK = 100;
  const rows: { comment_id: string; user_id: string }[] = [];
  for (let index = 0; index < commentIds.length; index += CHUNK) {
    const { data, error } = await admin
      .from("todo_comment_mentions")
      .select("comment_id,user_id")
      .in("comment_id", commentIds.slice(index, index + CHUNK));
    if (error) {
      if (isMissingTable(error.code)) return [];
      throw new Error(error.message);
    }
    rows.push(...((data ?? []) as { comment_id: string; user_id: string }[]));
  }
  return rows;
}
