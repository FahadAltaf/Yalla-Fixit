import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ActionType } from "@/types/types";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { requireCompliance } from "@/lib/server/compliance/access";
import { buildLinkSuggestions } from "@/lib/server/compliance/link-suggestions";
import { isServiceError, updateEmployee } from "@/lib/server/compliance/employees";
import { complianceToday, ok, parseBody, serverError } from "@/lib/server/compliance/http";

/*
  Q3 (Sami, 30 Oct 2026): link employees to FSM technicians by name, after
  review. GET proposes; POST applies only the pairs sent, each through the
  normal employee update, so the D11 status rule and the audit log apply.
  Needs Compliance Edit.
*/
const applySchema = z.object({
  pairs: z.array(z.object({ employee_id: z.string().uuid(), fsm_resource_id: z.string().min(1) })).min(1).max(500),
});

export async function GET() {
  const g = await requireCompliance(ActionType.EDIT);
  if (g.error) return g.error;
  try {
    const admin = await createAdminServerClient();
    return ok(await buildLinkSuggestions(admin));
  } catch (error) {
    return serverError("link suggestions", error);
  }
}

export async function POST(req: NextRequest) {
  const g = await requireCompliance(ActionType.EDIT);
  if (g.error) return g.error;
  const body = await parseBody(req, applySchema);
  if ("response" in body) return body.response;
  try {
    const admin = await createAdminServerClient();
    const today = complianceToday();
    const results: { employee_id: string; ok: boolean; error?: string }[] = [];
    for (const p of body.data.pairs) {
      const r = await updateEmployee(admin, g.actor, p.employee_id, { fsm_resource_id: p.fsm_resource_id }, today);
      if (isServiceError(r)) {
        const detail = r.fields ? Object.values(r.fields).join("; ") : r.error;
        results.push({ employee_id: p.employee_id, ok: false, error: detail });
      } else {
        results.push({ employee_id: p.employee_id, ok: true });
      }
    }
    const linked = results.filter((r) => r.ok).length;
    return NextResponse.json({ data: { linked, failed: results.length - linked, results } });
  } catch (error) {
    return serverError("apply links", error);
  }
}
