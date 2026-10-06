import { NextRequest, NextResponse } from "next/server";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { createAssessment, listAssessments } from "@/lib/server/amc/business";
import { createAssessmentSchema } from "@/lib/server/amc/business-schemas";
import { pageParams } from "@/lib/server/snagging/search";

/** AMC property assessments: list (status, search, page) and start one. */
export async function GET(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const params = req.nextUrl.searchParams;
  const { page, pageSize, from, to } = pageParams(params, { defaultSize: 25 });
  try {
    const { assessments, total } = await listAssessments(gate.admin, { status: params.get("status"), q: params.get("q"), from, to });
    return NextResponse.json({ assessments, total, page, pageSize });
  } catch (error) {
    return contractErrorResponse(error, "Could not load assessments");
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const parsed = createAssessmentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const assessment = await createAssessment(gate.admin, parsed.data, { id: gate.userId, label: gate.label });
    return NextResponse.json({ assessment }, { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not start the assessment");
  }
}
