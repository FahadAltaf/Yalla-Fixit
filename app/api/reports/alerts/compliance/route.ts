import { NextRequest, NextResponse } from "next/server";

import { runComplianceAlerts } from "@/lib/server/reports/compliance-alerts";
import { cronAuthorised } from "@/lib/server/reports/route-helpers";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/**
 * The compliance messages N9, N10, N11, E2 and E3 (BRD §6.1, §6.2), and
 * closing N11 when disputes close. Driven by an external scheduler with
 * CRON_SECRET, the house pattern, once a day (07:00 Dubai suggested);
 * deduplicated, so a repeat run sends nothing new. Nothing schedules it
 * until go-live.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!cronAuthorised(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const admin = await createAdminServerClient();
    return NextResponse.json(await runComplianceAlerts(admin));
  } catch (error) {
    console.error("Compliance alerts error:", error);
    return NextResponse.json({ error: "Compliance alerts failed" }, { status: 500 });
  }
}
