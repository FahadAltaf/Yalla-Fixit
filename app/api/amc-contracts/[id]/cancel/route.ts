import { NextResponse } from "next/server";

import { requireContractAccess } from "@/lib/server/amc/contract-access";

/**
 * Not used to end a contract any more (DEV-417). A contract ends through an
 * amendment -- an early termination, or a cancellation before it starts --
 * so the reason, the dates and the refund are recorded: an AMC approver does
 * it in one step, anyone else asks and one approver decides (26 Nov 2026:
 * one approver is enough; lib/server/amc/amendments.ts). Kept so an old
 * screen gets a clear answer rather than a 404.
 */
export async function POST() {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  return NextResponse.json(
    {
      error:
        "A contract ends through its Amendments tab (DEV-417): an AMC approver ends it there in one step; anyone else asks, and one approver decides.",
    },
    { status: 409 },
  );
}
