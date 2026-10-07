import { NextResponse } from "next/server";

import { canUseAmc } from "@/components/dashboard/extensions/amc/amc-constants";
import { todayInDubai } from "@/lib/amc/contracts";
import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse } from "@/lib/server/amc/contract-access";
import { rateCardInForce } from "@/lib/server/amc/rate-card";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/**
 * What the proposal wizard prices and checks with (Phase 4): the rate card
 * in force today (null: price as entered), the payment value band and
 * plans, the discount thresholds by approval level, and the validity days.
 * Read by any AMC user; changing them is the rate card and configuration
 * screens' business.
 */
export async function GET() {
  const access = await getAuthenticatedUserAccess();
  if (!access.profile || !access.accessUser || access.profile.is_active === false) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canUseAmc(access.accessUser)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const admin = await createAdminServerClient();
    const [version, config] = await Promise.all([rateCardInForce(admin), readAmcConfig(admin)]);
    return NextResponse.json(
      {
        today: todayInDubai(),
        rateCard: version ? { id: version.id, versionNo: version.versionNo, effectiveFrom: version.effectiveFrom, card: version.card } : null,
        payments: config.payments,
        approvals: {
          level1Name: config.approvals.level1Name,
          level2Name: config.approvals.level2Name,
          level3Name: config.approvals.level3Name,
          discountLevel1AbovePercent: config.approvals.discountLevel1AbovePercent,
          discountLevel2AbovePercent: config.approvals.discountLevel2AbovePercent,
          discountLevel3AbovePercent: config.approvals.discountLevel3AbovePercent,
        },
        validityDays: config.proposals.validityDays,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return contractErrorResponse(error, "Could not load the proposal rules");
  }
}
