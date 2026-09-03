import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { INHERITED_SELECT, inheritedFields, type InheritableJob } from "@/lib/server/snagging/inherit";
import { loadJobFamily } from "@/lib/server/snagging/job-family";
import { listReportVersions } from "@/lib/server/snagging/report-versions";
import { visitCode } from "@/lib/server/snagging/workflow";
import { createVisitSchema } from "@/modules/snagging/schemas";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Schedules an additional snagging visit on a property (Q1-Q6, F13).
 *
 * This is NOT a de-snag round: it is a fresh, chargeable inspection pass
 * requested on top of the package (a client wants the unit looked at
 * again). So it copies the parent's areas but carries no snags forward —
 * the inspector starts clean — and it snapshots the additional-visit
 * price from the pricing config onto the new job so the charge is fixed
 * at the moment it was booked.
 */
/** PostgREST returns an embedded row as an object or a one-element array. */
function firstOf<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Every additional visit against this inspection, with the answers the
 * Additional Visits section has to show.
 *
 * One request rather than a list plus a lookup per visit: a coordinator
 * opening the section wants the whole picture, and n+1 round trips at
 * ~220ms each is what makes a section feel broken.
 */
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

    // Asked from a visit or a round, the section still means the family.
    const family = await loadJobFamily(admin, id);

    const { data: visits, error: visitsError } = await admin
      .from("snagging_jobs")
      .select(
        `id, code, status, round_number, scheduled_date, appointment_at, visit_charge,
         created_at, inspector:inspector_id(id, full_name, email)`,
      )
      .eq("parent_job_id", family.rootId)
      .eq("visit_type", "additional")
      .order("round_number", { ascending: true });
    if (visitsError) throw new Error(visitsError.message);

    const visitIds = (visits ?? []).map((v) => v.id as string);
    if (visitIds.length === 0) {
      return NextResponse.json({ data: { visits: [], versions: [] } });
    }

    const [{ data: quotes }, { data: snags }, versions] = await Promise.all([
      admin
        .from("snagging_quotations")
        .select("id, job_id, status, total, quote_number")
        .in("job_id", visitIds),
      admin.from("snagging_snags").select("id, job_id").in("job_id", visitIds),
      listReportVersions(admin, family.rootId),
    ]);

    const snagCount = new Map<string, number>();
    for (const snag of snags ?? []) {
      const key = snag.job_id as string;
      snagCount.set(key, (snagCount.get(key) ?? 0) + 1);
    }

    const quoteFor = new Map<string, Record<string, unknown>>();
    for (const quote of quotes ?? []) {
      const key = quote.job_id as string;
      // An approved quote is the one that matters; otherwise the latest
      // state is what the coordinator needs to act on.
      const existing = quoteFor.get(key);
      if (!existing || quote.status === "approved") quoteFor.set(key, quote);
    }

    const versionForVisit = new Map<string, number>();
    for (const version of versions) {
      if (version.source_visit_id) versionForVisit.set(version.source_visit_id, version.version);
    }

    return NextResponse.json({
      data: {
        visits: (visits ?? []).map((visit) => {
          const quote = quoteFor.get(visit.id as string) ?? null;
          return {
            id: visit.id,
            code: visit.code,
            status: visit.status,
            visit_number: visit.round_number,
            scheduled_date: visit.scheduled_date,
            appointment_at: visit.appointment_at,
            visit_charge: visit.visit_charge,
            created_at: visit.created_at,
            inspector: firstOf(visit.inspector),
            quotation: quote
              ? {
                  id: quote.id,
                  status: quote.status,
                  total: quote.total,
                  quote_number: quote.quote_number,
                }
              : null,
            new_snags: snagCount.get(visit.id as string) ?? 0,
            report_version: versionForVisit.get(visit.id as string) ?? null,
          };
        }),
        versions,
      },
    });
  } catch (error) {
    console.error("Additional visits GET error:", error);
    return NextResponse.json({ error: "Failed to load the additional visits" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.CREATE)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const parsed = createVisitSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const input = parsed.data;

    const admin = await createAdminServerClient();

    /*
      The column list is shared with the other return-trip route rather
      than spelled out here, which costs the generated row type —
      PostgREST can only infer one from a literal string. The shape is
      asserted back below; INHERITED_COLUMNS is what keeps them honest.
    */
    const { data: openedFrom, error: openedFromError } = await admin
      .from("snagging_jobs")
      .select("id, code, status, parent_job_id")
      .eq("id", id)
      .maybeSingle();
    if (openedFromError) throw new Error(openedFromError.message);
    if (!openedFrom) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });

    /*
      FR-9.01 / FR-9.05 — every visit hangs off the ORIGINAL inspection.

      A visit took whichever job it was opened from as its parent and
      numbered itself one above that job, which breaks the moment there is
      more than one of anything:

        - opened from the original twice, both visits number themselves 2
          and both are coded "-V2"
        - opened from a de-snag round, the visit chains off the round, so
          the family becomes a tree and every consumer that walks
          parent_job_id one level up stops seeing the whole story
        - numbering off one job ignores the rounds, so a family with R2 and
          R3 hands its first visit round_number 2 as well

      Rooting here, and numbering across the whole family, is what makes
      "more than one additional visit" actually work.
    */
    const rootId = (openedFrom.parent_job_id as string | null) ?? openedFrom.id;

    const { data: parentRow, error: parentError } = await admin
      .from("snagging_jobs")
      .select(INHERITED_SELECT)
      .eq("id", rootId)
      .maybeSingle();
    const parent = parentRow as unknown as InheritableJob | null;

    if (parentError) throw new Error(parentError.message);
    if (!parent) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });

    // A visit is booked once the previous work is signed off, mirroring the
    // de-snag round guard — the property is between visits, not mid-flight.
    if (!["approved", "delivered"].includes(openedFrom.status as string)) {
      return NextResponse.json(
        { error: "Approve the current inspection before scheduling an additional visit" },
        { status: 409 },
      );
    }

    // FR-9.04 — an additional visit is a chargeable pass, so it cannot be
    // scheduled until the client has approved a quotation covering it.
    // Checked here rather than in the UI because the charge is the point:
    // booking one without an approved quote commits an inspector to work
    // nobody has agreed to pay for.
    const { data: visitQuote, error: quoteError } = await admin
      .from("snagging_quotations")
      .select("id, status")
      .eq("job_id", parent.id)
      .eq("status", "approved")
      .limit(1)
      .maybeSingle();
    if (quoteError) throw new Error(quoteError.message);
    if (!visitQuote) {
      return NextResponse.json(
        {
          error:
            "This visit needs an approved quotation before it can be scheduled. Send the quotation to the client and book once they approve it.",
        },
        { status: 409 },
      );
    }

    /*
      The next number counts every visit in the family — rounds included —
      so a visit can never take a number a de-snag round already holds and
      a second visit can never reuse the first one's code.
    */
    const { data: siblings, error: siblingError } = await admin
      .from("snagging_jobs")
      .select("round_number")
      .eq("parent_job_id", rootId);
    if (siblingError) throw new Error(siblingError.message);

    const nextRound =
      Math.max(
        parent.round_number ?? 1,
        ...(siblings ?? []).map((row) => (row.round_number as number | null) ?? 1),
      ) + 1;

    // The charge is fixed at booking time from the current config.
    const { data: pricing } = await admin
      .from("snagging_pricing_config")
      .select("additional_visit_price")
      .eq("id", true)
      .maybeSingle();
    const visitCharge = Number(pricing?.additional_visit_price ?? 0) || null;

    const inspectorId =
      input.technician_ids.length > 0 ? input.technician_ids[0] : parent.inspector_id;

    const scheduledDate = input.scheduled_date?.trim() || parent.scheduled_date;

    const { data: visit, error: visitError } = await admin
      .from("snagging_jobs")
      .insert({
        code: visitCode(parent.code, nextRound),
        /*
          A request, not a booking.

          Creating the visit commits nothing: no date, no inspector, no
          appointment. POST /visits/[visitId]/schedule is what books it,
          and it refuses until the client has approved a quotation raised
          against THIS visit (FR-9.04). Assigning here would have meant
          scheduling before anyone had agreed to pay.
        */
        status: "draft",
        visit_type: "additional",
        visit_charge: visitCharge,
        round_number: nextRound,
        parent_job_id: parent.id,
        ...inheritedFields(parent),
        inspector_id: null,
        approval_manager_id: input.approval_manager_id ?? parent.approval_manager_id,
        /*
          The date the coordinator asked for, kept as a plan.

          Blanking it threw away what they had just typed, so the Setup
          tab opened empty on a visit they had only just dated. It is a
          request, not a booking: the visit stays `draft` and scheduling
          is what confirms this date and moves it to assigned.
        */
        scheduled_date: input.scheduled_date?.trim() || null,
        appointment_at: null,
        notes: [input.reason?.trim(), input.notes?.trim()].filter(Boolean).join("\n\n") || null,
        created_by: profile.id,
      })
      .select("id, code")
      .single();

    if (visitError) throw new Error(visitError.message);

    /*
     * FR-9.02 — pre-load the rooms the earlier visit could not finish.
     *
     * The visit exists because something was unreachable, so it opens on
     * exactly that: the areas marked not accessible or limited, carrying
     * the reason and the elements that went unchecked so the inspector
     * knows what they are going back for. Every room was copied before,
     * which turned a targeted return into a full re-inspection.
     *
     * If nothing was flagged, the visit was booked for another reason
     * and falls back to the full room list rather than opening empty.
     */
    const { data: parentAreas, error: areaLoadError } = await admin
      .from("snagging_areas")
      .select(
        `name, catalogue_area_code, sort_order, access_state, access_reason,
         elements_not_checked, floor_plan_id, pin_x, pin_y`,
      )
      .eq("job_id", parent.id)
      .order("sort_order", { ascending: true });
    if (areaLoadError) throw new Error(areaLoadError.message);

    /*
      The unit's floor plans, copied before the rooms that pin onto them.

      A visit carried its rooms and no plans at all, so an inspector
      arrived at a property they had already mapped with nothing to pin
      against and no way to place a new defect. The plans belong to the
      unit, not to a single visit, so a return trip re-uses them rather
      than asking anyone to upload them again.
    */
    const { data: parentPlans, error: planLoadError } = await admin
      .from("snagging_floor_plans")
      .select("id, label, storage_path, width, height, sort_order")
      .eq("job_id", parent.id)
      .order("sort_order", { ascending: true });
    if (planLoadError) throw new Error(planLoadError.message);

    const planIdMap = new Map<string, string>();
    for (const plan of parentPlans ?? []) {
      const { data: newPlan, error: planInsertError } = await admin
        .from("snagging_floor_plans")
        .insert({
          job_id: visit.id,
          label: plan.label,
          // The same stored image; a plan id belongs to one job, so only
          // the row is new.
          storage_path: plan.storage_path,
          width: plan.width,
          height: plan.height,
          sort_order: plan.sort_order,
        })
        .select("id")
        .single();
      if (planInsertError) throw new Error(planInsertError.message);
      planIdMap.set(plan.id as string, newPlan.id as string);
    }

    const unfinished = (parentAreas ?? []).filter(
      (area) => area.access_state && area.access_state !== "accessible",
    );
    const carryAreas = unfinished.length > 0 ? unfinished : (parentAreas ?? []);

    if (carryAreas.length > 0) {
      const { error: areaInsertError } = await admin.from("snagging_areas").insert(
        carryAreas.map((area) => ({
          job_id: visit.id,
          name: area.name,
          catalogue_area_code: area.catalogue_area_code,
          sort_order: area.sort_order,
          // Where the room sits on the plan, remapped onto this visit's
          // copy of it — otherwise the pin points at a plan on another job.
          floor_plan_id: area.floor_plan_id
            ? planIdMap.get(area.floor_plan_id as string) ?? null
            : null,
          pin_x: area.pin_x,
          pin_y: area.pin_y,
          // Why the inspector is returning, carried across as a note so
          // it is in front of them on site. The area itself starts
          // clean — this is a fresh pass, not a verification.
          note:
            [
              area.access_reason ? `Previously ${area.access_state === "not_accessible" ? "no access" : "limited access"}: ${area.access_reason}` : null,
              area.elements_not_checked ? `Not checked last visit: ${area.elements_not_checked}` : null,
            ]
              .filter(Boolean)
              .join(" · ") || null,
        })),
      );
      if (areaInsertError) throw new Error(areaInsertError.message);
    }

    await recordAudit(admin, {
      entityType: "task",
      entityId: visit.id,
      taskId: visit.id,
      eventType: "additional_visit_created",
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email,
      payload: {
        code: visit.code,
        round_number: nextRound,
        parent_job_id: parent.id,
        visit_charge: visitCharge,
        areas: parentAreas?.length ?? 0,
        reason: input.reason?.trim() || null,
      },
    });

    return NextResponse.json(
      {
        data: {
          id: visit.id,
          code: visit.code,
          round_number: nextRound,
          visit_charge: visitCharge,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Snagging additional visit POST error:", error);
    return NextResponse.json({ error: "Failed to schedule additional visit" }, { status: 500 });
  }
}
