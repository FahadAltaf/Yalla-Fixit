import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { runLoggedJob, syncCurrentSites } from "@/lib/server/compliance/site-sync";

export const maxDuration = 60;

/*
  Scheduled job (C4): recompute every linked employee's current site from
  the appointment in progress (C3). Called every 6 hours by pg_cron
  through pg_net (supabase/compliance-cron.sql). Guarded by CRON_SECRET in
  x-cron-secret or a Bearer header; with no secret configured the route is
  closed. Each run is written to compliance_job_runs, failures included.
*/
function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = req.headers.get("x-cron-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const admin = await createAdminServerClient();
    const summary = await runLoggedJob(admin, "site_sync", "cron", () => syncCurrentSites(admin));
    return NextResponse.json({ data: summary });
  } catch (error) {
    console.error("[compliance] site-sync job:", error);
    return NextResponse.json({ error: "Site sync failed; see compliance_job_runs" }, { status: 500 });
  }
}
