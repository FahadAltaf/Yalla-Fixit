import { NextRequest, NextResponse } from "next/server";

import {
  contractErrorResponse,
  requireContractAccess,
  requireManagedContract,
} from "@/lib/server/amc/contract-access";
import { createReminders, reminderPlan } from "@/lib/server/amc/contract-operations";

/**
 * Renewal reminders for a contract. GET shows the planned reminders and
 * which exist; POST creates the missing ones as Todos. POST answers 409
 * while reminders are switched off (until the schedule is approved).
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  try {
    const contract = await requireManagedContract(gate, id, "read");
    if (!contract.ok) return contract.response;
    return NextResponse.json({ reminders: await reminderPlan(gate.admin, id) });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the renewal reminders");
  }
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  try {
    const contract = await requireManagedContract(gate, id);
    if (!contract.ok) return contract.response;
    const reminders = await createReminders(gate.admin, id, { id: gate.userId, label: gate.label });
    return NextResponse.json({ reminders }, { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not create the renewal reminders");
  }
}
