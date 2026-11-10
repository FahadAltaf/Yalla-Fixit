import type { SupabaseClient } from "@supabase/supabase-js";

import type { FsmCompletionResult } from "./fsm-completion";

/**
 * FSM's answer to a completion, on the work order's history (migration
 * 20261103110000): completed in FSM, or not, and why. Best effort: before
 * the migration, or if it fails, the answer was still shown on the page.
 */
export async function recordFsmCompletion(
  admin: SupabaseClient,
  input: { workOrderId: string; workOrderNumber: string | null; result: FsmCompletionResult; actor: { id: string; label: string } },
): Promise<void> {
  const { error } = await admin.schema("finance").rpc("record_fsm_completion", {
    p_work_order_id: input.workOrderId,
    p_completed: input.result.state === "done" || input.result.state === "partial",
    p_note: input.result.message.slice(0, 2000),
    p_actor: input.actor.id,
    p_actor_label: input.actor.label,
  });
  if (error) console.error("[finance:fsm-completion] history not kept:", error.message);
}
