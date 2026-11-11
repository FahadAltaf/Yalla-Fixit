import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, type ResourceType } from "@/types/types";

/**
 * Whether the person opening an AMC page may see it, read on the server
 * from their session cookie -- the same rule as Snagging's pages
 * (lib/server/snagging/page-access.ts): each page asks about its OWN
 * permission, and only that.
 *
 * No fallback to a module-wide AMC grant: turning a page off in the
 * Permissions screen deletes its rows, so "no grant" is how a page is
 * denied, and a fallback would hand back every page an administrator had
 * just taken away. The backfill that keeps today's roles working is
 * supabase/migrations/20261012100000_amc_per_page_permissions.sql, which
 * therefore runs before this code is used.
 */
export async function canSeeAmcPage(resource: ResourceType): Promise<boolean> {
  try {
    const { accessUser } = await getAuthenticatedUserAccess();
    return Boolean(accessUser && hasResourceAction(accessUser, resource, ActionType.VIEW));
  } catch {
    return false;
  }
}
