import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { listMyNotifications, markNotificationsRead } from "@/lib/server/amc/notifications";

/**
 * The caller's own AMC notifications (in-app), newest first, and marking
 * them read. ?limit=&offset= page the inbox; ?unread=1 lists only what is
 * still unopened (the home page, BRD 6.2).
 */
export async function GET(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const params = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(params.get("limit")) || 30, 1), 100);
  const offset = Math.max(Number(params.get("offset")) || 0, 0);
  try {
    return NextResponse.json(
      await listMyNotifications(gate.admin, gate.userId, limit, { offset, unreadOnly: params.get("unread") === "1" }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return contractErrorResponse(error, "Could not load notifications");
  }
}

const readSchema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }),
]);

export async function POST(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const parsed = readSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    await markNotificationsRead(gate.admin, gate.userId, "all" in parsed.data ? "all" : parsed.data.ids);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return contractErrorResponse(error, "Could not update notifications");
  }
}
