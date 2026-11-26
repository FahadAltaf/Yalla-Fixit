import { NextRequest, NextResponse } from "next/server";

import { linkFsmCustomer } from "@/lib/server/amc/client-list";
import { clientsErrorResponse, requireClientsAccess } from "@/lib/server/clients/gate";
import { linkFsmContact } from "@/lib/server/snagging/fsm-clients";

/**
 * The portal client behind a Zoho FSM contact, made the first time it is
 * opened or edited from the Clients list (FSM is only read here). With
 * AMC's view it also gets AMC's Client ID, as AMC's list always gave it.
 */
export async function POST(req: NextRequest) {
  const gate = await requireClientsAccess(req);
  if (!gate.ok) return gate.response;
  const body = (await req.json().catch(() => null)) as { fsmContactId?: unknown } | null;
  const fsmContactId = typeof body?.fsmContactId === "string" ? body.fsmContactId.trim() : "";
  if (!fsmContactId) return NextResponse.json({ error: "Which client?" }, { status: 400 });
  try {
    const id = gate.access.amc
      ? (await linkFsmCustomer(gate.admin, fsmContactId, gate.userId)).id
      : (await linkFsmContact(gate.admin, fsmContactId, gate.userId)).id;
    if (!id) return NextResponse.json({ error: "Could not open this client." }, { status: 500 });
    return NextResponse.json({ id });
  } catch (error) {
    return clientsErrorResponse(error, "Could not open this client");
  }
}
