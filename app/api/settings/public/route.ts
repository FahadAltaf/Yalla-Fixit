import { NextRequest, NextResponse } from "next/server";

import { SETTINGS_PUBLIC_COLUMNS } from "@/modules/settings/services/setting-graphql";

/**
 * The portal's public site settings (name, logo, colours), read on every
 * page load by the auth provider, signed in or not.
 *
 * 27 Nov 2026: this went through pg_graphql with the anon key, and a cold
 * pg_graphql schema build (about 2.5 s) ran into the anon statement
 * timeout ("canceling statement due to statement timeout", 2 of 8 page
 * loads on live). The same row over PostgREST takes a single round trip.
 * Only the columns migration 20261005160000 grants to anon are read.
 */
export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type") ?? "admin";
  if (!/^[a-z_]{1,40}$/.test(type)) return NextResponse.json({ error: "Unknown settings type" }, { status: 400 });
  try {
    const res = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/settings?select=${SETTINGS_PUBLIC_COLUMNS.join(",")}&type=eq.${type}&limit=1`,
      {
        headers: { apikey: process.env.SUPABASE_ANON_KEY! },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error(`[settings:public] upstream ${res.status}:`, body?.message ?? body?.error ?? "");
      return NextResponse.json({ error: "Could not read the settings" }, { status: 502 });
    }
    const rows = (await res.json()) as unknown[];
    return NextResponse.json(
      { settings: rows[0] ?? null },
      /* Shared by every visitor and changed rarely: a short edge cache keeps page loads off the database. */
      { headers: { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600" } },
    );
  } catch (error) {
    console.error("[settings:public]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not read the settings" }, { status: 502 });
  }
}
