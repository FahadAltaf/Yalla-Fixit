import { NextRequest, NextResponse } from "next/server";

import { canOperateContract, canReadContract } from "@/lib/amc/access";
import { jobSheetActionSchema } from "@/lib/amc/job-sheets";
import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import {
  closeJobSheet,
  jobSheetSupervisors,
  jobSheetView,
  returnJobSheet,
  saveJobSheet,
  sendServiceReport,
  visitOwner,
} from "@/lib/server/amc/job-sheets";

/**
 * A visit's job sheet (DEV-402, 403, 404).
 *
 *   GET                       the sheet, its trades, checklist and photos
 *   POST save | submit        fill it in (draft or returned)
 *   POST close | return       the supervisor's review; close sends the service report
 *   POST resend_report        the service report again
 *
 * Read: AMC Visits (View), or anyone who may read the contract. Fill in:
 * AMC Visits (Create or Edit), or whoever operates the contract. Review:
 * AMC Visits (Approve), or a supervisor named in configuration (none named:
 * the level 1 approvers).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => NextResponse.json({ error: "Visit not found." }, { status: 404 });

export async function GET(_req: NextRequest, ctx: { params: Promise<{ visitId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { visitId } = await ctx.params;
  if (!UUID.test(visitId)) return notFound();
  try {
    const scope = await visitOwner(gate.admin, visitId);
    if (!scope.found || (!gate.visits.view && !gate.seesAll && !canReadContract(gate.actor, scope.ownerId))) return notFound();
    const config = await readAmcConfig(gate.admin);
    const view = await jobSheetView(gate.admin, visitId);
    return NextResponse.json(
      {
        ...view,
        canEdit: gate.visits.create || gate.visits.edit || canOperateContract(gate.actor, scope.ownerId),
        canReview: gate.visits.approve || jobSheetSupervisors(config).includes(gate.userId),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return contractErrorResponse(error, "Could not load the job sheet");
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ visitId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { visitId } = await ctx.params;
  if (!UUID.test(visitId)) return notFound();
  const parsed = jobSheetActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const scope = await visitOwner(gate.admin, visitId);
    if (!scope.found) return notFound();
    const config = await readAmcConfig(gate.admin);
    const actor = { id: gate.userId, label: gate.label };
    const action = parsed.data;
    if (action.action === "save" || action.action === "submit") {
      if (!(gate.visits.create || gate.visits.edit || canOperateContract(gate.actor, scope.ownerId))) {
        return NextResponse.json({ error: "You cannot fill in this job sheet." }, { status: 403 });
      }
      return NextResponse.json(await saveJobSheet(gate.admin, visitId, action.sheet, actor, config, action.action === "submit"));
    }
    if (!(gate.visits.approve || jobSheetSupervisors(config).includes(gate.userId))) {
      return NextResponse.json({ error: "Only a supervisor reviews job sheets." }, { status: 403 });
    }
    if (action.action === "return") return NextResponse.json(await returnJobSheet(gate.admin, visitId, action.comment, actor));
    if (action.action === "close") return NextResponse.json(await closeJobSheet(gate.admin, visitId, action.comment, actor, config));
    return NextResponse.json(await sendServiceReport(gate.admin, visitId, actor, config));
  } catch (error) {
    return contractErrorResponse(error, "Could not update the job sheet");
  }
}
