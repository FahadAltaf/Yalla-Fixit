import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { emailService } from "@/lib/email-service";
import {
  canDeleteTodoRecord,
  canEditTodoRecord,
  canViewTodoRecord,
  hasResourceAction,
} from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType, Todo, TodoRelatedType, TodoStatus, User } from "@/types/types";

const TODO_STATUSES = ["todo", "in_progress", "done", "canceled", "blocked"] as const;
const RELATED_TYPES = ["work_order", "quotation", "appointment"] as const;

const todoPayloadSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  assigneeIds: z.array(z.string().uuid()).min(1),
  tags: z.array(z.string().trim().min(1)).default([]),
  relatedType: z.enum(RELATED_TYPES).nullable().optional(),
  relatedId: z.string().trim().nullable().optional(),
  deadlineAt: z.string().datetime(),
  reminderAt: z.string().datetime().nullable().optional(),
  status: z.enum(TODO_STATUSES).optional(),
});

const todoUpdateSchema = todoPayloadSchema.partial().extend({
  id: z.string().uuid(),
});

type TodoRow = {
  id: string;
  todo_key: string;
  owner_id: string;
  title: string;
  description: string;
  tags: string[] | null;
  related_type: TodoRelatedType | null;
  related_id: string | null;
  deadline_at: string;
  reminder_at: string | null;
  reminder_sent_at: string | null;
  status: TodoStatus;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
};

function normalizeTags(tags: string[]) {
  return Array.from(
    new Set(tags.map((tag) => tag.trim()).filter(Boolean))
  );
}

function normalizeDateValue(value?: string | null) {
  return value ? new Date(value).toISOString() : null;
}

