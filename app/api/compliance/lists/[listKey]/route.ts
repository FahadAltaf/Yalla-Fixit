import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ActionType, ResourceType } from "@/types/types";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { requireSharedList } from "@/lib/server/compliance/access";
import { recordComplianceAudit } from "@/lib/server/compliance/audit";
import { createOption, deleteOption, listOptions, renameOption, resolveListKey } from "@/lib/server/compliance/lists";
import { ok, parseBody, serverError } from "@/lib/server/compliance/http";

/*
  Designation and nationality lists (FRD section 6). Stored in
  lookup_options under the module's own keys. A value still used by an
  employee cannot be deleted (409).
*/
type Ctx = { params: Promise<{ listKey: string }> };

const nameSchema = z.string().trim().min(1).max(80).regex(/^[^*]+$/, "A name cannot contain *");
const createSchema = z.object({ name: nameSchema });
const updateSchema = z.object({ id: z.string().uuid(), name: nameSchema });
const deleteSchema = z.object({ id: z.string().uuid() });

const badKey = () => NextResponse.json({ error: "Unknown list" }, { status: 404 });
const duplicate = () => NextResponse.json({ error: "That name is already on the list" }, { status: 409 });

export async function GET(_req: NextRequest, ctx: Ctx) {
  const g = await requireSharedList(ActionType.VIEW, ResourceType.COMPLIANCE);
  if (g.error) return g.error;
  const key = resolveListKey((await ctx.params).listKey);
  if (!key) return badKey();
  try {
    const admin = await createAdminServerClient();
    return ok(await listOptions(admin, key));
  } catch (error) {
    return serverError(`list ${key}`, error);
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await requireSharedList(ActionType.CREATE, ResourceType.COMPLIANCE_SETTINGS);
  if (g.error) return g.error;
  const key = resolveListKey((await ctx.params).listKey);
  if (!key) return badKey();
  const body = await parseBody(req, createSchema);
  if ("response" in body) return body.response;
  try {
    const admin = await createAdminServerClient();
    const created = await createOption(admin, key, body.data.name, g.actor.id);
    if (created === "duplicate") return duplicate();
    await recordComplianceAudit(admin, g.actor, { entity_type: "list", entity_id: created.id, event_type: "create", field: key, new_value: created.name });
    return ok(created, { status: 201 });
  } catch (error) {
    return serverError(`create ${key}`, error);
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const g = await requireSharedList(ActionType.EDIT, ResourceType.COMPLIANCE_SETTINGS);
  if (g.error) return g.error;
  const key = resolveListKey((await ctx.params).listKey);
  if (!key) return badKey();
  const body = await parseBody(req, updateSchema);
  if ("response" in body) return body.response;
  try {
    const admin = await createAdminServerClient();
    const result = await renameOption(admin, key, body.data.id, body.data.name, g.actor.id);
    if (result === "duplicate") return duplicate();
    if (result === "missing") return NextResponse.json({ error: "Not found" }, { status: 404 });
    await recordComplianceAudit(admin, g.actor, { entity_type: "list", entity_id: body.data.id, event_type: "edit", field: key, old_value: result.before.name, new_value: result.after.name });
    return ok(result.after);
  } catch (error) {
    return serverError(`rename ${key}`, error);
  }
}

/* DELETE carries the id as ?id=: the browser helper sends no body on DELETE. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const g = await requireSharedList(ActionType.EDIT, ResourceType.COMPLIANCE_SETTINGS, ActionType.DELETE);
  if (g.error) return g.error;
  const key = resolveListKey((await ctx.params).listKey);
  if (!key) return badKey();
  const parsed = deleteSchema.safeParse({ id: req.nextUrl.searchParams.get("id") });
  if (!parsed.success) return NextResponse.json({ error: "Missing or invalid id" }, { status: 400 });
  try {
    const admin = await createAdminServerClient();
    const result = await deleteOption(admin, key, parsed.data.id);
    if (result === "in_use") return NextResponse.json({ error: "This value is still used by one or more employees" }, { status: 409 });
    if (result === "missing") return NextResponse.json({ error: "Not found" }, { status: 404 });
    await recordComplianceAudit(admin, g.actor, { entity_type: "list", entity_id: parsed.data.id, event_type: "archive", field: key });
    return ok({ deleted: true });
  } catch (error) {
    return serverError(`delete ${key}`, error);
  }
}
