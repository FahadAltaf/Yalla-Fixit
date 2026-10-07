import type { SupabaseClient } from "@supabase/supabase-js";

import { approversForLevel, type AmcConfig } from "@/lib/amc/config";
import { notifyUsers } from "@/lib/server/amc/notifications";

/**
 * AMC to-dos (DEV-423 base). Each of the 8 BRD to-dos is a Todo in the
 * existing Todos module, linked to its AMC record through `amc_todos`:
 *
 *   * idempotent: the same kind, record and step (dedupe key) never makes a
 *     second Todo, so retries and overlapping sweeps are harmless;
 *   * escalated like the Snagging approvals: a stored escalate_at, and a
 *     sweep that claims the row before it adds anyone or notifies;
 *   * no reminder time unless configuration switches email reminders on,
 *     because live `main`'s reminder job emails any Todo that has one;
 *   * assigned only to the people on the record (owner, named approvers),
 *     never broadcast.
 */

type Admin = SupabaseClient;

export const AMC_TODO_KINDS = [
  "proposal_approval",
  "contract_follow_up",
  "ppm_confirmation",
  "access_gate_pass",
  "job_closure_review",
  "installment_overdue",
  "renewal_due",
  "call_out",
] as const;
export type AmcTodoKind = (typeof AMC_TODO_KINDS)[number];

export interface OpenAmcTodoInput {
  kind: AmcTodoKind;
  entityType: string;
  entityId: string;
  /** Distinguishes steps of the same record, e.g. `proposal_approval:<version>:level-2`. */
  dedupeKey: string;
  title: string;
  description: string;
  /** The Todo's owner (shown as the creator in Todos). */
  ownerId: string;
  assigneeIds: string[];
  dueAt: string;
  escalateAt?: string | null;
  /** Only used when configuration has email reminders on. */
  reminderAt?: string | null;
  createdBy?: string | null;
}

export interface OpenAmcTodoResult {
  created: boolean;
  linkId: string | null;
  todoId: string | null;
}

const uniqueIds = (ids: Array<string | null | undefined>) => [...new Set(ids.filter((id): id is string => !!id))];

export async function openAmcTodo(
  admin: Admin,
  input: OpenAmcTodoInput,
  config: Pick<AmcConfig, "todos">,
): Promise<OpenAmcTodoResult> {
  /* The link row first: its unique dedupe key is what makes this idempotent. */
  const { data: link, error: linkError } = await admin
    .from("amc_todos")
    .insert({
      kind: input.kind,
      entity_type: input.entityType,
      entity_id: input.entityId,
      dedupe_key: input.dedupeKey.slice(0, 300),
      due_at: input.dueAt,
      escalate_at: input.escalateAt ?? null,
      created_by: input.createdBy ?? null,
    })
    .select("id")
    .single<{ id: string }>();
  if (linkError) {
    if (linkError.code === "23505") {
      const { data: existing } = await admin
        .from("amc_todos")
        .select("id, todo_id")
        .eq("dedupe_key", input.dedupeKey.slice(0, 300))
        .maybeSingle<{ id: string; todo_id: string | null }>();
      return { created: false, linkId: existing?.id ?? null, todoId: existing?.todo_id ?? null };
    }
    throw new Error(linkError.message);
  }

  const { data: todo, error: todoError } = await admin
    .from("todos")
    .insert({
      owner_id: input.ownerId,
      title: input.title.slice(0, 120),
      description: input.description,
      related_type: `amc_${input.entityType}`,
      related_id: input.entityId,
      deadline_at: input.dueAt,
      reminder_at: config.todos.emailReminders ? (input.reminderAt ?? null) : null,
    })
    .select("id")
    .single<{ id: string }>();
  if (todoError) {
    /* Free the slot so the next attempt can try again. */
    await admin.from("amc_todos").delete().eq("id", link.id);
    throw new Error(`Could not create the to-do: ${todoError.message}`);
  }

  const assignees = uniqueIds(input.assigneeIds);
  if (assignees.length > 0) {
    const { error } = await admin
      .from("todo_assignees")
      .upsert(assignees.map((userId) => ({ todo_id: todo.id, user_id: userId })), { onConflict: "todo_id,user_id", ignoreDuplicates: true });
    if (error) console.error("[amc:todos] assignees not added:", error.message);
  }
  await admin.from("amc_todos").update({ todo_id: todo.id }).eq("id", link.id);
  return { created: true, linkId: link.id, todoId: todo.id };
}

