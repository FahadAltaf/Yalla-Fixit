import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { createServerClientForApi } from "@/lib/supabase/supabase-server-client";
import { buildUserFromAccess, RoleAccessEntry } from "@/lib/role-permissions";
import { User } from "@/types/types";

type ProfileRow = {
  id: string;
  email?: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  role_id?: string;
  is_active?: boolean;
  profile_image?: string | null;
  roles?:
    | {
        name?: string | null;
      }
    | Array<{
        name?: string | null;
      }>;
};

/** A user's profile and the permissions of their role. */
export type ProfileAccess = { profile: ProfileRow; roleAccess: RoleAccessEntry[] };

/*
  Profile and permissions, cached per user for a short while.

  Every API request used to spend three sequential round trips on who the
  caller is: Supabase Auth, then user_profile, then role_access -- about a
  second before the route did any work. Now:

    - the token is verified locally (getClaims, below);
    - profile and permissions come back in ONE query, the role's
      role_access rows embedded through roles (role_access.role_id
      references roles.id);
    - that answer is kept for ACCESS_TTL_MS per user, so a page firing six
      requests pays for it once.

  The cache holds the PROMISE, not the result, so ten requests arriving at
  once with nothing cached share one query instead of starting ten.

  Trade-off: a change to someone's role, permissions or is_active flag
  takes up to ACCESS_TTL_MS to apply to requests already being served. No
  re-login is needed. `invalidateUserAccess` drops an entry at once for
  code that changes those.

  The cache lives in this server process only. Several instances each keep
  their own, which is fine for a 30-second window.
*/
const ACCESS_TTL_MS = 30_000;
const MAX_ENTRIES = 1_000;

type CacheEntry = { expiresAt: number; value: Promise<ProfileAccess | null> };
const accessCache = new Map<string, CacheEntry>();

async function queryProfileAccess(userId: string): Promise<ProfileAccess | null> {
  const admin = await createAdminServerClient();
  const { data, error } = await admin
    .from("user_profile")
    .select(
      "id,email,first_name,last_name,full_name,role_id,is_active,profile_image," +
        "roles(name,role_access(resource,action,enabled,record_access))",
    )
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as unknown as Omit<ProfileRow, "roles"> & {
    roles?:
      | { name?: string | null; role_access?: RoleAccessEntry[] | null }
      | Array<{ name?: string | null; role_access?: RoleAccessEntry[] | null }>
      | null;
  };
  const role = Array.isArray(row.roles) ? row.roles[0] : row.roles;
  return {
    // Same shape the separate queries produced: roles carries the name only.
    profile: { ...row, roles: role ? { name: role.name ?? null } : undefined },
    roleAccess: row.role_id ? (role?.role_access ?? []) : [],
  };
}

/**
 * The profile and permissions for a user: from the cache when fresh,
 * otherwise one query, shared by every caller asking at the same time.
 * Rejects when the query fails; a failure and "no profile" are not cached.
 */
export function loadProfileAccess(userId: string): Promise<ProfileAccess | null> {
  const now = Date.now();
  const hit = accessCache.get(userId);
  if (hit && hit.expiresAt > now) return hit.value;

  if (accessCache.size >= MAX_ENTRIES) {
    for (const [key, entry] of accessCache) {
      if (entry.expiresAt <= now) accessCache.delete(key);
    }
    if (accessCache.size >= MAX_ENTRIES) accessCache.clear();
  }

  const value = queryProfileAccess(userId);
  const entry: CacheEntry = { expiresAt: now + ACCESS_TTL_MS, value };
  accessCache.set(userId, entry);
  // Only a real answer is remembered. A missing profile may be created a
  // moment later (a new invite), and an error says nothing about the user.
  const forget = () => {
    if (accessCache.get(userId) === entry) accessCache.delete(userId);
  };
  value.then((result) => {
    if (result === null) forget();
  }, forget);
  return value;
}

/** Drops one user's cached access, or everyone's. */
export function invalidateUserAccess(userId?: string): void {
  if (userId) accessCache.delete(userId);
  else accessCache.clear();
}

export async function getAuthenticatedUserAccess(): Promise<{
  authUserId: string | null;
  profile: ProfileRow | null;
  accessUser: User | null;
}> {
  const sessionClient = await createServerClientForApi();
  /*
    getClaims verifies the session's JWT against the project's published
    signing keys (asymmetric ES256 here) without calling Supabase Auth.
    getUser asked the Auth server on every request. With a legacy HS256
    token, getClaims falls back to that same call itself.

    Like any JWT check, this accepts a token until it expires even after
    the session is signed out elsewhere. getUser did not, because it asked
    the server.
  */
  const { data, error } = await sessionClient.auth.getClaims();
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;

  if (error || !userId) {
    return { authUserId: null, profile: null, accessUser: null };
  }

  let access: ProfileAccess | null;
  try {
    access = await loadProfileAccess(userId);
  } catch {
    // As before: a failed profile read resolves to no access, not a crash.
    return { authUserId: userId, profile: null, accessUser: null };
  }

  if (!access) {
    return { authUserId: userId, profile: null, accessUser: null };
  }

  return {
    authUserId: userId,
    profile: access.profile,
    accessUser: buildUserFromAccess(access.profile, access.roleAccess),
  };
}
