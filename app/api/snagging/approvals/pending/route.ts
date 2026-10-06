import { NextRequest, NextResponse } from "next/server";

import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import {
  ActionType,
  ResourceType,
  type SnaggingPendingApproval,
} from "@/types/types";

/**
 * What is waiting on YOU, in Snagging (FR-6.01).
 *
 * The notice at the top of the module polls this on every page, so
 * somebody with nothing waiting gets an empty list rather than an error.
 *
 * "Waiting on you" is the same two tests the decision routes apply, read
 * from the other end: a job is yours to review if you are its named
 * reviewer, or if nobody is named and you are its approval manager; it is
 * yours to approve once the review is complete and you are that manager.
 * Nothing here is about permissions \u2014 holding Snagging's approve grant
 * does not put another person's job in your list, and not holding it does
 * not take your own out.
 */

type Row = {
  id: string;
  code: string | null;
  unit_label: string | null;
  building_name: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  approval_due_at: string | null;
  client: { name: string | null } | { name: string | null }[] | null;
};

/* Enough to work a morning from; the queue page holds the rest. */
const LIMIT = 25;

export async function GET(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Anyone who cannot open Snagging has nothing waiting in it.
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ data: { items: [] } });
    }

    const me = profile.id;
    const admin = await createAdminServerClient();

    /*
      The three ways a job can be waiting on one person, as one filter:

        reviewer named, and it is me, and the review is not done
        no reviewer named, manager is me, review not done  -- I review it
        manager is me, and the review IS done             -- I approve it

      Written as a single `or` rather than three requests because the
      notice polls, and one round trip that returns nothing is cheap
      enough to run on every page.
    */
    const { data, error } = await admin
      .from("snagging_jobs")
      .select(
        "id, code, unit_label, building_name, submitted_at, reviewed_at, approval_due_at, client:client_id(name)",
      )
      .in("status", ["submitted", "in_review"])
      .or(
        [
          `and(reviewed_at.is.null,reviewer_id.eq.${me})`,
          `and(reviewed_at.is.null,reviewer_id.is.null,approval_manager_id.eq.${me})`,
          `and(reviewed_at.not.is.null,approval_manager_id.eq.${me})`,
        ].join(","),
      )
      // Oldest first: the one that has waited longest is the one to do.
      .order("submitted_at", { ascending: true, nullsFirst: false })
      .limit(LIMIT);

    if (error) throw new Error(error.message);

    const now = Date.now();
    const items: SnaggingPendingApproval[] = ((data ?? []) as unknown as Row[]).map(
      (row) => {
        const client = Array.isArray(row.client) ? row.client[0] : row.client;
        const due = row.approval_due_at ? Date.parse(row.approval_due_at) : NaN;
        return {
          id: row.id,
          code: row.code,
          unitLabel: row.unit_label,
          buildingName: row.building_name,
          clientName: client?.name ?? null,
          step: row.reviewed_at ? "approve" : "review",
          submittedAt: row.submitted_at,
          reviewedAt: row.reviewed_at,
          overdue: !Number.isNaN(due) && due < now,
        };
      },
    );

    return NextResponse.json({ data: { items } });
  } catch (error) {
    console.error("Snagging pending approvals error:", error);
    return NextResponse.json(
      { error: "Failed to load what is waiting on you" },
      { status: 500 },
    );
  }
}
