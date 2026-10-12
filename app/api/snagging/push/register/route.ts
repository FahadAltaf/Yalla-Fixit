import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Where to reach this inspector when the app is closed.
 *
 * The app sends its Expo push token here after signing in, and again
 * whenever the token changes (a reinstall, a restore to a new phone).
 * DELETE removes it on sign-out, so a shared site phone stops buzzing
 * for whoever used it last.
 *
 * Gated on Mobile app, like the rest of the app's endpoints: this is the
 * phone's business, not the portal's.
 */

const registerSchema = z.object({
  token: z.string().min(1).max(255),
  platform: z.enum(["ios", "android"]),
});

export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.MOBILE_APP, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = registerSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    }

    const admin = await createAdminServerClient();
    /*
      Keyed on the token, not on the inspector.

      A device handed from one inspector to another keeps its token, and
      the row has to move with it or the new holder's phone would ring
      for the old holder's jobs. Upserting on the token does that in one
      statement; upserting on the user would instead accumulate a row per
      device and never release an old one.
    */
    const { error } = await admin
      .from("snagging_push_tokens")
      .upsert(
        {
          token: parsed.data.token,
          platform: parsed.data.platform,
          user_id: profile.id,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "token" },
      );
    if (error) throw new Error(error.message);

    return NextResponse.json({ data: { registered: true } });
  } catch (error) {
    console.error("[snagging/push/register]", error);
    return NextResponse.json({ error: "Could not register for alerts" }, { status: 500 });
  }
}

/** Sign-out: this device stops receiving the alerts of whoever just left. */
export async function DELETE(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = req.nextUrl.searchParams.get("token");
    if (!token) {
      return NextResponse.json({ error: "No token given" }, { status: 400 });
    }

    const admin = await createAdminServerClient();
    /*
      Scoped to the signed-in inspector as well as the token, so a leaked
      token cannot be used to silence somebody else's phone.
    */
    const { error } = await admin
      .from("snagging_push_tokens")
      .delete()
      .eq("token", token)
      .eq("user_id", profile.id);
    if (error) throw new Error(error.message);

    return NextResponse.json({ data: { removed: true } });
  } catch (error) {
    console.error("[snagging/push/register] delete", error);
    return NextResponse.json({ error: "Could not sign out of alerts" }, { status: 500 });
  }
}