/** Closes the open AMC to-dos of a record (all kinds, or one), marking their Todos done or cancelled. */
export async function closeAmcTodos(
  admin: Admin,
  filter: { entityType: string; entityId: string; kind?: AmcTodoKind; dedupeKey?: string },
  outcome: { status: "done" | "canceled"; reason: string },
): Promise<number> {
  let q = admin
    .from("amc_todos")
    .select("id, todo_id")
    .eq("entity_type", filter.entityType)
    .eq("entity_id", filter.entityId)
    .is("closed_at", null);
  if (filter.kind) q = q.eq("kind", filter.kind);
  if (filter.dedupeKey) q = q.eq("dedupe_key", filter.dedupeKey);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ id: string; todo_id: string | null }>;
  if (rows.length === 0) return 0;

  const now = new Date().toISOString();
  const todoIds = uniqueIds(rows.map((r) => r.todo_id));
  if (todoIds.length > 0) {
    await admin
      .from("todos")
      .update({ status: outcome.status, completed_at: outcome.status === "done" ? now : null, updated_at: now })
      .in("id", todoIds)
      .not("status", "in", "(done,canceled)");
  }
  await admin
    .from("amc_todos")
    .update({ closed_at: now, close_reason: outcome.reason.slice(0, 300) })
    .in("id", rows.map((r) => r.id))
    .is("closed_at", null);
  return rows.length;
}

/**
 * Who an overdue to-do escalates to. BRD 6.8: management for renewals
 * (after 15 idle days) and by default; later phases give each kind its own
 * rule (the next approval level, the supervisor for an SLA at risk).
 */
export function escalationRecipients(kind: AmcTodoKind, config: AmcConfig, level: number, dedupeKey?: string | null): string[] {
  switch (kind) {
    case "proposal_approval": {
      /* The approval level is in the key (…:l<level>, Phase 5): escalate one level up, level 3 to itself. */
      const approvalLevel = Number(/:l([1-3])$/.exec(dedupeKey ?? "")?.[1] ?? 0);
      return approversForLevel(config, Math.min((approvalLevel || level) + 1, 3));
    }
    default:
      return approversForLevel(config, 2);
  }
}

export interface EscalationRunResult {
  checked: number;
  escalated: number;
}

/** The escalation sweep: claim each overdue to-do, then add the escalation recipients and notify them. */
export async function escalateDueAmcTodos(admin: Admin, config: AmcConfig, now = new Date()): Promise<EscalationRunResult> {
  const result: EscalationRunResult = { checked: 0, escalated: 0 };
  const { data, error } = await admin
    .from("amc_todos")
    .select("id, kind, entity_type, entity_id, todo_id, escalation_level, dedupe_key")
    .is("closed_at", null)
    .is("escalated_at", null)
    .lte("escalate_at", now.toISOString())
    .order("escalate_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{
    id: string;
    kind: AmcTodoKind;
    entity_type: string;
    entity_id: string;
    todo_id: string | null;
    escalation_level: number;
    dedupe_key: string | null;
  }>;
  result.checked = rows.length;

  for (const row of rows) {
    /* Claim before any side effect: a parallel sweep finds nothing to claim. */
    const { data: claimed } = await admin
      .from("amc_todos")
      .update({ escalated_at: now.toISOString(), escalation_level: row.escalation_level + 1 })
      .eq("id", row.id)
      .is("escalated_at", null)
      .select("id");
    if (!claimed || claimed.length === 0) continue;

    const recipients = escalationRecipients(row.kind, config, row.escalation_level + 1, row.dedupe_key);
    if (row.todo_id && recipients.length > 0) {
      await admin
        .from("todo_assignees")
        .upsert(recipients.map((userId) => ({ todo_id: row.todo_id, user_id: userId })), { onConflict: "todo_id,user_id", ignoreDuplicates: true });
    }
    const { data: todo } = row.todo_id
      ? await admin.from("todos").select("title").eq("id", row.todo_id).maybeSingle<{ title: string | null }>()
      : { data: null };
    await notifyUsers(admin, {
      event: "todo_escalated",
      userIds: recipients,
      title: `Escalated: ${todo?.title ?? row.kind.replace(/_/g, " ")}`,
      body: "This AMC to-do passed its time limit without being closed and has been escalated to you.",
      link: "/todos",
      entityType: row.entity_type,
      entityId: row.entity_id,
      dedupeKey: `todo_escalated:${row.id}:${row.escalation_level + 1}`,
    });
    result.escalated += 1;
  }
  return result;
}
