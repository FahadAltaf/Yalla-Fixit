import { NextRequest, NextResponse } from "next/server";

import { buildHomeSummary } from "@/lib/server/home/summary";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/**
 * The home dashboard's figures for the signed-in user (26 Nov 2026): what is
 * waiting for their decision, what is theirs to do, the modules they can
 * open, and the portal's health for administrators. Every signed-in user may
 * ask; each figure is read only when they hold the permission its page asks.
 */
export async function GET(req: NextRequest) {
  const { profile, accessUser } = await getRequestUserAccess(req);
  if (!profile || !accessUser || profile.is_active === false) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const admin = await createAdminServerClient();
    const summary = await buildHomeSummary(admin, { id: profile.id, email: profile.email ?? null }, accessUser);
    return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[home] summary failed:", error);
    return NextResponse.json({ error: "Could not load your dashboard" }, { status: 500 });
  }
}
