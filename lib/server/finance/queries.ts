import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { ActionType, ResourceType } from "@/types/types";

import { usersHolding } from "./recipients";
import { InvoicingError, queryableWorkOrder } from "./work-orders";

/**
 * Queries as a conversation (the user's direction, 2 Nov; migrations
 * 20261103100000 and 20261104100000). Finance or Operations asks a question
 * on a work order; the other side is told and replies; either side replies
 * again or closes it. Questions only: "not invoiceable" is a mark on the
 * work order (./work-orders markNotInvoiceable), not a query. Threads from
 * before keep their old kinds and replies, as history. From the portal's
 * records only: no FSM call to list, one FSM read to raise (the work
 * order's number).
 */

export type QuerySide = "finance" | "operations";
export type QueryKind = "question" | "not_invoiceable";
/** What can be sent now: a reply, or closing it. */
export type QueryReplyAction = "comment" | "closed";
/** What a comment may say it did, including the steps of older threads. */
export type QueryCommentAction = "raised" | "comment" | "not_resolved" | "resolved" | "corrected" | "withdrawn" | "closed";
export type QueryResolution = "answered" | "corrected" | "withdrawn" | "closed";

export type QueryComment = {
  id: string;
  side: QuerySide;
  body: string | null;
  action: QueryCommentAction;
  taggedLabel: string | null;
  author: string | null;
  createdAt: string;
};

export type QueryThread = {
  id: string;
  workOrderId: string;
  number: string | null;
  quotationNumber: string | null;
  clientName: string | null;
  kind: QueryKind;
  raisedBySide: QuerySide;
  subject: string;
  lineIds: string[];
  status: "open" | "resolved";
  waitingOn: QuerySide | null;
  resolution: QueryResolution | null;
  raisedBy: string | null;
  createdAt: string;
  lastCommentAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  comments: QueryComment[];
};

/** Someone a query can tag: the people on the other side. */
export type TagOption = { id: string; name: string };

