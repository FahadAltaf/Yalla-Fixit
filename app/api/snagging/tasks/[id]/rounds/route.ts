import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { INHERITED_SELECT, inheritedFields, type InheritableJob } from "@/lib/server/snagging/inherit";
import { CARRY_FORWARD_STATUSES, roundCode } from "@/lib/server/snagging/workflow";
import { createRoundSchema } from "@/modules/snagging/schemas";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Opens a de-snagging round against an inspection (FR-6.01, FR-6.02).
 *
 * In the lean schema a round is simply a new snagging_jobs row that
 * points back at the original inspection — every round in a family
 * shares that one parent, however many there are, and can be opened
 * from any of them.
 *
 * Areas belong to a job, so the round gets its own copy of the
 * original's areas, and everything still outstanding on the original is
 * carried forward as fresh rows against the new job (remapped onto the
 * copied areas) with status pending_verification: the developer has
 * claimed these are fixed and this round is us going to check.
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
    const parsed = createRoundSchema.safeParse(await req.json().catch(() => ({})));
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

    // A round only makes sense once the visit it follows has been signed
    // off; otherwise the outstanding list is still moving.
    if (!["approved", "delivered"].includes(openedFrom.status)) {
      return NextResponse.json(
        { error: "Approve the previous round before opening a re-inspection" },
        { status: 409 },
      );
    }

    /*
      FR-6.01 — every round hangs off the ORIGINAL inspection, not off the
      round before it.

      A round used to take whichever job it was opened from as its parent,
      so round 3 pointed at round 2 and the family became a chain. That
      broke three things at once: the code came out "UNIT-R2-R3", the
      audit trail read only one link up so a reviewer on round 3 saw a
      history with round 1 missing, and a verdict written through to "the
      parent" landed on round 2's working copy instead of the lasting
      record on the original inspection.

      Rooting here makes the shape match what BRD 5.2 describes — one
      inspection, one lasting record per defect, N rounds against it —
      and every consumer that walks parent_job_id becomes correct without
      knowing about rounds at all.
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

    /*
      Two live rounds against one inspection would each carry the same
      defects and each claim a verdict on them, so the second to be
      worked would silently overwrite the first.
    */
    const { data: siblings, error: siblingError } = await admin
      .from("snagging_jobs")
      .select("id, code, status, round_number, visit_type")
      .eq("parent_job_id", rootId);
    if (siblingError) throw new Error(siblingError.message);

    const liveRound = (siblings ?? []).find(
      (row) =>
        row.visit_type === "desnag" &&
        !["approved", "delivered", "cancelled"].includes(row.status as string),
    );
    if (liveRound) {
      return NextResponse.json(
        { error: `Round ${liveRound.code} is still open. Finish it before opening another.` },
        { status: 409 },
      );
    }

    // The next number counts the whole family, so it keeps rising even
    // when a round is opened from the original rather than the last one.
    const nextRound =
      Math.max(
        parent.round_number ?? 1,
        ...(siblings ?? []).map((row) => (row.round_number as number | null) ?? 1),
      ) + 1;

    /*
      Where the CHECKLIST and the room access record are carried from.

      Snags come from the original, because the original holds the lasting
      record for a defect and a verdict on any round writes through to it —
      so it is always current. The checklist has no such write-through:
      each visit answers its own copy and nothing propagates back. Reading
      it from the original meant round 3 inherited round 1's answers and
      silently discarded everything round 2 had re-checked.

      So the checklist comes from the most recently numbered visit that has
      been signed off, which is the last time anybody actually looked.
    */
    const lastCompleted = (siblings ?? [])
      .filter((row) => ["approved", "delivered"].includes(row.status as string))
      .sort((a, b) => ((b.round_number as number) ?? 1) - ((a.round_number as number) ?? 1))[0];
    const answersFromId = (lastCompleted?.id as string | undefined) ?? parent.id;

    // FR-6.02: everything still outstanding on the parent job, unless the
    // reviewer narrowed the list to a chosen subset.
    let snagQuery = admin
      .from("snagging_snags")
      .select(
        `id, area_id, snag_code, catalogue_entry_id, catalogue_code, element_label,
         defect_label, severity, note, floor_plan_id, pin_x, pin_y, status, round_created`,
      )
      .eq("job_id", parent.id)
      .in("status", CARRY_FORWARD_STATUSES);

    if (input.snag_ids && input.snag_ids.length > 0) {
      snagQuery = snagQuery.in("id", input.snag_ids);
    }

    const { data: openSnags, error: snagError } = await snagQuery;
    if (snagError) throw new Error(snagError.message);

    /*
      A round is not only about snags.

      An item the inspector marked FAILED, or could not check at all, is
      outstanding in exactly the same sense as a defect that was not fixed —
      somebody has to go back and answer it. Refusing to open a round unless
      a snag was outstanding meant a unit whose only problem was six failed
      checks had no way to be re-inspected at all.
    */
    const { data: openChecks, error: checkError } = await admin
      .from("snagging_job_checklist")
      .select("code")
      .eq("job_id", parent.id)
      .in("status", ["failed", "not_checked"]);
    if (checkError) throw new Error(checkError.message);

    const outstandingChecks = openChecks?.length ?? 0;

    if ((!openSnags || openSnags.length === 0) && outstandingChecks === 0) {
      return NextResponse.json(
        { error: "Nothing outstanding on this job, so there is nothing to re-inspect" },
        { status: 409 },
      );
    }

    // 1) The round itself: a new job that inherits the parent's context.
    const inspectorId =
      input.technician_ids.length > 0 ? input.technician_ids[0] : parent.inspector_id;

    const scheduledDate = input.scheduled_date?.trim() || parent.scheduled_date;

    const { data: round, error: roundError } = await admin
      .from("snagging_jobs")
      .insert({
        code: roundCode(parent.code, nextRound),
        status: "assigned",
        visit_type: "desnag",
        round_number: nextRound,
        parent_job_id: parent.id,
        // Everything describing the unit and how to get into it — see
        // inherit.ts for why this is a shared list rather than two.
        ...inheritedFields(parent),
        inspector_id: inspectorId,
        approval_manager_id: input.approval_manager_id ?? parent.approval_manager_id,
        scheduled_date: scheduledDate,
        /*
          The appointment slot belongs to the date it was booked for. A
          return trip that keeps the parent's date keeps its slot; one
          moved to a new date starts unbooked, rather than showing a
          confirmed time that nobody agreed to.
        */
        appointment_at:
          scheduledDate === parent.scheduled_date ? parent.appointment_at : null,
        notes: input.notes?.trim() || (parent.notes as string | null),
        created_by: profile.id,
      })
      .select("id, code")
      .single();

    if (roundError) throw new Error(roundError.message);

    /*
      2) The unit's floor plans, copied first so both the rooms and the
      carried defects can be re-pinned onto the round's own copies.

      A plan id belongs to one job. Carrying pin_x/pin_y without remapping
      the plan left every carried defect pinned to a plan that did not
      exist on this job, and the reviewer's pin preview said the plan was
      unavailable for defects whose plan was right there.
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
          job_id: round.id,
          label: plan.label,
          // The same stored image; a round re-uses the unit's plans
          // rather than asking anyone to upload them again.
          storage_path: plan.storage_path,
          width: plan.width,
          height: plan.height,
          sort_order: plan.sort_order,
        })
        .select("id")
        .single();
      if (planInsertError) throw new Error(planInsertError.message);
      planIdMap.set(plan.id, newPlan.id);
    }

    /*
      3) The ORIGINAL's areas, keeping an old-area-id -> new-area-id map so
      the carried snags can be re-pinned onto the round's own rows.

      Deliberately the original's, not the last round's: the snags carried
      below come from the original too, so their area_id values are the
      original's ids and this is the map that has to resolve them. Sourcing
      the rooms from anywhere else silently drops every carried defect's
      room, which is worse than the stale access note it would fix.
    */
    const { data: parentAreas, error: areaLoadError } = await admin
      .from("snagging_areas")
      .select(
        `id, name, catalogue_area_code, sort_order, floor_plan_id, pin_x, pin_y,
         access_state, access_reason, elements_not_checked`,
      )
      .eq("job_id", parent.id)
      .order("sort_order", { ascending: true });
    if (areaLoadError) throw new Error(areaLoadError.message);

    /*
      The access record from the last time anyone was on site, overlaid by
      room name. A room that was locked on round 1 but opened on round 2
      should not arrive on round 3 still marked inaccessible.
    */
    const latestAccess = new Map<string, Record<string, unknown>>();
    if (answersFromId !== parent.id) {
      const { data: latestAreas, error: latestAreaError } = await admin
        .from("snagging_areas")
        .select("name, access_state, access_reason, elements_not_checked")
        .eq("job_id", answersFromId);
      if (latestAreaError) throw new Error(latestAreaError.message);
      for (const area of latestAreas ?? []) latestAccess.set(area.name as string, area);
    }

    const areaIdMap = new Map<string, string>();
    for (const area of parentAreas ?? []) {
      const { data: newArea, error: areaInsertError } = await admin
        .from("snagging_areas")
        .insert({
          job_id: round.id,
          name: area.name,
          catalogue_area_code: area.catalogue_area_code,
          sort_order: area.sort_order,
          /*
            The room's pin on the floor plan, carried with it.

            A round copied the name and dropped the pin, so every room on
            the round sat unplaced and the inspector had to re-pin a unit
            they had already mapped — and until they did, a carried snag
            re-pinned onto that room had nothing to point at.

            The plan id is remapped onto the round's own copy of the plan,
            which is why the plans are copied first.
          */
          floor_plan_id: area.floor_plan_id
            ? planIdMap.get(area.floor_plan_id) ?? null
            : null,
          pin_x: area.pin_x,
          pin_y: area.pin_y,
          /*
            Why a room could not be checked last time. A round returns to
            exactly these rooms, so the reason it was locked, and what went
            unchecked because of it, is the point of going back.
          */
          ...(() => {
            const latest = latestAccess.get(area.name as string) ?? area;
            return {
              access_state: latest.access_state,
              access_reason: latest.access_reason,
              elements_not_checked: latest.elements_not_checked,
            };
          })(),
          // Status stays at its default: the round walks the room again.
        })
        .select("id")
        .single();
      if (areaInsertError) throw new Error(areaInsertError.message);
      areaIdMap.set(area.id, newArea.id);
    }


    /*
      3) Carry the outstanding snags onto the round.

      The round gets its own row per carried defect, marked pending
      verification and re-pinned onto the copied areas, so an inspector
      walking the round has something to give a verdict to and the round
      keeps a record of what it checked.

      BRD 5.2 still wants one lasting record per defect: the parent's row
      is that record, and a verdict given here writes through to it (see
      applyVerification in the sync push). The copy carries the same
      snag_code, which is what links the two — a code is unique within a
      job, so the pair is unambiguous.
    */
    const carriedRows = openSnags.map((snag) => ({
      job_id: round.id,
      area_id: snag.area_id ? areaIdMap.get(snag.area_id) ?? null : null,
      floor_plan_id: snag.floor_plan_id ? planIdMap.get(snag.floor_plan_id) ?? null : null,
      snag_code: snag.snag_code,
      catalogue_entry_id: snag.catalogue_entry_id,
      catalogue_code: snag.catalogue_code,
      element_label: snag.element_label,
      defect_label: snag.defect_label,
      severity: snag.severity,
      note: snag.note,
      pin_x: snag.pin_x,
      pin_y: snag.pin_y,
      status: "pending_verification" as const,
      /*
        The round the defect was FOUND on, which the copy inherits — not
        the round it was copied into.

        Stamping the new round here made every carried defect look like it
        was raised on this visit, so a round of eleven re-checks and one
        genuinely new defect reported as twelve new defects, and the
        developer's count of what they had failed to fix vanished.
      */
      round_created: snag.round_created ?? 1,
    }));

    if (carriedRows.length > 0) {
      const { data: carried, error: carryError } = await admin
        .from("snagging_snags")
        .insert(carriedRows)
        .select("id, snag_code");
      if (carryError) throw new Error(carryError.message);

      /*
        The evidence comes with the defect.

        An inspector on a de-snag is asked "was this fixed?", and the only
        way to answer is to see what it looked like. Without the original
        photo the round showed a line of text and a verdict button.

        Each row owns its object — storage_path is unique — so the file is
        copied rather than referenced, which also means deleting a photo
        on the round cannot blank the round-1 record it came from. The
        round_number the shot was taken on rides along, so the report can
        still label it as the earlier round's photo beside the new one.
      */
      const newSnagId = new Map(
        (carried ?? []).map((row) => [row.snag_code, row.id] as const),
      );
      const { data: parentPhotos, error: photoLoadError } = await admin
        .from("snagging_snag_photos")
        .select(
          `snag_id, storage_path, media_type, bytes, width, height, taken_at,
           round_number, gps_lat, gps_lng, exif, marker_x, marker_y`,
        )
        .in("snag_id", openSnags.map((snag) => snag.id));
      if (photoLoadError) throw new Error(photoLoadError.message);

      const codeOf = new Map(openSnags.map((snag) => [snag.id, snag.snag_code] as const));
      for (const photo of parentPhotos ?? []) {
        const snagId = newSnagId.get(codeOf.get(photo.snag_id) ?? "");
        if (!snagId) continue;

        // Objects are filed under the job they belong to, so swapping the
        // job segment keeps the round's copies in the round's folder and
        // keeps the leaf name — already unique — unique.
        const destination = photo.storage_path.includes(parent.id)
          ? photo.storage_path.replace(parent.id, round.id)
          : `tasks/${round.id}/carried/${photo.storage_path.split("/").pop()}`;

        const { error: copyError } = await admin.storage
          .from("snagging")
          .copy(photo.storage_path, destination);
        // A missing original should not cost the inspector the whole
        // round; they lose one before-shot and the rest still opens.
        if (copyError) {
          console.warn("Round photo copy skipped:", photo.storage_path, copyError.message);
          continue;
        }

        const { snag_id: _origin, storage_path: _path, ...rest } = photo;
        const { error: photoError } = await admin.from("snagging_snag_photos").insert({
          ...rest,
          snag_id: snagId,
          job_id: round.id,
          storage_path: destination,
        });
        if (photoError) throw new Error(photoError.message);
      }

      // The originals move to pending verification too, so the parent
      // record shows the defect is with YFI to re-check rather than
      // still sitting open with the developer.
      const { error: originError } = await admin
        .from("snagging_snags")
        .update({ status: "pending_verification", updated_at: new Date().toISOString() })
        .in("id", openSnags.map((snag) => snag.id));
      if (originError) throw new Error(originError.message);
    }

    /*
      4) The checklist the round is worked against.

      It was not copied before, so every round opened with an empty
      Checklist tab — the inspector arrived on site with half a job. It
      copies as a fresh set of unanswered items, because a round is
      answered on its own merits, not inherited from the visit before it.
    */
    const { data: parentChecklist, error: checklistLoadError } = await admin
      .from("snagging_job_checklist")
      .select("code, label, group_name, mandatory, sort_order, status, reason")
      .eq("job_id", answersFromId)
      .order("sort_order", { ascending: true });
    if (checklistLoadError) throw new Error(checklistLoadError.message);

    if (parentChecklist && parentChecklist.length > 0) {
      const { error: checklistError } = await admin.from("snagging_job_checklist").insert(
        parentChecklist.map((item) => ({
          job_id: round.id,
          code: item.code,
          label: item.label,
          group_name: item.group_name,
          mandatory: item.mandatory,
          sort_order: item.sort_order,
          /*
            The answer from the last visit, carried rather than wiped.

            A round used to copy the checklist as a blank set, which threw
            away the reason the round exists: an item that FAILED or went
            NOT CHECKED is precisely what someone is going back for. It also
            made the inspector re-answer forty items that had already
            passed, on a visit that was never about them.

            The round's own answers overwrite these as it is walked, and a
            carried failure is what the re-check list is built from. Nothing
            is lost either way: the original job keeps its own rows, so
            round 1's answers stay readable next to round 2's.
          */
          status: item.status,
          reason: item.reason,
        })),
      );
      if (checklistError) throw new Error(checklistError.message);
    }

    await recordAudit(admin, {
      entityType: "task",
      entityId: round.id,
      taskId: round.id,
      eventType: "round_created",
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email,
      payload: {
        code: round.code,
        round_number: nextRound,
        parent_job_id: parent.id,
        carried_snags: carriedRows.length,
        carried_failed_checks: outstandingChecks,
        areas: areaIdMap.size,
      },
    });

    return NextResponse.json(
      {
        data: {
          id: round.id,
          code: round.code,
          round_number: nextRound,
          carried_snags: carriedRows.length,
          carried_failed_checks: outstandingChecks,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Snagging round POST error:", error);
    return NextResponse.json({ error: "Failed to open re-inspection round" }, { status: 500 });
  }
}
