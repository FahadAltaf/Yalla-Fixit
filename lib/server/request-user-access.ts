import { NextRequest } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { buildUserFromAccess } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess, loadProfileAccess } from "@/lib/server/user-access";
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

  // Verifies the JWT signature and expiry against the project's published
  // keys, locally -- a forged or stale token resolves to no user. (With a
  // legacy HS256 token getClaims asks Supabase Auth instead, as getUser
  // did.) See user-access.ts for the trade-off.
  const { data, error } = await admin.auth.getClaims(token);
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;

  if (error || !userId) return UNAUTHENTICATED;

  // Profile and permissions in one query, cached per user (user-access.ts).
  let access;
  try {
    access = await loadProfileAccess(userId);
  } catch {
    return { ...UNAUTHENTICATED, authUserId: userId, origin: "mobile" };
  }

  if (!access) {
    return { ...UNAUTHENTICATED, authUserId: userId, origin: "mobile" };
  }

  // A deactivated inspector keeps a valid token until it expires, so
  // the flag has to be checked on every request rather than at sign-in
  // (within the access cache's 30 seconds).
  if (access.profile.is_active === false) {
    return { ...UNAUTHENTICATED, authUserId: userId, origin: "mobile" };
  }

  return {
    authUserId: userId,
    profile: access.profile,
    accessUser: buildUserFromAccess(access.profile, access.roleAccess),
    origin: "mobile",
  };
}

export async function getRequestUserAccess(req: NextRequest): Promise<RequestUserAccess> {
  const token = readBearerToken(req);
  if (token) return resolveFromToken(token);

  const cookieAccess = await getAuthenticatedUserAccess();
  return { ...cookieAccess, origin: "portal" };
}
