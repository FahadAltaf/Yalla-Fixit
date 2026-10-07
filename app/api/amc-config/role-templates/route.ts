import { NextResponse } from "next/server";

import { AMC_ROLE_TEMPLATES, missingTemplateRows } from "@/lib/amc/role-templates";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * The AMC role templates (DEV-418, lib/amc/role-templates.ts).
 *
 * GET  AMC Configuration View: each template, whether its role exists, and
 *      how many of its permissions are missing.
 * POST admin only: create the missing roles and add the missing permission
 *      rows. Never removes or narrows anything.
 */

type Admin = Awaited<ReturnType<typeof createAdminServerClient>>;
type RoleRow = { id: string; name: string; role_access: Array<{ id: string; resource: string; action: string; enabled: boolean | null }> | null };

async function loadRoles(admin: Admin): Promise<RoleRow[]> {
  const { data, error } = await admin
    .from("roles")
    .select("id, name, role_access(id, resource, action, enabled)")
    .in("name", AMC_ROLE_TEMPLATES.map((t) => t.name));
  if (error) throw new Error(error.message);
  return (data ?? []) as RoleRow[];
}

function status(roles: RoleRow[]) {
  return AMC_ROLE_TEMPLATES.map((t) => {
    const role = roles.find((r) => r.name === t.name);
    return {
      key: t.key,
      name: t.name,
      description: t.description,
      grants: t.grants,
      exists: !!role,
      missing: missingTemplateRows(t, role?.role_access ?? []).length,
    };
  });
}

export async function GET() {
  const gate = await requireResourceAccess(ResourceType.AMC_CONFIG, ActionType.VIEW);
  if (!gate.ok) return gate.response;
  try {
    const admin = await createAdminServerClient();
    return NextResponse.json({ templates: status(await loadRoles(admin)) });
  } catch (error) {
    console.error("AMC role templates GET:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not load the AMC roles" }, { status: 500 });
  }
}

export async function POST() {
  const gate = await requireResourceAccess(null, null, { adminOnly: true });
  if (!gate.ok) return gate.response;
  try {
    const admin = await createAdminServerClient();
    const roles = await loadRoles(admin);
    const applied: Array<{ name: string; created: boolean; added: number }> = [];

    for (const template of AMC_ROLE_TEMPLATES) {
      let role = roles.find((r) => r.name === template.name);
      let created = false;
      if (!role) {
        const { data, error } = await admin
          .from("roles")
          .insert({ name: template.name, description: template.description })
          .select("id, name")
          .single<{ id: string; name: string }>();
        if (error) throw new Error(`${template.name}: ${error.message}`);
        role = { ...data, role_access: [] };
        created = true;
      }
      const existing = role.role_access ?? [];
      const missing = missingTemplateRows(template, existing);
      for (const row of missing) {
        /* A disabled row is switched back on; otherwise a new row is added. */
        const disabled = existing.find((e) => e.resource === row.resource && e.action === row.action && e.enabled === false);
        const { error } = disabled
          ? await admin.from("role_access").update({ enabled: true }).eq("id", disabled.id)
          : await admin.from("role_access").insert({ role_id: role.id, resource: row.resource, action: row.action, enabled: true });
        if (error) throw new Error(`${template.name} ${row.resource}:${row.action}: ${error.message}`);
      }
      applied.push({ name: template.name, created, added: missing.length });
    }

    const { profile } = gate.access;
    await recordAmcAudit(admin, {
      entityType: "config",
      eventType: "role_templates_applied",
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email ?? null,
      payload: { applied },
    });
    return NextResponse.json({ applied, templates: status(await loadRoles(admin)) });
  } catch (error) {
    console.error("AMC role templates POST:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not set up the AMC roles" }, { status: 500 });
  }
}
