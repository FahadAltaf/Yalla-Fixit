import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ActionType } from "@/types/types";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { requireCompliance } from "@/lib/server/compliance/access";
import { getEmployee } from "@/lib/server/compliance/employees";
import { requestDeactivation } from "@/lib/server/compliance/deactivation";
import { complianceToday, ok, parseBody, serverError } from "@/lib/server/compliance/http";

/*
  Deactivate (FRD D11, Sami 27 Oct 2026): for a linked technician this does
  not change the record. It emails the configured people to deactivate the
  person in Zoho FSM, and the UI tells the user so.
*/
type Ctx = { params: Promise<{ id: string }> };
const bodySchema = z.object({ note: z.string().trim().max(500).nullable().optional() });

export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await requireCompliance(ActionType.EDIT);
  if (g.error) return g.error;
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  const body = await parseBody(req, bodySchema);
  if ("response" in body) return body.response;
  try {
    const admin = await createAdminServerClient();
    const employee = await getEmployee(admin, id, complianceToday());
    if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    const result = await requestDeactivation(admin, g.actor, employee, body.data.note ?? null);
    if (!result.sent) {
      const messages = {
        not_linked: "This employee is not linked to an FSM technician. Change the status directly instead",
        already_inactive: "FSM already shows this technician as inactive",
        no_recipients: "No one is set to receive deactivation requests. Add recipients under Settings → Compliance",
      } as const;
      return NextResponse.json({ error: messages[result.reason], reason: result.reason }, { status: 409 });
    }
    return ok(result);
  } catch (error) {
    return serverError("deactivation request", error);
  }
}
