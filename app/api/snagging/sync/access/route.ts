import { NextRequest, NextResponse } from "next/server";

import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { ActionType, ResourceType } from "@/types/types";

/**
 * GET /api/snagging/sync/access -- may this account use the inspector app?
 *
 * The app signs in against Supabase Auth, which knows a password is right
 * and nothing about what the account may do. So anybody with a company
 * login could sign in to the app and land on an empty job list, with every
 * sync quietly refused. The app asks here straight after the password is
 * accepted, and signs a refused account back out with a reason.
 *
 *   200  access: the profile is active and its role may use the app.
 *   401  no usable profile: unknown, or deactivated.
 *   403  a real account, but not one allowed on the app.
 */
export async function GET(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    /*
      Using the app is its own permission.

      This asked for Snagging View, which is the portal's permission --
      so every office account that could read a job in the browser could
      also sign in on a phone, and every inspector who needed the phone
      had to be given the portal. They are different jobs. Mobile app
      grants the phone and nothing else.

      Snagging View is deliberately NOT accepted as a fallback. Taking
      Mobile app away from a role deletes its row, and a fallback would
      read that as "no answer" and let the phone through on the portal's
      permission instead -- so revoking would do nothing. The backfill
      grants Mobile app to every role that can open Snagging today, and
      must run before this deploys.
    */
    if (!hasResourceAction(accessUser, ResourceType.MOBILE_APP, ActionType.VIEW)) {
      return NextResponse.json(
        { error: "This account is not set up to use the inspector app." },
        { status: 403 },
      );
    }
    return NextResponse.json({
      data: {
        id: profile.id,
        full_name: profile.full_name ?? null,
        role: accessUser.roles?.name ?? null,
      },
    });
  } catch (error) {
    console.error("[sync/access]", error);
    return NextResponse.json({ error: "Could not check access" }, { status: 500 });
  }
}
