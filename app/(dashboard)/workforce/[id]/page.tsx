import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import WorkforcePerson from "@/components/dashboard/workforce/person";
import { RECORD_ROSTER_MAX_AGE_MS, refreshRosterIfOlderThan } from "@/lib/server/compliance/roster";
import { listTechniciansForViewer } from "@/lib/server/scheduling-technicians";
import { workforceAccess } from "@/lib/server/workforce/access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

export const metadata: Metadata = {
  title: "Person | Workforce",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
  /workforce/<employee id> for anyone with an employee record, and
  /workforce/fsm-<FSM id> for an FSM technician with none. A technician
  who is linked is sent to their employee's address, so a person has one.
*/
export default async function WorkforcePersonPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await workforceAccess();
  if (!access) return <NoPageAccess page="Workforce" />;
  const { id } = await params;
  // D11: as the compliance record did, at most 15 minutes behind FSM. Never throws.
  await refreshRosterIfOlderThan(RECORD_ROSTER_MAX_AGE_MS);
  const admin = await createAdminServerClient();

  let employeeId: string | null = null;
  let fsmResourceId: string | null = null;
  if (id.startsWith("fsm-")) {
    fsmResourceId = id.slice(4);
    if (access.compliance) {
      const { data } = await admin
        .from("compliance_employees")
        .select("id")
        .eq("fsm_resource_id", fsmResourceId)
        .is("archived_at", null)
        .maybeSingle();
      if (data?.id) redirect(`/workforce/${data.id}`);
    }
  } else {
    if (!access.compliance || !UUID.test(id)) return <NoPageAccess page="this person" />;
    const { data } = await admin.from("compliance_employees").select("id, fsm_resource_id").eq("id", id).maybeSingle();
    if (!data) return <NoPageAccess page="this person" />;
    employeeId = data.id as string;
    fsmResourceId = (data.fsm_resource_id as string | null) ?? null;
  }

  // Empty without Scheduling View.
  const technicians = await listTechniciansForViewer();
  if (!employeeId && !technicians.some((t) => t.fsm_resource_id === fsmResourceId)) return <NoPageAccess page="this person" />;

  return (
    <Suspense fallback={null}>
      <WorkforcePerson technicians={technicians} fsmResourceId={fsmResourceId} employeeId={employeeId} access={access} />
    </Suspense>
  );
}
