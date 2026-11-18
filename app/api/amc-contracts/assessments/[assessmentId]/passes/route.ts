import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { canReadAssessment } from "@/lib/amc/access";
import { todayInDubai } from "@/lib/amc/contracts";
import { ACCESS_STATUSES } from "@/lib/amc/visits";
import { getAssessment } from "@/lib/server/amc/business";
import { UUID } from "@/lib/server/amc/business-schemas";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { siteVisitAccess, writePassType } from "@/lib/server/amc/visits";

/*
  A site visit's access (17 Nov 2026), as a planned visit's: the property's
  access rules, the site visit's own gate passes (documents at level
  "site_visit") and the property's passes, which count for every visit
  there. Each pass has its valid-until, note, access type and status.

  GET                                                   -- rules, passes and the status for the visit day
  PATCH { documentId, validUntil, note, accessRuleId?, accessStatus? }
  DELETE ?documentId=                                   -- take one out of use (the file is kept)
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

const notFound = () => NextResponse.json({ error: "Site visit not found." }, { status: 404 });

async function load(assessmentId: string, mode: "read" | "write") {
  const gate = await requireContractAccess();
  if (!gate.ok) return { response: gate.response };
  if (!UUID.test(assessmentId)) return { response: notFound() };
  const a = await getAssessment(gate.admin, assessmentId);
  if (!canReadAssessment(gate.actor, a.createdBy, a.assessorId)) return { response: notFound() };
  const mayEdit = gate.canApprove || gate.actor.ops.edit || a.createdBy === gate.userId || a.assessorId === gate.userId;
  if (mode === "write" && !mayEdit) return { response: NextResponse.json({ error: "You cannot change this site visit." }, { status: 403 }) };
  return { gate, a, mayEdit };
}

async function ownPass(admin: SupabaseClient, assessmentId: string, documentId: string) {
  const { data } = await admin.from("amc_documents").select("id, level, entity_id, category, superseded_by").eq("id", documentId).maybeSingle();
  const row = data as { level?: string; entity_id?: string; category?: string; superseded_by?: string | null } | null;
  return Boolean(row && row.level === "site_visit" && String(row.entity_id) === assessmentId && row.category === "Gate pass" && !row.superseded_by);
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ assessmentId: string }> }) {
  const { assessmentId } = await ctx.params;
  try {
    const { gate, a, mayEdit, response } = await load(assessmentId, "read");
    if (!gate) return response;
    const day = a.scheduledAt ? a.scheduledAt.slice(0, 10) : (a.assessedOn ?? todayInDubai());
    const access = await siteVisitAccess(gate.admin, { id: a.id, propertyId: a.property?.id ?? null, day });
    return NextResponse.json({ ...access, day, propertyId: a.property?.id ?? null, canEdit: mayEdit }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the site visit's access");
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ assessmentId: string }> }) {
  const { assessmentId } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const { gate, a, response } = await load(assessmentId, "write");
    if (!gate) return response;
    if (!(await ownPass(gate.admin, assessmentId, parsed.data.documentId))) return NextResponse.json({ error: "That pass is not on this site visit." }, { status: 404 });
    const { error } = await gate.admin.from("amc_documents").update({ expires_on: parsed.data.validUntil, notes: parsed.data.note || null }).eq("id", parsed.data.documentId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await writePassType(gate.admin, parsed.data.documentId, { accessRuleId: parsed.data.accessRuleId, accessStatus: parsed.data.accessStatus }, a.property?.id ?? null);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return contractErrorResponse(error, "Could not save the pass");
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ assessmentId: string }> }) {
  const { assessmentId } = await ctx.params;
  const documentId = req.nextUrl.searchParams.get("documentId") ?? "";
  if (!UUID.test(documentId)) return NextResponse.json({ error: "Pass not found." }, { status: 404 });
  try {
    const { gate, response } = await load(assessmentId, "write");
    if (!gate) return response;
    if (!(await ownPass(gate.admin, assessmentId, documentId))) return NextResponse.json({ error: "That pass is not on this site visit." }, { status: 404 });
    /* Taken out of use, the file kept: marked as replaced by itself, so every list leaves it out. */
    const { error } = await gate.admin.from("amc_documents").update({ superseded_by: documentId }).eq("id", documentId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return contractErrorResponse(error, "Could not remove the pass");
  }
}
