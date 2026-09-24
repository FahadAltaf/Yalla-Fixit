import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Whether the person loading a snagging page may see its data, decided on
 * the server from their session cookie.
 *
 * The pages that read their first data on the server (jobs, a job,
 * quotations, clients) only do so for someone signed in with Snagging
 * view access. Anyone else gets no data with the page; the page then asks
 * the API itself, exactly as it did before, and the API decides.
 */
export async function canViewSnagging(): Promise<boolean> {
  try {
    const { accessUser } = await getAuthenticatedUserAccess();
    return Boolean(
      accessUser && hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW),
    );
  } catch {
    return false;
  }
}
