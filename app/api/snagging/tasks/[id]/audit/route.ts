import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { loadJobFamily } from "@/lib/server/snagging/job-family";
import { ActionType, ResourceType } from "@/types/types";

type AuditRow = {
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  payload: Record<string, unknown> | null;
};

/**
 * Names the thing each entry happened to.
 *
 * Area and checklist events record only an id, so the trail read "Area
 * confirmed" over and over with no way to tell which area. The writer now
 * snapshots the name, but every entry written before it did carries just
 * the id -- so the names are resolved here too, in two batched lookups,
 * and folded into the payload the client already reads. A row that
 * already carries its name is left alone: that one is the record of what
 * the area was called at the time, and this is only a fallback.
 */
async function withSubjects<T extends AuditRow>(
  admin: Awaited<ReturnType<typeof createAdminServerClient>>,
  rows: T[],
): Promise<T[]> {
  const idsFor = (match: (row: T) => boolean) => [
    ...new Set(
      rows.filter((row) => match(row) && row.entity_id).map((row) => row.entity_id as string),
    ),
  ];

  const areaIds = idsFor((row) => row.entity_type === "area" && !row.payload?.area_name);
  const itemIds = idsFor(
    (row) => row.event_type === "checklist_not_checked" && !row.payload?.label,
  );
  if (areaIds.length === 0 && itemIds.length === 0) return rows;

  const [areas, items] = await Promise.all([
    areaIds.length
      ? admin.from("snagging_areas").select("id, name").in("id", areaIds)
      : null,
    itemIds.length
      ? admin.from("snagging_job_checklist").select("id, code, label").in("id", itemIds)
      : null,
  ]);

  const areaNames = new Map(
    (areas?.data ?? []).map((area) => [area.id as string, area.name as string]),
  );
  const itemRows = new Map(
    (items?.data ?? []).map((item) => [item.id as string, item]),
  );

  return rows.map((row) => {
    const payload = { ...(row.payload ?? {}) };
    if (row.entity_type === "area" && !payload.area_name && row.entity_id) {
      payload.area_name = areaNames.get(row.entity_id) ?? null;
    }
    if (row.event_type === "checklist_not_checked" && !payload.label && row.entity_id) {
      const item = itemRows.get(row.entity_id);
      if (item) {
        payload.code = item.code;
        payload.label = item.label;
      }
    }
    return { ...row, payload };
  });
}

/**
 * The audit trail for one inspection (BR-5, §5.3).
 *
 * Read-only; the events themselves are written append-only by
 * recordAudit as approvals, rejections, rounds, visits and deliveries
 * happen.
 *
 * Paged. A busy job accumulates an entry per snag edit, area confirmation
 * and checklist answer, so this used to take the first hundred and drop
 * everything older with nothing on screen to say so -- the trail simply
 * ended. The client asks for a page at a time and is told the total.
 */
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const admin = await createAdminServerClient();

    // FR-8.05 — the whole chain, not just this leg. A de-snag round and
    // an additional visit each record against their own job id, so
    // filtering on one id showed a reviewer a history with the rounds
    // missing from it.
    const family = await loadJobFamily(admin, id);

    const url = new URL(req.url);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number(url.searchParams.get("pageSize")) || DEFAULT_PAGE_SIZE),
    );
    const page = Math.max(0, Number(url.searchParams.get("page")) || 0);
    // Oldest-first reads the inspection as a story; newest-first answers
    // "what just happened". Both are one index scan on (task_id, created_at).
    const ascending = url.searchParams.get("order") === "asc";
    const from = page * pageSize;

    const { data, error, count } = await admin
      .from("snagging_audit_events")
      .select(
        "id, event_type, entity_type, entity_id, actor_label, origin, justification, payload, created_at, task_id",
        // Counted in the same round trip: the pager needs a total, and a
        // separate count query would double the work on every page turn.
        { count: "exact" },
      )
      .in("task_id", family.allIds)
      .order("created_at", { ascending })
      .range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);

    return NextResponse.json({
      data: await withSubjects(admin, data ?? []),
      totalCount: count ?? 0,
    });
  } catch (error) {
    console.error("Snagging audit GET error:", error);
    return NextResponse.json({ error: "Failed to load the audit trail" }, { status: 500 });
  }
}
