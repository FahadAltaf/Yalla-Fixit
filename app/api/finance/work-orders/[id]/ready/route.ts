import { NextRequest, NextResponse } from "next/server";

import { hasResourceAction } from "@/lib/role-permissions";
import { actorOf } from "@/lib/server/finance/route-helpers";
import { InvoicingError, readyRequestSchema, setLinesReady } from "@/lib/server/finance/work-orders";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Mark a work order's lines Ready to invoice, or take the mark off: the
 * lines given, or every current line when none are. Stored in the portal
 * only (FSM is never written). Finance (queue Edit) or a coordinator
 * (Not-invoiceable Create) may do it.
 *
 * Body: { lines?: string[], ready: boolean, note? }
 */
const ID = /^[0-9A-Za-z_-]{1,40}$/;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;
  const user = gate.access.accessUser;
  if (
    !hasResourceAction(user, ResourceType.FINANCE_QUEUE, ActionType.EDIT) &&
    !hasResourceAction(user, ResourceType.FINANCE_EXCLUSIONS, ActionType.CREATE)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = readyRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    const admin = await createAdminServerClient();
    const changed = await setLinesReady(admin, id, parsed.data, actorOf(gate.access.profile));
    return NextResponse.json({ changed });
  } catch (error) {
    if (error instanceof InvoicingError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Finance ready error:", error);
    return NextResponse.json({ error: "Something went wrong. Nothing was changed." }, { status: 500 });
  }
}
