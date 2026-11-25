import { NextResponse } from "next/server";

import { requireResourceAccess } from "@/lib/server/require-access";
import { createServerClientForApi } from "@/lib/supabase/supabase-server-client";

/**
 * What the browser needs to hear about new notifications live (23 Nov 2026,
 * Supabase Realtime): the project address, the public key and the caller's
 * own session token. Realtime then sends only rows the policy lets that
 * person read: their own in-app notifications (migration 20261123110000).
 *
 * The public key is the one the YFI app already ships, so handing it to a
 * signed-in user publishes nothing new; the token is the caller's own (it is
 * in their cookie already). Asked again before the token expires.
 */
export async function GET() {
  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ error: "Live notifications are off" }, { status: 503 });

  try {
    const supabase = await createServerClientForApi();
    /* Refreshed here when it has expired; the user was checked just above. */
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session?.access_token || session.user?.id !== gate.access.authUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { url, key, token: session.access_token, expiresAt: session.expires_at ?? null, userId: gate.access.profile.id },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Live notifications GET error:", error);
    return NextResponse.json({ error: "Could not start live notifications" }, { status: 500 });
  }
}
