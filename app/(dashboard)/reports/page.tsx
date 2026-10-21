import { redirect } from "next/navigation";

import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

/* In menu order. */
const PAGES: Array<[ResourceType, string]> = [
  [ResourceType.REPORTS_QUOTATIONS, "/reports/quotations"],
  [ResourceType.REPORTS_UTILIZATION, "/reports/utilization"],
  [ResourceType.REPORTS_CAPACITY, "/reports/capacity"],
  [ResourceType.REPORTS_EXCEPTIONS, "/reports/exceptions"],
];

/* Reports is a group of pages; /reports (the breadcrumb's link) opens the first one the person may see. */
export default async function ReportsIndex() {
  let target = "/reports/quotations";
  try {
    const { accessUser } = await getAuthenticatedUserAccess();
    if (accessUser) {
      const first = PAGES.find(([resource]) => hasResourceAction(accessUser, resource, ActionType.VIEW));
      if (first) target = first[1];
    }
  } catch {
    /* Not signed in: the quotation page's own check answers. */
  }
  redirect(target);
}
