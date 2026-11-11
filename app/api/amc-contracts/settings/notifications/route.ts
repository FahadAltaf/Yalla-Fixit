import { NextRequest, NextResponse } from "next/server";

import { recordAmcAudit } from "@/lib/server/amc/audit";
import { notificationSettingsSchema } from "@/lib/server/amc/business-schemas";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { readNotificationSettings, writeNotificationSettings } from "@/lib/server/amc/notifications";

/**
 * AMC notification settings. Defaults: workflow emails on (they go to the
 * approvers and the proposal owner), allowance emails off, renewal
 * reminders 60/30/15 days in-app to the owner with automatic delivery OFF.
 * None of these is an approved business schedule; AMC approvers change them.
 */
export async function GET() {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  try {
    return NextResponse.json({ settings: await readNotificationSettings(gate.admin), canEdit: gate.canApprove });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the notification settings");
  }
}

export async function PUT(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  if (!gate.canApprove) return NextResponse.json({ error: "Only AMC approvers can change notification settings." }, { status: 403 });
  const parsed = notificationSettingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    await writeNotificationSettings(gate.admin, parsed.data, gate.userId);
    await recordAmcAudit(gate.admin, {
      entityType: "settings",
      entityId: null,
      eventType: "notification_settings_updated",
      actorId: gate.userId,
      actorLabel: gate.label,
      payload: { ...parsed.data, reminderExtraEmails: parsed.data.reminderExtraEmails.length },
    });
    return NextResponse.json({ settings: await readNotificationSettings(gate.admin), canEdit: true });
  } catch (error) {
    return contractErrorResponse(error, "Could not save the notification settings");
  }
}
