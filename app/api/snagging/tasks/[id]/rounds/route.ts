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

    /*
      A round is a visit that has not happened yet.

      Backdating one silently rewrites the record a developer's remediation
      window is measured from, and an appointment in the past is not a
      booking anybody can attend. The date is compared in Gulf time, since
      that is the day an inspector means when they pick one; the appointment
      is compared as an instant, so "today at 09:00" is refused at 14:00.
    */
    const nowMs = Date.now();
    if (input.appointment_at) {
      if (new Date(input.appointment_at).getTime() <= nowMs) {
        return NextResponse.json(
          { error: "Pick an appointment time in the future for this round." },
          { status: 400 },
        );
      }
    } else {
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Dubai",
      }).format(new Date());
      if (input.scheduled_date.trim() < today) {
        return NextResponse.json(
          { error: "Pick a date in the future for this round." },
          { status: 400 },
        );
      }
    }

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

    /*
      FR-6.02 — everything still outstanding anywhere in the FAMILY, unless
      the reviewer narrowed the list to a chosen subset.

      This used to read the original alone, on the reasoning that the
      original holds the lasting record and a verdict writes through to it.
      That is true only of a defect the original knows about. A defect first
      raised DURING a round is created on that round's row and has no
      counterpart on the original at all — so reading the original could
      never see it, and it silently stopped existing the moment the next
      round opened. Round 2 found a new unlabelled distribution board,
      round 3 was opened, and the board was gone: still open, on a round
      nobody would look at again.

      Reading the whole family finds it. The same defect appears once per
      round it was carried into, so the rows are collapsed by snag_code --
      unique within a job, and copied verbatim by this route, which is what
      makes it the link between a defect's copies.
    */
    const familyIds = (siblings ?? []).map((row) => row.id as string);
    let snagQuery = admin
      .from("snagging_snags")
      .select(
        `id, job_id, area_id, snag_code, catalogue_entry_id, catalogue_code, element_label,
         defect_label, severity, note, floor_plan_id, pin_x, pin_y, status, round_created`,
      )
      .in("job_id", [parent.id, ...familyIds])
      .in("status", CARRY_FORWARD_STATUSES);

    if (input.snag_ids && input.snag_ids.length > 0) {
      snagQuery = snagQuery.in("id", input.snag_ids);
    }

    const { data: familySnags, error: snagError } = await snagQuery;
    if (snagError) throw new Error(snagError.message);

    /*
      One row per defect, preferring the copy that IS the lasting record.

      The original's row wins where there is one, because that is what a
      verdict writes through to and therefore what is current. Failing
      that -- a defect born on a round -- the earliest round holding it
      wins, so the same row stays authoritative as further rounds open
      rather than the record hopping forward each time.
    */
    const roundNumberOf = new Map<string, number>(
      [
        [parent.id, (parent.round_number as number | null) ?? 1] as const,
        ...(siblings ?? []).map(
          (row) => [row.id as string, (row.round_number as number | null) ?? 1] as const,
        ),
      ],
    );
    const bestByCode = new Map<string, (typeof familySnags)[number]>();
    for (const snag of familySnags ?? []) {
      const current = bestByCode.get(snag.snag_code as string);
      if (!current) {
        bestByCode.set(snag.snag_code as string, snag);
        continue;
      }
      const isOriginal = snag.job_id === parent.id;
      const currentIsOriginal = current.job_id === parent.id;
      if (isOriginal && !currentIsOriginal) {
        bestByCode.set(snag.snag_code as string, snag);
      } else if (isOriginal === currentIsOriginal) {
        const mine = roundNumberOf.get(snag.job_id as string) ?? Number.MAX_SAFE_INTEGER;
        const theirs = roundNumberOf.get(current.job_id as string) ?? Number.MAX_SAFE_INTEGER;
        if (mine < theirs) bestByCode.set(snag.snag_code as string, snag);
      }
    }
    const openSnags = [...bestByCode.values()];

    /*
      What the ids on a carried defect mean, across every round.

      Only needed to place a defect that came from a round other than the
      original; loaded once here rather than per snag.
    */
    const familyAreaNameById = new Map<string, string>();
    const familyPlanPathById = new Map<string, string>();
    if (openSnags.some((snag) => snag.job_id !== parent.id)) {
      const [{ data: famAreas }, { data: famPlans }] = await Promise.all([
        admin
          .from("snagging_areas")
          .select("id, name")
          .in("job_id", [parent.id, ...familyIds]),
        admin
          .from("snagging_floor_plans")
          .select("id, storage_path")
          .in("job_id", [parent.id, ...familyIds]),
      ]);
      for (const area of famAreas ?? []) {
        familyAreaNameById.set(area.id as string, area.name as string);
      }
      for (const plan of famPlans ?? []) {
        familyPlanPathById.set(plan.id as string, plan.storage_path as string);
      }
    }

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

    const scheduledDate = input.scheduled_date.trim();

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
        // The slot the coordinator actually booked for this round, never
        // the parent's. A round with no time given is dated but unbooked.
        appointment_at: input.appointment_at ?? null,
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
    /* Plans and areas are re-created per round, so an id only means
       anything within its own round. A carried defect may come from a
       DIFFERENT round, whose ids this round has never seen — these index
       the new copies by something stable instead: a plan by the image it
       points at, an area by its name. Both are copied verbatim by this
       route, which is what makes them usable as identity. */
    const newPlanIdByPath = new Map<string, string>();
    const newAreaIdByName = new Map<string, string>();
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
      if (plan.storage_path) newPlanIdByPath.set(plan.storage_path as string, newPlan.id);
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
      newAreaIdByName.set(area.name as string, newArea.id);
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
    /*
      Where a carried defect lands on this round.

      A defect from the original translates through the id maps built while
      copying. One carried from another round does not — those ids belong to
      that round — so it falls back to the area's name and the plan's image,
      which every copy shares. Without this a round-born defect arrived with
      no room and no pin, which is a defect nobody can walk to.
    */
    const areaFor = (areaId: string | null): string | null => {
      if (!areaId) return null;
      const direct = areaIdMap.get(areaId);
      if (direct) return direct;
      const name = familyAreaNameById.get(areaId);
      return (name ? newAreaIdByName.get(name) : null) ?? null;
    };
    const planFor = (planId: string | null): string | null => {
      if (!planId) return null;
      const direct = planIdMap.get(planId);
      if (direct) return direct;
      const path = familyPlanPathById.get(planId);
      return (path ? newPlanIdByPath.get(path) : null) ?? null;
    };

    const carriedRows = openSnags.map((snag) => ({
      job_id: round.id,
      area_id: areaFor(snag.area_id as string | null),
      floor_plan_id: planFor(snag.floor_plan_id as string | null),
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

      /*
        The defect's whole evidence history, not one round's slice of it.

        Photos hang off a snag ROW, and every round gets its own row, so the
        shots taken on round 2 belong to round 2's copy. Loading them from
        the single row this round carried from — the original's — meant a
        round only ever inherited the first capture: on round 3 an inspector
        saw the day-one photo and nothing of the fix round 2 had already
        rejected, which is precisely the comparison they are there to make.

        So the photos come from every row in the family carrying this code.
      */
      const carriedCodes = openSnags.map((snag) => snag.snag_code as string);
      const { data: historyRows, error: historyError } = await admin
        .from("snagging_snags")
        .select("id, snag_code")
        .in("job_id", [parent.id, ...familyIds])
        .in("snag_code", carriedCodes);
      if (historyError) throw new Error(historyError.message);

      const codeOf = new Map(
        (historyRows ?? []).map((row) => [row.id as string, row.snag_code as string] as const),
      );

      const { data: parentPhotos, error: photoLoadError } = await admin
        .from("snagging_snag_photos")
        .select(
          `snag_id, storage_path, media_type, bytes, width, height, taken_at,
           round_number, gps_lat, gps_lng, exif, marker_x, marker_y`,
        )
        .in("snag_id", (historyRows ?? []).map((row) => row.id as string))
        // Oldest first, so the de-duplication below keeps the earliest copy
        // of a shot and the round's evidence reads in the order it happened.
        .order("round_number", { ascending: true })
        .order("taken_at", { ascending: true });
      if (photoLoadError) throw new Error(photoLoadError.message);

      /*
        One copy of each shot.

        A photo taken on round 1 already exists twice by round 3 — once on
        the original and once on round 2's copy of it — and copying the
        family wholesale would carry the same image in twice over. Copies
        keep the leaf filename of the object they came from (see the path
        rewrite below), which is unique, so the leaf identifies a shot no
        matter which round's row is holding it.
      */
      const seen = new Set<string>();
      for (const photo of parentPhotos ?? []) {
        const code = codeOf.get(photo.snag_id) ?? "";
        const leaf = photo.storage_path.split("/").pop() ?? photo.storage_path;
        const identity = `${code}|${leaf}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        const snagId = newSnagId.get(code);
        if (!snagId) continue;

        /*
          Objects are filed under the job they belong to, so swapping the
          job segment keeps the round's copies in the round's folder and
          keeps the leaf name — already unique — unique.

          Any job in the family, not just the original: a shot carried from
          round 2 is filed under round 2, and matching only the original
          sent every one of those to the fallback folder instead.
        */
        const owner = [parent.id, ...familyIds].find((jobId) =>
          photo.storage_path.includes(jobId),
        );
        const destination = owner
          ? photo.storage_path.replace(owner, round.id)
          : `tasks/${round.id}/carried/${leaf}`;

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
