/*
  TEST DATA: queue items for checking the Finance screens (P4) while the
  real trigger (DEV-433) waits on decisions D-01..D-03. Authorised by the
  user on 21 Oct 2026.

  Each item is made from real completed FSM lines through the same
  finance.create_queue_item the trigger will use, and is marked so it can
  be found and removed: created_by = 'test', trigger_key 'test:<wo>:<n>'.
  Nothing is written to FSM. The go-live checklist removes all of them.

  Run:
    node --env-file=.env --env-file=.env.local --import ./tests/setup/register.mjs \
      scripts/finance/create-test-queue-items.ts <workOrderId>[:<maxLines>] ...
*/
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

async function main() {
  const specs = process.argv.slice(2).map((arg) => {
    const [workOrderId, max] = arg.split(":");
    return { workOrderId, maxLines: max ? Number(max) : Infinity };
  });
  if (specs.length === 0) throw new Error("usage: create-test-queue-items.ts <workOrderId>[:<maxLines>] ...");
  const admin = await createAdminServerClient();

  for (const { workOrderId, maxLines } of specs) {
    const { data: lines, error } = await admin
      .schema("fsm")
      .from("line_items")
      .select("fsm_line_id, sequence")
      .eq("fsm_work_order_id", workOrderId)
      .eq("status", "Completed")
      .is("removed_at", null)
      .not("amount", "is", null)
      .order("sequence", { ascending: true });
    if (error) throw new Error(error.message);
    const chosen = (lines ?? []).slice(0, maxLines).map((l) => l.fsm_line_id as string);
    if (chosen.length === 0) {
      console.log(`${workOrderId}: no completed lines, skipped`);
      continue;
    }
    const { data: itemId, error: createError } = await admin.schema("finance").rpc("create_queue_item", {
      p_trigger_key: `test:${workOrderId}:${chosen.length}`,
      p_work_order_id: workOrderId,
      p_line_ids: chosen,
      p_created_by: "test",
    });
    console.log(`${workOrderId}: ${createError ? `refused: ${createError.message}` : `item ${itemId} from ${chosen.length} line(s)`}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
