import { NextRequest, NextResponse } from "next/server";

import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { jobSheetSupervisors, reviewQueue } from "@/lib/server/amc/job-sheets";
import { siteVisitsAwaitingApproval } from "@/lib/server/amc/site-visit-approvers";
import { homeDrill } from "@/lib/server/home/drill";
import { getRequestUserAccess } from "@/lib/server/request-user-access";

/**
 * AMC -> Approvals & reviews: everything waiting for this person's decision
 * or review, in one list (27 Nov 2026). Submitted job sheets (to-do 5,
 * oldest first, with why each needs a close look and its report clock),
 * the site visit reports, proposals and contract amendments waiting for
 * them -- the same lists the home page counts.
 */
export async function GET(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  try {
    const config = await readAmcConfig(gate.admin);
    const supervisor = gate.visits.approve || jobSheetSupervisors(config).includes(gate.userId);
    const { profile, accessUser } = await getRequestUserAccess(req);
    /* The home page's lists, so both always agree; a list this person may not see is simply empty. */
    const drill = async (key: "amc-proposals" | "amc-amendments") => {
      if (!profile || !accessUser) return [];
      const page = await homeDrill(gate.admin, { id: profile.id, email: profile.email ?? null }, accessUser, key, { page: 0, pageSize: 50 }).catch((e) => {
        console.warn(`[amc:reviews] ${key} not read:`, e instanceof Error ? e.message : e);
        return null;
      });
      return page?.rows ?? [];
    };
    const [queue, siteVisits, proposals, amendments] = await Promise.all([
      gate.visits.view || supervisor ? reviewQueue(gate.admin) : Promise.resolve({ migrated: true, items: [] }),
      siteVisitsAwaitingApproval(gate.admin, gate.userId).catch((e) => {
        console.warn("[amc:reviews] site visits not read:", e instanceof Error ? e.message : e);
        return [];
      }),
      drill("amc-proposals"),
      drill("amc-amendments"),
    ]);
    if (!gate.visits.view && !supervisor && !siteVisits.length && !proposals.length && !amendments.length) {
      return NextResponse.json({ error: "You do not have access to approvals and reviews." }, { status: 403 });
    }
    const approvals = [
      ...proposals.map((r) => ({ ...r, type: "proposal" as const })),
      ...amendments.map((r) => ({ ...r, type: "amendment" as const })),
    ];
    return NextResponse.json({ ...queue, siteVisits, approvals, canReview: supervisor }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the approvals and reviews");
  }
}
