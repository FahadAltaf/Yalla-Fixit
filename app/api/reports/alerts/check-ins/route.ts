import { NextRequest, NextResponse } from "next/server";

import { runCheckInAlerts } from "@/lib/server/reports/checkin-alerts";
import { cronAuthorised } from "@/lib/server/reports/route-helpers";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/**
 * The check-in alerts N5 and N6 (BRD B3, 6.2), and closing the ones that are
 * over. Driven by an external scheduler with CRON_SECRET, the house pattern,
 * every five minutes; deduplicated, so a repeat run sends nothing new.
 * Nothing schedules it until go-live.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!cronAuthorised(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const admin = await createAdminServerClient();
    return NextResponse.json(await runCheckInAlerts(admin));
  } catch (error) {
    console.error("Check-in alerts error:", error);
    return NextResponse.json({ error: "Check-in alerts failed" }, { status: 500 });
  }
}
