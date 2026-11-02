import { NextRequest, NextResponse } from "next/server";

import { runDigest } from "@/lib/server/finance/digest";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/**
 * Sends the daily Ready-to-Invoice digest (BRD §5.1 Step 6; DEV-439).
 *
 * Driven by an external scheduler with CRON_SECRET, the house pattern. It
 * can be called every hour: before the configured time it does nothing,
 * and after it sends at most once per Dubai day (the dedupe key carries the
 * date). Nothing schedules it until go-live.
 *
 * Body (optional): { "ignoreTime": true } to send before the configured
 * time, for testing. Still once a day.
 */

export const dynamic = "force-dynamic";

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const headerSecret = req.headers.get("x-cron-secret");
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return headerSecret === secret || bearer === secret;
}

export async function POST(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { ignoreTime?: unknown };
  try {
    const admin = await createAdminServerClient();
    return NextResponse.json(await runDigest(admin, { ignoreTime: body.ignoreTime === true }));
  } catch (error) {
    console.error("Finance digest error:", error);
    return NextResponse.json({ error: "Digest failed" }, { status: 500 });
  }
}
