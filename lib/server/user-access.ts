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

export async function getAuthenticatedUserAccess(): Promise<{
  authUserId: string | null;
  profile: ProfileRow | null;
  accessUser: User | null;
}> {
  const sessionClient = await createServerClientForApi();
  const {
    data: { user },
    error,
  } = await sessionClient.auth.getUser();

  if (error || !user?.id) {
    return { authUserId: null, profile: null, accessUser: null };
  }

  const admin = await createAdminServerClient();
  const { data: profile, error: profileError } = await admin
    .from("user_profile")
    .select("id,email,first_name,last_name,full_name,role_id,is_active,profile_image,roles(name)")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    return { authUserId: user.id, profile: null, accessUser: null };
  }

  const typedProfile = profile as ProfileRow;
  let roleAccess: RoleAccessEntry[] = [];

  if (typedProfile.role_id) {
    const { data: accessRows, error: accessError } = await admin
      .from("role_access")
      .select("resource, action, enabled, record_access")
      .eq("role_id", typedProfile.role_id);

    if (accessError) throw new Error(accessError.message);
    roleAccess = (accessRows ?? []) as RoleAccessEntry[];
  }

  return {
    authUserId: user.id,
    profile: typedProfile,
    accessUser: buildUserFromAccess(typedProfile, roleAccess),
  };
}
