import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ActionType, ResourceType } from "@/types/types";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { requireCompliance } from "@/lib/server/compliance/access";
import { recordComplianceAudit } from "@/lib/server/compliance/audit";
import { createCertificateType, listCertificateTypes, updateCertificateType } from "@/lib/server/compliance/certificate-types";
import { ok, parseBody, serverError } from "@/lib/server/compliance/http";

/*
  Certificate types (FRD FR-1, D5, D6): a managed list with an "expires"
  flag. Seven are entered through the UI at go-live (nothing is seeded).
  Retired (is_active=false), never deleted.
*/
const nameSchema = z.string().trim().min(1).max(80).regex(/^[^*]+$/, "A name cannot contain *");
const createSchema = z.object({ name: nameSchema, expires: z.boolean().default(true), sort_order: z.number().int().min(0).max(10_000).optional() });
const updateSchema = z.object({
  id: z.string().uuid(),
  name: nameSchema.optional(),
  expires: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(10_000).optional(),
  is_active: z.boolean().optional(),
});

const duplicate = () => NextResponse.json({ error: "A certificate type with this name already exists" }, { status: 409 });

export async function GET(req: NextRequest) {
  const g = await requireCompliance(ActionType.VIEW);
  if (g.error) return g.error;
  try {
    const admin = await createAdminServerClient();
    const includeInactive = req.nextUrl.searchParams.get("include_inactive") !== "false";
    return ok(await listCertificateTypes(admin, includeInactive));
  } catch (error) {
    return serverError("list certificate types", error);
  }
}

export async function POST(req: NextRequest) {
  const g = await requireCompliance(ActionType.CREATE, ResourceType.COMPLIANCE_SETTINGS);
  if (g.error) return g.error;
  const body = await parseBody(req, createSchema);
  if ("response" in body) return body.response;
  try {
    const admin = await createAdminServerClient();
    const created = await createCertificateType(admin, body.data, g.actor.id);
    if (created === "duplicate") return duplicate();
    await recordComplianceAudit(admin, g.actor, { entity_type: "certificate_type", entity_id: created.id, event_type: "create", new_value: created });
    return ok(created, { status: 201 });
  } catch (error) {
    return serverError("create certificate type", error);
  }
}

export async function PATCH(req: NextRequest) {
  const g = await requireCompliance(ActionType.EDIT, ResourceType.COMPLIANCE_SETTINGS);
  if (g.error) return g.error;
  const body = await parseBody(req, updateSchema);
  if ("response" in body) return body.response;
  try {
    const admin = await createAdminServerClient();
    const { id, ...patch } = body.data;
    const result = await updateCertificateType(admin, id, patch, g.actor.id);
    if (result === "duplicate") return duplicate();
    if (result === "missing") return NextResponse.json({ error: "Certificate type not found" }, { status: 404 });
    await recordComplianceAudit(admin, g.actor, { entity_type: "certificate_type", entity_id: id, event_type: "edit", old_value: result.before, new_value: result.after });
    return ok(result.after);
  } catch (error) {
    return serverError("update certificate type", error);
  }
}
