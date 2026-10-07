import type { NextResponse } from "next/server";

import { hasResourceAction } from "@/lib/role-permissions";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Who may do what with AMC enquiries (BRD 6.7, the AMC Enquiries
 * permission). The pipeline is the team's: anyone with View sees every
 * enquiry, as the sales team works one board.
 *
 *   view     AMC Enquiries View (management, department head, coordinators, sales)
 *   log      AMC Enquiries Create
 *   change   AMC Enquiries Edit: details, owner, stage, follow-ups, site visits
 *   export   AMC Enquiries Export
 *
 * Admins inherit everything.
 */
export type EnquiryGate =
  | {
      ok: true;
      admin: Awaited<ReturnType<typeof createAdminServerClient>>;
      actor: { id: string; label: string | null };
      canCreate: boolean;
      canEdit: boolean;
      canExport: boolean;
    }
  | { ok: false; response: NextResponse };

export async function requireEnquiryAccess(action: ActionType = ActionType.VIEW): Promise<EnquiryGate> {
  const gate = await requireResourceAccess(ResourceType.AMC_ENQUIRIES, action);
  if (!gate.ok) return gate;
  const user = gate.access.accessUser;
  const can = (a: ActionType) => hasResourceAction(user, ResourceType.AMC_ENQUIRIES, a);
  return {
    ok: true,
    admin: await createAdminServerClient(),
    actor: { id: gate.access.profile.id, label: gate.access.profile.full_name ?? gate.access.profile.email ?? null },
    canCreate: can(ActionType.CREATE),
    canEdit: can(ActionType.EDIT),
    canExport: can(ActionType.EXPORT),
  };
}
