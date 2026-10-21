import { redirect } from "next/navigation";

import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

/* Reports is a group of pages; /reports (the breadcrumb's link) opens the first one the person may see. */
export default async function ReportsIndex() {
  let target = "/reports/quotations";
  try {
    const { accessUser } = await getAuthenticatedUserAccess();
    if (
      accessUser &&
      !hasResourceAction(accessUser, ResourceType.REPORTS_QUOTATIONS, ActionType.VIEW) &&
      hasResourceAction(accessUser, ResourceType.REPORTS_EXCEPTIONS, ActionType.VIEW)
    ) {
      target = "/reports/exceptions";
    }
  } catch {
    /* Not signed in: the quotation page's own check answers. */
  }
  redirect(target);
}
