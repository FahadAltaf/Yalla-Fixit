import type { Metadata } from "next";
import { Suspense } from "react";

import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import WorkforceSettings from "@/components/dashboard/workforce/workforce-settings";
import { hasSharedListAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

export const metadata: Metadata = {
  title: "Workforce | Settings",
  robots: { index: false, follow: false },
};

/**
 * Settings → Workforce (13-5): Workforce settings (admins, managers), or the
 * key that guarded each list before. Each tab follows its own list's rules,
 * the same ones its routes apply.
 */
export default async function WorkforceSettingsPage() {
  const { profile, accessUser } = await getAuthenticatedUserAccess().catch(() => ({ profile: null, accessUser: null }));
  if (!accessUser || profile?.is_active === false) return <NoPageAccess page="Workforce settings" />;
  const s = (action: ActionType) => hasSharedListAction(accessUser, ResourceType.SCHEDULING, action);
  const c = (action: ActionType, workforceAction: ActionType = action) =>
    hasSharedListAction(accessUser, ResourceType.COMPLIANCE_SETTINGS, action, workforceAction);
  const rights = {
    scheduling: { view: s(ActionType.VIEW), add: s(ActionType.CREATE), edit: s(ActionType.EDIT), delete: s(ActionType.DELETE) },
    compliance: { view: c(ActionType.VIEW), add: c(ActionType.CREATE), edit: c(ActionType.EDIT) },
  };
  if (!rights.scheduling.view && !rights.compliance.view) return <NoPageAccess page="Workforce settings" />;
  return (
    <Suspense fallback={null}>
      <WorkforceSettings rights={rights} />
    </Suspense>
  );
}