function valuesEqual(a: unknown, b: unknown) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function userDisplayName(user: User) {
  return user.full_name || [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email || user.id;
}

function assigneeSnapshot(users: User[] = []) {
  return users
    .map((user) => ({ id: user.id, name: userDisplayName(user) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function loadTodos(todoIds?: string[]): Promise<Todo[]> {
  const admin = await createAdminServerClient();
  let query = admin.from("todos").select("*").order("deadline_at", { ascending: true });

  if (todoIds) {
    if (todoIds.length === 0) return [];
    query = query.in("id", todoIds);
  }

  const { data: todoRows, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (todoRows ?? []) as TodoRow[];
  if (rows.length === 0) return [];

  const ids = rows.map((todo) => todo.id);
  const ownerIds = Array.from(new Set(rows.map((todo) => todo.owner_id)));

  const [
    { data: assigneeRows, error: assigneeError },
    { data: commentRows, error: commentError },
    { data: updateRows, error: updateRowsError },
    { data: owners, error: ownersError },
  ] = await Promise.all([
    admin.from("todo_assignees").select("todo_id,user_profile(id,email,first_name,last_name,full_name,profile_image)").in("todo_id", ids),
    admin.from("todo_comments").select("id,todo_id,author_id,body,created_at,updated_at,user_profile(id,email,first_name,last_name,full_name,profile_image)").in("todo_id", ids).order("created_at", { ascending: true }),
    admin.from("todo_updates").select("id,todo_id,actor_id,action,field_name,old_value,new_value,created_at,user_profile(id,email,first_name,last_name,full_name,profile_image)").in("todo_id", ids).order("created_at", { ascending: false }),
    admin.from("user_profile").select("id,email,first_name,last_name,full_name,profile_image").in("id", ownerIds),
  ]);

  if (assigneeError) throw new Error(assigneeError.message);
  if (commentError) throw new Error(commentError.message);
  if (updateRowsError) throw new Error(updateRowsError.message);
  if (ownersError) throw new Error(ownersError.message);

  const ownersById = new Map((owners ?? []).map((owner: any) => [owner.id, owner]));
  const assigneesByTodo = new Map<string, User[]>();
  const commentsByTodo = new Map<string, Todo["comments"]>();
  const updatesByTodo = new Map<string, Todo["updates"]>();

  (assigneeRows ?? []).forEach((row: any) => {
    const user = row.user_profile as User | null;
    if (!user) return;
    const current = assigneesByTodo.get(row.todo_id) ?? [];
    current.push(user);
    assigneesByTodo.set(row.todo_id, current);
  });

  (commentRows ?? []).forEach((row: any) => {
    const current = commentsByTodo.get(row.todo_id) ?? [];
    current.push({
      id: row.id,
      todo_id: row.todo_id,
      author_id: row.author_id,
      body: row.body,
      created_at: row.created_at,
      updated_at: row.updated_at,
      author: row.user_profile ?? undefined,
    });
    commentsByTodo.set(row.todo_id, current);
  });

  (updateRows ?? []).forEach((row: any) => {
    const current = updatesByTodo.get(row.todo_id) ?? [];
    current.push({
      id: row.id,
      todo_id: row.todo_id,
      actor_id: row.actor_id,
      action: row.action,
      field_name: row.field_name,
      old_value: row.old_value,
      new_value: row.new_value,
      created_at: row.created_at,
      actor: row.user_profile ?? undefined,
    });
    updatesByTodo.set(row.todo_id, current);
  });

  return rows.map((row) => ({
    id: row.id,
    todo_key: row.todo_key,
    owner_id: row.owner_id,
    title: row.title,
    description: row.description,
    tags: row.tags ?? [],
    related_type: row.related_type,
    related_id: row.related_id,
    deadline_at: row.deadline_at,
    reminder_at: row.reminder_at,
    reminder_sent_at: row.reminder_sent_at,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at ?? undefined,
    completed_at: row.completed_at,
    owner: ownersById.get(row.owner_id) as User | undefined,
    assignees: assigneesByTodo.get(row.id) ?? [],
    comments: commentsByTodo.get(row.id) ?? [],
    updates: updatesByTodo.get(row.id) ?? [],
  }));
}

function dateInputValue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function applyFilters(todos: Todo[], req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const search = params.get("search")?.trim().toLowerCase();
  const ownerId = params.get("ownerId");
  const assigneeId = params.get("assigneeId");
  const status = params.get("status");
  const tag = params.get("tag")?.trim().toLowerCase();
  const relatedType = params.get("relatedType");
  const relatedId = params.get("relatedId")?.trim().toLowerCase();
  const deadlineDate = params.get("deadlineDate");
  const reminderDate = params.get("reminderDate");
  const deadlineFrom = params.get("deadlineFrom");
  const deadlineTo = params.get("deadlineTo");
  const reminderFrom = params.get("reminderFrom");
  const reminderTo = params.get("reminderTo");

  return todos.filter((todo) => {
    if (
      search &&
      ![todo.todo_key, todo.title, todo.description, todo.related_id || ""].some((value) =>
        value.toLowerCase().includes(search)
      )
    ) return false;
    if (ownerId && todo.owner_id !== ownerId) return false;
    if (assigneeId && !todo.assignees?.some((user) => user.id === assigneeId)) return false;
    if (status && todo.status !== status) return false;
    if (tag && !todo.tags.some((todoTag) => todoTag.toLowerCase().includes(tag))) return false;
    if (relatedType && todo.related_type !== relatedType) return false;
    if (relatedId && !todo.related_id?.toLowerCase().includes(relatedId)) return false;
    if (deadlineDate && dateInputValue(todo.deadline_at) !== deadlineDate) return false;
    if (reminderDate && (!todo.reminder_at || dateInputValue(todo.reminder_at) !== reminderDate)) return false;
    if (deadlineFrom && new Date(todo.deadline_at) < new Date(deadlineFrom)) return false;
    if (deadlineTo && new Date(todo.deadline_at) > new Date(deadlineTo)) return false;
    if (reminderFrom && (!todo.reminder_at || new Date(todo.reminder_at) < new Date(reminderFrom))) return false;
    if (reminderTo && (!todo.reminder_at || new Date(todo.reminder_at) > new Date(reminderTo))) return false;
    return true;
  });
}

function todoKeyNumber(todoKey: string) {
  const [, numericPart] = todoKey.split("-");
  return Number(numericPart) || 0;
}

function sortTodos(todos: Todo[], req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const sortBy = params.get("sortBy") || "deadline";
  const sortDirection = params.get("sortDirection") === "desc" ? "desc" : "asc";
  const direction = sortDirection === "desc" ? -1 : 1;

  return [...todos].sort((a, b) => {
    let aValue: number;
    let bValue: number;

    if (sortBy === "created") {
      aValue = new Date(a.created_at).getTime();
      bValue = new Date(b.created_at).getTime();
    } else if (sortBy === "todoKey") {
      aValue = todoKeyNumber(a.todo_key);
      bValue = todoKeyNumber(b.todo_key);
    } else {
      aValue = new Date(a.deadline_at).getTime();
      bValue = new Date(b.deadline_at).getTime();
    }

    if (aValue === bValue) return todoKeyNumber(a.todo_key) - todoKeyNumber(b.todo_key);
    return (aValue - bValue) * direction;
  });
}

async function sendAssignmentEmails(todo: Todo, assigneeIds: string[]) {
  const assignees = todo.assignees?.filter((user) => assigneeIds.includes(user.id)) ?? [];
  await Promise.all(
    assignees
      .filter((user) => user.email)
      .map((user) => emailService.sendTodoAssignedEmail(user.email!, todo))
  );
}

async function insertTodoUpdates(
  todoId: string,
  actorId: string,
  updates: Array<{
    action?: string;
    field_name?: string | null;
    old_value?: unknown;
    new_value?: unknown;
  }>
) {
  if (updates.length === 0) return;

  const admin = await createAdminServerClient();
  const { error } = await admin.from("todo_updates").insert(
    updates.map((update) => ({
      todo_id: todoId,
      actor_id: actorId,
      action: update.action || "updated",
      field_name: update.field_name ?? null,
      old_value: update.old_value ?? null,
      new_value: update.new_value ?? null,
    }))
  );
  if (error) throw new Error(error.message);
}

function buildTodoChangeLog(existing: Todo, payload: z.infer<typeof todoUpdateSchema>) {
  const updates: Array<{
    field_name: string;
    old_value: unknown;
    new_value: unknown;
  }> = [];

  const addChange = (fieldName: string, oldValue: unknown, newValue: unknown) => {
    if (!valuesEqual(oldValue, newValue)) {
      updates.push({
        field_name: fieldName,
        old_value: oldValue,
        new_value: newValue,
      });
    }
  };

  if (payload.title !== undefined) addChange("title", existing.title, payload.title);
  if (payload.description !== undefined) addChange("description", existing.description, payload.description);
  if (payload.tags !== undefined) addChange("tags", existing.tags, normalizeTags(payload.tags));
  if (payload.relatedType !== undefined) addChange("related_type", existing.related_type, payload.relatedType || null);
  if (payload.relatedId !== undefined) addChange("related_id", existing.related_id, payload.relatedId || null);
  if (payload.deadlineAt !== undefined) addChange("deadline", normalizeDateValue(existing.deadline_at), normalizeDateValue(payload.deadlineAt));
  if (payload.reminderAt !== undefined) addChange("reminder", normalizeDateValue(existing.reminder_at), normalizeDateValue(payload.reminderAt));
  if (payload.status !== undefined) addChange("status", existing.status, payload.status);

  return updates;
}

export async function GET(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.TODOS, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const page = Number(req.nextUrl.searchParams.get("page") ?? 0);
    const pageSize = Number(req.nextUrl.searchParams.get("pageSize") ?? 100);

    const todos = await loadTodos();
    const visibleTodos = todos.filter((todo) =>
      canViewTodoRecord(accessUser, todo, profile.id)
    );
    const filteredTodos = applyFilters(visibleTodos, req);
    const sortedTodos = sortTodos(filteredTodos, req);
    const start = page * pageSize;
    const pagedTodos = sortedTodos.slice(start, start + pageSize);

    return NextResponse.json({
      data: {
        todos: pagedTodos,
        totalCount: filteredTodos.length,
      },
    });
  } catch (error) {
    console.error("Todos GET error:", error);
    return NextResponse.json({ error: "Failed to load todos" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.TODOS, ActionType.CREATE)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = todoPayloadSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const admin = await createAdminServerClient();
    const payload = parsed.data;

    const { data: created, error } = await admin
      .from("todos")
      .insert({
        owner_id: profile.id,
        title: payload.title,
        description: payload.description,
        tags: normalizeTags(payload.tags),
        related_type: payload.relatedType || null,
        related_id: payload.relatedId || null,
        deadline_at: payload.deadlineAt,
        reminder_at: payload.reminderAt || null,
        status: payload.status || "todo",
        completed_at: payload.status === "done" ? new Date().toISOString() : null,
      })
      .select("id")
      .single();

    if (error || !created) throw new Error(error?.message || "Todo creation failed");

    const assigneeRows = payload.assigneeIds.map((userId) => ({
      todo_id: created.id,
      user_id: userId,
    }));
    const { error: assigneeError } = await admin.from("todo_assignees").insert(assigneeRows);
    if (assigneeError) throw new Error(assigneeError.message);

    const [todo] = await loadTodos([created.id]);
    await insertTodoUpdates(created.id, profile.id, [
      {
        action: "created",
        field_name: null,
        old_value: null,
        new_value: {
          title: todo.title,
          status: todo.status,
        },
      },
    ]);

    await sendAssignmentEmails(todo, payload.assigneeIds);

    const [todoWithUpdates] = await loadTodos([created.id]);
    return NextResponse.json({ data: todoWithUpdates });
  } catch (error) {
    console.error("Todos POST error:", error);
    return NextResponse.json({ error: "Failed to create todo" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.TODOS, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = todoUpdateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const [existing] = await loadTodos([parsed.data.id]);
    if (!existing || !canEditTodoRecord(accessUser, existing, profile.id)) {
      return NextResponse.json({ error: "Todo not found" }, { status: 404 });
    }

    const admin = await createAdminServerClient();
    const payload = parsed.data;
    const changeLog = buildTodoChangeLog(existing, payload);
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (payload.title !== undefined) updateData.title = payload.title;
    if (payload.description !== undefined) updateData.description = payload.description;
    if (payload.tags !== undefined) updateData.tags = normalizeTags(payload.tags);
    if (payload.relatedType !== undefined) updateData.related_type = payload.relatedType || null;
    if (payload.relatedId !== undefined) updateData.related_id = payload.relatedId || null;
    if (payload.deadlineAt !== undefined) updateData.deadline_at = payload.deadlineAt;
    if (payload.reminderAt !== undefined) {
      updateData.reminder_at = payload.reminderAt || null;
      updateData.reminder_sent_at = null;
    }
    if (payload.status !== undefined) {
      updateData.status = payload.status;
      updateData.completed_at = payload.status === "done" ? new Date().toISOString() : null;
    }

    const { error } = await admin.from("todos").update(updateData).eq("id", payload.id);
    if (error) throw new Error(error.message);

    let newAssigneeIds: string[] = [];
    if (payload.assigneeIds) {
      const oldAssigneeIds = existing.assignees?.map((user) => user.id) ?? [];
      newAssigneeIds = payload.assigneeIds.filter((id) => !oldAssigneeIds.includes(id));

      const { error: deleteError } = await admin.from("todo_assignees").delete().eq("todo_id", payload.id);
      if (deleteError) throw new Error(deleteError.message);

      const { error: insertError } = await admin.from("todo_assignees").insert(
        payload.assigneeIds.map((userId) => ({ todo_id: payload.id, user_id: userId }))
      );
      if (insertError) throw new Error(insertError.message);
    }

    const [todo] = await loadTodos([payload.id]);
    if (payload.assigneeIds !== undefined) {
      const oldAssignees = assigneeSnapshot(existing.assignees ?? []);
      const newAssignees = assigneeSnapshot(todo.assignees ?? []);
      if (!valuesEqual(oldAssignees, newAssignees)) {
        changeLog.push({
          field_name: "assignees",
          old_value: oldAssignees,
          new_value: newAssignees,
        });
      }
    }

    await insertTodoUpdates(payload.id, profile.id, changeLog);

    if (newAssigneeIds.length > 0) {
      await sendAssignmentEmails(todo, newAssigneeIds);
    }

    const [todoWithUpdates] = await loadTodos([payload.id]);
    return NextResponse.json({ data: todoWithUpdates });
  } catch (error) {
    console.error("Todos PUT error:", error);
    return NextResponse.json({ error: "Failed to update todo" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.TODOS, ActionType.DELETE)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });

    const [existing] = await loadTodos([id]);
    if (!existing || !canDeleteTodoRecord(accessUser, existing, profile.id)) {
      return NextResponse.json({ error: "Todo not found" }, { status: 404 });
    }

    const admin = await createAdminServerClient();
    const { error } = await admin.from("todos").delete().eq("id", id);
    if (error) throw new Error(error.message);

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("Todos DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete todo" }, { status: 500 });
  }
}
