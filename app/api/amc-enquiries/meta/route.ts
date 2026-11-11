import { NextResponse } from "next/server";

import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse } from "@/lib/server/amc/contract-access";
import { listAmcPeople } from "@/lib/server/amc/enquiries";
import { requireEnquiryAccess } from "@/lib/server/amc/enquiry-access";

/**
 * What the enquiry screens need besides the records: the configured
 * stages, sources and lost reasons, the idle and site-visit rules, the
 * people who can own an enquiry or go on a site visit, and what the caller
 * may do.
 */
export async function GET() {
  const gate = await requireEnquiryAccess();
  if (!gate.ok) return gate.response;
  try {
    const [config, people] = await Promise.all([readAmcConfig(gate.admin), listAmcPeople(gate.admin)]);
    return NextResponse.json(
      {
        stages: config.enquiries.stages,
        sources: config.enquiries.sources,
        lostReasons: config.enquiries.lostReasons,
        idleDays: config.enquiries.idleDays,
        managementEscalationDays: config.enquiries.managementEscalationDays,
        siteVisitRule: config.proposals.siteVisitRule,
        siteVisitRequiredCategories: config.proposals.siteVisitRequiredCategories,
        people,
        me: gate.actor.id,
        canCreate: gate.canCreate,
        canEdit: gate.canEdit,
        canExport: gate.canExport,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return contractErrorResponse(error, "Could not load the enquiry settings");
  }
}
