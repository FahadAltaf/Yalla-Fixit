import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ActionType } from "@/types/types";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { requireCompliance } from "@/lib/server/compliance/access";
import { isServiceError, setArchived } from "@/lib/server/compliance/employees";
import { complianceToday, fail, ok, parseBody, serverError } from "@/lib/server/compliance/http";

/*
  Archive or restore (FRD FR-14). Delete permission means archive; nothing
  is hard-deleted. Refused (409) for a linked technician still active in
  FSM (D11): use the deactivation request instead.
*/
type Ctx = { params: Promise<{ id: string }> };
const bodySchema = z.object({ archived: z.boolean(), reason: z.string().trim().max(500).nullable().optional() });

export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await requireCompliance(ActionType.DELETE);
  if (g.error) return g.error;
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  const body = await parseBody(req, bodySchema);
  if ("response" in body) return body.response;
  try {
    const admin = await createAdminServerClient();
    const result = await setArchived(admin, g.actor, id, body.data.archived, body.data.reason ?? null, complianceToday());
    if (isServiceError(result)) return fail(result);
    return ok(result);
  } catch (error) {
    return serverError("archive employee", error);
  }
}
