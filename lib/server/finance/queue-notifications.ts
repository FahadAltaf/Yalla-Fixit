import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveNotifications } from "@/lib/server/notifications/inbox";
import { createNotifier, supabaseNotificationStore } from "@/lib/server/notifications/notifier";
import { sendEmail } from "@/lib/server/send-email";
import { ActionType, ResourceType } from "@/types/types";

import { usersHolding } from "./recipients";

/**
 * N3 and N4 (BRD §6.2), in-app. Both are action items that stay open until
 * the thing they ask for is done, then resolve for everyone they went to.
 * Delivery goes through the notifier, so outside production they reach
 * only the development allowlist.
 *
 *  N3  "{coordinator} marked {work order} not invoiceable: {reason}. Please
 *      verify." -> whoever may verify exclusions. Stops when decided.
 *  N4  "Finance raised a query on {work order}: {text}" -> coordinators
 *      (whoever may request exclusions; D-18 maps the role). Stops when
 *      answered.
 *
 * Never thrown: the change it announces is already committed, and a failed
 * notice must not turn that into an error for the user.
 */

const notifierFor = (admin: SupabaseClient) =>
  createNotifier({
    store: supabaseNotificationStore(admin),
    sendEmail: (input) => sendEmail(input),
    appUrl: process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL,
  });