export const queryFiltersSchema = z.object({
  /** waiting: open and waiting on the viewer's side; open; resolved; all. */
  view: z.enum(["waiting", "open", "resolved", "all"]).default("waiting"),
  raisedBy: z.enum(["all", "finance", "operations"]).default("all"),
  kind: z.enum(["all", "question", "not_invoiceable"]).default("all"),
  /** One work order's queries, for its page. */
  workOrder: z
    .string()
    .regex(/^[0-9A-Za-z_-]{1,40}$/)
    .optional(),
  page: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type QueryFilters = z.infer<typeof queryFiltersSchema>;

export type QueryList = {
  rows: QueryThread[];
  total: number;
  counts: {
    waitingOnYou: number;
    waitingOnOperations: number;
    waitingOnFinance: number;
    resolved: number;
    oldestOpenAt: string | null;
    overWeek: number;
  };
  /** False until migration 20261103100000 is applied. */
  ready: boolean;
};

export const openQuerySchema = z
  .object({
    workOrderId: z.string().regex(/^[0-9A-Za-z_-]{1,40}$/),
    /* Questions only (2 Nov): "not invoiceable" is a mark on the work order now, not a query. */
    kind: z.enum(["question"]).default("question"),
    body: z.string().trim().min(1).max(2000),
    lineIds: z.array(z.string().regex(/^[0-9A-Za-z_-]{1,40}$/)).max(200).default([]),
    taggedUserId: z.string().uuid().nullish(),
    /** The side the page acts as, for someone in both teams. */
    as: z.enum(["finance", "operations"]).optional(),
  })
  .strict();

export const replyQuerySchema = z
  .object({
    /* A reply, or closing the conversation: either side (2 Nov). */
    action: z.enum(["comment", "closed"]),
    body: z.string().trim().max(2000).nullish(),
    taggedUserId: z.string().uuid().nullish(),
    as: z.enum(["finance", "operations"]).optional(),
  })
  .strict();

const DAY_MS = 86_400_000;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const other = (side: QuerySide): QuerySide => (side === "finance" ? "operations" : "finance");

/* The thread tables arrive with migration 20261103100000. */
function threadsMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "PGRST205" || error.code === "42P01" || /query_threads|query_comments|schema cache/i.test(error.message ?? "");
}

/** The permission behind each side: Finance works the invoicing queue; Operations are the coordinators. */
export const SIDE_PERMISSION: Record<QuerySide, { resource: ResourceType; action: ActionType }> = {
  finance: { resource: ResourceType.FINANCE_QUEUE, action: ActionType.EDIT },
  operations: { resource: ResourceType.FINANCE_EXCLUSIONS, action: ActionType.CREATE },
};

/** The side someone acts as: the one asked for if they are in it, else their only side (Finance when both). */
export function sideOf(sides: QuerySide[], asked?: QuerySide | null): QuerySide | null {
  if (asked && sides.includes(asked)) return asked;
  return sides.includes("finance") ? "finance" : (sides[0] ?? null);
}

const THREAD_COLUMNS =
  "id, fsm_work_order_id, work_order_number, kind, raised_by_side, subject, fsm_line_ids, status, waiting_on, resolution, raised_by_label, created_at, last_comment_at, resolved_by_label, resolved_at";

function shapeThread(t: Record<string, unknown>): QueryThread {
  return {
    id: String(t.id),
    workOrderId: String(t.fsm_work_order_id),
    number: str(t.work_order_number),
    quotationNumber: null,
    clientName: null,
    kind: t.kind === "not_invoiceable" ? "not_invoiceable" : "question",
    raisedBySide: t.raised_by_side === "operations" ? "operations" : "finance",
    subject: String(t.subject ?? ""),
    lineIds: Array.isArray(t.fsm_line_ids) ? t.fsm_line_ids.map(String) : [],
    status: t.status === "resolved" ? "resolved" : "open",
    waitingOn: t.waiting_on === "finance" || t.waiting_on === "operations" ? t.waiting_on : null,
    resolution: (str(t.resolution) as QueryResolution | null) ?? null,
    raisedBy: str(t.raised_by_label),
    createdAt: String(t.created_at),
    lastCommentAt: String(t.last_comment_at),
    resolvedBy: str(t.resolved_by_label),
    resolvedAt: str(t.resolved_at),
    comments: [],
  };
}

/**
 * The queries, filtered and paged here: open ones by their last comment,
 * newest first; resolved ones by when they ended. Each row comes with its
 * whole thread and the work order's quotation and client as the portal
 * last saw them.
 */
export async function listQueryThreads(admin: SupabaseClient, filters: QueryFilters, viewerSides: QuerySide[]): Promise<QueryList> {
  const fin = admin.schema("finance");
  let query = fin.from("query_threads").select(THREAD_COLUMNS).order("last_comment_at", { ascending: false }).range(0, 9999);
  if (filters.workOrder) query = query.eq("fsm_work_order_id", filters.workOrder);
  const { data, error } = await query;
  const blank = { waitingOnYou: 0, waitingOnOperations: 0, waitingOnFinance: 0, resolved: 0, oldestOpenAt: null, overWeek: 0 };
  if (error) {
    if (threadsMissing(error)) return { rows: [], total: 0, counts: blank, ready: false };
    throw new Error(error.message);
  }
  const all = (data ?? []).map((t) => shapeThread(t as Record<string, unknown>));
  const open = all.filter((t) => t.status === "open");
  const waitingOnYou = open.filter((t) => t.waitingOn && viewerSides.includes(t.waitingOn));
  const now = Date.now();
  const counts = {
    waitingOnYou: waitingOnYou.length,
    waitingOnOperations: open.filter((t) => t.waitingOn === "operations").length,
    waitingOnFinance: open.filter((t) => t.waitingOn === "finance").length,
    resolved: all.length - open.length,
    oldestOpenAt: open.reduce<string | null>((oldest, t) => (!oldest || t.createdAt < oldest ? t.createdAt : oldest), null),
    overWeek: open.filter((t) => now - Date.parse(t.createdAt) >= 7 * DAY_MS).length,
  };

  const inView =
    filters.view === "waiting"
      ? waitingOnYou
      : filters.view === "open"
        ? open
        : filters.view === "resolved"
          ? all.filter((t) => t.status === "resolved").sort((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? ""))
          : [...open, ...all.filter((t) => t.status === "resolved")];
  const listed = inView.filter((t) => (filters.raisedBy === "all" || t.raisedBySide === filters.raisedBy) && (filters.kind === "all" || t.kind === filters.kind));
  const rows = listed.slice(filters.page * filters.pageSize, (filters.page + 1) * filters.pageSize);

  if (rows.length) {
    const [comments, states] = await Promise.all([
      fin
        .from("query_comments")
        .select("id, thread_id, side, body, action, tagged_label, author_label, created_at")
        .in(
          "thread_id",
          rows.map((r) => r.id),
        )
        .order("created_at")
        .order("id"),
      fin
        .from("work_order_states")
        .select("fsm_work_order_id, work_order_number, quotation_number, contact_name, client_name")
        .in("fsm_work_order_id", [...new Set(rows.map((r) => r.workOrderId))]),
    ]);
    if (comments.error) throw new Error(comments.error.message);
    const byThread = new Map(rows.map((r) => [r.id, r]));
    for (const c of comments.data ?? []) {
      byThread.get(String(c.thread_id))?.comments.push({
        id: String(c.id),
        side: c.side === "operations" ? "operations" : "finance",
        body: str(c.body),
        action: c.action as QueryComment["action"],
        taggedLabel: str(c.tagged_label),
        author: str(c.author_label),
        createdAt: String(c.created_at),
      });
    }
    /* The snapshot's columns arrive with 20261025100000: without them, the rows go without quotation and client. */
    const stateOf = new Map((states.error ? [] : (states.data ?? [])).map((s) => [String(s.fsm_work_order_id), s]));
    for (const r of rows) {
      const s = stateOf.get(r.workOrderId);
      if (!s) continue;
      r.number = r.number ?? str(s.work_order_number);
      r.quotationNumber = str(s.quotation_number);
      r.clientName = str(s.contact_name) ?? str(s.client_name);
    }
  }
  return { rows, total: listed.length, counts, ready: true };
}

/** The people of one side, to tag. */
export async function tagOptions(admin: SupabaseClient, side: QuerySide): Promise<TagOption[]> {
  const people = await usersHolding(admin, SIDE_PERMISSION[side].resource, SIDE_PERMISSION[side].action);
  return people.map((p) => ({ id: p.userId, name: p.name || "Unnamed user" })).sort((a, b) => a.name.localeCompare(b.name));
}

async function taggedPerson(admin: SupabaseClient, side: QuerySide, userId: string | null | undefined): Promise<TagOption | null> {
  if (!userId) return null;
  const person = (await tagOptions(admin, side)).find((p) => p.id === userId);
  if (!person) throw new InvoicingError(`The person tagged is not in ${side === "finance" ? "Finance" : "Operations"}. Pick someone else.`, 400);
  return person;
}

/* The database's refusals, in words for the page. */
function queryError(error: { code?: string; message: string }): never {
  const message = error.message.replace(/^(open|reply)_query_thread: /, "");
  const words: Array<[RegExp, string]> = [
    [/already (resolved|closed)/, "This query is already closed. Reload to see the latest."],
    [/write the reply/, "Write the reply first."],
    [/only the side that raised it closes it|reply or close/, "This needs a database update that is not applied yet (closing from either side)."],
    [/marked not to be invoiced/, "This work order is marked not to be invoiced: there is nothing to query."],
  ];
  const friendly = words.find(([re]) => re.test(message))?.[1];
  if (threadsMissing(error)) throw new InvoicingError("Queries are not set up yet: a database update is still to be applied.", 409);
  if (["23514", "40001", "P0002", "23505"].includes(error.code ?? "")) throw new InvoicingError(friendly ?? message, error.code === "P0002" ? 404 : 409);
  throw new Error(error.message);
}

export async function openQueryThread(
  admin: SupabaseClient,
  input: z.infer<typeof openQuerySchema>,
  side: QuerySide,
  actor: { id: string; label: string },
): Promise<{ id: string; workOrderNumber: string | null; tagged: TagOption | null }> {
  const [wo, tagged] = await Promise.all([queryableWorkOrder(admin, input.workOrderId), taggedPerson(admin, other(side), input.taggedUserId)]);
  const unknownLine = input.lineIds.find((id) => !wo.lineNames.has(id));
  if (unknownLine) throw new InvoicingError("A line is no longer on the work order in FSM. Reload and try again.", 409);
  const { data, error } = await admin.schema("finance").rpc("open_query_thread", {
    p_work_order_id: input.workOrderId,
    p_work_order_number: wo.number,
    p_kind: input.kind,
    p_side: side,
    p_body: input.body,
    p_lines: input.lineIds,
    p_tagged: tagged?.id ?? null,
    p_tagged_label: tagged?.name ?? null,
    p_actor: actor.id,
    p_actor_label: actor.label,
  });
  if (error) queryError(error);
  return { id: String(data), workOrderNumber: wo.number, tagged };
}

export async function readQueryThread(admin: SupabaseClient, id: string): Promise<QueryThread | null> {
  const { data, error } = await admin.schema("finance").from("query_threads").select(THREAD_COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    if (threadsMissing(error)) throw new InvoicingError("Queries are not set up yet: a database update is still to be applied.", 409);
    throw new Error(error.message);
  }
  return data ? shapeThread(data as Record<string, unknown>) : null;
}

/** Everyone who wrote on a thread, by side: whom a reply tells. */
export async function threadParticipants(admin: SupabaseClient, id: string): Promise<Array<{ side: QuerySide; userId: string | null; taggedUserId: string | null }>> {
  const { data, error } = await admin.schema("finance").from("query_comments").select("side, author_id, tagged_user_id").eq("thread_id", id);
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({ side: c.side === "operations" ? "operations" : "finance", userId: str(c.author_id), taggedUserId: str(c.tagged_user_id) }));
}

export async function replyQueryThread(
  admin: SupabaseClient,
  thread: QueryThread,
  input: z.infer<typeof replyQuerySchema>,
  side: QuerySide,
  actor: { id: string; label: string },
): Promise<{ status: "open" | "resolved"; tagged: TagOption | null }> {
  const tagged = await taggedPerson(admin, other(side), input.taggedUserId);
  const { data, error } = await admin.schema("finance").rpc("reply_query_thread", {
    p_thread_id: thread.id,
    p_side: side,
    p_body: input.body?.trim() || null,
    p_action: input.action,
    p_tagged: tagged?.id ?? null,
    p_tagged_label: tagged?.name ?? null,
    p_actor: actor.id,
    p_actor_label: actor.label,
  });
  if (error) queryError(error);
  return { status: data === "resolved" ? "resolved" : "open", tagged };
}
