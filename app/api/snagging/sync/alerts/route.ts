import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { hasTable } from "@/lib/server/snagging/columns";
import { ActionType, ResourceType } from "@/types/types";

const bodySchema = z.object({
  /** The server_time of the last answer; only alerts new or changed since then. */
  since: z.string().datetime({ offset: true }).optional(),
  /** Alerts the inspector opened, marked read in the same request. */
  read: z.array(z.string().uuid()).max(500).optional(),
  /** "Mark all as read". */
  read_all: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

/*
  Every column, so the list still loads where when_at (the appointment
  an alert is about, added 2026-09-24) has not been migrated in yet. The
  row is then trimmed to what the phone reads.
*/
const ALERT_COLUMNS = "*";

type AlertRow = {
  id: string;
  job_id: string | null;
  visit_id: string | null;
  type: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
  when_at?: string | null;
};

/** What the phone gets: with the appointment as an instant, for its own clock. */
function toAlert(row: AlertRow) {
  return {
    id: row.id,
    job_id: row.job_id,
    visit_id: row.visit_id,
    type: row.type,
    title: row.title,
    body: row.body,
    created_at: row.created_at,
    read_at: row.read_at,
    when_at: row.when_at ?? null,
  };
}

/**
 * POST /api/snagging/sync/alerts -- the inspector's alerts, in one request.
 *
 * Does everything the Alerts tab and its badge need at once: marks the
 * alerts the phone read (`read`, or `read_all`), then answers with the
 * alerts new or changed since the phone's cursor (newest first, the last
 * `limit` on a first load), the unread count for the badge, and who the
 * inspector is (name and role, for the Profile screen). A read made on one
 * device reaches the others through `since`, which also matches read_at.
 *
 * The rows are written by database triggers (20260924120000); new ones are
 * also pushed to the phone over Supabase Realtime, which prompts this call.
 */
export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { since, read, read_all: readAll, limit = 50 } = parsed.data;

    const admin = await createAdminServerClient();
    const serverTime = new Date().toISOString();
    const me = {
      id: profile.id,
      full_name: profile.full_name ?? null,
      email: profile.email ?? null,
      role: accessUser.roles?.name ?? null,
    };

    // Where the migration has not run, the phone keeps its derived alerts.
    if (!(await hasTable(admin, "snagging_notifications"))) {
      return NextResponse.json({
        data: { server_time: serverTime, me, alerts: null, unread: null },
      });
    }

    // Reads first, so the answer below already reflects them.
    if (readAll) {
      const { error } = await admin
        .from("snagging_notifications")
        .update({ read_at: serverTime })
        .eq("user_id", profile.id)
        .is("read_at", null);
      if (error) throw new Error(error.message);
    } else if (read && read.length > 0) {
      const { error } = await admin
        .from("snagging_notifications")
        .update({ read_at: serverTime })
        .eq("user_id", profile.id)
        .in("id", read)
        .is("read_at", null);
      if (error) throw new Error(error.message);
    }

    let listQuery = admin
      .from("snagging_notifications")
      .select(ALERT_COLUMNS)
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (since) {
      // New since the cursor, or read since it (on this phone or another).
      listQuery = listQuery.or(`created_at.gt.${since},read_at.gt.${since}`);
    }

    const [list, unread] = await Promise.all([
      listQuery,
      admin
        .from("snagging_notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", profile.id)
        .is("read_at", null),
    ]);
    if (list.error) throw new Error(list.error.message);
    if (unread.error) throw new Error(unread.error.message);

    return NextResponse.json({
      data: {
        server_time: serverTime,
        me,
        alerts: ((list.data ?? []) as AlertRow[]).map(toAlert),
        unread: unread.count ?? 0,
      },
    });
  } catch (error) {
    console.error("[sync/alerts]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load alerts" },
      { status: 500 },
    );
  }
}
