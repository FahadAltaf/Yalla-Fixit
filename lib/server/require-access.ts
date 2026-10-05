import { NextResponse } from "next/server";

import { hasResourceAction, isAdminUser } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import type { ActionType, ResourceType } from "@/types/types";

type Access = Awaited<ReturnType<typeof getAuthenticatedUserAccess>>;
type GrantedAccess = Access & {
  authUserId: string;
  profile: NonNullable<Access["profile"]>;
  accessUser: NonNullable<Access["accessUser"]>;
};

export type RequireAccessResult =
  | { ok: true; access: GrantedAccess }
  | { ok: false; response: NextResponse };

/**
 * A signed-in, active portal user holding `resource`/`action` (admins
 * always pass), or a ready 401/403 response.
 *
 * For routes that used to run with no check at all and reached Supabase or
 * Zoho on behalf of whoever called them. Pass `{ adminOnly: true }` for
 * routes no role should reach.
 */
export async function requireResourceAccess(
  resource: ResourceType | null,
  action: ActionType | null,
  options: { adminOnly?: boolean } = {},
): Promise<RequireAccessResult> {
  let access: Access;
  try {
    access = await getAuthenticatedUserAccess();
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!access.authUserId || !access.profile || !access.accessUser) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (access.profile.is_active === false) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const allowed = options.adminOnly
    ? isAdminUser(access.accessUser)
    : resource && action
      ? hasResourceAction(access.accessUser, resource, action)
      : true;
  if (!allowed) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, access: access as GrantedAccess };
}
