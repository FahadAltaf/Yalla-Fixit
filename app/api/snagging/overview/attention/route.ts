import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { cacheHeaders, countJobs } from "@/lib/server/snagging/overview-queries";
import { APPROVAL_SLA_HOURS } from "@/lib/server/snagging/workflow";
import { ActionType, ResourceType } from "@/types/types";

/**
 * What needs somebody today, worst first.
 *
 * Three kinds of item, each fetched with its own LIMIT so the list never
 * pulls more than it shows: inspections sent back for correction, review
 * that has run past the 48-hour SLA, and review still inside it. The
 * total is counted separately, so "View all" can promise a number the
 * list itself is not carrying.
 */
const VISIBLE = 4;

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
    const overdueCutoff = new Date(
      Date.now() - APPROVAL_SLA_HOURS * 60 * 60 * 1000,
    ).toISOString();

    const columns =
      "id, code, status, unit_label, building_name, submitted_at, updated_at, rejection_reason";

    const [rejected, overdue, waiting, rejectedCount, waitingCount] = await Promise.all([
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
      countJobs(admin, (q) => q.eq("status", "rejected")),
      countJobs(admin, (q) => q.in("status", ["submitted", "in_review"])),
    ]);
    for (const result of [rejected, overdue, waiting]) {
      if (result.error) throw new Error(result.error.message);
    }

    type Row = {
      id: string;
      code: string;
      unit_label: string | null;
      building_name: string | null;
      submitted_at: string | null;
      updated_at: string;
      rejection_reason: string | null;
    };

    const place = (row: Row) =>
      [row.unit_label, row.building_name].filter(Boolean).join(", ") || "Unit not named";

    const items = [
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
      { data: { total: rejectedCount + waitingCount, items } },
      { headers: cacheHeaders(60) },
    );
  } catch (error) {
    console.error("Needs attention error:", error);
    return NextResponse.json({ error: "Failed to load what needs attention" }, { status: 500 });
  }
}
