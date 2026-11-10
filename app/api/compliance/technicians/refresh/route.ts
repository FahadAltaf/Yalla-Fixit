import { NextResponse } from "next/server";
import { ActionType } from "@/types/types";
import { requireCompliance } from "@/lib/server/compliance/access";
import { rosterSyncedAt } from "@/lib/server/compliance/roster";
import { syncFsmTechnicians } from "@/lib/server/zoho/service-resources";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { runLoggedJob, syncCurrentSites } from "@/lib/server/compliance/site-sync";

// Pages through up to 2,000 FSM users, like the scheduling refresh route.
export const maxDuration = 60;

/*
  "Refresh from FSM" on the compliance pages (FRD D11). Runs Scheduling's
  roster sync so a technician deactivated in FSM shows as inactive here
  without anyone opening the Scheduling module. Needs Compliance Edit.
*/
export async function POST() {
  const g = await requireCompliance(ActionType.EDIT);
  if (g.error) return g.error;
  try {
    const result = await syncFsmTechnicians();
    if (!result.ok) return NextResponse.json(result.json, { status: result.status });
    // C3: the same button also recomputes current sites, logged as a manual run.
    const admin = await createAdminServerClient();
    const sites = await runLoggedJob(admin, "site_sync", "manual", () => syncCurrentSites(admin)).catch((e) => {
      console.error("[compliance] manual site sync:", e);
      return null;
    });
    return NextResponse.json({ data: { ...(result.json as object), synced_at: await rosterSyncedAt(), sites } });
  } catch (error) {
    console.error("[compliance] roster refresh:", error);
    return NextResponse.json({ error: "Could not refresh the roster from FSM" }, { status: 500 });
  }
}

/* When the copy was last refreshed, for the "roster as of" note. */
export async function GET() {
  const g = await requireCompliance(ActionType.VIEW);
  if (g.error) return g.error;
  return NextResponse.json({ data: { synced_at: await rosterSyncedAt() } });
}
