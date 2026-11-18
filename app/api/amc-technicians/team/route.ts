import { NextResponse } from "next/server";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";

/**
 * Who has AMC access (18 Nov 2026), for Workforce -> People's AMC column and
 * filter: every FSM technician with at least one confirmed AMC skill
 * (trainee does not count), with those trades. They are the ones offered for
 * call outs and additional work. Any AMC user may read it.
 */
export async function GET() {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  try {
    const { data, error } = await gate.admin.from("amc_technician_skills").select("fsm_resource_id, trade, level");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const team: Record<string, string[]> = {};
    for (const s of (data ?? []) as Array<{ fsm_resource_id: string; trade: string; level: string }>) {
      if (s.level === "trainee") continue;
      (team[s.fsm_resource_id] ??= []).push(s.trade);
    }
    return NextResponse.json({ team }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the AMC team");
  }
}
