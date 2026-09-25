import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { loadJobFamily } from "@/lib/server/snagging/job-family";
import { PROPERTY_COLUMNS } from "@/lib/server/snagging/property";
import {
  loadPricingConfig,
  priceVisit,
  UNDECIDED,
  type QuotedProperty,
} from "@/lib/server/snagging/quotation-build";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Raises the quotation an additional visit is charged by (BA v2, changes
 * 26 and 30; FR-9.04, BR-14).
 *
 * The step the visit flow was missing. A visit set to "charged by
 * quotation" cannot be booked until the client approves one — the gate
 * has always been enforced — but nothing anywhere could raise that
 * quotation or tie it to the visit, so the only button on the row was a
 * Book that refused every time.
 *
 * "When a quotation is used, it must be created from the same job"
 * (change 26): so it is raised HERE, against the visit's own job, and
 * linked to the visit in the same request. The booking gate then finds it
 * without anybody having to connect the two by hand.
 *
 * One live quotation per visit. A rejected one does not block the next —
 * the client said no to that document, not to ever being asked again.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; visitId: string }> },
) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id, visitId } = await ctx.params;
    const admin = await createAdminServerClient();

    // Visits live on the family's root, whichever job the page is showing.
    const family = await loadJobFamily(admin, id);

    const { data: visit, error: visitError } = await admin
      .from("snagging_job_visits")
      .select("id, job_id, visit_number, status, charge, charge_method, quotation_id")
      .eq("id", visitId)
      .maybeSingle();
    if (visitError) throw new Error(visitError.message);
    if (!visit || visit.job_id !== family.rootId) {
      return NextResponse.json({ error: "Visit not found on this job" }, { status: 404 });
    }

    if (visit.charge_method !== "quotation") {
      return NextResponse.json(
        {
          error:
            "This visit is charged by payment link, so it has no quotation. Switch it to quotation first if the client wants one.",
        },
        { status: 409 },
      );
    }
    if (visit.status === "cancelled" || visit.status === "completed") {
      return NextResponse.json(
        { error: `This visit is ${visit.status}, so there is nothing left to quote.` },
        { status: 409 },
      );
    }

    // One live quotation per visit.
    if (visit.quotation_id) {
      const { data: current, error: currentError } = await admin
        .from("snagging_quotations")
        .select("id, quote_number, status")
        .eq("id", visit.quotation_id as string)
        .maybeSingle();
      if (currentError) throw new Error(currentError.message);
      if (current && current.status !== "rejected") {
        return NextResponse.json(
          {
            error: `Quotation ${current.quote_number} is already ${current.status} for this visit.`,
          },
          { status: 409 },
        );
      }
    }

    const config = await loadPricingConfig(admin);
    if (!config) {
      return NextResponse.json({ error: "Pricing is not configured yet" }, { status: 400 });
    }

    const { data: job, error: jobError } = await admin
      .from("snagging_jobs")
      .select(
        `id, code, client_id, property_id,
         client:client_id(id, name, email, phone),
         property:property_id(${PROPERTY_COLUMNS})`,
      )
      .eq("id", visit.job_id as string)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) {
      return NextResponse.json({ error: "That job was not found" }, { status: 404 });
    }

    // An embedded row arrives as an object or a one-item array depending on
    // how the relationship is inferred; both happen in practice.
    const first = (v: unknown): Record<string, unknown> | null =>
      Array.isArray(v)
        ? ((v[0] as Record<string, unknown>) ?? null)
        : ((v as Record<string, unknown>) ?? null);
    const property = first(job.property);
    const client = first(job.client);
    if (!property) {
      return NextResponse.json(
        { error: "This job has no property record to put on the quotation" },
        { status: 400 },
      );
    }

    /*
      The visit's own charge, frozen when it was requested — the number
      the coordinator has already seen on the row. Today's card is only
      the fallback for a visit that somehow carries none.
    */
    const charge =
      Number(visit.charge) || Number(config.additional_visit_price) || 0;

    const priced = priceVisit(
      property as QuotedProperty,
      client as { name?: string | null } | null,
      config,
      {
        visitNumber: visit.visit_number as number,
        charge,
      },
    );
    if (!priced) {
      return NextResponse.json(
        {
          error:
            "The rate card has no additional visit price yet. Set one on the Settings page first.",
        },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    const { data: quote, error: insertError } = await admin
      .from("snagging_quotations")
      .insert({
        // The visit's own job, so the booking gate's "same job" check holds.
        job_id: visit.job_id,
        client_id: job.client_id,
        property_id: job.property_id,
        quote_kind: "visit",
        ...UNDECIDED,
        ...priced,
        created_by: profile.id,
        updated_at: now,
      })
      .select("id, quote_number, status, total")
      .single();
    if (insertError) throw new Error(insertError.message);

    /*
      Linked in the same request. Leaving it for the coordinator to
      connect by hand is the gap this route exists to close.
    */
    const { error: linkError } = await admin
      .from("snagging_job_visits")
      .update({ quotation_id: quote.id, updated_at: now })
      .eq("id", visitId);
    if (linkError) {
      // Undo the orphan rather than leave a quotation no visit points at.
      await admin.from("snagging_quotations").delete().eq("id", quote.id);
      throw new Error(linkError.message);
    }

    await recordAudit(admin, {
      entityType: "quotation",
      entityId: quote.id as string,
      taskId: visit.job_id as string,
      eventType: "quotation_generated",
      actorId: profile.id,
      payload: {
        quote_number: quote.quote_number,
        total: priced.total,
        kind: "visit",
        visit_number: visit.visit_number,
      },
    });

    return NextResponse.json({ data: quote }, { status: 201 });
  } catch (error) {
    console.error("Visit quotation POST error:", error);
    return NextResponse.json(
      { error: "Failed to raise the quotation for this visit" },
      { status: 500 },
    );
  }
}
