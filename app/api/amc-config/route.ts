import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  AMC_CONFIG_DEFAULTS,
  AMC_CONFIG_SECTION_LEVEL,
  AMC_CONFIG_SECTIONS,
  isAmcConfigSection,
  validateAmcConfigSection,
  type AmcConfigSection,
} from "@/lib/amc/config";
import { hasResourceAction } from "@/lib/role-permissions";
import { AmcConfigError, listAmcConfigHistory, readAmcConfigResolved, writeAmcConfigSection } from "@/lib/server/amc/config";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * AMC configuration (DEV-357, DEV-419).
 *
 * GET  AMC Configuration View: the configuration, defaults, which sections
 *      the caller may edit, the people who can be named as approvers, and
 *      the change history.
 * PUT  { section, value }: approval thresholds and payment value bands need
 *      AMC Configuration Approve (management, BRD 6.7); every other section
 *      needs AMC Configuration Edit. Admins inherit both.
 */

type AccessUser = Parameters<typeof hasResourceAction>[0];

function editableSections(user: AccessUser): Record<AmcConfigSection, boolean> {
  const canEdit = hasResourceAction(user, ResourceType.AMC_CONFIG, ActionType.EDIT);
  const canApprove = hasResourceAction(user, ResourceType.AMC_CONFIG, ActionType.APPROVE);
  return Object.fromEntries(
    AMC_CONFIG_SECTIONS.map((s) => [s, AMC_CONFIG_SECTION_LEVEL[s] === "management" ? canApprove : canEdit]),
  ) as Record<AmcConfigSection, boolean>;
}

type UserRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  is_active: boolean | null;
  roles: { name?: string | null } | Array<{ name?: string | null }> | null;
};

/** Active portal users, for naming approvers per level. */
async function listActiveUsers(admin: Awaited<ReturnType<typeof createAdminServerClient>>) {
  const { data, error } = await admin
    .from("user_profile")
    .select("id, email, full_name, is_active, roles(name)")
    .order("full_name", { ascending: true })
    .limit(2000);
  if (error) return [];
  return ((data ?? []) as UserRow[])
    .filter((u) => u.is_active !== false)
    .map((u) => {
      const role = Array.isArray(u.roles) ? u.roles[0] : u.roles;
      return { id: u.id, name: u.full_name?.trim() || u.email || "User", email: u.email, role: role?.name ?? null };
    });
}

export async function GET() {
  const gate = await requireResourceAccess(ResourceType.AMC_CONFIG, ActionType.VIEW);
  if (!gate.ok) return gate.response;
  try {
    const admin = await createAdminServerClient();
    const [resolved, history, users] = await Promise.all([
      readAmcConfigResolved(admin),
      listAmcConfigHistory(admin),
      listActiveUsers(admin),
    ]);
    return NextResponse.json(
      {
        ...resolved,
        defaults: AMC_CONFIG_DEFAULTS,
        canEdit: editableSections(gate.access.accessUser),
        history,
        users,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("AMC config GET:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not load AMC configuration" }, { status: 500 });
  }
}

const putSchema = z.object({ section: z.string(), value: z.unknown() });

export async function PUT(req: NextRequest) {
  const gate = await requireResourceAccess(ResourceType.AMC_CONFIG, ActionType.VIEW);
  if (!gate.ok) return gate.response;
  const body = putSchema.safeParse(await req.json().catch(() => null));
  if (!body.success || !isAmcConfigSection(body.data.section)) {
    return NextResponse.json({ error: "Unknown configuration section" }, { status: 400 });
  }
  const section = body.data.section;
  if (!editableSections(gate.access.accessUser)[section]) {
    return NextResponse.json(
      {
        error:
          AMC_CONFIG_SECTION_LEVEL[section] === "management"
            ? "Only management (AMC Configuration: Approve) sets approval thresholds and payment value bands."
            : "You need AMC Configuration: Edit to change this.",
      },
      { status: 403 },
    );
  }
  const valid = validateAmcConfigSection(section, body.data.value);
  if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 });

  try {
    const admin = await createAdminServerClient();
    const { profile } = gate.access;
    const { changes } = await writeAmcConfigSection(admin, section, valid.value as never, {
      id: profile.id,
      label: profile.full_name ?? profile.email ?? null,
    });
    return NextResponse.json({ ok: true, changed: changes.length });
  } catch (error) {
    if (error instanceof AmcConfigError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("AMC config PUT:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not save AMC configuration" }, { status: 500 });
  }
}
