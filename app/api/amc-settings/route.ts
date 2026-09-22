import { NextRequest, NextResponse } from "next/server";

import { amcSettingsOverridesSchema } from "@/components/dashboard/extensions/amc/amc-settings";
import { isAdminUser } from "@/lib/role-permissions";
import {
  diffSettingsKeys,
  listAmcSettingsHistory,
  recordAmcAudit,
} from "@/lib/server/amc/audit";
import {
  readAmcSettings,
  readAmcSettingsOverrides,
  writeAmcSettingsOverrides,
} from "@/lib/server/amc/settings";
import { canUseAmc } from "@/components/dashboard/extensions/amc/amc-constants";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";

/**
 * AMC Settings (FR6.1–FR6.5).
 *
 * FR6.1 makes this admin-only, which is a stricter gate than the rest of
 * the module: anyone whose role has AMC access can write a proposal, but
 * only an admin can change the text every proposal is written from, or
 * choose the approvers.
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

async function requireAmcReader() {
  const access = await getAuthenticatedUserAccess();
  if (!access.profile || !access.accessUser) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!canUseAmc(access.accessUser)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { isAdmin: isAdminUser(access.accessUser) };
}

/*
  The people an admin can choose as approvers: admins, and everyone whose
  role has the AMC Proposals permission (view or approve). Someone without
  AMC access could not open the approval queue, so they are not offered.
*/
async function listAmcUsers(
  admin: Awaited<ReturnType<typeof createAdminServerClient>>,
): Promise<{ email: string; name: string; isAdmin: boolean }[]> {
  const { data, error } = await admin
    .from("user_profile")
    .select("email, full_name, is_active, roles(name, role_access(resource, action, enabled))")
    .not("email", "is", null)
    .order("full_name", { ascending: true })
    .limit(2000);
  if (error) {
    console.error("AMC settings: could not list users:", error.message);
    return [];
  }
  return (data ?? [])
    .filter((row) => row.is_active !== false)
    .map((row) => {
      const email = String(row.email).trim().toLowerCase();
      type RoleRow = {
        name?: string | null;
        role_access?: { resource: string; action: string; enabled?: boolean | null }[] | null;
      };
      const joined = row.roles as RoleRow | RoleRow[] | null;
      const role = Array.isArray(joined) ? joined[0] : joined;
      const isAdmin = role?.name === "admin";
      const hasAmcRole = (role?.role_access ?? []).some(
        (entry) =>
          entry.resource === "amc" &&
          (entry.action === "view" || entry.action === "approve") &&
          entry.enabled !== false,
      );
      return {
        email,
        name: ((row.full_name as string | null) ?? "").trim() || email,
        isAdmin,
        eligible: isAdmin || hasAmcRole,
      };
    })
    .filter((user) => user.eligible)
    .map(({ email, name, isAdmin }) => ({ email, name, isAdmin }));
}

export async function GET() {
  const gate = await requireAmcReader();
  if (gate.error) return gate.error;

  try {
    const admin = await createAdminServerClient();
    /*
      Both are returned. `settings` is what documents will render with --
      the shape the page shows in its fields. `overrides` is what has
      actually been edited, which is how the page marks a field as
      customised versus still on the shipped default.
    */
    const [settings, overrides, history, amcUsers] = await Promise.all([
      readAmcSettings(admin),
      readAmcSettingsOverrides(admin),
      /* FR6.5 — who changed what, and when. Admins only, like the page. */
      gate.isAdmin ? listAmcSettingsHistory(admin) : Promise.resolve([]),
      /* FR5.3 — the people an admin can choose as approvers. */
      gate.isAdmin ? listAmcUsers(admin) : Promise.resolve([]),
    ]);
    /* The override document is an admin's working view -- which fields
       have been customised. The team only needs the resolved text. */
    return NextResponse.json(
      gate.isAdmin
        ? { settings, overrides, history, amcUsers }
        : { settings, overrides: {}, history: [], amcUsers: [] },
    );
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

    const [settings, history] = await Promise.all([
      readAmcSettings(admin),
      listAmcSettingsHistory(admin),
    ]);
    return NextResponse.json({ settings, overrides: saved, changedKeys, history });
  } catch (error) {
    console.error("AMC settings PUT error:", error);
    return NextResponse.json(
      { error: "Failed to save AMC settings" },
      { status: 500 },
    );
  }
}
