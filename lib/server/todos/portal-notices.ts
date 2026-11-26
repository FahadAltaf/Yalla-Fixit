import type { SupabaseClient } from "@supabase/supabase-js";

import { notifyInPortal } from "@/lib/server/notifications/portal-notify";

/**
 * To-dos in the portal inbox (26 Nov 2026, the user: the inbox covers every
 * module), beside the emails they already send:
 *   assigned   the people newly put on a to-do (not the one who did it)
 *   mentioned  the people @-mentioned in a comment
 *   reminder   the owner and assignees when the reminder time comes
 * Never throws: the step it follows has already happened.
 */
export type TodoNoticeKind = "assigned" | "mentioned" | "reminder";

export async function notifyTodo(
  admin: SupabaseClient,
  todo: { id: string; todo_key: string; title: string },
  kind: TodoNoticeKind,
  userIds: Array<string | null | undefined>,
  actor: { id: string | null; name: string | null },
  /** What makes this notice distinct (a comment id, the reminder time). */
  moment: string,
): Promise<void> {
  const who = actor.name ?? "A colleague";
  const text =
    kind === "assigned"
      ? { title: `To-do for you: ${todo.title}`, body: `${who} put you on ${todo.todo_key}.` }
      : kind === "mentioned"
        ? { title: `Mentioned on ${todo.todo_key}`, body: `${who} mentioned you in a comment on "${todo.title}".` }
        : { title: `Reminder: ${todo.title}`, body: `${todo.todo_key} is due for a reminder.` };
  await notifyInPortal(admin, {
    event: `todos.${kind}`,
    userIds,
    title: text.title,
    body: text.body,
    link: `/todos?todo=${encodeURIComponent(todo.todo_key)}`,
    entityType: "todo",
    entityId: todo.id,
    dedupeKey: `todos.${kind}:${todo.id}:${moment}`,
    actorId: actor.id,
  });
}
