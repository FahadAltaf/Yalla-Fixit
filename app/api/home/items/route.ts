import { NextRequest, NextResponse } from "next/server";

import { homeDrill } from "@/lib/server/home/drill";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/**
 * The records behind one figure on the home dashboard, a page at a time
 * (26 Nov 2026): ?key=<figure>[:<chart bar>]&page=0&pageSize=10&q=. Allowed by
 * the same permission as the figure; an unknown key or one this person may
 * not open answers 404, never an empty list that looks like "nothing".
 */
export async function GET(req: NextRequest) {
  const { profile, accessUser } = await getRequestUserAccess(req);
  if (!profile || !accessUser || profile.is_active === false) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const params = req.nextUrl.searchParams;
  const key = (params.get("key") ?? "").trim();
  if (!/^[a-z0-9-]+(:[a-z0-9_-]+)?$/i.test(key)) return NextResponse.json({ error: "Which list?" }, { status: 400 });
  try {
    const page = await homeDrill(await createAdminServerClient(), { id: profile.id, email: profile.email ?? null }, accessUser, key, {
      page: Number(params.get("page")) || 0,
      pageSize: Number(params.get("pageSize")) || 10,
      q: params.get("q"),
    });
    if (!page) return NextResponse.json({ error: "That list is not available to you." }, { status: 404 });
    return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(`[home] list ${key} failed:`, error);
    return NextResponse.json({ error: "Could not load the list" }, { status: 500 });
  }
}
