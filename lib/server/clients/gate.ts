import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { canEditCustomer } from "@/lib/amc/access";
import { clientsAccess, type ClientsAccess } from "@/lib/clients/access";
import { requireContractAccess } from "@/lib/server/amc/contract-access";
import { ContractError } from "@/lib/server/amc/contracts";
import { fsmErrorMessage } from "@/lib/server/snagging/fsm-clients";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { FsmConfigError } from "@/lib/server/zoho/fsm-client";
import { FsmApiError } from "@/lib/server/zoho/fsm-contacts";

export type ClientsGate =
  | { ok: false; response: NextResponse }
  | {
      ok: true;
      admin: SupabaseClient;
      userId: string;
      label: string | null;
      access: ClientsAccess;
      /** AMC's own rule for changing a client: its creator, an AMC approver or AMC Operations (Edit). */
      amcCanEdit: (createdBy: string | null) => Promise<boolean>;
    };

/** Signed in, active, and holding either module's Clients permission. */
export async function requireClientsAccess(req: NextRequest): Promise<ClientsGate> {
  const { profile, accessUser } = await getRequestUserAccess(req);
  if (!profile || !accessUser || profile.is_active === false) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const access = clientsAccess(accessUser);
  if (!access.view) return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  let amcGate: Awaited<ReturnType<typeof requireContractAccess>> | null = null;
  return {
    ok: true,
    admin: await createAdminServerClient(),
    userId: profile.id,
    label: profile.full_name ?? profile.email ?? null,
    access,
    amcCanEdit: async (createdBy) => {
      if (!access.amc) return false;
      amcGate ??= await requireContractAccess();
      return amcGate.ok && canEditCustomer(amcGate.actor, createdBy);
    },
  };
}

/** An error as the Clients screens show it: FSM's own words when FSM refused. */
export function clientsErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof FsmApiError || error instanceof FsmConfigError) {
    return NextResponse.json({ error: fsmErrorMessage(error) }, { status: 502 });
  }
  if (error instanceof ContractError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(`[clients] ${fallback}:`, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
