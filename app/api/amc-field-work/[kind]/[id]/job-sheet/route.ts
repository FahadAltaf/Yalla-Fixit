import { NextRequest, NextResponse } from "next/server";

import type { FieldStartKind } from "@/lib/amc/field-start";
import { jobSheetActionSchema } from "@/lib/amc/job-sheets";
import { browserPdfFrom } from "@/lib/server/amc/browser-pdf";
import { additionalWorkOwner } from "@/lib/server/amc/additional-works";
import { callOutOwner, handymanFacts, handymanHoursLeft } from "@/lib/server/amc/call-outs";
import { minutesOnSite, suggestedTeamHours } from "@/lib/amc/handyman-hours";
import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { fsmQuotationState } from "@/lib/server/amc/fsm-quotation";
import { closeFieldJobSheet, fieldJobSheetView, markFieldReportSent, returnFieldJobSheet, saveFieldJobSheet, sendFieldServiceReport } from "@/lib/server/amc/field-job-sheets";
import { UUID, fieldWorkRights } from "@/lib/server/amc/field-work-access";
import { jobSheetSupervisors } from "@/lib/server/amc/job-sheets";

/*
  The job sheet of a call out or additional work (18 Nov 2026), as a planned
  visit's (/api/amc-visits/[visitId]/job-sheet):

    GET                       the sheet, the work's one outcome, checklist and photos
    POST save | submit        fill it in (draft or returned), once the office started it
    POST close | return       the supervisor's review; close closes the call out or
                              completes the work and sends the service report
    POST resend_report        the service report again
                              (close and resend_report may carry pdfBase64: the
                              report as the portal built it, 18 Nov 2026)

  Read and fill in: the call out's or additional work's own rights. Review:
  AMC Visits (Approve), or a supervisor named in configuration.
*/

const KINDS = ["call_out", "additional_work"] as const;
type Params = { params: Promise<{ kind: string; id: string }> };
const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 });

async function gateFor(kindParam: string, id: string) {
  const gate = await requireContractAccess();
  if (!gate.ok) return { response: gate.response };
  if (!(KINDS as readonly string[]).includes(kindParam) || !UUID.test(id)) return { response: notFound() };
  const kind = kindParam as FieldStartKind;
  const scope = kind === "call_out" ? await callOutOwner(gate.admin, id) : await additionalWorkOwner(gate.admin, id);
  const rights = fieldWorkRights(gate, kind === "call_out" ? "call_outs" : "additional_works", scope.ownerId);
  if (!scope.found || !rights.view) return { response: notFound() };
  return { gate, kind, rights };
}

export async function GET(_req: NextRequest, ctx: Params) {
  const { kind: kindParam, id } = await ctx.params;
  try {
    const { gate, kind, rights, response } = await gateFor(kindParam, id);
    if (!gate) return response;
    const [view, config, fsmQuotation, facts] = await Promise.all([
      fieldJobSheetView(gate.admin, kind, id),
      readAmcConfig(gate.admin),
      /* DEV-508: the FSM quotation number, and whether closing needs it. */
      fsmQuotationState(gate.admin, kind, id).catch(() => null),
      /* DEV-495: a handyman job's teams and hours. */
      kind === "call_out" ? handymanFacts(gate.admin, id) : Promise.resolve(null),
    ]);
    /* How many free hours are left, so the close dialog says up front when the hours run over (25 Nov 2026). */
    const left = facts ? await handymanHoursLeft(gate.admin, id).catch(() => null) : null;
    const minutes = facts ? minutesOnSite(view.sheet?.arrivedAt, view.sheet?.completedAt) : null;
    const handyman = facts
      ? { ...facts, minutesOnSite: minutes, suggestedHours: suggestedTeamHours(minutes, facts.teams), hoursLeft: left?.hoursLeft ?? null, covered: left?.covered ?? true }
      : null;
    return NextResponse.json(
      { ...view, fsmQuotation, handyman, canEdit: rights.edit, canReview: gate.visits.approve || jobSheetSupervisors(config).includes(gate.userId) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return contractErrorResponse(error, "Could not load the job sheet");
  }
}

export async function POST(req: NextRequest, ctx: Params) {
  const { kind: kindParam, id } = await ctx.params;
  const body: unknown = await req.json().catch(() => null);
  const parsed = jobSheetActionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const { gate, kind, rights, response } = await gateFor(kindParam, id);
    if (!gate) return response;
    const config = await readAmcConfig(gate.admin);
    const actor = { id: gate.userId, label: gate.label };
    const action = parsed.data;
    if (action.action === "save" || action.action === "submit") {
      if (!rights.edit) return NextResponse.json({ error: "You cannot fill in this job sheet." }, { status: 403 });
      return NextResponse.json(await saveFieldJobSheet(gate.admin, kind, id, action.sheet, actor, config, action.action === "submit"));
    }
    if (!(gate.visits.approve || jobSheetSupervisors(config).includes(gate.userId))) {
      return NextResponse.json({ error: "Only a supervisor reviews job sheets." }, { status: 403 });
    }
    if (action.action === "return") return NextResponse.json(await returnFieldJobSheet(gate.admin, kind, id, action.comment, actor));
    if (action.action === "mark_report_sent") return NextResponse.json(await markFieldReportSent(gate.admin, kind, id, { channel: action.channel, note: action.note }, actor));
    if (action.action === "close") return NextResponse.json(await closeFieldJobSheet(gate.admin, kind, id, action.comment, actor, config, action.send, browserPdfFrom(body), action.fsmQuotationNo ?? null, action.hoursUsed ?? null, action.fsmQuotationSkip ?? null));
    return NextResponse.json(await sendFieldServiceReport(gate.admin, kind, id, actor, config, action.channel, browserPdfFrom(body)));
  } catch (error) {
    return contractErrorResponse(error, "Could not update the job sheet");
  }
}
