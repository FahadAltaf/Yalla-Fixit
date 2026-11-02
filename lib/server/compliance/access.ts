// Server-side access for the compliance module (FRD FR-9). Every route and
// page asks here; the client-side guard is only a courtesy.

import { NextResponse } from "next/server";
import { hasResourceAction, hasSharedListAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType, type User } from "@/types/types";

export type ComplianceActor = {
  id: string;
  label: string;
  email: string | null;
  accessUser: User;
};

type GuardResult = { actor: ComplianceActor; error?: undefined } | { actor?: undefined; error: NextResponse };

/**
 * 401 without a session, 403 without the action on the resource. Admins
 * inherit every action here (there is no admin exception for the module
 * itself; seeing full numbers is a separate allowlist, phase 2).
 */
export async function requireCompliance(
  action: ActionType,
  resource: ResourceType = ResourceType.COMPLIANCE,
): Promise<GuardResult> {
  const { profile, accessUser } = await getAuthenticatedUserAccess();
  if (!profile || !accessUser) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  // A deactivated portal user keeps a valid session until it expires; this
  // module refuses them regardless (the shared access helper does not).
  if (profile.is_active === false) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  if (!hasResourceAction(accessUser, resource, action)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const label =
    (profile.full_name && profile.full_name.trim()) ||
    [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() ||
    profile.email ||
    profile.id;
  return { actor: { id: profile.id, label, email: profile.email ?? null, accessUser } };
}

/**
 * The designation and nationality lists (Settings → Workforce, 31 Oct 2026):
 * the compliance key as before, or Workforce settings with workforceAction.
 */
export async function requireSharedList(
  action: ActionType,
  resource: ResourceType,
  workforceAction: ActionType = action,
): Promise<GuardResult> {
  const { profile, accessUser } = await getAuthenticatedUserAccess();
  if (!profile || !accessUser) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (profile.is_active === false) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  if (!hasSharedListAction(accessUser, resource, action, workforceAction)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const label = (profile.full_name && profile.full_name.trim()) || profile.email || profile.id;
  return { actor: { id: profile.id, label, email: profile.email ?? null, accessUser } };
}

/** Either of two actions is enough (Create or Edit for pickers). */
export async function requireComplianceAny(
  actions: ActionType[],
  resource: ResourceType = ResourceType.COMPLIANCE,
): Promise<GuardResult> {
  const { profile, accessUser } = await getAuthenticatedUserAccess();
  if (!profile || !accessUser) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (profile.is_active === false) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  if (!actions.some((a) => hasResourceAction(accessUser, resource, a))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const label = (profile.full_name && profile.full_name.trim()) || profile.email || profile.id;
  return { actor: { id: profile.id, label, email: profile.email ?? null, accessUser } };
}

/** For pages: may the person loading it see it at all. */
export async function canSeeCompliancePage(resource: ResourceType = ResourceType.COMPLIANCE, action: ActionType = ActionType.VIEW): Promise<boolean> {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!accessUser || profile?.is_active === false) return false;
    return hasResourceAction(accessUser, resource, action);
  } catch {
    return false;
  }
}

/** The caller's rights, so the UI can hide what the API would refuse. */
export function complianceRights(user: User) {
  const r = ResourceType.COMPLIANCE;
  return {
    view: hasResourceAction(user, r, ActionType.VIEW),
    create: hasResourceAction(user, r, ActionType.CREATE),
    edit: hasResourceAction(user, r, ActionType.EDIT),
    archive: hasResourceAction(user, r, ActionType.DELETE),
    export: hasResourceAction(user, r, ActionType.EXPORT),
    settings_view: hasResourceAction(user, ResourceType.COMPLIANCE_SETTINGS, ActionType.VIEW),
    /** Add new list values and certificate types (Create or Edit). */
    settings_create:
      hasResourceAction(user, ResourceType.COMPLIANCE_SETTINGS, ActionType.CREATE) ||
      hasResourceAction(user, ResourceType.COMPLIANCE_SETTINGS, ActionType.EDIT),
    /** Rename, retire, delete, change recipients (Edit only, as the routes require). */
    settings_edit: hasResourceAction(user, ResourceType.COMPLIANCE_SETTINGS, ActionType.EDIT),
    /** D2: the full-number right, granted per role, never inherited by admins. */
    full_numbers: hasResourceAction(user, ResourceType.COMPLIANCE_IDENTITY, ActionType.VIEW),
  };
}

export type ComplianceRights = ReturnType<typeof complianceRights>;
