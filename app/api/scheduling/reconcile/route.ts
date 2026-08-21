import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { reconcileFsmAppointments } from "@/lib/server/zoho/reconcile";
import { ActionType, ResourceType } from "@/types/types";

// Reconciliation can take a few seconds per FSM read; a busy all-days sweep
// needs more than the platform default.
export const maxDuration = 60;

const bodySchema = z.object({
  // Scope the sweep to one operating date. The daily-schedule Refresh button
  // passes the day being viewed, which is the common case and much cheaper
  // than re-reading every current entry across every day.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// SYNC-013: on-demand refresh/reconcile for authorised users. Replaces the
// every-10-minutes pg_cron job -- FSM changes are adopted when a scheduler
// actually opens or refreshes a day, which is both cheaper and fresher at
// the moment it matters.
export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // The Refresh button sends no body; treat that as an all-days sweep.
    let raw: unknown = {};
    try {
      raw = await req.json();
    } catch {
      raw = {};
    }
    const parsed = bodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const result = await reconcileFsmAppointments({ operatingDate: parsed.data.date });
    if (!result.ok) return NextResponse.json(result.json, { status: result.status });

    return NextResponse.json({ data: result.json });
  } catch (error) {
    console.error("Scheduling reconcile error:", error);
    return NextResponse.json({ error: "Failed to trigger reconciliation" }, { status: 500 });
  }
}
