import { NextRequest, NextResponse } from "next/server";

import { verifyInternalRequest } from "@/lib/internal-signature";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { runExpiryReminderSweep } from "@/lib/server/amc/reminders";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/**
 * Runs the contract-expiry reminder sweep.
 *
 * - A scheduled job signs the request (lib/internal-signature.ts, purpose
 *   "amc-reminders"). It runs only when automatic reminders are switched
 *   on in AMC notification settings, which they are not by default. No job
 *   is scheduled today.
 * - An AMC approver may run it by hand at any time.
 *
 * Idempotent: a reminder already recorded for a contract, threshold,
 * recipient and channel is never recorded or sent again.
 */
export async function POST(req: NextRequest) {
  if (await verifyInternalRequest(req.headers, "amc-reminders")) {
    try {
      const admin = await createAdminServerClient();
      return NextResponse.json(await runExpiryReminderSweep(admin, { trigger: "automatic", actor: null }));
    } catch (error) {
      return contractErrorResponse(error, "Reminder sweep failed");
    }
  }
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  if (!gate.canApprove) return NextResponse.json({ error: "Only AMC approvers can run the reminders." }, { status: 403 });
  try {
    return NextResponse.json(
      await runExpiryReminderSweep(gate.admin, { trigger: "manual", actor: { id: gate.userId, label: gate.label } }),
    );
  } catch (error) {
    return contractErrorResponse(error, "Reminder sweep failed");
  }
}
