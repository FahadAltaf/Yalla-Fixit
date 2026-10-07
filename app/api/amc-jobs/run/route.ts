import { NextRequest, NextResponse } from "next/server";

import { AMC_JOBS, isScheduledJobRequest, listAmcJobRuns, runAmcJobs } from "@/lib/server/amc/jobs";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

export const dynamic = "force-dynamic";

/**
 * Runs the AMC scheduled jobs (lib/server/amc/jobs.ts).
 *
 * POST from the scheduler: `x-cron-secret` / Bearer = CRON_SECRET, the same
 *      as the Snagging escalations and the Todos reminders. No secret
 *      configured means closed.
 * POST from the portal ("Run now"): AMC Configuration Edit.
 * GET  AMC Configuration View: the jobs and the last runs.
 */
export async function POST(req: NextRequest) {
  if (isScheduledJobRequest(req.headers)) {
    try {
      const admin = await createAdminServerClient();
      return NextResponse.json(await runAmcJobs(admin, { trigger: "scheduled", actorId: null }));
    } catch (error) {
      console.error("AMC jobs (scheduled):", error instanceof Error ? error.message : error);
      return NextResponse.json({ error: "AMC jobs failed" }, { status: 500 });
    }
  }
  const gate = await requireResourceAccess(ResourceType.AMC_CONFIG, ActionType.EDIT);
  if (!gate.ok) return gate.response;
  try {
    const admin = await createAdminServerClient();
    return NextResponse.json(await runAmcJobs(admin, { trigger: "manual", actorId: gate.access.profile.id }));
  } catch (error) {
    console.error("AMC jobs (manual):", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "AMC jobs failed" }, { status: 500 });
  }
}

export async function GET() {
  const gate = await requireResourceAccess(ResourceType.AMC_CONFIG, ActionType.VIEW);
  if (!gate.ok) return gate.response;
  const admin = await createAdminServerClient();
  return NextResponse.json(
    { jobs: AMC_JOBS.map((j) => ({ key: j.key, label: j.label })), runs: await listAmcJobRuns(admin) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
