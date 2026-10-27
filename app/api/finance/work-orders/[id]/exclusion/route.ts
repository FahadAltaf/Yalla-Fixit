import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { EVIDENCE_MAX_FILES, workOrderEvidencePrefix } from "@/lib/finance/evidence";
import { notifyExclusionRequested, resolveAgedNotices } from "@/lib/server/finance/queue-notifications";
import { actorOf, workOrderAbilities } from "@/lib/server/finance/route-helpers";
import { decideWorkOrderExclusion, InvoicingError, requestWorkOrderExclusion } from "@/lib/server/finance/work-orders";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/**
 * Finance or Operations marks a work order not to be invoiced (BRD 5.1
 * Step 5; TC05; both teams since 27 Oct), with a reason and evidence files
 * uploaded through ./evidence.
 *
 * Asked by Finance, it waits to be verified (N3 goes to whoever may verify;
 * it shows on Queries and the work order). Asked by Operations, it is
 * verified there and then (27 Oct): the work order is Excluded at once.
 *
 * Body: { reason, notes?, evidence?: string[], as?: "finance" | "operations" }
 * (the team the page acts as; someone in one team only is that team).
 */
const ID = /^[0-9A-Za-z_-]{1,40}$/;
const bodySchema = z
  .object({
    reason: z.string().trim().min(1).max(200),
    notes: z.string().trim().max(2000).nullish(),
    evidence: z.array(z.string().trim().min(1).max(500)).max(EVIDENCE_MAX_FILES).optional(),
    as: z.enum(["finance", "operations"]).optional(),
  })
  .strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;
  const can = workOrderAbilities(gate.access.accessUser);
  if (!can.exclude) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A reason is required" }, { status: 400 });
  /* Which team asks: the one the page acts as, if the person is in it; else their only team (Finance when both). */
  const finance = can.query;
  const operations = can.progress;
  const team = parsed.data.as === "operations" && operations ? "operations" : parsed.data.as === "finance" && finance ? "finance" : finance ? "finance" : "operations";
  if (parsed.data.evidence?.some((path) => !path.startsWith(workOrderEvidencePrefix(id)) || path.includes(".."))) {
    return NextResponse.json({ error: "Evidence must be uploaded to this work order" }, { status: 400 });
  }

  try {
    const admin = await createAdminServerClient();
    const actor = actorOf(gate.access.profile);
    const { reason, notes, evidence } = parsed.data;
    const result = await requestWorkOrderExclusion(admin, id, { reason, notes, evidence }, actor);
    if (team === "operations") {
      /* Operations' word is enough: verified at once, nothing waits on anyone. */
      await decideWorkOrderExclusion(admin, result.exclusionId, { decision: "verified", note: "Marked not invoiceable by Operations: verified on request." }, actor);
      after(() => resolveAgedNotices(admin, id).catch((error) => console.error("Exclusion notices:", error)));
      return NextResponse.json({ exclusionId: result.exclusionId, verified: true });
    }
    /* N3 to whoever may verify, after the answer is sent (27 Oct). */
    after(() =>
      notifyExclusionRequested(admin, {
        exclusionId: result.exclusionId,
        itemId: id,
        workOrderNumber: result.workOrderNumber ?? "a work order",
        value: result.value,
        reason: parsed.data.reason,
        coordinator: actor.label,
      }).catch((error) => console.error("Exclusion notices:", error)),
    );
    return NextResponse.json({ exclusionId: result.exclusionId, verified: false });
  } catch (error) {
    if (error instanceof InvoicingError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Ready to invoice exclusion error:", error);
    return NextResponse.json({ error: "Something went wrong. Nothing was changed." }, { status: 500 });
  }
}
