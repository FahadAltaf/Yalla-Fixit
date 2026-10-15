import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { fsmErrorMessage, linkFsmAddress } from "@/lib/server/snagging/fsm-clients";
import { ActionType, ResourceType } from "@/types/types";

/**
 * POST /api/snagging/fsm/addresses/link { client_id, fsm_address_id } -- the
 * portal's property for one of the client's Zoho FSM addresses, made when
 * it is first picked, so the quotation and the job can point at it.
 */
export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (
      !hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.CREATE) &&
      !hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.EDIT)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const clientId = String(body?.client_id ?? "").trim();
    const addressId = String(body?.fsm_address_id ?? "").replace(/^fsm:/, "").trim();
    if (!clientId || !/^\d{6,30}$/.test(addressId)) {
      return NextResponse.json({ error: "Which client and address?" }, { status: 400 });
    }
    const admin = await createAdminServerClient();
    try {
      return NextResponse.json({ data: await linkFsmAddress(admin, clientId, addressId, profile.id) });
    } catch (err) {
      return NextResponse.json({ error: fsmErrorMessage(err) }, { status: 502 });
    }
  } catch (error) {
    console.error("FSM address link error:", error);
    return NextResponse.json({ error: "Failed to use that address" }, { status: 500 });
  }
}
