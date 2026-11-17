import { NextRequest, NextResponse } from "next/server";

import { hasResourceAction } from "@/lib/role-permissions";
import {
  TechnicianAccountError,
  ensureTechnicianLogin,
  listOtherInspectors,
  listTechnicianAccounts,
} from "@/lib/server/technician-accounts";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Technicians' logins (13 Nov 2026).
 *
 * GET   the active technicians with whether each can sign in, and the
 *       Inspector accounts that are not technicians (snagging picker).
 * POST  { fsmId } make sure that technician can sign in: link the account
 *       that has their FSM email, or create an Inspector login. A new
 *       login's password comes back once, in this reply only.
 *
 * Open to whoever assigns technicians: Snagging editors, AMC visit and
 * contract staff, and user managers. The login is always the technician's
 * own FSM email with the Inspector role, never anything the caller chooses.
 */

type AccessUser = Parameters<typeof hasResourceAction>[0];
const any = (user: AccessUser, grants: Array<[ResourceType, ActionType]>) => grants.some(([r, a]) => hasResourceAction(user, r, a));

const CAN_SEE: Array<[ResourceType, ActionType]> = [
  [ResourceType.SNAGGING, ActionType.VIEW],
  [ResourceType.AMC, ActionType.VIEW],
  [ResourceType.AMC_VISITS, ActionType.VIEW],
  [ResourceType.AMC_CONTRACTS, ActionType.VIEW],
  [ResourceType.USERS, ActionType.VIEW],
];
const CAN_CREATE: Array<[ResourceType, ActionType]> = [
  [ResourceType.USERS, ActionType.CREATE],
  [ResourceType.SNAGGING, ActionType.EDIT],
  [ResourceType.SNAGGING_JOBS, ActionType.EDIT],
  [ResourceType.AMC, ActionType.VIEW],
  [ResourceType.AMC_VISITS, ActionType.EDIT],
  [ResourceType.AMC_CONTRACTS, ActionType.EDIT],
];

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function GET() {
  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;
  if (!any(gate.access.accessUser, CAN_SEE)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const admin = await createAdminServerClient();
    const technicians = await listTechnicianAccounts(admin);
    const inspectors = await listOtherInspectors(admin, technicians);
    return NextResponse.json({ data: { technicians, inspectors } });
  } catch (error) {
    console.error("Technician accounts GET error:", error);
    return NextResponse.json({ error: "Could not load the technicians" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;
  if (!any(gate.access.accessUser, CAN_CREATE)) {
    return NextResponse.json({ error: "You cannot create logins. Ask someone who manages users." }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { fsmId?: unknown } | null;
  const fsmId = typeof body?.fsmId === "string" ? body.fsmId.trim() : "";
  if (!SAFE_ID.test(fsmId)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const admin = await createAdminServerClient();
    const result = await ensureTechnicianLogin(admin, fsmId);
    if (result.status !== "existing") {
      console.info(`Technician login ${result.status} for FSM ${fsmId} by ${gate.access.profile.id}`);
    }
    return NextResponse.json({ data: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof TechnicianAccountError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Technician login POST error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create the login" }, { status: 500 });
  }
}
