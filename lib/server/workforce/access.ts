// Workforce module (C6, Sami 31 Oct 2026): who may open it, and which half
// of each person they see. No key of its own (13-7 decision 2): Scheduling
// View shows the scheduling fields, Compliance View the compliance fields,
// and every write is still decided by that module's own route.

import { hasResourceAction, hasSharedListAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType, type User } from "@/types/types";
import type { WorkforceAccess } from "@/components/dashboard/workforce/people";

/**
 * Settings → Workforce: Workforce settings, or the key that guarded the list
 * before (Scheduling for roles, service types, tags and leave types;
 * Compliance settings for designations and nationalities).
 */
export function canSeeWorkforceLists(user: User): boolean {
  return (
    hasSharedListAction(user, ResourceType.SCHEDULING, ActionType.VIEW) ||
    hasSharedListAction(user, ResourceType.COMPLIANCE_SETTINGS, ActionType.VIEW)
  );
}

export async function workforceAccess(): Promise<WorkforceAccess | null> {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!accessUser || profile?.is_active === false) return null;
    const access: WorkforceAccess = {
      scheduling: hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.VIEW),
      compliance: hasResourceAction(accessUser, ResourceType.COMPLIANCE, ActionType.VIEW),
      complianceCreate: hasResourceAction(accessUser, ResourceType.COMPLIANCE, ActionType.CREATE),
      complianceEdit: hasResourceAction(accessUser, ResourceType.COMPLIANCE, ActionType.EDIT),
      lists: canSeeWorkforceLists(accessUser),
      // Leave for employees not in FSM (app/api/workforce/leave).
      leaveAdd:
        hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.CREATE) ||
        hasResourceAction(accessUser, ResourceType.COMPLIANCE, ActionType.EDIT),
      leaveCancel:
        hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.EDIT) ||
        hasResourceAction(accessUser, ResourceType.COMPLIANCE, ActionType.EDIT),
    };
    return access.scheduling || access.compliance ? access : null;
  } catch {
    return null;
  }
}
