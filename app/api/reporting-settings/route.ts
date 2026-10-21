import { NextRequest, NextResponse } from "next/server";

import { hasResourceAction } from "@/lib/role-permissions";
import {
  diffSettingsPaths,
  getReportingSettingsDefaults,
  mergeReportingSettings,
  reportingSettingsOverridesSchema,
  validateReportingSettings,
} from "@/lib/reporting/settings";
import { listPickableUsers } from "@/lib/server/people/pickable-users";
import { listReportingSettingsHistory, recordReportingAudit } from "@/lib/server/reporting/audit";
import {
  readReportingSettingsOverrides,
  writeReportingSettingsOverrides,
} from "@/lib/server/reporting/settings";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Reporting Settings (BRD §6.4, §6.6; DEV-461).
 *
 * View reads them; Edit changes them. Administrators hold both by
 * default (the BRD gives the screen to the Administrator); a role can be
 * granted them in Permissions.
 */

export async function GET() {
  const gate = await requireResourceAccess(ResourceType.REPORTING_SETTINGS, ActionType.VIEW);
  if (!gate.ok) return gate.response;

  try {
    const admin = await createAdminServerClient();
    const defaults = getReportingSettingsDefaults();
    const [overrides, history, users] = await Promise.all([
      readReportingSettingsOverrides(admin),
      listReportingSettingsHistory(admin),
      listPickableUsers(admin),
    ]);
    const { settings } = mergeReportingSettings(defaults, overrides);
    return NextResponse.json({
      settings,
      defaults,
      overrides,
      history,
      users,
      canEdit: hasResourceAction(gate.access.accessUser, ResourceType.REPORTING_SETTINGS, ActionType.EDIT),
    });
  } catch (error) {
    console.error("Reporting settings GET error:", error);
    return NextResponse.json({ error: "Failed to load reporting settings" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const gate = await requireResourceAccess(ResourceType.REPORTING_SETTINGS, ActionType.EDIT);
  if (!gate.ok) return gate.response;
  const { profile } = gate.access;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = reportingSettingsOverridesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid settings", issues: parsed.error.issues }, { status: 400 });
  }

  const defaults = getReportingSettingsDefaults();
  const { settings: next, valid } = mergeReportingSettings(defaults, parsed.data);
  if (!valid) {
    return NextResponse.json({ error: "Invalid settings" }, { status: 400 });
  }
  const problems = validateReportingSettings(next);
  if (Object.keys(problems).length > 0) {
    return NextResponse.json({ error: "Invalid settings", problems }, { status: 400 });
  }

  try {
    const admin = await createAdminServerClient();

    /* Recipients must be people who can be picked: active and not hidden. */
    const recipientIds = [
      ...next.finance.digestRecipientUserIds,
      ...next.compliance.hrRecipientUserIds,
      ...next.quotations.alertRecipientUserIds,
    ];
    if (recipientIds.length > 0) {
      const pickable = new Set((await listPickableUsers(admin)).map((user) => user.id));
      const unknown = recipientIds.filter((id) => !pickable.has(id));
      if (unknown.length > 0) {
        return NextResponse.json(
          { error: "Some recipients are not active portal users", unknown },
          { status: 400 },
        );
      }
    }

    const before = await readReportingSettingsOverrides(admin);
    const saved = await writeReportingSettingsOverrides(admin, parsed.data, profile.id);
    const changedKeys = diffSettingsPaths(
      mergeReportingSettings(defaults, before).settings,
      next,
    );
    if (changedKeys.length > 0) {
      await recordReportingAudit(admin, {
        entityType: "settings",
        eventType: "settings_updated",
        actorId: profile.id,
        actorLabel: profile.full_name ?? profile.email ?? null,
        payload: { changedKeys },
      });
    }

    const history = await listReportingSettingsHistory(admin);
    return NextResponse.json({ settings: next, overrides: saved, changedKeys, history });
  } catch (error) {
    console.error("Reporting settings PUT error:", error);
    return NextResponse.json({ error: "Failed to save reporting settings" }, { status: 500 });
  }
}
