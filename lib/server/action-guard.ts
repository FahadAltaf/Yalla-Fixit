import type { SupabaseClient } from "@supabase/supabase-js";

import { hasResourceAction, isAdminUser } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import type { ActionType, ResourceType, User } from "@/types/types";

/**
 * The check every privileged server action makes first.
 *
 * A "use server" function imported by a client component is a public HTTP
 * endpoint: anyone can call it with any arguments, signed in or not. The
 * user-admin actions (create, delete, set password) used to trust their
 * arguments completely, so a visitor could create an account, delete any
 * account or set any user's password. They now refuse unless the caller is
 * a signed-in, active user holding the permission.
 */
export type ActionCaller = { id: string; accessUser: User; isAdmin: boolean };

export class ActionDenied extends Error {
  constructor(message = "You are not allowed to do that.") {
    super(message);
    this.name = "ActionDenied";
  }
}

export async function requireActionCaller(resource?: ResourceType, action?: ActionType): Promise<ActionCaller> {
  const { authUserId, profile, accessUser } = await getAuthenticatedUserAccess().catch(() => ({
    authUserId: null,
    profile: null,
    accessUser: null,
  }));
  if (!authUserId || !profile || !accessUser || profile.is_active === false) throw new ActionDenied("Sign in again to continue.");
  if (resource && action && !hasResourceAction(accessUser, resource, action)) throw new ActionDenied();
  return { id: authUserId, accessUser, isAdmin: isAdminUser(accessUser) };
}

/** Whether the target account is an admin (only admins act on admins). */
export async function targetIsAdmin(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await admin.from("user_profile").select("roles(name)").eq("id", userId).maybeSingle();
  const joined = (data as { roles?: { name?: string } | Array<{ name?: string }> } | null)?.roles;
  const role = Array.isArray(joined) ? joined[0] : joined;
  return role?.name === "admin";
}
