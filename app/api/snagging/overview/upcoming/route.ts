import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { cacheHeaders, countJobs } from "@/lib/server/snagging/overview-queries";
import { ActionType, ResourceType } from "@/types/types";

/**
 * The next few inspections due, grouped by the day they fall on.
 *
 * Limited in the query rather than sliced afterwards, and ordered by
 * appointment time so "Today" reads in the order the day happens.
 *
 * `?scope=all` lifts the ceiling for the dialog behind "View all" —
 * bigger, not unbounded, because a full diary is a schedule rather than
 * something to read in a dialog. The total is counted separately either
 * way, so the card can name a number its own list is not carrying.
 */
const LIMIT = 6;
const ALL_LIMIT = 100;

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
    const limit =
      req.nextUrl.searchParams.get("scope") === "all" ? ALL_LIMIT : LIMIT;

    /*
      What counts as booked, asked once.

      The count and the list have to agree exactly -- a footer reading
      "showing 6 of 23" is a lie the moment the two predicates drift --
      so the filter is written here and both queries are refined through
      it rather than each spelling it out.
    */
    const booked = (q: any) =>
      q.gte("scheduled_date", today).in("status", ["assigned", "in_progress"]);

    const total = await countJobs(admin, booked);

    const { data, error } = await booked(
      admin
        .from("snagging_jobs")
        .select(
          "id, code, scheduled_date, appointment_at, property_type, unit_label, building_name, inspector:inspector_id(full_name, email)",
        ),
    )
      .order("scheduled_date", { ascending: true })
      .order("appointment_at", { ascending: true, nullsFirst: false })
      .limit(limit);
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
        day: row.scheduled_date,
        time: row.appointment_at ? row.appointment_at.slice(11, 16) : null,
        propertyType: row.property_type,
        /*
          The unit names the row now that the job code no longer does, so it
          is its own field rather than being folded into the address line
          underneath — a row whose headline is the building would read the
          same for every unit in it.
        */
        unit: row.unit_label,
        place: row.building_name,
        inspector: inspector?.full_name ?? inspector?.email ?? null,
        href: `/snagging/${row.id}`,
      };
    });

    return NextResponse.json(
      { data: { total, items } },
      { headers: cacheHeaders(300) },
    );
  } catch (error) {
    console.error("Upcoming inspections error:", error);
    return NextResponse.json({ error: "Failed to load upcoming inspections" }, { status: 500 });
  }
}
