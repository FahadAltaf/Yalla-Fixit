import { NextRequest } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { buildUserFromAccess, RoleAccessEntry } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { User } from "@/types/types";

/**
 * Resolves the caller for routes that serve both the portal and the
 * mobile inspector app.
 *
 * The portal authenticates with a Supabase session cookie, which
 * `getAuthenticatedUserAccess` already handles. React Native has no
 * cookie jar, so the app sends its access token as
 * `Authorization: Bearer <token>` instead. Both paths end at the same
 * profile and the same role-access entries, so every permission check
 * downstream is written once.
 */

export type RequestUserAccess = {
  authUserId: string | null;
  profile: {
    id: string;
    email?: string;
    full_name?: string | null;
    role_id?: string;
    is_active?: boolean;
  } | null;
  accessUser: User | null;
  /** Which credential the caller presented. Audit rows record this. */
  origin: "portal" | "mobile";
};

const UNAUTHENTICATED: RequestUserAccess = {
  authUserId: null,
  profile: null,
  accessUser: null,
  origin: "portal",
};

function readBearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) return null;

  const [scheme, token] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token?.trim()) return null;
  return token.trim();
}

async function resolveFromToken(token: string): Promise<RequestUserAccess> {
  const admin = await createAdminServerClient();

  // Verifies the JWT signature and expiry against the project's keys —
  // a forged or stale token resolves to no user.
  const {
    data: { user },
    error,
  } = await admin.auth.getUser(token);

  if (error || !user?.id) return UNAUTHENTICATED;

  const { data: profile, error: profileError } = await admin
    .from("user_profile")
    .select("id,email,full_name,role_id,is_active,roles(name)")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    return { ...UNAUTHENTICATED, authUserId: user.id, origin: "mobile" };
  }

  // A deactivated inspector keeps a valid token until it expires, so
  // the flag has to be checked on every request rather than at sign-in.
  if (profile.is_active === false) {
    return { ...UNAUTHENTICATED, authUserId: user.id, origin: "mobile" };
  }

  let roleAccess: RoleAccessEntry[] = [];
  if (profile.role_id) {
    const { data: accessRows, error: accessError } = await admin
      .from("role_access")
      .select("resource, action, enabled, record_access")
      .eq("role_id", profile.role_id);

    if (accessError) throw new Error(accessError.message);
    roleAccess = (accessRows ?? []) as RoleAccessEntry[];
  }

  return {
    authUserId: user.id,
    profile,
    accessUser: buildUserFromAccess(profile, roleAccess),
    origin: "mobile",
  };
}

export async function getRequestUserAccess(req: NextRequest): Promise<RequestUserAccess> {
  const token = readBearerToken(req);
  if (token) return resolveFromToken(token);

  const cookieAccess = await getAuthenticatedUserAccess();
  return { ...cookieAccess, origin: "portal" };
}
