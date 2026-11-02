import { after, NextRequest, NextResponse } from "next/server";

import { notifyQueryReply } from "@/lib/server/finance/queue-notifications";
import { readQueryThread, replyQuerySchema, replyQueryThread, sideOf, threadParticipants } from "@/lib/server/finance/queries";
import { actorOf, querySides, UUID_PATTERN } from "@/lib/server/finance/route-helpers";
import { InvoicingError } from "@/lib/server/finance/work-orders";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/**
 * Reply on a query (2 Nov): { action, body?, taggedUserId?, as? }.
 *   comment  a reply; the other side's turn.
 *   closed   ends the conversation: either side.
 * Answers { status }.
 */

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;
  const parsed = replyQuerySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid reply" }, { status: 400 });
  const side = sideOf(querySides(gate.access.accessUser), parsed.data.as);
  if (!side) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const admin = await createAdminServerClient();
    const thread = await readQueryThread(admin, id);
    if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const actor = actorOf(gate.access.profile);
    const result = await replyQueryThread(admin, thread, parsed.data, side, actor);
    after(async () => {
      const participants = await threadParticipants(admin, id).catch(() => []);
      await notifyQueryReply(admin, {
        threadId: id,
        workOrderId: thread.workOrderId,
        workOrderNumber: thread.number,
        kind: thread.kind,
        side,
        author: actor,
        body: parsed.data.body?.trim() || null,
        taggedUserId: result.tagged?.id ?? null,
        action: parsed.data.action,
        resolved: result.status === "resolved",
        participants,
        replyCount: participants.length,
      });
    });
    return NextResponse.json({ status: result.status });
  } catch (error) {
    if (error instanceof InvoicingError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Query reply error:", error);
    return NextResponse.json({ error: "Something went wrong. Nothing was changed." }, { status: 500 });
  }
}
