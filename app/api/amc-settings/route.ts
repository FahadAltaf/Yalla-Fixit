import { NextRequest, NextResponse } from "next/server";

import { amcSettingsOverridesSchema } from "@/components/dashboard/extensions/amc/amc-settings";
import { isAdminUser } from "@/lib/role-permissions";
import { diffSettingsKeys, recordAmcAudit } from "@/lib/server/amc/audit";
import {
  readAmcSettings,
  readAmcSettingsOverrides,
  writeAmcSettingsOverrides,
} from "@/lib/server/amc/settings";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";

/**
 * AMC Settings (FR6.1–FR6.5).
 *
 * FR6.1 makes this admin-only, which is a stricter gate than the rest of
 * the module: the AMC allowlist decides who can write a proposal, but only
 * an admin can change the text every proposal is written from.
 */

async function requireAdmin() {
  const access = await getAuthenticatedUserAccess();
  if (!access.profile || !access.accessUser) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!isAdminUser(access.accessUser)) {
    return {
      error: NextResponse.json(
        { error: "Only an administrator can change AMC settings" },
        { status: 403 },
      ),
    };
  }
  return { profile: access.profile };
}

export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  try {
    const admin = await createAdminServerClient();
    /*
      Both are returned. `settings` is what documents will render with --
      the shape the page shows in its fields. `overrides` is what has
      actually been edited, which is how the page marks a field as
      customised versus still on the shipped default.
    */
    const [settings, overrides] = await Promise.all([
      readAmcSettings(admin),
      readAmcSettingsOverrides(admin),
    ]);
    return NextResponse.json({ settings, overrides });
  } catch (error) {
    console.error("AMC settings GET error:", error);
    return NextResponse.json(
      { error: "Failed to load AMC settings" },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const { profile } = gate;

  const parsed = amcSettingsOverridesSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const admin = await createAdminServerClient();
    const before = await readAmcSettingsOverrides(admin);
    const saved = await writeAmcSettingsOverrides(admin, parsed.data, profile.id);

    /* FR6.5 — record who changed what, and when. Key paths rather than
       the text itself; see diffSettingsKeys. */
    const changedKeys = diffSettingsKeys(
      before as Record<string, unknown>,
      saved as Record<string, unknown>,
    );
    if (changedKeys.length > 0) {
      await recordAmcAudit(admin, {
        entityType: "settings",
        eventType: "settings_updated",
        actorId: profile.id,
        actorLabel: profile.full_name ?? profile.email ?? null,
        payload: { changedKeys },
      });
    }

    const settings = await readAmcSettings(admin);
    return NextResponse.json({ settings, overrides: saved, changedKeys });
  } catch (error) {
    console.error("AMC settings PUT error:", error);
    return NextResponse.json(
      { error: "Failed to save AMC settings" },
      { status: 500 },
    );
  }
}
