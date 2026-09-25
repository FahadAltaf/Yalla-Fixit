import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { hasVisitInspectors } from "@/lib/server/snagging/columns";
import { setVisitRoster } from "@/lib/server/snagging/job-roster";
import { loadJobFamily } from "@/lib/server/snagging/job-family";
import { updateVisitSchema } from "@/modules/snagging/schemas";
import { ActionType, ResourceType } from "@/types/types";

/**
 * One additional visit: book it, charge it, run it, close it.
 *
 * Every transition a visit has lives here rather than in an endpoint per
 * verb, because they are all the same write to the same row and the
 * rules between them are the interesting part:
 *
 *   - a visit charged BY QUOTATION cannot be booked until the client has
 *     approved that quotation (FR-9.04). The charge is the point of the
 *     trip; booking one unpaid commits an inspector to work nobody has
 *     agreed to pay for
 *   - a visit charged BY PAYMENT LINK has no quotation to wait for
 *     (change 26 / BR-14). It is a penalty the client settles directly,
 *     and holding it behind an approval that will never come is what
 *     made coordinators raise quotations they did not want
 *
 * The gate is here rather than in the UI because a disabled button is not
 * a control: a stale tab, a retry or a script reaches the API directly.
 */
/**
 * One additional visit and everything that belongs to it.
 *
 * The visit page reads this: what the visit found (its own snags, with
 * their photos), how it is being paid for, what it answered on the
 * checklist, and which rooms it went back for. Scoped to THIS visit
 * throughout — the job's other snags are the original report's, and the
 * page exists to show what the return trip added.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; visitId: string }> },
) {
  try {
    // const { profile, accessUser } = await getRequestUserAccess(req);
    // if (!profile || !accessUser) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // }
    // if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
    //   return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    // }

    const { id, visitId } = await ctx.params;
    const admin = await createAdminServerClient();
    // The family and the visit do not depend on each other: read together.
    /*
      Everyone attending, embedded with the visit rather than read
      separately -- and the page needs the whole set, not just the first:
      its Edit dialog sends back what it was given, so a visit opened here
      with only its lead inspector would lose the rest on save.

      Left out where 20260924140000 has not run, and `inspector` below is
      then the whole answer.
    */
    const rosterSelect = (await hasVisitInspectors(admin))
      ? ", roster:snagging_visit_inspectors(user_profile:inspector_id(id, full_name, email))"
      : "";
    const [family, { data: visit, error: visitError }] = await Promise.all([
      loadJobFamily(admin, id),
      admin
        .from("snagging_job_visits")
        /* Composed at runtime, so the row type is named rather than
           inferred from the select string. */
        .select<string, Record<string, unknown>>(
          `id, job_id, visit_number, status, scheduled_date, appointment_at, inspector_id,
           charge, charge_method, payment_reference, quotation_id, started_at, submitted_at,
           review_note, notes, created_at, inspector:inspector_id(id, full_name, email)${rosterSelect}`,
        )
        .eq("id", visitId)
        .maybeSingle(),
    ]);
    if (visitError) throw new Error(visitError.message);
    if (!visit || visit.job_id !== family.rootId) {
      return NextResponse.json(
        { error: "Visit not found on this job" },
        { status: 404 },
      );
    }
    const jobId = visit.job_id as string;

    const [job, quote, snags, checklist, areas] = await Promise.all([
      admin
        .from("snagging_jobs")
        .select("id, unit_label, building_name, status")
        .eq("id", jobId)
        .maybeSingle(),
      visit.quotation_id
        ? admin
            .from("snagging_quotations")
            // The Quotation tab loads the document itself, by this id.
            .select("id, status")
            .eq("id", visit.quotation_id as string)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      /*
        Only what the header counts (high severity, photographed). The list
        itself is the job's snags filtered to this visit, so these rows
        carry no labels and their photos are not signed.
      */
      admin
        .from("snagging_snags")
        .select("id, severity, photos:snagging_snag_photos(id)")
        .eq("job_id", jobId)
        .eq("visit_id", visitId)
        .neq("status", "withdrawn")
        .order("created_at", { ascending: true }),
      admin
        .from("snagging_job_checklist")
        .select("id, group_name, label, status, reason")
        .eq("job_id", jobId)
        .eq("visit_id", visitId)
        .order("sort_order", { ascending: true }),
      // The rooms a return trip is usually FOR (change 27).
      admin
        .from("snagging_areas")
        .select("id, name, access_state, access_reason, elements_not_checked")
        .eq("job_id", jobId)
        .in("access_state", ["not_accessible", "limited_access"])
        .order("sort_order", { ascending: true }),
    ]);
    for (const result of [job, quote, snags, checklist, areas]) {
      if (result.error) throw new Error(result.error.message);
    }

    const first = (v: unknown) =>
      Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

    /* The lead first, then the rest, as the visits tab lists them. */
    const lead = first(visit.inspector) as { id?: string } | null;
    const crew = ((visit.roster ?? []) as Array<Record<string, unknown>>)
      .map((row) => first(row.user_profile) as { id?: string } | null)
      .filter((person): person is { id?: string } => Boolean(person));
    const { roster: _roster, ...visitRow } = visit as Record<string, unknown>;
    void _roster;

    return NextResponse.json({
      data: {
        visit: {
          ...visitRow,
          inspector: lead,
          inspectors: lead
            ? [lead, ...crew.filter((person) => person.id !== lead.id)]
            : crew,
        },
        job: job.data,
        quotation: quote.data,
        snags: (snags.data ?? []).map((snag) => ({ ...snag, photos: snag.photos ?? [] })),
        checklist: checklist.data ?? [],
        revisit_areas: areas.data ?? [],
      },
    });
  } catch (error) {
    console.error("Visit GET error:", error);
    return NextResponse.json(
      { error: "Failed to load the visit" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; visitId: string }> },
) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      !hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.EDIT)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { visitId } = await ctx.params;
    const parsed = updateVisitSchema.safeParse(
      await req.json().catch(() => ({})),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const input = parsed.data;

    const admin = await createAdminServerClient();

    const { data: visit, error: loadError } = await admin
      .from("snagging_job_visits")
      .select("id, job_id, visit_number, status, charge_method, quotation_id")
      .eq("id", visitId)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!visit)
      return NextResponse.json({ error: "Visit not found" }, { status: 404 });

    const nextMethod = input.charge_method ?? (visit.charge_method as string);
    const nextStatus = input.status ?? (visit.status as string);

    /*
      Booking is the moment the money has to be settled, so the check
      happens on the transition INTO scheduled rather than on every edit —
      a coordinator can fill in a date on a requested visit while the
      client is still deciding.
    */
    const booking = nextStatus === "scheduled" && visit.status !== "scheduled";
    if (booking && nextMethod === "quotation") {
      const quotationId =
        input.quotation_id ?? (visit.quotation_id as string | null);
      if (!quotationId) {
        return NextResponse.json(
          {
            error:
              "This visit is charged by quotation, so raise one from this job and book it once the client approves.",
          },
          { status: 409 },
        );
      }
      const { data: quote, error: quoteError } = await admin
        .from("snagging_quotations")
        .select("id, status, job_id")
        .eq("id", quotationId)
        .maybeSingle();
      if (quoteError) throw new Error(quoteError.message);
      if (!quote) {
        return NextResponse.json(
          { error: "That quotation no longer exists." },
          { status: 409 },
        );
      }
      /*
        Change 26 — "when a quotation is used, it must be created from the
        same job". A quotation raised against a different property can
        still be approved, and without this a visit could be booked
        against somebody else's money.
      */
      if (quote.job_id && quote.job_id !== visit.job_id) {
        return NextResponse.json(
          {
            error:
              "That quotation belongs to a different job. Raise one from this job.",
          },
          { status: 409 },
        );
      }
      if (quote.status !== "approved") {
        return NextResponse.json(
          {
            error:
              "The client has not approved that quotation yet. Send it, and book the visit once they approve.",
          },
          { status: 409 },
        );
      }
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (input.charge_method !== undefined)
      patch.charge_method = input.charge_method;
    if (input.scheduled_date !== undefined)
      patch.scheduled_date = input.scheduled_date;
    if (input.appointment_at !== undefined)
      patch.appointment_at = input.appointment_at;
    /*
      Who attends. `technician_ids` is the whole set and wins where it is
      sent; `inspector_id` is still accepted on its own, which is what the
      app and any older caller send, and then means a set of one.
    */
    const visitRoster =
      input.technician_ids !== undefined
        ? [...new Set(input.technician_ids)]
        : input.inspector_id !== undefined
          ? input.inspector_id
            ? [input.inspector_id]
            : []
          : null;
    if (visitRoster !== null) patch.inspector_id = visitRoster[0] ?? null;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.status !== undefined) patch.status = input.status;

    /*
      The two charge routes are mutually exclusive, and the database says
      so too. Switching method clears what the other one carried, rather
      than leaving a row that claims both.
    */
    if (nextMethod === "payment_link") {
      patch.quotation_id = null;
      if (input.payment_reference !== undefined) {
        patch.payment_reference = input.payment_reference || null;
      }
    } else {
      patch.payment_reference = null;
      if (input.quotation_id !== undefined)
        patch.quotation_id = input.quotation_id;
    }

    // When the visit actually happened, for the report and the SLA clocks.
    if (input.status === "in_progress" && visit.status !== "in_progress") {
      patch.started_at = new Date().toISOString();
    }
    if (input.status === "completed" && visit.status !== "completed") {
      patch.completed_at = new Date().toISOString();
    }

    const { data: updated, error: updateError } = await admin
      .from("snagging_job_visits")
      .update(patch)
      .eq("id", visitId)
      .select(
        "id, job_id, visit_number, status, scheduled_date, appointment_at, inspector_id, " +
          "charge, charge_method, quotation_id, payment_reference, started_at, completed_at, notes",
      )
      .single();
    if (updateError) throw new Error(updateError.message);

    if (visitRoster !== null) await setVisitRoster(admin, visitId, visitRoster);
    /*
      Asserted rather than inferred: snagging_job_visits arrives with the
      visits migration, so the generated Database types do not carry it
      until that has run and types have been regenerated.
    */
    const row = updated as unknown as Record<string, unknown>;

    await recordAudit(admin, {
      entityType: "task",
      entityId: visit.job_id as string,
      taskId: visit.job_id as string,
      eventType: booking
        ? "additional_visit_scheduled"
        : "additional_visit_updated",
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email,
      payload: {
        visit_id: visitId,
        visit_number: visit.visit_number,
        from_status: visit.status,
        to_status: row.status,
        charge_method: row.charge_method,
      },
    });

    return NextResponse.json({ data: row });
  } catch (error) {
    console.error("Snagging visit PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to update the visit" },
      { status: 500 },
    );
  }
}

