import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { EVIDENCE_MAX_FILES, workOrderEvidencePrefix } from "@/lib/finance/evidence";
import { sideOf } from "@/lib/server/finance/queries";
import { notifyWorkOrderChange, resolveAgedNotices } from "@/lib/server/finance/queue-notifications";
import { actorOf, querySides, workOrderAbilities } from "@/lib/server/finance/route-helpers";
import { InvoicingError, markInvoiceable, markNotInvoiceable } from "@/lib/server/finance/work-orders";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/**
 * Not invoiceable, from either side (BRD 5.1 Step 5; TC05; 2 Nov).
 *
 *   POST    Finance or Operations marks the work order not invoiceable at
 *           once, with a reason and evidence files uploaded through
 *           ./evidence. Body: { reason, notes?, evidence?: string[], as? }
 *   DELETE  Either side marks it invoiceable again. Body: { note?, as? }
 *
 * The other side is told who did it, each time. No verification step.
 */
const ID = /^[0-9A-Za-z_-]{1,40}$/;
const markSchema = z
  .object({
    reason: z.string().trim().min(1).max(200),
    notes: z.string().trim().max(2000).nullish(),
    evidence: z.array(z.string().trim().min(1).max(500)).max(EVIDENCE_MAX_FILES).optional(),
    as: z.enum(["finance", "operations"]).optional(),
  })
  .strict();
const unmarkSchema = z
  .object({
    note: z.string().trim().max(2000).nullish(),
    as: z.enum(["finance", "operations"]).optional(),
  })
  .strict();

async function gateFor(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) } as const;
  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return { response: gate.response } as const;
  if (!workOrderAbilities(gate.access.accessUser).exclude) return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  return { id, gate, sides: querySides(gate.access.accessUser) } as const;
}

function failed(error: unknown) {
  if (error instanceof InvoicingError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Ready to invoice not-invoiceable error:", error);
  return NextResponse.json({ error: "Something went wrong. Nothing was changed." }, { status: 500 });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await gateFor(req, ctx);
  if ("response" in g) return g.response;
  const parsed = markSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A reason is required" }, { status: 400 });
  if (parsed.data.evidence?.some((path) => !path.startsWith(workOrderEvidencePrefix(g.id)) || path.includes(".."))) {
    return NextResponse.json({ error: "Evidence must be uploaded to this work order" }, { status: 400 });
  }
  const side = sideOf(g.sides, parsed.data.as);
  if (!side) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const admin = await createAdminServerClient();
    const actor = actorOf(g.gate.access.profile);
    const { reason, notes, evidence } = parsed.data;
    const result = await markNotInvoiceable(admin, g.id, { reason, notes, evidence }, side, actor);
    after(async () => {
      await resolveAgedNotices(admin, g.id).catch((error) => console.error("Exclusion notices:", error));
      await notifyWorkOrderChange(admin, { workOrderId: g.id, workOrderNumber: result.workOrderNumber, change: "not_invoiceable", side, author: actor, reason });
    });
    return NextResponse.json({ exclusionId: result.exclusionId });
  } catch (error) {
    return failed(error);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await gateFor(req, ctx);
  if ("response" in g) return g.response;
  const parsed = unmarkSchema.safeParse((await req.json().catch(() => null)) ?? {});
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const side = sideOf(g.sides, parsed.data.as);
  if (!side) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const admin = await createAdminServerClient();
    const actor = actorOf(g.gate.access.profile);
    const note = parsed.data.note?.trim() || null;
    const result = await markInvoiceable(admin, g.id, { note }, side, actor);
    after(() =>
      notifyWorkOrderChange(admin, { workOrderId: g.id, workOrderNumber: result.workOrderNumber, change: "invoiceable", side, author: actor, reason: note }),
    );
    return NextResponse.json({ status: result.status });
  } catch (error) {
    return failed(error);
  }
}
