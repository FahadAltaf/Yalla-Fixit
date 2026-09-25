import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { setVisitRoster } from "@/lib/server/snagging/job-roster";
import { loadJobVisits } from "@/lib/server/snagging/job-detail-sections";
import { createVisitSchema } from "@/modules/snagging/schemas";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Additional visits on one job (BA v2, changes 25-30 / FR-9.01 to FR-9.04).
 *
 * A visit is an APPOINTMENT, not a job. It used to be a whole
 * `snagging_jobs` row — its own code, its own copy of every area, its own
 * floor plans, its own checklist and its own report — which is precisely
 * what change 25 rejects, and it had a concrete cost: anything found on
 * the return landed on a different job from the inspection it belonged
 * to, so the client received two reports for one property.
 *
 * Now it is a row in `snagging_job_visits` hanging off the job. Nothing
 * is copied:
 *
 *   - the areas are the job's areas, so every room is available and the
 *     ones that were blocked still carry their access state (change 27,
 *     answer Q6), and an inspector can recheck any of them (change 28)
 *   - defects are written to the JOB and tagged with `visit_id`, so they
 *     join the one report while still saying which pass found them
 *   - the checklist is the job's, and change 29 is a filter on it rather
 *     than a second copy
 *
 * The other half is change 26: a visit does not always need a quotation.
 * It is usually a penalty the client pays by link, so the coordinator
 * records which route was used and only the quotation route waits for an
 * approval.
 */


export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    // const { profile, accessUser } = await getRequestUserAccess(req);
    // if (!profile || !accessUser) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // }
    // if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
    //   return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    // }

    const { id } = await ctx.params;
    const admin = await createAdminServerClient();

    return NextResponse.json({ data: await loadJobVisits(admin, id) });
  } catch (error) {
    console.error("Snagging visits GET error:", error);
    return NextResponse.json(
      { error: "Failed to load additional visits" },
      { status: 500 },
    );
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      !hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.CREATE)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const parsed = createVisitSchema.safeParse(
      await req.json().catch(() => ({})),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const input = parsed.data;

    /*
      A visit is a trip that has not happened yet, so it cannot be asked
      for a moment that has gone. An appointment is compared as an
      instant; a bare date as the Gulf day an inspector means by it.
    */
    if (input.appointment_at) {
      if (new Date(input.appointment_at).getTime() <= Date.now()) {
        return NextResponse.json(
          { error: "Pick an appointment time in the future for this visit." },
          { status: 400 },
        );
      }
    } else {
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Dubai",
      }).format(new Date());
      if (input.scheduled_date.trim() < today) {
        return NextResponse.json(
          { error: "Pick a date in the future for this visit." },
          { status: 400 },
        );
      }
    }

    const admin = await createAdminServerClient();

    const { data: openedFrom, error: openedFromError } = await admin
      .from("snagging_jobs")
      .select("id, code, status, parent_job_id, inspector_id")
      .eq("id", id)
      .maybeSingle();
    if (openedFromError) throw new Error(openedFromError.message);
    if (!openedFrom) {
      return NextResponse.json(
        { error: "Inspection not found" },
        { status: 404 },
      );
    }

    // Every visit hangs off the original inspection, so one opened from a
    // de-snag job still belongs to the record the client has.
    const rootId =
      (openedFrom.parent_job_id as string | null) ?? (openedFrom.id as string);

    const { data: job, error: jobError } = await admin
      .from("snagging_jobs")
      .select("id, code, status, inspector_id")
      .eq("id", rootId)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job)
      return NextResponse.json(
        { error: "Inspection not found" },
        { status: 404 },
      );

    /*
      The property is between visits, not mid-inspection. Unchanged from
      the old model: a return trip to a unit somebody is still walking is
      a scheduling mistake, not a second pass.
    */
    if (!["approved", "delivered"].includes(job.status as string)) {
      return NextResponse.json(
        {
          error:
            "Approve the current inspection before adding an additional visit",
        },
        { status: 409 },
      );
    }

    // Numbered per job, so "visit 2" means the second visit to this unit.
    const { data: existing, error: existingError } = await admin
      .from("snagging_job_visits")
      .select("visit_number")
      .eq("job_id", rootId)
      .order("visit_number", { ascending: false })
      .limit(1);
    if (existingError) throw new Error(existingError.message);
    const visitNumber =
      ((existing?.[0]?.visit_number as number | undefined) ?? 1) + 1;

    /*
      Change 30 — a fixed price per visit per property, whichever way it
      is charged. Stamped now rather than read at display time, so a later
      change to the rate card cannot rewrite what a client was told.
    */
    const { data: pricing } = await admin
      .from("snagging_pricing_config")
      .select("additional_visit_price")
      .eq("id", true)
      .maybeSingle();
    const charge = Number(pricing?.additional_visit_price ?? 0) || null;

    const { data: visit, error: visitError } = await admin
      .from("snagging_job_visits")
      .insert({
        job_id: rootId,
        visit_number: visitNumber,
        /*
          Requested, not booked. Scheduling is a separate step because a
          quotation-charged visit waits for the client to approve it; a
          link-charged one only waits for the coordinator.
        */
        status: "requested",
        scheduled_date: input.scheduled_date.trim(),
        appointment_at: input.appointment_at ?? null,
        // The first of them; the rest go to snagging_visit_inspectors
        // below, once the row has an id.
        inspector_id: input.technician_ids[0] ?? null,
        charge,
        charge_method: input.charge_method,
        // A link-charged visit names no quotation; the database enforces it.
        payment_reference:
          input.charge_method === "payment_link"
            ? input.payment_reference?.trim() || null
            : null,
        notes:
          [input.reason?.trim(), input.notes?.trim()]
            .filter(Boolean)
            .join("\n\n") || null,
        created_by: profile.id,
      })
      .select("id, visit_number, charge, charge_method")
      .single();
    if (visitError) throw new Error(visitError.message);

    // Everyone attending, so a visit walked by two inspectors reaches both.
    await setVisitRoster(admin, visit.id as string, [
      ...new Set(input.technician_ids),
    ]);

    await recordAudit(admin, {
      entityType: "task",
      entityId: rootId,
      taskId: rootId,
      eventType: "additional_visit_created",
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email,
      payload: {
        visit_id: visit.id,
        visit_number: visit.visit_number,
        charge: visit.charge,
        charge_method: visit.charge_method,
        scheduled_date: input.scheduled_date.trim(),
        reason: input.reason?.trim() || null,
      },
    });

    return NextResponse.json({ data: visit }, { status: 201 });
  } catch (error) {
    console.error("Snagging additional visit POST error:", error);
    return NextResponse.json(
      { error: "Failed to add the additional visit" },
      { status: 500 },
    );
  }
}