/**
 * Calls a visit off.
 *
 * Soft, not a delete: a trip that was arranged and then cancelled is part
 * of what happened to this property, and a client who was charged for it
 * will ask. Anything the visit already found stays on the job.
 */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; visitId: string }> },
) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      !hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.EDIT)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { visitId } = await ctx.params;
    const admin = await createAdminServerClient();

    const { data: visit, error: loadError } = await admin
      .from("snagging_job_visits")
      .select("id, job_id, visit_number, status")
      .eq("id", visitId)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!visit)
      return NextResponse.json({ error: "Visit not found" }, { status: 404 });

    if (visit.status === "completed") {
      return NextResponse.json(
        {
          error: "This visit has already happened, so it cannot be cancelled.",
        },
        { status: 409 },
      );
    }

    const { error: updateError } = await admin
      .from("snagging_job_visits")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", visitId);
    if (updateError) throw new Error(updateError.message);

    await recordAudit(admin, {
      entityType: "task",
      entityId: visit.job_id as string,
      taskId: visit.job_id as string,
      eventType: "additional_visit_cancelled",
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email,
      payload: { visit_id: visitId, visit_number: visit.visit_number },
    });

    return NextResponse.json({ data: { id: visitId, status: "cancelled" } });
  } catch (error) {
    console.error("Snagging visit DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to cancel the visit" },
      { status: 500 },
    );
  }
}
