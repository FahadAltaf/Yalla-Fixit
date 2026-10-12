import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Whether the person loading a snagging page may see its data, decided on
 * the server from their session cookie.
 *
 * The pages that read their first data on the server (jobs, a job,
 * quotations, clients) only do so for someone who may see that page.
 * Anyone else gets no data with the page; the page then asks the API
 * itself, exactly as it did before, and the API decides.
 *
 * Each page asks about its OWN permission now rather than about Snagging
 * as a whole, so a role can be given Jobs without being given Quotations.
 * The module-wide grant still answers for all of them, which is what
 * keeps every existing role working: see `canSeeSnaggingPage`.
 */
async function may(resource: ResourceType): Promise<boolean> {
  try {
    const { accessUser } = await getAuthenticatedUserAccess();
    if (!accessUser) return false;
    /*
      The page's own grant, and only that.

      This briefly also accepted the module-wide `snagging` grant, so
      that the code and the backfill could be deployed in either order.
      It cannot: turning a page off in the Permissions screen DELETES its
      rows, so "no grant" is how a page is denied -- and a module grant
      read as a fallback would quietly hand back every page an
      administrator had just taken away. A permission you can set and
      that does nothing is worse than one that is missing.

      The consequence is an ordering requirement, written at the top of
      supabase/migrations/20261008100000_per_page_permissions.sql: the
      backfill runs BEFORE this deploys, or nobody can open Snagging in
      the gap between them.
    */
    return hasResourceAction(accessUser, resource, ActionType.VIEW);
  } catch {
    return false;
  }
}

/** The module as a whole: still what the APIs and the staff lookup ask. */
export async function canViewSnagging(): Promise<boolean> {
  return may(ResourceType.SNAGGING);
}

/** One page of it, named by the resource its menu entry carries. */
export function canSeeSnaggingPage(resource: ResourceType): Promise<boolean> {
  return may(resource);
}
