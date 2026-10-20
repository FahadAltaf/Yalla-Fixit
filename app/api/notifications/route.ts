import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { listMyNotifications, markNotificationsRead } from "@/lib/server/notifications/inbox";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/**
 * The caller's own in-app notifications (BRD §6.2), newest first, and
 * marking them read. ?limit=&offset= page the inbox; ?unread=1 lists only
 * what is still unopened (the home panel).
 *
 * Any signed-in, active user: everyone has an inbox, and the user id comes
 * from the session, so nobody can read or mark another person's.
 */
export async function GET(req: NextRequest) {
  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;

  const params = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(params.get("limit")) || 30, 1), 100);
  const offset = Math.min(Math.max(Number(params.get("offset")) || 0, 0), 10_000);
  try {
    const admin = await createAdminServerClient();
    const page = await listMyNotifications(admin, gate.access.profile.id, {
      limit,
      offset,
      unreadOnly: params.get("unread") === "1",
    });
    return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Notifications GET error:", error);
    return NextResponse.json({ error: "Could not load notifications" }, { status: 500 });
  }
}

const readSchema = z.union([
  z.object({ all: z.literal(true) }).strict(),
  z.object({ ids: z.array(z.uuid()).min(1).max(200) }).strict(),
]);

export async function POST(req: NextRequest) {
  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;

  const parsed = readSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const admin = await createAdminServerClient();
    await markNotificationsRead(admin, gate.access.profile.id, "all" in parsed.data ? "all" : parsed.data.ids);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Notifications POST error:", error);
    return NextResponse.json({ error: "Could not update notifications" }, { status: 500 });
  }
}
