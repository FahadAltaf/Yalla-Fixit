import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { hasResourceAction } from "@/lib/role-permissions";
import { UUID, adminErrorResponse, roleAccessSchema } from "@/lib/server/admin/users-roles";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * A role's permission rows (role_access).
 *
 * These rows decide what every user may do, so each method needs the
 * Permissions right that matches it (admins always have it). The route
 * used to write them with the service role for anyone who called it,
 * signed in or not: one request granted any role any permission.
 */

const json = (status: number, body: unknown) => NextResponse.json(body, { status });

export async function GET(req: NextRequest) {
  const gate = await requireResourceAccess(ResourceType.PERMISSIONS, ActionType.VIEW);
  if (!gate.ok) return gate.response;
  const params = req.nextUrl.searchParams;
  if (params.get("operation") !== "getByRole") return json(400, { error: "Invalid operation" });
  const roleId = params.get("roleId") ?? "";
  if (!UUID.test(roleId)) return json(400, { error: "Role ID is required" });
  try {
    const admin = await createAdminServerClient();
    const { data, error } = await admin
      .from("role_access")
      .select("id, role_id, resource, action, enabled, record_access")
      .eq("role_id", roleId);
    if (error) throw error;
    return json(200, { data: data ?? [] });
  } catch (error) {
    const r = adminErrorResponse(error);
    return json(r.status, r.body);
  }
}

const postSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("create"), data: roleAccessSchema }),
  z.object({ operation: z.literal("bulkCreate"), data: z.array(roleAccessSchema).min(1).max(500) }),
]);

export async function POST(req: NextRequest) {
  const gate = await requireResourceAccess(ResourceType.PERMISSIONS, ActionType.CREATE);
  if (!gate.ok) return gate.response;
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, { error: parsed.error.issues[0]?.message ?? "Invalid request" });
  try {
    const admin = await createAdminServerClient();
    const rows = Array.isArray(parsed.data.data) ? parsed.data.data : [parsed.data.data];
    const { data, error } = await admin.from("role_access").insert(rows).select();
    if (error) throw error;
    return json(200, { data: parsed.data.operation === "create" ? data?.[0] : data });
  } catch (error) {
    const r = adminErrorResponse(error);
    return json(r.status, r.body);
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await requireResourceAccess(ResourceType.PERMISSIONS, ActionType.DELETE);
  if (!gate.ok) return gate.response;
  /* Editing a role's permissions replaces its rows: the editor needs both. */
  if (!hasResourceAction(gate.access.accessUser, ResourceType.PERMISSIONS, ActionType.EDIT)) {
    return json(403, { error: "Forbidden" });
  }
  const params = req.nextUrl.searchParams;
  const id = params.get("id");
  const roleId = params.get("roleId");
  if (!(id && UUID.test(id)) && !(roleId && UUID.test(roleId))) return json(400, { error: "ID is required" });
  try {
    const admin = await createAdminServerClient();
    const q = admin.from("role_access").delete();
    const { error } = roleId ? await q.eq("role_id", roleId) : await q.eq("id", id!);
    if (error) throw error;
    return json(200, { success: true });
  } catch (error) {
    const r = adminErrorResponse(error);
    return json(r.status, r.body);
  }
}
