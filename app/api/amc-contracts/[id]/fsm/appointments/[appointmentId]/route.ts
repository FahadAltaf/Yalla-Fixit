import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  contractErrorResponse,
  requireContractAccess,
  requireManagedContract,
} from "@/lib/server/amc/contract-access";
import { syncFsmAppointment } from "@/lib/server/amc/fsm-integration";

/**
 * Applies the FSM usage rules to one linked appointment, read fresh from
 * FSM. With `confirm`, a person confirms the usage (or the reversal) the
 * rules propose, and enters the hours where FSM has none. Repeating it never
 * records the same appointment twice.
 */
const schema = z
  .object({
    confirm: z.boolean().optional(),
    quantity: z.number().finite().positive().max(1000).nullable().optional(),
  })
  .strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; appointmentId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id, appointmentId } = await ctx.params;
  const parsed = schema.safeParse((await req.json().catch(() => ({}))) ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(appointmentId)) {
    return NextResponse.json({ error: "Appointment not found." }, { status: 404 });
  }
  try {
    const contract = await requireManagedContract(gate, id);
    if (!contract.ok) return contract.response;
    const outcome = await syncFsmAppointment(gate.admin, id, appointmentId, {
      actor: { id: gate.userId, label: gate.label },
      confirm: parsed.data.confirm ? { quantity: parsed.data.quantity ?? null } : null,
    });
    return NextResponse.json({ outcome });
  } catch (error) {
    return contractErrorResponse(error, "Could not check the appointment");
  }
}
