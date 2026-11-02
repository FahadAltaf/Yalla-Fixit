import { NextRequest, NextResponse } from "next/server";

import {
  UUID,
  adminErrorResponse,
  createRole,
  deleteRole,
  listRoles,
  listRolesWithAccess,
  roleSchema,
  updateRole,
} from "@/lib/server/admin/users-roles";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Roles, for the browser. Listing them is open to every signed-in user
 * (role pickers); the permission matrix needs Permissions: View; creating,
 * renaming and deleting need Roles: Create / Edit / Delete. The admin role
 * cannot be renamed or deleted.
 */

const json = (status: number, body: unknown) => NextResponse.json(body, { status });

export async function GET(req: NextRequest) {
  const withAccess = req.nextUrl.searchParams.get("op") === "withAccess";
  const gate = withAccess
    ? await requireResourceAccess(ResourceType.PERMISSIONS, ActionType.VIEW)
    : await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;
  try {
    const admin = await createAdminServerClient();
    return json(200, { roles: withAccess ? await listRolesWithAccess(admin) : await listRoles(admin) });
  } catch (error) {
    const r = adminErrorResponse(error);
    return json(r.status, r.body);
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireResourceAccess(ResourceType.ROLES, ActionType.CREATE);
  if (!gate.ok) return gate.response;
  const parsed = roleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, { error: parsed.error.issues[0]?.message ?? "Invalid request" });
  try {
    const admin = await createAdminServerClient();
    return json(200, { role: await createRole(admin, parsed.data) });
  } catch (error) {
    const r = adminErrorResponse(error);
    return json(r.status, r.body);
  }
}

export async function PATCH(req: NextRequest) {
  const gate = await requireResourceAccess(ResourceType.ROLES, ActionType.EDIT);
  if (!gate.ok) return gate.response;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!UUID.test(id)) return json(400, { error: "Invalid id" });
  const parsed = roleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, { error: parsed.error.issues[0]?.message ?? "Invalid request" });
  try {
    const admin = await createAdminServerClient();
    return json(200, { role: await updateRole(admin, id, parsed.data) });
  } catch (error) {
    const r = adminErrorResponse(error);
    return json(r.status, r.body);
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await requireResourceAccess(ResourceType.ROLES, ActionType.DELETE);
  if (!gate.ok) return gate.response;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!UUID.test(id)) return json(400, { error: "Invalid id" });
  try {
    const admin = await createAdminServerClient();
    await deleteRole(admin, id);
    return json(200, { success: true });
  } catch (error) {
    const r = adminErrorResponse(error);
    return json(r.status, r.body);
  }
}
