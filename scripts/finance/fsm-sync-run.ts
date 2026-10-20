/*
  Run the read-only FSM sync once, by hand (development and go-live
  backfill). The same engine and store as app/api/finance/fsm-sync/run.

  Run:
    FINANCE_FSM_READ=on node --env-file=.env --env-file=.env.local \
      --import ./tests/setup/register.mjs scripts/finance/fsm-sync-run.ts \
      <estimates|work_orders|appointments> <incremental|reconcile|backfill> <budget> [detailDays]

  `detailDays` (backfill only): read work-order lines and appointment crews
  only for records modified in the last N days. Older records still get
  their headers. Leave it out to read details for everything.
*/
import { createFsmReader, financeFsmReadEnabled } from "@/lib/server/finance/fsm-read";
import { runFsmSync } from "@/lib/server/finance/fsm-sync/engine";
import { supabaseSyncStore, type SyncKind, type SyncResource } from "@/lib/server/finance/fsm-sync/store";
import { getFsmAccessToken } from "@/lib/server/zoho/fsm-client";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

const RESOURCES = ["estimates", "work_orders", "appointments"];
const KINDS = ["incremental", "reconcile", "backfill"];

async function main() {
  const [resource, kind, budgetArg, detailDaysArg] = process.argv.slice(2);
  if (!RESOURCES.includes(resource) || !KINDS.includes(kind) || !Number(budgetArg)) {
    throw new Error("usage: fsm-sync-run.ts <resource> <kind> <budget> [detailDays]");
  }
  if (!financeFsmReadEnabled()) throw new Error("Set FINANCE_FSM_READ=on");
  const admin = await createAdminServerClient();
  const token = await getFsmAccessToken(admin);
  const reader = createFsmReader({ token, budget: Number(budgetArg) });
  const detailDays = detailDaysArg ? Number(detailDaysArg) : null;
  const started = Date.now();
  const summary = await runFsmSync({
    resource: resource as SyncResource,
    kind: kind as SyncKind,
    reader,
    store: supabaseSyncStore(admin),
    options: {
      backfillDetailSince: detailDays ? new Date(Date.now() - detailDays * 86_400_000).toISOString() : null,
    },
  });
  console.log(JSON.stringify({ ...summary, seconds: Math.round((Date.now() - started) / 1000) }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
