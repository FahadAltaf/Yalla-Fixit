import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FsmReportsPage, type FsmReportLink } from "@/components/dashboard/reports/fsm-reports-page";
import { hasResourceAction } from "@/lib/role-permissions";
import { readReportingSettings } from "@/lib/server/reporting/settings";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

export const metadata: Metadata = {
  title: "Zoho FSM reports | Reports",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const REPORT_PAGES = [
  ResourceType.REPORTS_QUOTATIONS,
  ResourceType.REPORTS_UTILIZATION,
  ResourceType.REPORTS_CAPACITY,
  ResourceType.REPORTS_EXCEPTIONS,
  ResourceType.REPORTS_ATTENDANCE,
  ResourceType.REPORTS_COMPLIANCE,
];

/*
  BRD 5.2 B5: the reports Zoho FSM already has (or will have, as FSM custom
  reports) are reached from the portal, so there is one place for
  everything. Open to anyone who may open a report; Revenue needs the
  Revenue permission (6.7: a manager's report). FSM decides what each
  person may see once there.
*/
export default async function FsmReportsRoute() {
  const { accessUser } = await getAuthenticatedUserAccess();
  if (!accessUser) redirect("/auth/login");
  if (!REPORT_PAGES.some((r) => hasResourceAction(accessUser, r, ActionType.VIEW))) redirect("/dashboard");

  const settings = await readReportingSettings(await createAdminServerClient());
  const links = settings.fsmLinks;
  const all: FsmReportLink[] = [
    {
      key: "checkInLog",
      title: "Check-in and check-out log",
      description: "The raw check-in and check-out events from the FSM mobile app.",
      kind: "FSM standard",
      url: links.checkInLog,
    },
    {
      key: "appointmentsByStatus",
      title: "Appointments by status",
      description: "How many appointments are in each status, and where they stand.",
      kind: "FSM standard",
      url: links.appointmentsByStatus,
    },
    {
      key: "workOrdersByStatus",
      title: "Work orders by type and by status",
      description: "Volume and position of work orders by type and status.",
      kind: "FSM standard",
      url: links.workOrdersByStatus,
    },
    {
      key: "revenue",
      title: "Revenue per technician, per client, AMC vs one-time",
      description: "Value of completed line items by technician, by client (ranked), and split between contract and one-time work.",
      kind: "FSM custom",
      url: links.revenue,
    },
    {
      key: "ratings",
      title: "Rating and feedback trend",
      description: "Average and distribution by technician and team, response rate, low ratings with comments.",
      kind: "FSM custom",
      url: links.ratings,
    },
  ];
  const visible = all.filter((l) => l.key !== "revenue" || hasResourceAction(accessUser, ResourceType.REPORTS_REVENUE, ActionType.VIEW));
  const canConfigure = hasResourceAction(accessUser, ResourceType.REPORTING_SETTINGS, ActionType.EDIT);
  return <FsmReportsPage links={visible} canConfigure={canConfigure} />;
}
