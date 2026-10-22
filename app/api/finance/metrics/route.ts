import { NextRequest, NextResponse } from "next/server";

import { computePeriodMetrics, computeQueueMetrics, summarise } from "@/lib/finance/metrics";
import { readQueueForMetrics } from "@/lib/server/finance/queue-read";
import { readReportingSettings } from "@/lib/server/reporting/settings";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Invoicing controls (BRD §5.1 Step 8, §6.9; DEV-441): days to invoice,
 * ageing bands, holds, excluded value by reason, variance. For whoever may
 * view the queue (Finance, and managers for its ageing).
 *
 * ?days=7|30|90|365 (default 30) sets the window the period figures and
 * the activity chart are read over; the rest is the queue as it is now.
 */
const WINDOWS = new Set([7, 30, 90, 365]);

export async function GET(req: NextRequest) {
  const gate = await requireResourceAccess(ResourceType.FINANCE_QUEUE, ActionType.VIEW);
  if (!gate.ok) return gate.response;
  const asked = Number(req.nextUrl.searchParams.get("days") ?? 30);
  const days = WINDOWS.has(asked) ? asked : 30;
  try {
    const admin = await createAdminServerClient();
    const [{ items, invoices, exclusions }, settings] = await Promise.all([
      readQueueForMetrics(admin),
      readReportingSettings(admin),
    ]);
    const now = new Date();
    return NextResponse.json(
      {
        summary: summarise(items, invoices),
        metrics: computeQueueMetrics(items, invoices, exclusions, now),
        period: computePeriodMetrics({ items, invoices, now, days, agedAfterDays: settings.finance.agedAfterDays }),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Finance metrics error:", error);
    return NextResponse.json({ error: "Could not load the metrics" }, { status: 500 });
  }
}
