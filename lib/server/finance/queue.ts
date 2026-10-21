import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The Ready-to-Invoice queue's writes (BRD §5.1; migration 20261021100000).
 *
 * Every change is one call to a finance.* function, which locks the item,
 * checks the status the user last saw and writes the change and its event
 * in one transaction. This module only translates: arguments in, and the
 * database's refusals out as errors a route can answer with.
 */

export type QueueStatus = "pending" | "in_progress" | "query_raised" | "on_hold" | "excluded" | "invoiced";
export type QueueAction = "pick_up" | "release" | "raise_query" | "answer_query" | "put_on_hold" | "resume";

export const QUEUE_ACTIONS: QueueAction[] = ["pick_up", "release", "raise_query", "answer_query", "put_on_hold", "resume"];
export const QUEUE_STATUSES: QueueStatus[] = ["pending", "in_progress", "query_raised", "on_hold", "excluded", "invoiced"];

export type Actor = { id: string; label: string };

/** A refusal the user can act on, with the HTTP status that says so. */
export class QueueError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
  }
}

/*
  The database raises with a SQLSTATE that says what kind of refusal it is
  (see the migration): someone else got there first (40001), the rule does
  not allow it (23514), it is already there (23505), it does not exist
  (P0002). The message after the function name is written for people.
*/
export function toQueueError(error: { code?: string; message?: string } | null): QueueError | Error {
  const message = (error?.message ?? "Request failed").replace(/^[a-z_]+: /, "");
  const readable = message.charAt(0).toUpperCase() + message.slice(1);
  switch (error?.code) {
    case "40001":
      return new QueueError(`${readable}. Reload to see the latest.`, 409);
    case "23505":
      return new QueueError(readable, 409);
    case "23514":
    case "22P02":
      return new QueueError(readable, 400);
    case "P0002":
      return new QueueError(readable, 404);
    default:
      return new Error(error?.message ?? "Request failed");
  }
}

async function call<T>(admin: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.schema("finance").rpc(fn, args);
  if (error) throw toQueueError(error);
  return data as T;
}

export function applyQueueAction(
  admin: SupabaseClient,
  input: { itemId: string; action: QueueAction; expected: QueueStatus; actor: Actor; note?: string | null },
): Promise<QueueStatus> {
  return call(admin, "apply_action", {
    p_item_id: input.itemId,
    p_action: input.action,
    p_expected: input.expected,
    p_actor: input.actor.id,
    p_actor_label: input.actor.label,
    p_note: input.note ?? null,
  });
}

export function recordInvoice(
  admin: SupabaseClient,
  input: {
    itemId: string;
    idempotencyKey: string;
    number: string;
    date: string;
    amount: number;
    varianceReason?: string | null;
    actor: Actor;
  },
): Promise<string> {
  return call(admin, "record_invoice", {
    p_item_id: input.itemId,
    p_idempotency_key: input.idempotencyKey,
    p_number: input.number,
    p_date: input.date,
    p_amount: input.amount,
    p_variance_reason: input.varianceReason ?? null,
    p_actor: input.actor.id,
    p_actor_label: input.actor.label,
  });
}

export function requestExclusion(
  admin: SupabaseClient,
  input: { itemId: string; reason: string; notes?: string | null; evidence?: string[]; actor: Actor },
): Promise<string> {
  return call(admin, "request_exclusion", {
    p_item_id: input.itemId,
    p_reason: input.reason,
    p_notes: input.notes ?? null,
    p_evidence: input.evidence ?? [],
    p_actor: input.actor.id,
    p_actor_label: input.actor.label,
  });
}

export function decideExclusion(
  admin: SupabaseClient,
  input: { exclusionId: string; decision: "verified" | "rejected"; note?: string | null; actor: Actor },
): Promise<QueueStatus> {
  return call(admin, "decide_exclusion", {
    p_exclusion_id: input.exclusionId,
    p_decision: input.decision,
    p_note: input.note ?? null,
    p_actor: input.actor.id,
    p_actor_label: input.actor.label,
  });
}

/** The few item fields a notification needs. */
export async function readQueueItemSummary(admin: SupabaseClient, itemId: string) {
  const { data, error } = await admin
    .schema("finance")
    .from("queue_items")
    .select("id, number, status, status_changed_at, fsm_work_order_id, fsm_estimate_id, value")
    .eq("id", itemId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new QueueError("No such item", 404);
  const { data: wo } = await admin
    .schema("fsm")
    .from("work_orders")
    .select("number, company_name")
    .eq("fsm_work_order_id", data.fsm_work_order_id as string)
    .maybeSingle();
  return {
    id: data.id as string,
    number: Number(data.number),
    status: data.status as QueueStatus,
    statusChangedAt: data.status_changed_at as string,
    value: Number(data.value),
    workOrderNumber: (wo?.number as string | null) ?? (data.fsm_work_order_id as string),
    client: (wo?.company_name as string | null) ?? null,
  };
}
