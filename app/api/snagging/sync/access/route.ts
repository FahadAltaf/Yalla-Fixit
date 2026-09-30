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
 *   200  access: the profile is active and its role can open Snagging.
 *   401  no usable profile: unknown, or deactivated.
 *   403  a real account, but without access to Snagging.
 */
export async function GET(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json(
        { error: "This account does not have access to Snagging." },
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
