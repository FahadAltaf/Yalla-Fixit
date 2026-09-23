"use server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { createServerClientForApi } from "@/lib/supabase/supabase-server-client";
import type { User } from "@/types/types";

type RoleRow = {
  name?: string | null;
  description?: string | null;
  role_access?: Array<{
    resource: string;
    action: string;
    enabled?: boolean | null;
    record_access?: string | null;
  }> | null;
};

/**
 * Who is signed in, and their profile with its role and permissions -- in
 * one call from the browser.
 *
 * Every page load used to make two calls one after the other before the
 * portal would show anything: a server action that asked Supabase Auth who
 * the session belonged to, and only then a GraphQL request for that
 * person's profile. That was two network round trips (a second or more)
 * in front of every page.
 *
 * Now the session's token is verified here without calling Supabase Auth
 * (getClaims checks the signature against the project's published keys --
 * the same check every API route already makes), and the profile is read
 * in one query in the same shape the GraphQL request returned, so nothing
 * that reads `userProfile` changes.
 *
 * As with the API routes, a token is accepted until it expires even if the
 * session was signed out elsewhere; every API call still checks it again.
 */
export async function loadSignedInUser(): Promise<{
  user: { id: string; email?: string } | null;
  profile: User | null;
}> {
  const sessionClient = await createServerClientForApi();
  const { data, error } = await sessionClient.auth.getClaims();
  const claims = data?.claims;
  const userId = typeof claims?.sub === "string" ? claims.sub : null;
  if (error || !userId) return { user: null, profile: null };

  const user = {
    id: userId,
    email: typeof claims?.email === "string" ? claims.email : undefined,
  };

  const admin = await createAdminServerClient();
  const { data: row, error: profileError } = await admin
    .from("user_profile")
    .select(
      `id, email, role_id, first_name, last_name, full_name, is_active,
       receives_schedule_approval_email, last_login, profile_image, created_at, updated_at,
       roles(name, description, role_access(resource, action, enabled, record_access))`,
    )
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!row) return { user, profile: null };

  const { roles, ...rest } = row as Record<string, unknown> & {
    roles?: RoleRow | RoleRow[] | null;
  };
  const role = Array.isArray(roles) ? roles[0] : roles;

  // The shape the GraphQL request returned: role_access as edges of nodes.
  const profile = {
    ...rest,
    roles: role
      ? {
          name: role.name ?? null,
          description: role.description ?? null,
          role_accessCollection: {
            edges: (role.role_access ?? []).map((node) => ({ node })),
          },
        }
      : null,
  } as unknown as User;

  return { user, profile };
}
