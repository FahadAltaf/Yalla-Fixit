import { NextResponse } from "next/server";

import { hasResourceAction } from "@/lib/role-permissions";
import { ActionType, ResourceType } from "@/types/types";

import { QueueError } from "./queue";

/**
 * Who does what on a work order (27 Oct; 2 Nov). Finance (the Finance queue
 * permissions) records invoices; Operations (Not-invoiceable Create, the
 * coordinators) records % done and marks work ready to invoice. Both raise
 * queries, reply and close them, mark a work order not invoiceable or
 * invoiceable again (the other side is told), and put it on hold or resume
 * it. Nothing waits on a verifier. The routes check these, and the page
 * shows only these buttons.
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
  };
}
export type WorkOrderAbilities = ReturnType<typeof workOrderAbilities>;

/** The sides of a query someone may write for (2 Nov, ./queries). */
export function querySides(user: Parameters<typeof hasResourceAction>[0]): Array<"finance" | "operations"> {
  const can = workOrderAbilities(user);
  return [...(can.query ? (["finance"] as const) : []), ...(can.answer ? (["operations"] as const) : [])];
}

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
