import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ActionType, ResourceType } from "@/types/types";
import { hasResourceAction } from "@/lib/role-permissions";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { requireCompliance } from "@/lib/server/compliance/access";
import { recordComplianceAudit } from "@/lib/server/compliance/audit";
import { ITEM_KEY_RE, listDocuments, signDocument, storeDocument } from "@/lib/server/compliance/documents";
import { serverError } from "@/lib/server/compliance/http";
import { isRealDate } from "@/lib/compliance/validation";

// 10 MB multipart uploads, like the task attachments (self-hosted Node server).
export const maxDuration = 60;

/*
  Certificate files on an employee record (Sharon's action point C2).
  Seeing or opening any file needs the identity-numbers right, the same
  people who see full Emirates ID and passport numbers. Uploading also needs
  Compliance Edit. Nothing is deleted.
    GET                       list (newest first; "current" per item)
    GET  ?open=<document id>  a one-hour signed link, audited
    POST multipart: file, item_key, expiry_date?
*/
type Ctx = { params: Promise<{ id: string }> };

function canSeeFiles(user: Parameters<typeof hasResourceAction>[0]) {
  return hasResourceAction(user, ResourceType.COMPLIANCE_IDENTITY, ActionType.VIEW);
}
const forbidden = () => NextResponse.json({ error: "You do not have access to compliance documents" }, { status: 403 });

export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await requireCompliance(ActionType.VIEW);
  if (g.error) return g.error;
  if (!canSeeFiles(g.actor.accessUser)) return forbidden();
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  try {
    const admin = await createAdminServerClient();
    const open = req.nextUrl.searchParams.get("open");
    if (open) {
      if (!z.string().uuid().safeParse(open).success) return NextResponse.json({ error: "File not found" }, { status: 404 });
      const signed = await signDocument(admin, open);
      if (!signed || signed.row.employee_id !== id) return NextResponse.json({ error: "File not found" }, { status: 404 });
      await recordComplianceAudit(admin, g.actor, { entity_type: "document", entity_id: open, employee_id: id, event_type: "open", field: signed.row.item_key, new_value: { file_name: signed.row.file_name } });
      const res = NextResponse.json({ data: { url: signed.url } });
      res.headers.set("Cache-Control", "no-store");
      return res;
    }
    return NextResponse.json({ data: await listDocuments(admin, id) });
  } catch (error) {
    return serverError("list documents", error);
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await requireCompliance(ActionType.EDIT);
  if (g.error) return g.error;
  if (!canSeeFiles(g.actor.accessUser)) return forbidden();
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  try {
    const form = await req.formData();
    const file = form.get("file");
    const itemKey = String(form.get("item_key") ?? "");
    const expiryRaw = String(form.get("expiry_date") ?? "");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file" }, { status: 400 });
    if (!ITEM_KEY_RE.test(itemKey)) return NextResponse.json({ error: "Unknown item" }, { status: 400 });
    const expiryDate = expiryRaw && isRealDate(expiryRaw) ? expiryRaw : null;

    const admin = await createAdminServerClient();
    const { data: employee } = await admin.from("compliance_employees").select("id").eq("id", id).maybeSingle();
    if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await storeDocument(admin, { employeeId: id, itemKey, expiryDate, fileName: file.name, bytes, actorId: g.actor.id });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    await recordComplianceAudit(admin, g.actor, { entity_type: "document", entity_id: result.document.id, employee_id: id, event_type: "upload", field: itemKey, new_value: { file_name: result.document.file_name, size_bytes: result.document.size_bytes, expiry_date: expiryDate } });
    return NextResponse.json({ data: result.document }, { status: 201 });
  } catch (error) {
    return serverError("upload document", error);
  }
}
