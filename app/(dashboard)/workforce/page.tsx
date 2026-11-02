import type { Metadata } from "next";
import { Suspense } from "react";

import WorkforcePeople from "@/components/dashboard/workforce/people";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { listTechniciansForViewer } from "@/lib/server/scheduling-technicians";
import { workforceAccess } from "@/lib/server/workforce/access";
import { refreshTechniciansIfStale } from "@/lib/server/zoho/service-resources";

export const metadata: Metadata = {
  title: "People | Workforce",
  description: "Everyone in one list: FSM technicians and compliance employees, with their scheduling and compliance fields.",
  robots: { index: false, follow: false },
};

export default async function WorkforcePage() {
  const access = await workforceAccess();
  if (!access) return <NoPageAccess page="Workforce" />;
  // The six-hour FSM roster refresh the Technicians page used to do. Never throws.
  await refreshTechniciansIfStale();
  // Empty without Scheduling View; the page then lists employees only.
  const technicians = await listTechniciansForViewer();
  return (
    <Suspense fallback={null}>
      <WorkforcePeople technicians={technicians} access={access} />
    </Suspense>
  );
}
