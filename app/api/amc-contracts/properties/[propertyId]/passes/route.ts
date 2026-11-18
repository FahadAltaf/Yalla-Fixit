import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { UUID } from "@/lib/server/amc/business-schemas";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { refuseCustomerEdit } from "@/lib/server/amc/customer-access";
import { ACCESS_STATUSES } from "@/lib/amc/visits";
import { readPasses, refreshPropertyVisitsAccess, writePassType } from "@/lib/server/amc/visits";

/*
  A property's gate passes (17 Nov 2026): uploaded as the property's "Gate
  pass" documents, each with its own valid-until and note. A property pass
  counts for every visit there, so after any change the visits not yet
  started have their access worked out again.

  GET                                           -- the passes, with their access type and status
  POST  {}                                      -- after uploads: refresh the visits
  PATCH { documentId, validUntil, note, accessRuleId?, accessStatus? }
                                                -- change one pass (17 Nov 2026: its access type and status too)
  DELETE ?documentId=                           -- take one out of use (the file is kept)
*/

const patchSchema = z
  .object({
    documentId: z.string().regex(UUID),
    validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date").nullable(),
    note: z.string().trim().max(500).nullable(),
    accessRuleId: z.string().regex(UUID).nullable().optional(),
    accessStatus: z.enum(ACCESS_STATUSES).optional(),
  })
  .strict();

async function gateFor(propertyId: string) {
  const gate = await requireContractAccess();
  if (!gate.ok) return { response: gate.response };
  if (!UUID.test(propertyId)) return { response: NextResponse.json({ error: "Property not found." }, { status: 404 }) };
  const refused = await refuseCustomerEdit(gate, "customer_properties", propertyId);
  if (refused) return { response: refused };
  return { gate };
}

async function passOf(admin: Parameters<typeof refreshPropertyVisitsAccess>[0], propertyId: string, documentId: string) {
  const { data } = await admin.from("amc_documents").select("id, level, entity_id, category, superseded_by").eq("id", documentId).maybeSingle();
  const row = data as { level?: string; entity_id?: string; category?: string; superseded_by?: string | null } | null;
  return Boolean(row && row.level === "property" && String(row.entity_id) === propertyId && row.category === "Gate pass" && !row.superseded_by);
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = await ctx.params;
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  if (!UUID.test(propertyId)) return NextResponse.json({ error: "Property not found." }, { status: 404 });
  try {
    const { passes, typed } = await readPasses(gate.admin, "property", [propertyId]);
    return NextResponse.json({ passes, passTypes: typed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the passes");
  }
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = await ctx.params;
  try {
    const { gate, response } = await gateFor(propertyId);
    if (!gate) return response;
    return NextResponse.json({ visits: await refreshPropertyVisitsAccess(gate.admin, propertyId) });
  } catch (error) {
    return contractErrorResponse(error, "Could not update the visits' access");
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const { gate, response } = await gateFor(propertyId);
    if (!gate) return response;
    if (!(await passOf(gate.admin, propertyId, parsed.data.documentId))) return NextResponse.json({ error: "That pass is not on this property." }, { status: 404 });
    const { error } = await gate.admin
      .from("amc_documents")
      .update({ expires_on: parsed.data.validUntil, notes: parsed.data.note || null })
      .eq("id", parsed.data.documentId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await writePassType(gate.admin, parsed.data.documentId, { accessRuleId: parsed.data.accessRuleId, accessStatus: parsed.data.accessStatus }, propertyId);
    return NextResponse.json({ visits: await refreshPropertyVisitsAccess(gate.admin, propertyId) });
  } catch (error) {
    return contractErrorResponse(error, "Could not save the pass");
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = await ctx.params;
  const documentId = req.nextUrl.searchParams.get("documentId") ?? "";
  if (!UUID.test(documentId)) return NextResponse.json({ error: "Pass not found." }, { status: 404 });
  try {
    const { gate, response } = await gateFor(propertyId);
    if (!gate) return response;
    if (!(await passOf(gate.admin, propertyId, documentId))) return NextResponse.json({ error: "That pass is not on this property." }, { status: 404 });
    /* Taken out of use, the file kept: marked as replaced by itself, so every list leaves it out. */
    const { error } = await gate.admin.from("amc_documents").update({ superseded_by: documentId }).eq("id", documentId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ visits: await refreshPropertyVisitsAccess(gate.admin, propertyId) });
  } catch (error) {
    return contractErrorResponse(error, "Could not remove the pass");
  }
}
