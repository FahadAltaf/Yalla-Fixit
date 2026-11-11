import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  contractErrorResponse,
  requireContractAccess,
} from "@/lib/server/amc/contract-access";
import { linkFsmCustomer } from "@/lib/server/amc/client-list";
import { fsmErrorMessage } from "@/lib/server/snagging/fsm-clients";
import { FsmConfigError } from "@/lib/server/zoho/fsm-client";
import { FsmApiError } from "@/lib/server/zoho/fsm-contacts";

const bodySchema = z.object({ fsmContactId: z.string().trim().min(1).max(40) });

/**
 * The portal client for a Zoho FSM contact picked or opened in AMC, made
 * the first time it is used. FSM is only read; the row is the portal's.
 */
export async function POST(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Choose a client from the list." },
      { status: 400 },
    );
  try {
    const customer = await linkFsmCustomer(
      gate.admin,
      parsed.data.fsmContactId,
      gate.userId,
    );
    return NextResponse.json({ customer });
  } catch (error) {
    if (error instanceof FsmApiError || error instanceof FsmConfigError) {
      return NextResponse.json(
        { error: fsmErrorMessage(error) },
        { status: 502 },
      );
    }
    return contractErrorResponse(error, "Could not use this client");
  }
}
