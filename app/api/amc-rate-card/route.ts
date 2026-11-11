import { NextRequest, NextResponse } from "next/server";

import { todayInDubai } from "@/lib/amc/contracts";
import { publishRateCardSchema, versionInForce } from "@/lib/amc/rate-card";
import { hasResourceAction } from "@/lib/role-permissions";
import { contractErrorResponse } from "@/lib/server/amc/contract-access";
import { listRateCardVersions, publishRateCard } from "@/lib/server/amc/rate-card";
import { readAmcSettings } from "@/lib/server/amc/settings";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * The governed rate card (BRD 5.3, DEV-363).
 *
 * GET  AMC Rate Card View: every published version (newest first), the one
 *      in force today, the services it can price, and whether the caller
 *      may publish.
 * POST AMC Rate Card Edit (the department head and Finance): publish the
 *      card as a new version, effective today or later, with a reason.
 */
export async function GET() {
  const gate = await requireResourceAccess(ResourceType.AMC_RATE_CARD, ActionType.VIEW);
  if (!gate.ok) return gate.response;
  try {
    const admin = await createAdminServerClient();
    const [{ versions, migrated }, settings] = await Promise.all([listRateCardVersions(admin), readAmcSettings(admin)]);
    const today = todayInDubai();
    return NextResponse.json(
      {
        migrated,
        today,
        versions,
        inForceId: versionInForce(versions.filter((v) => v.valid), today)?.id ?? null,
        services: settings.services.filter((s) => s.enabled !== false).map((s) => ({ id: s.id, label: s.label, frequencyType: s.frequencyType })),
        canEdit: hasResourceAction(gate.access.accessUser, ResourceType.AMC_RATE_CARD, ActionType.EDIT),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return contractErrorResponse(error, "Could not load the rate card");
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireResourceAccess(ResourceType.AMC_RATE_CARD, ActionType.EDIT);
  if (!gate.ok) return gate.response;
  const parsed = publishRateCardSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: `${issue?.path?.length ? `${issue.path.join(".")}: ` : ""}${issue?.message ?? "Invalid request"}` }, { status: 400 });
  }
  try {
    const admin = await createAdminServerClient();
    const settings = await readAmcSettings(admin);
    const known = new Set(settings.services.map((s) => s.id));
    const unknown = [
      ...parsed.data.card.items.map((i) => i.serviceId),
      ...parsed.data.card.packages.flatMap((p) => p.lines.map((l) => l.serviceId)),
      ...parsed.data.card.promotions.flatMap((p) => p.serviceIds),
    ].filter((id) => !known.has(id));
    if (unknown.length) return NextResponse.json({ error: `Not in the AMC catalogue: ${[...new Set(unknown)].join(", ")}.` }, { status: 400 });
    const label = (id: string) => settings.services.find((s) => s.id === id)?.label ?? id;
    const version = await publishRateCard(
      admin,
      parsed.data,
      { id: gate.access.profile.id, label: gate.access.profile.full_name ?? gate.access.profile.email ?? null },
      label,
    );
    return NextResponse.json({ version }, { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not publish the rate card");
  }
}
