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
