import { NextRequest, NextResponse } from "next/server";

import { FIELD_VISIT_KINDS, FIELD_VISIT_STAGES, FIELD_VISIT_WHEN, type FieldVisitKind, type FieldVisitStage, type FieldVisitWhen } from "@/lib/amc/field-visits";
import { UUID } from "@/lib/server/amc/business-schemas";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { listFieldVisits } from "@/lib/server/amc/field-visits";
import { pageParams } from "@/lib/server/snagging/search";

/**
 * AMC -> Visits: every AMC visit (planned visits, call outs, approved
 * additional work, site visits), one page at a time.
 *
 *   ?kind=ppm|call_out|additional_work|site_visit
 *   ?stage=open (default)|all|to_plan|planned|confirmed|in_progress|review|done|cancelled
 *   ?when=any|overdue|today|week|past30
 *   ?technician=<FSM id>  ?contract=<id>  ?customer=<id>  ?q=  ?page=  ?pageSize= (max 100)
 *
 * AMC Visits (View) and those who see every contract get every visit;
 * anyone else their own contracts' visits and their own site visits.
 */
export async function GET(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const p = req.nextUrl.searchParams;
  const { page, pageSize, from, to } = pageParams(p, { defaultSize: 25, maxSize: 100 });
  const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | null => (value && (allowed as readonly string[]).includes(value) ? (value as T) : null);
  const stage = p.get("stage");
  const contract = p.get("contract");
  const customer = p.get("customer");
  try {
    const result = await listFieldVisits(
      gate.admin,
      {
        kind: pick<FieldVisitKind>(p.get("kind"), FIELD_VISIT_KINDS),
        stage: stage === "all" ? "all" : (pick<FieldVisitStage>(stage, FIELD_VISIT_STAGES) ?? "open"),
        when: pick<FieldVisitWhen>(p.get("when"), FIELD_VISIT_WHEN) ?? "any",
        technicianId: p.get("technician")?.trim().slice(0, 40) || null,
        contractId: contract && UUID.test(contract) ? contract : null,
        customerId: customer && UUID.test(customer) ? customer : null,
        q: p.get("q"),
        from,
        to,
      },
      gate.seesAll || gate.visits.view ? { all: true } : { all: false, userId: gate.userId },
    );
    return NextResponse.json({ ...result, page, pageSize }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the visits");
  }
}
