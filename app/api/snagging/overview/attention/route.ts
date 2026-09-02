import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import {
  cacheHeaders,
  countJobs,
} from "@/lib/server/snagging/overview-queries";
import { APPROVAL_SLA_HOURS } from "@/lib/server/snagging/workflow";
import { ActionType, ResourceType } from "@/types/types";

/**
 * What needs somebody today, worst first.
 *
 * Four kinds of item, each fetched with its own LIMIT so the list never
 * pulls more than it shows: inspections whose scheduled day has passed
 * without the visit happening, inspections sent back for correction,
 * review that has run past the 48-hour SLA, and review still inside it.
 * The total is counted separately, so "View all" can promise a number the
 * list itself is not carrying.
 *
 * The first of those was missing. Every other kind starts at submission,
 * so a job booked for last Tuesday that nobody has been to yet -- the
 * thing the inspector's own job list shows in red -- was the one case
 * the card could not see, and the card sat on "Nothing needs attention"
 * while inspections quietly ran late. A draft is not counted: it has no
 * inspector on it and no visit to miss.
 */
const VISIBLE = 4;

export async function GET(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      !hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = await createAdminServerClient();
    const overdueCutoff = new Date(
      Date.now() - APPROVAL_SLA_HOURS * 60 * 60 * 1000,
    ).toISOString();

    // Dates are stored as plain YYYY-MM-DD, so "before today" has to be
    // asked in the timezone the work is scheduled in, not the server's.
    const todayGst = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Dubai",
    });

    const columns =
      "id, code, status, unit_label, building_name, scheduled_date, submitted_at, updated_at, rejection_reason";

    /** Booked to an inspector, the day has passed, still not submitted. */
    const ON_SITE_STATUSES = ["assigned", "in_progress"];

    const [
      onSite,
      rejected,
      overdue,
      waiting,
      onSiteCount,
      rejectedCount,
      waitingCount,
    ] = await Promise.all([
      admin
        .from("snagging_jobs")
        .select(columns)
        .in("status", ON_SITE_STATUSES)
        .lt("scheduled_date", todayGst)
        .order("scheduled_date", { ascending: true })
        .limit(VISIBLE),
      admin
        .from("snagging_jobs")
        .select(columns)
        .eq("status", "rejected")
        .order("updated_at", { ascending: false })
        .limit(VISIBLE),
      admin
        .from("snagging_jobs")
        .select(columns)
        .in("status", ["submitted", "in_review"])
        .lt("submitted_at", overdueCutoff)
        .order("submitted_at", { ascending: true })
        .limit(VISIBLE),
      admin
        .from("snagging_jobs")
        .select(columns)
        .in("status", ["submitted", "in_review"])
        .gte("submitted_at", overdueCutoff)
        .order("submitted_at", { ascending: true })
        .limit(VISIBLE),
      countJobs(admin, (q) =>
        q.in("status", ON_SITE_STATUSES).lt("scheduled_date", todayGst),
      ),
      countJobs(admin, (q) => q.eq("status", "rejected")),
      countJobs(admin, (q) => q.in("status", ["submitted", "in_review"])),
    ]);
    for (const result of [onSite, rejected, overdue, waiting]) {
      if (result.error) throw new Error(result.error.message);
    }

    type Row = {
      id: string;
      code: string;
      unit_label: string | null;
      building_name: string | null;
      scheduled_date: string | null;
      submitted_at: string | null;
      updated_at: string;
      rejection_reason: string | null;
    };

    const place = (row: Row) =>
      [row.unit_label, row.building_name].filter(Boolean).join(", ") ||
      "Unit not named";

    const dueDate = (value: string | null) =>
      value
        ? new Date(value).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            timeZone: "Asia/Dubai",
          })
        : null;

    const items = [
      // A visit that never happened leads: it blocks everything downstream,
      // and unlike the review items nobody is waiting on a decision -- they
      // are waiting on somebody to turn up.
      ...((onSite.data ?? []) as Row[]).map((row) => {
        const due = dueDate(row.scheduled_date);
        return {
          id: row.id,
          severity: "urgent" as const,
          title: `${row.code} overdue on site`,
          subtitle: due ? `${place(row)} · was due ${due}` : place(row),
          // The due date is already spelled out above; a "3 days ago" after
          // it would be the same fact told twice.
          at: null,
          href: `/snagging/${row.id}`,
        };
      }),
      ...((rejected.data ?? []) as Row[]).map((row) => ({
        id: row.id,
        severity: "urgent" as const,
        title: `${row.code} sent back for correction`,
        subtitle: row.rejection_reason?.trim() || place(row),
        at: row.updated_at,
        href: `/snagging/${row.id}`,
      })),
      ...((overdue.data ?? []) as Row[]).map((row) => ({
        id: row.id,
        severity: "urgent" as const,
        title: `${row.code} past the 48-hour review window`,
        subtitle: place(row),
        at: row.submitted_at ?? row.updated_at,
        href: `/snagging/${row.id}`,
      })),
      ...((waiting.data ?? []) as Row[]).map((row) => ({
        id: row.id,
        severity: "pending" as const,
        title: `${row.code} waiting on review`,
        subtitle: place(row),
        at: row.submitted_at ?? row.updated_at,
        href: `/snagging/${row.id}`,
      })),
    ].slice(0, VISIBLE);

    return NextResponse.json(
      { data: { total: onSiteCount + rejectedCount + waitingCount, items } },
      { headers: cacheHeaders(60) },
    );
  } catch (error) {
    console.error("Needs attention error:", error);
    return NextResponse.json(
      { error: "Failed to load what needs attention" },
      { status: 500 },
    );
  }
}
