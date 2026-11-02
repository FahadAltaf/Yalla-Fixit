import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ActionType, ResourceType } from "@/types/types";
import { hasResourceAction } from "@/lib/role-permissions";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { requireCompliance } from "@/lib/server/compliance/access";
import { recordComplianceAudit } from "@/lib/server/compliance/audit";
import { readIdentityRaw } from "@/lib/server/compliance/employees";
import { formatEmiratesId, maskForAudit } from "@/lib/compliance/masking";
import { serverError } from "@/lib/server/compliance/http";

/*
  The only path on which a full Emirates ID or passport number leaves the
  server (FRD FR-9, AC-34, decision D2).
  - POST, never GET: the number is never in a URL or a cacheable response.
  - Needs Compliance View AND the separate identity right, which admins
    do not inherit.
  - The audit row is written and AWAITED before the number is returned;
    if the audit write fails, the number is not returned.
  - Cache-Control: no-store.
*/
type Ctx = { params: Promise<{ id: string }> };
const bodySchema = z.object({ field: z.enum(["emirates_id", "passport"]) });

export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await requireCompliance(ActionType.VIEW);
  if (g.error) return g.error;
  if (!hasResourceAction(g.actor.accessUser, ResourceType.COMPLIANCE_IDENTITY, ActionType.VIEW)) {
    return NextResponse.json({ error: "You do not have the right to see full identity numbers" }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Say which number: emirates_id or passport" }, { status: 400 });
  const field = parsed.data.field;
  try {
    const admin = await createAdminServerClient();
    const { data: employee } = await admin.from("compliance_employees").select("id, maher_id").eq("id", id).maybeSingle();
    if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    const raw = await readIdentityRaw(admin, id);
    const value = field === "emirates_id" ? raw?.emirates_id_number ?? null : raw?.passport_number ?? null;

    // Audit first, and only then answer (AC-34). The log holds the masked form.
    await recordComplianceAudit(admin, g.actor, {
      entity_type: "identity",
      entity_id: id,
      employee_id: id,
      event_type: "reveal",
      field,
      new_value: { shown: maskForAudit(value) },
    });

    const response = NextResponse.json({ data: { field, value: value ? (field === "emirates_id" ? formatEmiratesId(value) : value) : null } });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return serverError("identity reveal", error);
  }
}
