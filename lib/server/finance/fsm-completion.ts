import type { SupabaseClient } from "@supabase/supabase-js";

import { planFsmCompletion, type FsmAppointmentLink } from "@/lib/finance/fsm-completion-plan";
import { fsmFetch, fsmGetRecord, getFsmAccessToken } from "@/lib/server/zoho/fsm-client";

import { forgetLists } from "./fsm-live";

/**
 * Completion in the portal, written to Zoho FSM (the user's direction,
 * 2 Nov: "When a line item or whole work order is marked complete in the
 * portal, update the status in Zoho FSM automatically").
 *
 * This is the Finance module's only FSM write, so it has its own switch:
 * nothing is sent unless FINANCE_FSM_COMPLETION=on. Every other finance
 * call still goes through the read-only client (./fsm-read.ts).
 *
 * The portal's completion is saved first and stays saved whatever FSM
 * says; FSM's answer comes back in words for the page, and is kept on the
 * work order's history. What is completed, and what is left alone and why:
 * lib/finance/fsm-completion-plan.ts. Each step is a blueprint transition,
 * taken only when FSM offers it (Zoho: list the transitions, then PUT the
 * one wanted), as the snagging sync completes its work orders.
 */

export type FsmCompletionResult = {
  /** off: the switch is off; done: FSM shows it complete; partial: some of it; refused: FSM did not complete it; skipped: nothing to send. */
  state: "off" | "done" | "partial" | "refused" | "skipped";
  /** In words, for the page and the history. */
  message: string;
};

type Row = Record<string, any>;

export function financeFsmCompletionEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.FINANCE_FSM_COMPLETION === "on";
}

/* FSM's own words for a refusal, as short as it says them. */
function fsmReason(json: Row | null | undefined, status: number): string {
  const first = Array.isArray(json?.data) ? json?.data?.[0] : null;
  const message = first?.message ?? json?.message ?? json?.error ?? json?.code;
  const detail = first?.details?.api_name ? ` (${first.details.api_name})` : "";
  return message ? `${String(message)}${detail}` : `FSM answered ${status}`;
}

/* One blueprint step on a record, when FSM offers it. */
async function transition(
  token: string,
  module: "Work_Orders" | "Service_Appointments",
  recordId: string,
  pattern: RegExp,
  data?: Record<string, unknown>,
): Promise<{ done: boolean; reason?: string }> {
  const path = `/${module}/${encodeURIComponent(recordId)}/actions/blueprint`;
  const list = await fsmFetch(token, `${path}/transitions`);
  if (!list.ok) return { done: false, reason: fsmReason(list.json, list.status) };
  const transitions = (list.json?.transitions ?? []) as Row[];
  const match = transitions.find((t) => t.enabled !== false && pattern.test(String(t.name ?? "")));
  if (!match) return { done: false, reason: `FSM offers no Complete from "${list.json?.process_info?.field_value ?? "its current status"}"` };
  const res = await fsmFetch(
    token,
    path,
    { method: "PUT", body: JSON.stringify({ blueprint: [{ transition_id: String(match.id), ...(data ? { data } : {}) }] }) },
    { retry: false },
  );
  return res.ok ? { done: true } : { done: false, reason: fsmReason(res.json, res.status) };
}

function linksOf(workOrder: Row): FsmAppointmentLink[] {
  return ((workOrder.Appointments_X_Services ?? []) as Row[])
    .filter((x) => x.Service_Appointment?.id)
    .map((x) => ({
      appointmentId: String(x.Service_Appointment.id),
      appointmentName: (x.Service_Appointment.name as string | undefined) ?? null,
      lineId: x.Service_Line_Item?.id ? String(x.Service_Line_Item.id) : null,
      status: (x.SLI_Status as string | undefined) ?? null,
      active: x.is_line_item_active !== false,
    }));
}

/**
 * Completes in FSM what the portal now says is complete: the appointments
 * whose lines are all complete (and already started), and, for the whole
 * work order, the work order. Never throws: the portal's completion is
 * already saved.
 */
export async function syncCompletionToFsm(
  admin: SupabaseClient,
  input: { workOrderId: string; workOrderNumber: string | null; completeLines: Set<string>; changedLines: string[]; wholeWorkOrder: boolean },
): Promise<FsmCompletionResult> {
  const name = input.workOrderNumber ?? "The work order";
  if (!financeFsmCompletionEnabled()) {
    return { state: "off", message: "Saved in the portal. Sending completion to Zoho FSM is switched off on this server." };
  }
  try {
    const token = await getFsmAccessToken(admin);
    const read = await fsmGetRecord<Row>(token, "Work_Orders", input.workOrderId);
    if (!read.ok || !read.record) return { state: "refused", message: `Saved in the portal. FSM could not be read: ${fsmReason(read.json, read.status)}.` };
    const plan = planFsmCompletion({
      workOrderStatus: (read.record.Status as string | undefined) ?? null,
      links: linksOf(read.record),
      completeLines: input.completeLines,
      changedLines: input.changedLines,
      wholeWorkOrder: input.wholeWorkOrder,
    });
    if (plan.alreadyComplete) return { state: "skipped", message: `${name} is already ${read.record.Status} in FSM.` };

    const done: string[] = [];
    const notes: string[] = plan.skipped.map((s) => `${s.appointmentName} left as it is: ${s.reason}`);
    for (const a of plan.complete) {
      const step = await transition(token, "Service_Appointments", a.appointmentId, /^complete/i, {
        $complete_pc_li: true,
        $complete_wo: a.completesWorkOrder,
      });
      if (step.done) done.push(a.appointmentName ?? a.appointmentId);
      else notes.push(`${a.appointmentName ?? a.appointmentId} not completed: ${step.reason}`);
    }

    let workOrderDone = false;
    if (plan.completeWorkOrder) {
      const now = await fsmGetRecord<Row>(token, "Work_Orders", input.workOrderId);
      workOrderDone = /completed|closed/i.test(String(now.record?.Status ?? ""));
      if (!workOrderDone) {
        const step = await transition(token, "Work_Orders", input.workOrderId, /^complete/i);
        workOrderDone = step.done;
        if (!step.done) notes.push(`the work order was not completed: ${step.reason}`);
      }
    }
    if (done.length || workOrderDone) forgetLists();

    const said = [
      workOrderDone ? `${name} completed in FSM` : null,
      done.length ? `${done.length === 1 ? "appointment" : "appointments"} ${done.join(", ")} completed in FSM` : null,
    ].filter(Boolean);
    if (!said.length && !notes.length) return { state: "skipped", message: "Saved in the portal. No appointment in FSM covers these lines, so nothing was sent." };
    const wanted = plan.completeWorkOrder ? workOrderDone : notes.length === 0;
    return {
      state: wanted ? "done" : said.length ? "partial" : "refused",
      message: `${said.length ? `${said.join("; ")}.` : "Saved in the portal; FSM was not changed."}${notes.length ? ` ${notes.join("; ")}.` : ""}`,
    };
  } catch (error) {
    console.error("[finance:fsm-completion]", error);
    return { state: "refused", message: `Saved in the portal. FSM could not be reached: ${error instanceof Error ? error.message : String(error)}.` };
  }
}
