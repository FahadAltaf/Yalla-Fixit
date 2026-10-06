import { NextRequest, NextResponse } from "next/server";

import { hasResourceAction, isAdminUser } from "@/lib/role-permissions";
import {
  UUID,
  adminErrorResponse,
  callerFrom,
  createUserProfile,
  createUserSchema,
  deleteUserProfile,
  getUser,
  listAllUsers,
  listUsersPage,
  updateUserProfile,
  updateUserSchema,
} from "@/lib/server/admin/users-roles";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/**
 * Portal users (user_profile), for the browser. Replaces pg_graphql with
 * the anon key, which let anyone read and rewrite every profile.
 *
 * GET ?op=all            every colleague (directory fields; full rows for user managers)
 * GET ?op=page&…         the Users screen (Users: View)
 * GET ?op=byId&id=       one user (yourself, or Users: View)
 * POST                   add a profile (Users: Create)
 * PATCH                  edit (your own name/photo; anything else Users: Edit)
 * DELETE ?id=            remove (Users: Delete; never yourself)
 */

const json = (status: number, body: unknown) => NextResponse.json(body, { status });

async function signedIn() {
  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate;
  const { accessUser, profile } = gate.access;
  const caller = callerFrom(accessUser, profile.id, isAdminUser(accessUser), (r, a) => hasResourceAction(accessUser, r, a));
  return { ok: true as const, caller };
}

export async function GET(req: NextRequest) {
  const gate = await signedIn();
  if (!gate.ok) return gate.response;
  const params = req.nextUrl.searchParams;
  try {
    const admin = await createAdminServerClient();
    switch (params.get("op")) {
      case "all":
        return json(200, { users: await listAllUsers(admin, gate.caller.canView) });
      case "page":
        if (!gate.caller.canView) return json(403, { error: "Forbidden" });
        return json(
          200,
          await listUsersPage(admin, {
            search: params.get("search") ?? "",
            limit: Number(params.get("limit") ?? 10),
            page: Number(params.get("page") ?? 0),
            sortBy: params.get("sortBy"),
            sortOrder: params.get("sortOrder"),
          }),
        );
      case "byId": {
        const id = params.get("id") ?? "";
        if (!UUID.test(id)) return json(400, { error: "Invalid id" });
        if (id !== gate.caller.id && !gate.caller.canView) return json(404, { error: "Not found" });
        const user = await getUser(admin, id);
        return user ? json(200, { user }) : json(404, { error: "Not found" });
      }
      default:
        return json(400, { error: "Invalid operation" });
    }
  } catch (error) {
    const r = adminErrorResponse(error);
    return json(r.status, r.body);
  }
}

export async function POST(req: NextRequest) {
  const gate = await signedIn();
  if (!gate.ok) return gate.response;
  const parsed = createUserSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, { error: parsed.error.issues[0]?.message ?? "Invalid request" });
  try {
    const admin = await createAdminServerClient();
    return json(200, { user: await createUserProfile(admin, gate.caller, parsed.data) });
  } catch (error) {
    const r = adminErrorResponse(error);
    return json(r.status, r.body);
  }
}

export async function PATCH(req: NextRequest) {
  const gate = await signedIn();
  if (!gate.ok) return gate.response;
  const parsed = updateUserSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, { error: parsed.error.issues[0]?.message ?? "Invalid request" });
  try {
    const admin = await createAdminServerClient();
    return json(200, { user: await updateUserProfile(admin, gate.caller, parsed.data) });
  } catch (error) {
    const r = adminErrorResponse(error);
    return json(r.status, r.body);
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await signedIn();
  if (!gate.ok) return gate.response;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!UUID.test(id)) return json(400, { error: "Invalid id" });
  try {
    const admin = await createAdminServerClient();
    await deleteUserProfile(admin, gate.caller, id);
    return json(200, { success: true });
  } catch (error) {
    const r = adminErrorResponse(error);
    return json(r.status, r.body);
  }
}
