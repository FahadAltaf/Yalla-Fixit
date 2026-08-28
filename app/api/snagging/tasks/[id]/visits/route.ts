import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
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

    const { data: parent, error: parentError } = await admin
      .from("snagging_jobs")
      .select(
        `id, code, status, round_number, client_id, property_id, unit_label, building_name, community,
         property_type, developer_name, inspector_id, approval_manager_id, scheduled_date`,
      )
      .eq("id", id)
      .maybeSingle();

    if (parentError) throw new Error(parentError.message);
    if (!parent) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });

    // A visit is booked once the previous work is signed off, mirroring the
    // de-snag round guard — the property is between visits, not mid-flight.
    if (!["approved", "delivered"].includes(parent.status)) {
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

    const nextRound = (parent.round_number ?? 1) + 1;

    // The charge is fixed at booking time from the current config.
    const { data: pricing } = await admin
      .from("snagging_pricing_config")
      .select("additional_visit_price")
      .eq("id", true)
      .maybeSingle();
    const visitCharge = Number(pricing?.additional_visit_price ?? 0) || null;

    const inspectorId =
      input.technician_ids.length > 0 ? input.technician_ids[0] : parent.inspector_id;

    const { data: visit, error: visitError } = await admin
      .from("snagging_jobs")
      .insert({
        code: visitCode(parent.code, nextRound),
        status: "assigned",
        visit_type: "additional",
        visit_charge: visitCharge,
        round_number: nextRound,
        parent_job_id: parent.id,
        client_id: parent.client_id,
        property_id: parent.property_id,
        unit_label: parent.unit_label,
        building_name: parent.building_name,
        community: parent.community,
        property_type: parent.property_type,
        developer_name: parent.developer_name,
        inspector_id: inspectorId,
        approval_manager_id: input.approval_manager_id ?? parent.approval_manager_id,
        scheduled_date: input.scheduled_date?.trim() || parent.scheduled_date,
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
      .select("name, catalogue_area_code, sort_order, access_state, access_reason, elements_not_checked")
      .eq("job_id", parent.id)
      .order("sort_order", { ascending: true });
    if (areaLoadError) throw new Error(areaLoadError.message);

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
