import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createFsmReader, financeFsmReadEnabled } from "@/lib/server/finance/fsm-read";
import { runFsmSync, type SyncSummary } from "@/lib/server/finance/fsm-sync/engine";
import { supabaseSyncStore, type SyncResource } from "@/lib/server/finance/fsm-sync/store";
import { getFsmAccessToken } from "@/lib/server/zoho/fsm-client";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/**
 * Runs the read-only FSM sync (P2). Driven by an external scheduler with
 * CRON_SECRET, the house pattern (app/api/snagging/approvals/escalations/run);
 * nothing schedules it until go-live, so in development it is run by hand.
 *
 * Body: { resource: "estimates" | "work_orders" | "appointments" | "all",
 *         kind: "incremental" | "reconcile" | "backfill", budget?: number }
 *
 * `budget` caps the FSM calls of each resource's run (default 300). Reads
 * only: the reader can send nothing but GET, and refuses to run unless
 * FINANCE_FSM_READ=on.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RESOURCES: SyncResource[] = ["estimates", "work_orders", "appointments"];

const bodySchema = z
  .object({
    resource: z.enum(["estimates", "work_orders", "appointments", "all"]),
    kind: z.enum(["incremental", "reconcile", "backfill"]).default("incremental"),
    budget: z.number().int().min(1).max(2000).default(300),
  })
  .strict();

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // No secret configured means the endpoint is closed, not open.
  if (!secret) return false;
  const headerSecret = req.headers.get("x-cron-secret");
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return headerSecret === secret || bearer === secret;
}

export async function POST(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  if (!financeFsmReadEnabled()) {
    return NextResponse.json({ error: "FSM reads are off (FINANCE_FSM_READ)" }, { status: 503 });
  }

  try {
    const admin = await createAdminServerClient();
    const token = await getFsmAccessToken(admin);
    const store = supabaseSyncStore(admin);
    const resources = parsed.data.resource === "all" ? RESOURCES : [parsed.data.resource];

    /* One after another: they share FSM's rate allowance, and appointments
       re-read work orders, which is cheaper once work orders are current. */
    const results: SyncSummary[] = [];
    for (const resource of resources) {
      const reader = createFsmReader({ token, budget: parsed.data.budget });
      results.push(await runFsmSync({ resource, kind: parsed.data.kind, reader, store }));
    }
    const failed = results.some((r) => r.status === "failed");
    return NextResponse.json({ results }, { status: failed ? 502 : 200 });
  } catch (error) {
    console.error("FSM sync run error:", error);
    return NextResponse.json({ error: "FSM sync failed to start" }, { status: 500 });
  }
}
