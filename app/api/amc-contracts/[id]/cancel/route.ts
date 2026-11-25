import { NextResponse } from "next/server";

import { requireContractAccess } from "@/lib/server/amc/contract-access";

/**
 * Cancelled directly, by one approver, no longer (DEV-417, 20 Nov 2026
 * review: it bypassed the two-person approval). An active contract ends
 * through an amendment -- an early termination, or a cancellation before it
 * starts -- asked for by one person and decided by another
 * (lib/server/amc/amendments.ts). Kept so an old screen gets a clear answer
 * rather than a 404.
 */
export async function POST() {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  return NextResponse.json(
    {
      error:
        "Ending a contract needs two people (DEV-417): request an early termination or a cancellation on the contract's Amendments tab, and a different AMC approver decides it.",
    },
    { status: 409 },
  );
}
