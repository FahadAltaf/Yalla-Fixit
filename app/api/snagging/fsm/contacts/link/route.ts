import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { fsmErrorMessage, linkFsmContact } from "@/lib/server/snagging/fsm-clients";
import { ActionType, ResourceType } from "@/types/types";

/**
 * POST /api/snagging/fsm/contacts/link { fsm_contact_id } -- the portal's
 * client for a Zoho FSM contact, made when the contact is first picked
 * (or used from the Clients page), so quotations and jobs can point at it.
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
    const contactId = String(body?.fsm_contact_id ?? "").trim();
    if (!/^\d{6,30}$/.test(contactId)) {
      return NextResponse.json({ error: "Which FSM client?" }, { status: 400 });
    }
    const admin = await createAdminServerClient();
    try {
      return NextResponse.json({ data: await linkFsmContact(admin, contactId, profile.id) });
    } catch (err) {
      return NextResponse.json({ error: fsmErrorMessage(err) }, { status: 502 });
    }
  } catch (error) {
    console.error("FSM contact link error:", error);
    return NextResponse.json({ error: "Failed to use that client" }, { status: 500 });
  }
}
