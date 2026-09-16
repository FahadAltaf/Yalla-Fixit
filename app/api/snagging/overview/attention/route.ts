import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import {
  cacheHeaders,
  countJobs,
  myJobs,
  myQuotations,
} from "@/lib/server/snagging/overview-queries";
import { APPROVAL_SLA_HOURS } from "@/lib/server/snagging/workflow";
import { ActionType, ResourceType } from "@/types/types";

/**
 * What needs somebody today, worst first.
 *
 * Six kinds of item, each fetched with its own LIMIT so the list never
 * pulls more than it shows: inspections whose scheduled day has passed
 * without the visit happening, inspections sent back for correction,
 * review that has run past the 48-hour SLA, review still inside it, jobs
 * raised but never assigned to anybody, and quotations sent to a client
 * who has not answered in two days.
 *
 * All of it scoped to the reader (FR-10.01) — see myJobs. This card says
 * what YOU need to act on; the org-wide view of the same work is
 * Analytics.
 * The total is counted separately, so the card can promise a number the
 * list itself is not carrying.
 *
 * `?scope=all` is what that promise pays out: the same four queries with
 * a bigger ceiling, for the dialog behind "View all". Bigger, not
 * unbounded -- a backlog of several hundred is a real possibility and
 * nobody reads past a hundred rows in a dialog anyway. The total keeps
 * being the true count either way, so the footer can still say how much
 * is not on screen.
 *
 * The first of those was missing. Every other kind starts at submission,
 * so a job booked for last Tuesday that nobody has been to yet -- the
 * thing the inspector's own job list shows in red -- was the one case
 * the card could not see, and the card sat on "Nothing needs attention"
 * while inspections quietly ran late. A draft has no visit to miss, so
 * it is not counted there — it is counted as unassigned instead, which
 * is the thing actually waiting on somebody.
 */
const VISIBLE = 4;
const ALL_LIMIT = 100;

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

    const limit =
      req.nextUrl.searchParams.get("scope") === "all" ? ALL_LIMIT : VISIBLE;

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

    /*
      A quotation the client has gone quiet on (FR-10.01).

      Two days from when it was SENT, not when it was raised: a draft
      nobody has sent is not waiting on a client, it is waiting on the
      person looking at this card, and that is a different sentence.
    */
    const QUOTE_SLA_HOURS = 48;
    const quoteCutoff = new Date(
      Date.now() - QUOTE_SLA_HOURS * 60 * 60 * 1000,
    ).toISOString();

    const me = profile.id;
    /** Every job query on this card is the reader's own work. */
    const jobs = () => myJobs(admin.from("snagging_jobs").select(columns), me);

    const [
      onSite,
      rejected,
      overdue,
      waiting,
      unassigned,
      staleQuotes,
      onSiteCount,
      rejectedCount,
      waitingCount,
      unassignedCount,
      staleQuoteCount,
    ] = await Promise.all([
      jobs()
        .in("status", ON_SITE_STATUSES)
        .lt("scheduled_date", todayGst)
        .order("scheduled_date", { ascending: true })
        .limit(limit),
      jobs()
        .eq("status", "rejected")
        .order("updated_at", { ascending: false })
        .limit(limit),
      jobs()
        .in("status", ["submitted", "in_review"])
        .lt("submitted_at", overdueCutoff)
        .order("submitted_at", { ascending: true })
        .limit(limit),
      jobs()
        .in("status", ["submitted", "in_review"])
        .gte("submitted_at", overdueCutoff)
        .order("submitted_at", { ascending: true })
        .limit(limit),
      // Raised, but nobody is going: no inspector on it yet.
      jobs()
        .is("inspector_id", null)
        .not("status", "in", "(approved,delivered,cancelled)")
        .order("created_at", { ascending: true })
        .limit(limit),
      myQuotations(
        admin
          .from("snagging_quotations")
          .select("id, quote_number, status, sent_at, updated_at"),
        me,
      )
        .eq("status", "sent")
        .lt("sent_at", quoteCutoff)
        .order("sent_at", { ascending: true })
        .limit(limit),
      countJobs(admin, (q) =>
        myJobs(q, me).in("status", ON_SITE_STATUSES).lt("scheduled_date", todayGst),
      ),
      countJobs(admin, (q) => myJobs(q, me).eq("status", "rejected")),
      countJobs(admin, (q) =>
        myJobs(q, me).in("status", ["submitted", "in_review"]),
      ),
      countJobs(admin, (q) =>
        myJobs(q, me)
          .is("inspector_id", null)
          .not("status", "in", "(approved,delivered,cancelled)"),
      ),
      (async () => {
        const { count, error } = await myQuotations(
          admin
            .from("snagging_quotations")
            .select("id", { count: "exact", head: true }),
          me,
        )
          .eq("status", "sent")
          .lt("sent_at", quoteCutoff);
        if (error) throw new Error(error.message);
        return count ?? 0;
      })(),
    ]);
    for (const result of [onSite, rejected, overdue, waiting, unassigned, staleQuotes]) {
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

    type QuoteRow = {
      id: string;
      quote_number: string;
      status: string;
      sent_at: string | null;
      updated_at: string;
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
      ...((unassigned.data ?? []) as Row[]).map((row) => ({
        id: row.id,
        severity: "pending" as const,
        title: `${row.code} has no inspector`,
        subtitle: place(row),
        at: row.updated_at,
        href: `/snagging/${row.id}`,
      })),
      ...((staleQuotes.data ?? []) as QuoteRow[]).map((row) => ({
        id: row.id,
        severity: "pending" as const,
        title: `${row.quote_number} unanswered for 2 days`,
        subtitle: "Sent to the client, no decision yet",
        at: row.sent_at ?? row.updated_at,
        href: `/snagging/quotations/${row.id}`,
      })),
    ].slice(0, limit);

    return NextResponse.json(
      {
        data: {
          total:
            onSiteCount +
            rejectedCount +
            waitingCount +
            unassignedCount +
            staleQuoteCount,
          items,
        },
      },
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
