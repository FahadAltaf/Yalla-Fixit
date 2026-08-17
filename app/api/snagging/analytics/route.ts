import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { ActionType, ResourceType, SnaggingAnalytics } from "@/types/types";

/**
 * Operational analytics (§6.7) and the KPIs from §2.3.
 *
 * Counts come back as head-only queries so the dashboard never pulls
 * rows it is only going to length(). The distributions read from the
 * snags table directly; at Phase 1 volumes (100 inspections a day,
 * headroom to 500) that is a single indexed scan, and the moment it is
 * not, these become materialised views without the caller changing.
 */
export async function GET(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const params = req.nextUrl.searchParams;
    const from = params.get("from") ?? defaultFrom();
    const to = params.get("to") ?? new Date().toISOString().slice(0, 10);

    const admin = await createAdminServerClient();
    const now = new Date().toISOString();
    const todayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;

    const [
      openCount,
      pendingApproval,
      approvedToday,
      deliveredCount,
      overdueApprovals,
      snagRows,
      developerRows,
      taskRows,
    ] = await Promise.all([
      countTasks(admin, (q) => q.in("status", ["assigned", "in_progress", "rejected"])),
      countTasks(admin, (q) => q.in("status", ["submitted", "in_review"])),
      countTasks(admin, (q) => q.eq("status", "approved").gte("approved_at", todayStart)),
      countTasks(admin, (q) => q.eq("status", "delivered")),
      // FR-4.06: anything past its 48-hour window.
      countTasks(admin, (q) =>
        q.in("status", ["submitted", "in_review"]).lt("approval_due_at", now),
      ),
      admin
        .from("snagging_snags")
        .select("severity, element_code, element_label")
        .gte("created_at", `${from}T00:00:00.000Z`)
        .lte("created_at", `${to}T23:59:59.999Z`),
      admin
        .from("snagging_developer_quality")
        .select("*")
        .order("snags_per_unit", { ascending: false })
        .limit(20),
      // Everything the KPI block needs, in one read.
      admin
        .from("snagging_tasks")
        .select("id, status, submitted_at, approved_at, delivered_at, rejection_count")
        .gte("created_at", `${from}T00:00:00.000Z`)
        .not("submitted_at", "is", null),
    ]);

    if (snagRows.error) throw new Error(snagRows.error.message);
    if (developerRows.error) throw new Error(developerRows.error.message);
    if (taskRows.error) throw new Error(taskRows.error.message);

    const snags = snagRows.data ?? [];

    const bySeverity = (["low", "medium", "high"] as const).map((severity) => ({
      severity,
      count: snags.filter((snag) => snag.severity === severity).length,
    }));

    const elementCounts = new Map<string, { element_label: string; count: number }>();
    for (const snag of snags) {
      const key = snag.element_code ?? "unknown";
      const existing = elementCounts.get(key);
      if (existing) existing.count += 1;
      else elementCounts.set(key, { element_label: snag.element_label ?? key, count: 1 });
    }

    const byElement = [...elementCounts.entries()]
      .map(([element_code, value]) => ({ element_code, ...value }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    const inspectorRows = await loadInspectorTotals(admin, from, to);

    return NextResponse.json({
      data: {
        counts: {
          open: openCount,
          pendingApproval,
          approvedToday,
          delivered: deliveredCount,
          overdueApprovals,
        },
        bySeverity,
        byElement,
        byDeveloper: (developerRows.data ?? []).map((row) => ({
          developer_name: row.developer_name,
          building_name: row.building_name ?? null,
          unit_count: Number(row.unit_count ?? 0),
          snag_count: Number(row.snag_count ?? 0),
          snags_per_unit: Number(row.snags_per_unit ?? 0),
          outstanding_count: Number(row.outstanding_count ?? 0),
        })),
        byInspector: inspectorRows,
        kpis: computeKpis(taskRows.data ?? []),
      } satisfies SnaggingAnalytics,
    });
  } catch (error) {
    console.error("Snagging analytics error:", error);
    return NextResponse.json({ error: "Failed to load analytics" }, { status: 500 });
  }
}

type Admin = Awaited<ReturnType<typeof createAdminServerClient>>;
type TaskQuery = ReturnType<ReturnType<Admin["from"]>["select"]>;

async function countTasks(admin: Admin, refine: (query: TaskQuery) => TaskQuery): Promise<number> {
  const { count, error } = await refine(
    admin.from("snagging_tasks").select("id", { count: "exact", head: true }) as TaskQuery,
  );
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * §2.3 KPIs.
 *
 * - Preparation time is submit-to-approval, which is what the BRD
 *   defines as the measurable proxy for the 80% reduction target (O2).
 * - First-time approval counts inspections approved without ever having
 *   been rejected (O5).
 * - Delivery SLA is submit-to-delivery inside 24 hours (O4).
 */
function computeKpis(
  tasks: Array<{
    status: string;
    submitted_at: string | null;
    approved_at: string | null;
    delivered_at: string | null;
    rejection_count: number | null;
  }>,
): SnaggingAnalytics["kpis"] {
  const approved = tasks.filter((task) => task.approved_at && task.submitted_at);

  const preparationMinutes = approved.map(
    (task) =>
      (new Date(task.approved_at!).getTime() - new Date(task.submitted_at!).getTime()) / 60000,
  );

  const avgPreparationMinutes = preparationMinutes.length
    ? Math.round(
        preparationMinutes.reduce((sum, value) => sum + value, 0) / preparationMinutes.length,
      )
    : null;

  const firstTime = approved.filter((task) => (task.rejection_count ?? 0) === 0).length;
  const firstTimeApprovalRate = approved.length
    ? Math.round((firstTime / approved.length) * 100)
    : null;

  const delivered = tasks.filter((task) => task.delivered_at && task.submitted_at);
  const withinSla = delivered.filter(
    (task) =>
      new Date(task.delivered_at!).getTime() - new Date(task.submitted_at!).getTime() <=
      24 * 60 * 60 * 1000,
  ).length;
  const deliveredWithinSlaRate = delivered.length
    ? Math.round((withinSla / delivered.length) * 100)
    : null;

  return { avgPreparationMinutes, firstTimeApprovalRate, deliveredWithinSlaRate };
}

/** FR-7.01 — distribution by inspector. */
async function loadInspectorTotals(admin: Admin, from: string, to: string) {
  const { data, error } = await admin
    .from("snagging_task_assignees")
    .select(
      `user_id, task_id, user_profile:user_id(full_name, email),
       task:snagging_tasks!inner(id, created_at)`,
    )
    .eq("role", "technician")
    .gte("task.created_at", `${from}T00:00:00.000Z`)
    .lte("task.created_at", `${to}T23:59:59.999Z`);

  if (error) throw new Error(error.message);

  // Without generated database types, supabase-js reports every
  // embedded relation as an array regardless of cardinality, so the
  // one-to-one join is normalised here rather than asserted away.
  type ProfileRef = { full_name: string | null; email: string | null };
  const rows = ((data ?? []) as unknown as Array<{
    user_id: string;
    task_id: string;
    user_profile: ProfileRef | ProfileRef[] | null;
  }>).map((row) => ({
    user_id: row.user_id,
    task_id: row.task_id,
    user_profile: Array.isArray(row.user_profile) ? row.user_profile[0] ?? null : row.user_profile,
  }));

  if (rows.length === 0) return [];

  const { data: snagCounts, error: snagError } = await admin
    .from("snagging_snags")
    .select("created_by")
    .in("origin_task_id", [...new Set(rows.map((row) => row.task_id))]);
  if (snagError) throw new Error(snagError.message);

  const snagsByUser = new Map<string, number>();
  for (const snag of snagCounts ?? []) {
    if (!snag.created_by) continue;
    snagsByUser.set(snag.created_by, (snagsByUser.get(snag.created_by) ?? 0) + 1);
  }

  const byUser = new Map<string, { name: string; task_count: number }>();
  for (const row of rows) {
    const name = row.user_profile?.full_name ?? row.user_profile?.email ?? "Unknown";
    const existing = byUser.get(row.user_id);
    if (existing) existing.task_count += 1;
    else byUser.set(row.user_id, { name, task_count: 1 });
  }

  return [...byUser.entries()]
    .map(([user_id, value]) => ({
      user_id,
      name: value.name,
      task_count: value.task_count,
      snag_count: snagsByUser.get(user_id) ?? 0,
    }))
    .sort((a, b) => b.task_count - a.task_count);
}

function defaultFrom(): string {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return date.toISOString().slice(0, 10);
}
