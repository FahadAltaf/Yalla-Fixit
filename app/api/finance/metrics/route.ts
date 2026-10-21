import { NextResponse } from "next/server";

import { computeQueueMetrics, summarise } from "@/lib/finance/metrics";
import { readQueueForMetrics } from "@/lib/server/finance/queue-read";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Invoicing controls (BRD §5.1 Step 8, §6.9; DEV-441): days to invoice,
 * ageing bands, holds, excluded value by reason, variance. For whoever may
 * view the queue (Finance, and managers for its ageing).
 */
export async function GET() {
  const gate = await requireResourceAccess(ResourceType.FINANCE_QUEUE, ActionType.VIEW);
  if (!gate.ok) return gate.response;
  try {
    const admin = await createAdminServerClient();
    const { items, invoices, exclusions } = await readQueueForMetrics(admin);
    return NextResponse.json(
      { summary: summarise(items, invoices), metrics: computeQueueMetrics(items, invoices, exclusions, new Date()) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Finance metrics error:", error);
    return NextResponse.json({ error: "Could not load the metrics" }, { status: 500 });
  }
}
