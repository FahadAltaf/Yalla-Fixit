import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ActionType } from "@/types/types";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { requireCompliance } from "@/lib/server/compliance/access";
import { getEmployee, isServiceError, updateEmployee, type EmployeePatch } from "@/lib/server/compliance/employees";
import { complianceToday, fail, ok, parseBody, serverError } from "@/lib/server/compliance/http";
import { certificateInputSchema, employeeInputSchema, optionalDateSchema, optionalEmiratesIdSchema, optionalPassportSchema } from "@/lib/compliance/validation";

/*
  One employee (FRD FR-1, FR-2, FR-6). GET returns the record with every
  item's status and the nearest expiry; PATCH updates any subset of fields.
  Identity numbers are write-only here: a string sets, null clears, absent
  leaves untouched. Responses carry the last four characters only.
*/
type Ctx = { params: Promise<{ id: string }> };

const patchSchema = employeeInputSchema
  .omit({ identity: true, certificates: true })
  .partial()
  .extend({
    identity: z
      .object({
        emirates_id_number: optionalEmiratesIdSchema.optional(),
        emirates_id_expiry: optionalDateSchema.optional(),
        passport_number: optionalPassportSchema.optional(),
        passport_expiry: optionalDateSchema.optional(),
      })
      .optional(),
    certificates: z.array(certificateInputSchema).optional(),
  });

const idSchema = z.string().uuid();

export async function GET(_req: NextRequest, ctx: Ctx) {
  const g = await requireCompliance(ActionType.VIEW);
  if (g.error) return g.error;
  const { id } = await ctx.params;
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  try {
    const admin = await createAdminServerClient();
    const record = await getEmployee(admin, id, complianceToday());
    if (!record) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    return ok(record);
  } catch (error) {
    return serverError("get employee", error);
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const g = await requireCompliance(ActionType.EDIT);
  if (g.error) return g.error;
  const { id } = await ctx.params;
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  const body = await parseBody(req, patchSchema);
  if ("response" in body) return body.response;
  try {
    const admin = await createAdminServerClient();
    const result = await updateEmployee(admin, g.actor, id, body.data as EmployeePatch, complianceToday());
    if (isServiceError(result)) return fail(result);
    return ok(result);
  } catch (error) {
    return serverError("update employee", error);
  }
}
