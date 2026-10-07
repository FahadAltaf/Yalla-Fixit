import { NextResponse } from "next/server";

import { canApproveAmc } from "@/components/dashboard/extensions/amc/amc-settings";
import { canUseAmc } from "@/components/dashboard/extensions/amc/amc-constants";
import { hasResourceAction } from "@/lib/role-permissions";
import { readAmcSettings } from "@/lib/server/amc/settings";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Who may see a proposal, for the routes added in Phase 4 (versions). The
 * same rule as GET /api/amc-submissions?id= (DEV-368): its owner, or, once
 * it has left draft, an approver or AMC Operations (View). Not visible
 * reads as not found.
 */
export type ProposalGate =
  | {
      ok: true;
      admin: Awaited<ReturnType<typeof createAdminServerClient>>;
      actor: { id: string; label: string | null };
      proposal: { id: string; ownerId: string; status: string };
      isOwner: boolean;
    }
  | { ok: false; response: NextResponse };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requireProposalViewer(id: string | null): Promise<ProposalGate> {
  const access = await getAuthenticatedUserAccess();
  if (!access.profile || !access.accessUser || access.profile.is_active === false) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!canUseAmc(access.accessUser)) return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const notFound = { ok: false as const, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  if (!id || !UUID.test(id)) return notFound;

  const admin = await createAdminServerClient();
  const [{ data, error }, settings] = await Promise.all([
    admin.from("amc_submissions").select("id, owner_id, status").eq("id", id).maybeSingle<{ id: string; owner_id: string; status: string }>(),
    readAmcSettings(admin).catch(() => null),
  ]);
  if (error) return { ok: false, response: NextResponse.json({ error: error.message }, { status: 500 }) };
  if (!data) return notFound;

  const isOwner = data.owner_id === access.profile.id;
  const canApprove = settings
    ? canApproveAmc(settings, access.profile.email, hasResourceAction(access.accessUser, ResourceType.AMC, ActionType.APPROVE))
    : hasResourceAction(access.accessUser, ResourceType.AMC, ActionType.APPROVE);
  const seesTeam = canApprove || hasResourceAction(access.accessUser, ResourceType.AMC_OPERATIONS, ActionType.VIEW);
  if (!isOwner && (!seesTeam || data.status === "draft")) return notFound;

  return {
    ok: true,
    admin,
    actor: { id: access.profile.id, label: access.profile.full_name ?? access.profile.email ?? null },
    proposal: { id: data.id, ownerId: data.owner_id, status: data.status },
    isOwner,
  };
}