const money = (value: number) => `AED ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function notifyExclusionRequested(
  admin: SupabaseClient,
  input: { exclusionId: string; itemId: string; workOrderNumber: string; value: number; reason: string; coordinator: string },
): Promise<void> {
  try {
    const verifiers = await usersHolding(admin, ResourceType.FINANCE_EXCLUSIONS, ActionType.APPROVE);
    await notifierFor(admin)({
      event: "finance.exclusion_requested",
      entityType: "finance_exclusion",
      entityId: input.exclusionId,
      dedupeKey: `exclusion:${input.exclusionId}`,
      recipients: verifiers.map((v) => ({ userId: v.userId })),
      channels: ["in_app"],
      title: `Verify: ${input.workOrderNumber} not to be invoiced`,
      body: `${input.coordinator} marked ${input.workOrderNumber} (${money(input.value)}) not invoiceable: ${input.reason}. Please verify.`,
      link: `/finance/queue/${input.itemId}`,
      requiresAction: true,
    });
  } catch (error) {
    console.error("[finance:N3] notification failed:", error);
  }
}

export async function resolveExclusionNotices(admin: SupabaseClient, exclusionId: string): Promise<void> {
  try {
    await resolveNotifications(admin, { entityType: "finance_exclusion", entityId: exclusionId });
  } catch (error) {
    console.error("[finance:N3] resolve failed:", error);
  }
}

export async function notifyQueryRaised(
  admin: SupabaseClient,
  input: { itemId: string; workOrderNumber: string; question: string; raisedAt: string },
): Promise<void> {
  try {
    const coordinators = await usersHolding(admin, ResourceType.FINANCE_EXCLUSIONS, ActionType.CREATE);
    await notifierFor(admin)({
      event: "finance.query_raised",
      entityType: "finance_queue_item",
      entityId: input.itemId,
      /* One per query: a later query on the same item notifies again. */
      dedupeKey: `query:${input.itemId}:${input.raisedAt}`,
      recipients: coordinators.map((c) => ({ userId: c.userId })),
      channels: ["in_app"],
      title: `Finance query on ${input.workOrderNumber}`,
      body: `Finance raised a query on ${input.workOrderNumber}: ${input.question}`,
      link: `/finance/queue/${input.itemId}`,
      requiresAction: true,
    });
  } catch (error) {
    console.error("[finance:N4] notification failed:", error);
  }
}

/** N2 ("pending for {d} days") stops when the item's status changes. */
export async function resolveAgedNotices(admin: SupabaseClient, itemId: string): Promise<void> {
  try {
    await resolveNotifications(admin, { entityType: "finance_queue_item", entityId: itemId, event: "finance.item_aged" });
  } catch (error) {
    console.error("[finance:N2] resolve failed:", error);
  }
}

export async function resolveQueryNotices(admin: SupabaseClient, itemId: string): Promise<void> {
  try {
    await resolveNotifications(admin, {
      entityType: "finance_queue_item",
      entityId: itemId,
      event: "finance.query_raised",
    });
  } catch (error) {
    console.error("[finance:N4] resolve failed:", error);
  }
}

// ---------------------------------------------------------------------
// Query threads (2 Nov, ./queries): a raised query goes to the person
// tagged, else to everyone on the other side; a reply goes to whoever on
// the other side wrote on it or was tagged, else to the whole side. Each
// reply resolves the thread's earlier notices; one waiting on an answer is
// an action item, one saying it was resolved is not.
// ---------------------------------------------------------------------

type ThreadNotice = {
  threadId: string;
  workOrderId: string;
  workOrderNumber: string | null;
  kind: "question" | "not_invoiceable";
  /** The side writing. */
  side: "finance" | "operations";
  author: { id: string; label: string };
  body: string | null;
  taggedUserId: string | null;
};

const SIDE_WORD = { finance: "Finance", operations: "Operations" } as const;
const queryLink = (input: Pick<ThreadNotice, "workOrderId">) => `/finance/queue/${input.workOrderId}`;
const clip = (text: string | null, max = 240) => (text && text.length > max ? `${text.slice(0, max - 1)}…` : (text ?? ""));

async function sideRecipients(admin: SupabaseClient, side: "finance" | "operations"): Promise<string[]> {
  const people =
    side === "finance"
      ? await usersHolding(admin, ResourceType.FINANCE_QUEUE, ActionType.EDIT)
      : await usersHolding(admin, ResourceType.FINANCE_EXCLUSIONS, ActionType.CREATE);
  return people.map((p) => p.userId);
}

export async function notifyQueryOpened(admin: SupabaseClient, input: ThreadNotice): Promise<void> {
  try {
    const to = input.side === "finance" ? "operations" : "finance";
    const ids = (input.taggedUserId ? [input.taggedUserId] : await sideRecipients(admin, to)).filter((id) => id !== input.author.id);
    const wo = input.workOrderNumber ?? "a work order";
    await notifierFor(admin)({
      event: "finance.query_raised",
      entityType: "finance_query",
      entityId: input.threadId,
      dedupeKey: `query-thread:${input.threadId}:raised`,
      recipients: ids.map((userId) => ({ userId })),
      channels: ["in_app"],
      title: input.kind === "not_invoiceable" ? `Finance: ${wo} is not invoiceable` : `${SIDE_WORD[input.side]} query on ${wo}`,
      body:
        input.kind === "not_invoiceable"
          ? `${input.author.label} says ${wo} is not invoiceable: ${clip(input.body)}. Correct the completion or withdraw the request to invoice, or reply.`
          : `${input.author.label} asks on ${wo}: ${clip(input.body)}`,
      link: queryLink(input),
      requiresAction: true,
    });
  } catch (error) {
    console.error("[finance:queries] notification failed:", error);
  }
}

export async function notifyQueryReply(
  admin: SupabaseClient,
  input: ThreadNotice & {
    action: "comment" | "closed";
    resolved: boolean;
    participants: Array<{ side: "finance" | "operations"; userId: string | null; taggedUserId: string | null }>;
    replyCount: number;
  },
): Promise<void> {
  try {
    await resolveNotifications(admin, { entityType: "finance_query", entityId: input.threadId });
    const to = input.side === "finance" ? "operations" : "finance";
    const involved = new Set<string>();
    for (const p of input.participants) {
      if (p.side === to && p.userId) involved.add(p.userId);
      if (p.side !== to && p.taggedUserId) involved.add(p.taggedUserId);
    }
    /* Without the author first: someone who answers on both sides still reaches the other side. */
    const notAuthor = (list: string[]) => [...new Set(list)].filter((id) => id !== input.author.id);
    let ids = notAuthor(input.taggedUserId ? [input.taggedUserId, ...involved] : [...involved]);
    if (!ids.length) ids = notAuthor(await sideRecipients(admin, to));
    const wo = input.workOrderNumber ?? "a work order";
    const what = input.action === "closed" ? "closed it" : "replied";
    await notifierFor(admin)({
      event: input.resolved ? "finance.query_resolved" : "finance.query_reply",
      entityType: "finance_query",
      entityId: input.threadId,
      dedupeKey: `query-thread:${input.threadId}:${input.replyCount}`,
      recipients: ids.map((userId) => ({ userId })),
      channels: ["in_app"],
      title: input.resolved ? `Query on ${wo} closed` : `${SIDE_WORD[input.side]} replied on ${wo}`,
      body: `${input.author.label} ${what}${input.body ? `: ${clip(input.body)}` : "."}`,
      link: queryLink(input),
      requiresAction: !input.resolved,
    });
  } catch (error) {
    console.error("[finance:queries] notification failed:", error);
  }
}

// ---------------------------------------------------------------------
// Changes on a work order, from either side (2 Nov): the other side is
// told who marked it not invoiceable or invoiceable again, put it on hold
// or resumed it. A notice, not an action item; each change resolves the
// one before it.
// ---------------------------------------------------------------------

export type WorkOrderChange = "not_invoiceable" | "invoiceable" | "on_hold" | "resumed";

const CHANGE_WORDS: Record<WorkOrderChange, { event: string; title: string; did: string }> = {
  not_invoiceable: { event: "finance.marked_not_invoiceable", title: "marked not invoiceable", did: "marked {wo} not invoiceable" },
  invoiceable: { event: "finance.marked_invoiceable", title: "is invoiceable again", did: "marked {wo} invoiceable again" },
  on_hold: { event: "finance.put_on_hold", title: "put on hold", did: "put {wo} on hold" },
  resumed: { event: "finance.resumed", title: "resumed", did: "resumed {wo}" },
};

export async function notifyWorkOrderChange(
  admin: SupabaseClient,
  input: {
    workOrderId: string;
    workOrderNumber: string | null;
    change: WorkOrderChange;
    /** The side that changed it. */
    side: "finance" | "operations";
    author: { id: string; label: string };
    reason: string | null;
  },
): Promise<void> {
  try {
    await resolveNotifications(admin, { entityType: "finance_work_order_change", entityId: input.workOrderId });
    const to = input.side === "finance" ? "operations" : "finance";
    const ids = (await sideRecipients(admin, to)).filter((id) => id !== input.author.id);
    const wo = input.workOrderNumber ?? "A work order";
    const words = CHANGE_WORDS[input.change];
    await notifierFor(admin)({
      event: words.event,
      entityType: "finance_work_order_change",
      entityId: input.workOrderId,
      dedupeKey: `wo-change:${input.workOrderId}:${input.change}:${Date.now()}`,
      recipients: ids.map((userId) => ({ userId })),
      channels: ["in_app"],
      title: `${wo} ${words.title}`,
      body: `${input.author.label} (${SIDE_WORD[input.side]}) ${words.did.replace("{wo}", wo)}${input.reason ? `: ${clip(input.reason)}` : "."}`,
      link: `/finance/queue/${input.workOrderId}`,
      requiresAction: false,
    });
  } catch (error) {
    console.error("[finance:work-order-change] notification failed:", error);
  }
}
