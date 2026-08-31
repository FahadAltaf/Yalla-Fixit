import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { cacheHeaders } from "@/lib/server/snagging/overview-queries";
import { ActionType, ResourceType } from "@/types/types";

/**
 * The next few inspections due, grouped by the day they fall on.
 *
 * Limited in the query rather than sliced afterwards, and ordered by
 * appointment time so "Today" reads in the order the day happens.
 */
const LIMIT = 6;

export async function GET(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = await createAdminServerClient();
    const today = new Date().toISOString().slice(0, 10);

    const { data, error } = await admin
      .from("snagging_jobs")
      .select(
        "id, code, scheduled_date, appointment_at, property_type, unit_label, building_name, inspector:inspector_id(full_name, email)",
      )
      .gte("scheduled_date", today)
      .in("status", ["assigned", "in_progress"])
      .order("scheduled_date", { ascending: true })
      .order("appointment_at", { ascending: true, nullsFirst: false })
      .limit(LIMIT);
    if (error) throw new Error(error.message);

    type Joined = { full_name: string | null; email: string | null };
    type Row = {
      id: string;
      code: string;
      scheduled_date: string | null;
      appointment_at: string | null;
      property_type: string | null;
      unit_label: string | null;
      building_name: string | null;
      inspector: Joined | Joined[] | null;
    };

    const items = ((data ?? []) as unknown as Row[]).map((row) => {
      const inspector = Array.isArray(row.inspector) ? row.inspector[0] : row.inspector;
      return {
        id: row.id,
        code: row.code,
        day: row.scheduled_date,
        time: row.appointment_at ? row.appointment_at.slice(11, 16) : null,
        propertyType: row.property_type,
        place: [row.unit_label, row.building_name].filter(Boolean).join(", ") || null,
        inspector: inspector?.full_name ?? inspector?.email ?? null,
        href: `/snagging/${row.id}`,
      };
    });

    return NextResponse.json({ data: { items } }, { headers: cacheHeaders(300) });
  } catch (error) {
    console.error("Upcoming inspections error:", error);
    return NextResponse.json({ error: "Failed to load upcoming inspections" }, { status: 500 });
  }
}
