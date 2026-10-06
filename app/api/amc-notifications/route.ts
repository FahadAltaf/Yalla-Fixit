import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { listMyNotifications, markNotificationsRead } from "@/lib/server/amc/notifications";

/** The caller's own AMC notifications (in-app), newest first, and marking them read. */
export async function GET() {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  try {
    return NextResponse.json(await listMyNotifications(gate.admin, gate.userId), { headers: { "Cache-Control": "no-store" } });
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
