import { NextRequest, NextResponse } from "next/server";

import { runReportAlerts } from "@/lib/server/reports/alerts";
import { cronAuthorised } from "@/lib/server/reports/route-helpers";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/**
 * The daily report alerts N7, N8, N13 and N14 (BRD 6.2; DEV-442, 452, 453), and
 * closing the ones that are over. Driven by an external scheduler with
 * CRON_SECRET, the house pattern; safe to call every hour (deduplicated).
 * Nothing schedules it until go-live.
 */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!cronAuthorised(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const admin = await createAdminServerClient();
    return NextResponse.json(await runReportAlerts(admin));
  } catch (error) {
    console.error("Report alerts error:", error);
    return NextResponse.json({ error: "Report alerts failed" }, { status: 500 });
  }
}
