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
import { amcPeople } from "@/lib/server/amc/people";
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

/** Every user id already named somewhere in the configuration: kept in the list, so a save never drops them. */
function namedIds(config: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  for (const section of Object.values(config)) {
    if (!section || typeof section !== "object") continue;
    for (const [key, value] of Object.entries(section as Record<string, unknown>)) {
      if (/(Ids|UserIds)$/.test(key) && Array.isArray(value)) for (const id of value) if (typeof id === "string") ids.add(id);
    }
  }
  return ids;
}

export async function GET() {
  const gate = await requireResourceAccess(ResourceType.AMC_CONFIG, ActionType.VIEW);
  if (!gate.ok) return gate.response;
  try {
    const admin = await createAdminServerClient();
    const [resolved, history] = await Promise.all([readAmcConfigResolved(admin), listAmcConfigHistory(admin)]);
    /* Admins and people with AMC access, each with what they may be named for (23 Nov 2026). */
    const users = await amcPeople(admin, namedIds(resolved.config as unknown as Record<string, unknown>));
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
