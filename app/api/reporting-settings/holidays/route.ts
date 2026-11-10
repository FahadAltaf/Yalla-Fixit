import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { UUID_PATTERN, actorOf } from "@/lib/server/finance/route-helpers";
import { recordReportingAudit } from "@/lib/server/reporting/audit";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Public holidays (BRD 5.2 B2; DEV-443): days that count zero available
 * hours for everyone. Reporting settings View lists them; Edit adds and
 * removes. Every change is in the settings history.
 *
 *   GET                             every holiday, newest first
 *   POST   { date, name }           add, or rename the holiday on that date
 *   DELETE ?id=<uuid>               remove
 */

export const dynamic = "force-dynamic";

async function list(admin: Awaited<ReturnType<typeof createAdminServerClient>>) {
  const { data, error } = await admin
    .from("org_public_holidays")
    .select("id, holiday_date, name")
    .order("holiday_date", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []).map((h) => ({ id: String(h.id), date: String(h.holiday_date), name: String(h.name) }));
}

export async function GET() {
  const gate = await requireResourceAccess(ResourceType.REPORTING_SETTINGS, ActionType.VIEW);
  if (!gate.ok) return gate.response;
  try {
    return NextResponse.json({ holidays: await list(await createAdminServerClient()) });
  } catch (error) {
    console.error("Public holidays GET error:", error);
    return NextResponse.json({ error: "Could not load public holidays" }, { status: 500 });
  }
}

const bodySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), "Invalid date"),
    name: z.string().trim().min(1).max(120),
  })
  .strict();

export async function POST(req: NextRequest) {
  const gate = await requireResourceAccess(ResourceType.REPORTING_SETTINGS, ActionType.EDIT);
  if (!gate.ok) return gate.response;
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Give a date and a name (up to 120 characters)" }, { status: 400 });

  try {
    const admin = await createAdminServerClient();
    const actor = actorOf(gate.access.profile);
    const { data, error } = await admin
      .from("org_public_holidays")
      .upsert(
        { holiday_date: body.data.date, name: body.data.name, created_by: actor.id, updated_by: actor.id, updated_at: new Date().toISOString() },
        { onConflict: "holiday_date" },
      )
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await recordReportingAudit(admin, {
      entityType: "holiday",
      entityId: String(data.id),
      eventType: "holiday_saved",
      actorId: actor.id,
      actorLabel: actor.label,
      payload: { date: body.data.date, name: body.data.name },
    });
    return NextResponse.json({ holidays: await list(admin) });
  } catch (error) {
    console.error("Public holidays POST error:", error);
    return NextResponse.json({ error: "Could not save the holiday" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await requireResourceAccess(ResourceType.REPORTING_SETTINGS, ActionType.EDIT);
  if (!gate.ok) return gate.response;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const admin = await createAdminServerClient();
    const { data, error } = await admin.from("org_public_holidays").delete().eq("id", id).select("holiday_date, name");
    if (error) throw new Error(error.message);
    if (!data?.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const actor = actorOf(gate.access.profile);
    await recordReportingAudit(admin, {
      entityType: "holiday",
      entityId: id,
      eventType: "holiday_removed",
      actorId: actor.id,
      actorLabel: actor.label,
      payload: { date: data[0].holiday_date, name: data[0].name },
    });
    return NextResponse.json({ holidays: await list(admin) });
  } catch (error) {
    console.error("Public holidays DELETE error:", error);
    return NextResponse.json({ error: "Could not remove the holiday" }, { status: 500 });
  }
}
