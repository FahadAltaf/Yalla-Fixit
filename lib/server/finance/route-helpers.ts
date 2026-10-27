import { NextResponse } from "next/server";

import { hasResourceAction } from "@/lib/role-permissions";
import { ActionType, ResourceType } from "@/types/types";

import { QueueError } from "./queue";

/**
 * Who does what on a work order (27 Oct). Finance (the Finance queue
 * permissions) records invoices and raises queries; Operations (Not-invoiceable
 * Create, the coordinators) records % done, marks work ready to invoice and
 * answers queries; both put a work order on hold, resume it, and mark it not
 * invoiceable. The routes check these, and the page shows only these buttons.
 */
export function workOrderAbilities(user: Parameters<typeof hasResourceAction>[0]) {
  const finance = hasResourceAction(user, ResourceType.FINANCE_QUEUE, ActionType.EDIT);
  const operations = hasResourceAction(user, ResourceType.FINANCE_EXCLUSIONS, ActionType.CREATE);
  return {
    view: hasResourceAction(user, ResourceType.FINANCE_QUEUE, ActionType.VIEW) || operations,
    invoice: hasResourceAction(user, ResourceType.FINANCE_QUEUE, ActionType.APPROVE),
    query: finance,
    hold: finance || operations,
    exclude: finance || operations,
    progress: operations,
    markReady: operations,
    answer: operations,
    verify: hasResourceAction(user, ResourceType.FINANCE_EXCLUSIONS, ActionType.APPROVE),
  };
}
export type WorkOrderAbilities = ReturnType<typeof workOrderAbilities>;

/** The signed-in person, as recorded on queue events. */
export function actorOf(profile: { id: string; full_name?: string | null; email?: string | null }) {
  return { id: profile.id, label: (profile.full_name ?? "").trim() || profile.email || "Unknown user" };
}

/** A refusal from the queue functions as its HTTP answer; anything else is a 500. */
export function queueErrorResponse(error: unknown, context: string) {
  if (error instanceof QueueError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(`${context}:`, error);
  return NextResponse.json({ error: "Something went wrong. Nothing was changed." }, { status: 500 });
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
