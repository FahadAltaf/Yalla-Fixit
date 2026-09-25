import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction, isAdminUser } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAuditBatch, type AuditEntry } from "@/lib/server/snagging/audit";
import {
  hasAreaInspector,
  hasChecklistAnsweredBy,
  hasJobInspectors,
  hasVerdictNote,
} from "@/lib/server/snagging/columns";
import { isZone } from "@/lib/snagging/zone-geometry";
import { inParallel, planWaves } from "@/lib/server/snagging/push-plan";
import { readAllRows } from "@/lib/server/snagging/read-all";
import { loadJobRosters } from "@/lib/server/snagging/job-roster";
import { assertEveryoneSigned, recordSignoff } from "@/lib/server/snagging/signoffs";
import { SNAGGING_BUCKET, mediaObjectKey } from "@/lib/server/snagging/media";
import {
  approvalDueAt,
  assertTransition,
  isTaskEditableByInspector,
  statusFromVerdict,
} from "@/lib/server/snagging/workflow";
import { syncPushSchema, type SyncPushInput } from "@/modules/snagging/schemas";
import { ActionType, ResourceType, SnaggingTaskStatus, SnaggingVerdict } from "@/types/types";

/**
 * Drains the device outbox (§6.3).
 *
 * Every mutation carries a client-generated UUID; applying the same id
 * twice is a no-op, so a retry after a dropped response cannot duplicate a
 * snag. The device speaks the pre-merge vocabulary (task_id, submission,
 * verification); this route maps it onto the lean schema — task_id is the
 * job id, a submission writes the sign-off onto the job, and a verification
 * updates the snag's status.
 */
type Admin = SupabaseClient;
type JobRef = {
  id: string;
  status: string;
  code: string;
  /** The lead inspector: the one who submits when rooms are split (point 6). */
  inspector_id?: string | null;
  /**
   * The additional visit being run on this job right now, if any.
   *
   * A visit is an appointment on an already-approved job (change 25), so
   * the job itself is locked and in a status the inspector may not edit.
   * A live visit is the one thing that reopens it: it is how the server
   * tells a sanctioned return trip from a write to a closed record.
   */
  visit?: { id: string; number: number; status: string } | null;
};

type MutationResult = {
  mutation_id: string;
  status: "applied" | "duplicate" | "rejected";
  error?: string;
  /** The code a new snag was given, when the one the device sent was taken. */
  snag_code?: string;
};

/**
 * Applies a batch of device mutations, behind two routes:
 *   /api/snagging/sync/push   -- the queued changes, as JSON
 *   /api/snagging/sync/snag   -- the same, with the photos they carry, in one
 *                                multipart request (see that route)
 * `body` is the already-parsed batch when the caller read the request itself.
 */
export async function handleSyncPush(req: NextRequest, body?: unknown) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = syncPushSchema.safeParse(body === undefined ? await req.json() : body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const input = parsed.data;

    const admin = await createAdminServerClient();

    /*
      The jobs this push touches. Every applier resolves its job from the
      mutation itself -- task_id, round_task_id, or a task's own id -- so
      these are the only jobs whose access has to be known. Reading just
      them replaced reading every job the inspector has (for an admin,
      every job in the table, a page at a time) on every push.
    */
    const touched = new Set<string>();
    for (const m of input.mutations) {
      const p = (m.payload ?? {}) as Record<string, unknown>;
      const taskId =
        m.entity === "task" ? m.entity_id : ((p.task_id ?? p.round_task_id) as string | undefined);
      if (typeof taskId === "string" && taskId) touched.add(taskId);
    }
    const touchedIds = [...touched];
    const isAdmin = isAdminUser(accessUser);
    const checkRooms = !isAdmin && (await hasAreaInspector(admin));
    const none = Promise.resolve({ data: [] as never[], error: null });

    /*
      Everything access depends on, read together rather than one after
      another: which mutations were already applied, the touched jobs, the
      rooms this inspector holds on them, and their live visits.
    */
    const ids = input.mutations.map((m) => m.mutation_id);
    const [
      { data: seenRows, error: seenError },
      { data: jobRows, error: jobsError },
      { data: roomRows, error: roomError },
      { data: liveVisits, error: liveError },
      { data: rosterRows, error: rosterError },
    ] = await Promise.all([
      admin.from("snagging_sync_mutations").select("mutation_id, status").in("mutation_id", ids),
      touchedIds.length
        ? admin.from("snagging_jobs").select("id, status, code, inspector_id").in("id", touchedIds)
        : none,
      checkRooms && touchedIds.length
        ? admin
            .from("snagging_areas")
            .select("job_id")
            .eq("inspector_id", profile.id)
            .in("job_id", touchedIds)
        : none,
      touchedIds.length
        ? admin
            .from("snagging_job_visits")
            .select("id, job_id, visit_number, status, inspector_id")
            .in("job_id", touchedIds)
            .in("status", ["scheduled", "in_progress"])
            .order("visit_number", { ascending: false })
        : none,
      // The jobs this inspector is on through the roster (several per job).
      touchedIds.length && (await hasJobInspectors(admin))
        ? admin
            .from("snagging_job_inspectors")
            .select("job_id")
            .eq("inspector_id", profile.id)
            .in("job_id", touchedIds)
        : none,
    ]);
    if (seenError) throw new Error(seenError.message);
    if (jobsError) throw new Error(jobsError.message);
    if (roomError) throw new Error(roomError.message);
    if (liveError) throw new Error(liveError.message);
    if (rosterError) throw new Error(rosterError.message);

    /*
      Only a change that was APPLIED is a duplicate. One the server
      rejected used to sit in this ledger too, so when the phone retried it
      (same mutation id) it came back "duplicate", the phone took that as
      done, and the inspector's change was lost while the app said it was
      saved. A rejected change is now tried again, and its ledger row is
      updated with the new outcome.
    */
    const seen = new Set(
      (seenRows ?? [])
        .filter((r) => (r.status ?? "applied") === "applied")
        .map((r) => r.mutation_id),
    );

    /*
      Who may write to a job -- the same rules as before:
        - its lead inspector (an admin is never restricted in snagging);
        - an inspector holding one of its rooms (point 6), who may not
          submit it -- that stays with the lead;
        - an inspector booked onto one of its live visits (BA v2, change
          25): the visit may not be the job's own inspector's, and the job
          is approved and locked by then.
    */
    const roomJobs = new Set(
      [...(roomRows ?? []), ...(rosterRows ?? [])].map((r) => r.job_id as string),
    );
    const visitJobs = new Set(
      (liveVisits ?? [])
        .filter((v) => v.inspector_id === profile.id)
        .map((v) => v.job_id as string),
    );
    const jobById = new Map<string, JobRef>();
    for (const j of (jobRows ?? []) as JobRef[]) {
      if (isAdmin || j.inspector_id === profile.id || roomJobs.has(j.id) || visitJobs.has(j.id)) {
        jobById.set(j.id, j);
      }
    }

    // Highest visit first, so the first one seen per job is the live pass.
    for (const v of liveVisits ?? []) {
      const job = jobById.get(v.job_id as string);
      if (job && !job.visit) {
        job.visit = {
          id: v.id as string,
          number: v.visit_number as number,
          status: v.status as string,
        };
      }
    }

    /*
      The first thing a device sends for a booked visit means the
      inspector is on site. Flipped once, here, rather than in each
      applier, so a batch of forty snags does not race to do it forty
      times -- and every visit starting in this push is flipped at once.
    */
    const starting = touchedIds
      .map((taskId) => jobById.get(taskId))
      .filter((job): job is JobRef & { visit: NonNullable<JobRef["visit"]> } =>
        job?.visit?.status === "scheduled",
      );
    await Promise.all(
      starting.map(async (job) => {
        const now = new Date().toISOString();
        const { error: startError } = await admin
          .from("snagging_job_visits")
          .update({
            status: "in_progress",
            started_at: now,
            // The pull finds changed visits by this; see its delta.
            updated_at: now,
          })
          .eq("id", job.visit.id)
          .eq("status", "scheduled");
        if (startError) throw new Error(startError.message);
        job.visit.status = "in_progress";
      }),
    );

    const results: MutationResult[] = [];
    const ledger: Array<Record<string, unknown>> = [];
    const audit: AuditEntry[] = [];

    /*
      Applied in dependency waves, concurrently within each wave.

      This was strictly sequential. Every mutation costs one to three round
      trips to the database, measured at ~220ms each, so a full
      hundred-mutation outbox took twenty seconds to a minute — and the
      longer an inspector had been offline, the worse it got.

      planWaves keeps the two things that matter: a photo or a verdict
      never runs before its snag, a submission runs last and alone, and two
      mutations against the same row keep their order. Everything else was
      already independent and simply had no reason to wait.

      Results are keyed by mutation_id and the client matches on that, so
      the order they are reported in does not matter.
    */
    /*
      Captured before the closure below: TypeScript's narrowing from the
      unauthorized guard does not survive into a nested function, and the
      alternative is a non-null assertion on every use.
    */
    const actor = profile;

    const fresh = input.mutations.filter((mutation) => {
      if (!seen.has(mutation.mutation_id)) return true;
      results.push({ mutation_id: mutation.mutation_id, status: "duplicate" });
      return false;
    });

    async function runOne(mutation: Mutation): Promise<void> {
      try {
        const outcome: { snag_code?: string } = {};
        await applyMutation(admin, {
          mutation,
          userId: actor.id,
          actorLabel: actor.full_name ?? actor.email ?? null,
          isAdmin: isAdminUser(accessUser),
          jobById,
          audit,
          outcome,
        });
        results.push({ mutation_id: mutation.mutation_id, status: "applied", ...outcome });
        ledger.push({
          mutation_id: mutation.mutation_id,
          user_id: actor.id,
          device_id: input.device_id ?? null,
          entity: mutation.entity,
          entity_id: mutation.entity_id,
          op: mutation.op,
          status: "applied",
        });
      } catch (mutationError) {
        const message = (mutationError as Error).message;
        results.push({ mutation_id: mutation.mutation_id, status: "rejected", error: message });
        ledger.push({
          mutation_id: mutation.mutation_id,
          user_id: actor.id,
          device_id: input.device_id ?? null,
          entity: mutation.entity,
          entity_id: mutation.entity_id,
          op: mutation.op,
          status: "rejected",
          error_message: message,
        });
      }
    }

    for (const wave of planWaves(fresh)) {
      // Each chain is one row's mutations in order; chains never share a
      // row, so running them together cannot race.
      await inParallel(
        wave.map((chain) => async () => {
          for (const mutation of chain) await runOne(mutation);
        }),
      );
    }

    if (ledger.length > 0) {
      const { error: ledgerError } = await admin
        .from("snagging_sync_mutations")
        // Not ignoreDuplicates: a retried change that failed before and
        // applies now has to overwrite its "rejected" row.
        .upsert(ledger, { onConflict: "mutation_id" });
      if (ledgerError) throw new Error(ledgerError.message);
    }

    // FR-6.04 — one insert for everything this push changed. Never
    // throws: the mutations are already committed, and losing the trail
    // must not fail the device's sync.
    await recordAuditBatch(admin, audit);

    return NextResponse.json({
      data: {
        server_time: new Date().toISOString(),
        results,
        applied: results.filter((r) => r.status === "applied").length,
        rejected: results.filter((r) => r.status === "rejected").length,
      },
    });
  } catch (error) {
    console.error("Snagging sync push error:", error);
    return NextResponse.json({ error: "Failed to sync changes" }, { status: 500 });
  }
}

type Mutation = SyncPushInput["mutations"][number];
type Ctx = {
  mutation: Mutation;
  userId: string;
  actorLabel: string | null;
  /** An admin may submit a job whoever leads it. */
  isAdmin: boolean;
  jobById: Map<string, JobRef>;
  /**
   * FR-6.04 — audit rows collected across the whole push and inserted
   * once at the end. A device drains its outbox in batches of dozens, so
   * one INSERT per mutation would multiply the round trips for a payload
   * that is already the slowest thing the app does.
   */
  audit: AuditEntry[];
  /**
   * What the server settled differently from what the device sent, told
   * back in this mutation's result -- today, a snag code that was taken.
   */
  outcome?: { snag_code?: string };
};

/** Shorthand for the fields every sync-side audit row shares. */
function auditFrom(
  ctx: Ctx,
  entry: Pick<AuditEntry, "entityType" | "entityId" | "taskId" | "eventType"> &
    Partial<Pick<AuditEntry, "justification" | "payload">>,
): void {
  ctx.audit.push({
    ...entry,
    actorId: ctx.userId,
    actorLabel: ctx.actorLabel,
    origin: "mobile",
  });
}

async function applyMutation(admin: Admin, ctx: Ctx): Promise<void> {
  const payload = ctx.mutation.payload as Record<string, unknown>;
  switch (ctx.mutation.entity) {
    case "snag": return applySnag(admin, ctx, payload);
    case "area": return applyArea(admin, ctx, payload);
    case "photo": return applyPhoto(admin, ctx, payload);
    case "checklist": return applyChecklist(admin, ctx, payload);
    case "verification": return applyVerification(admin, ctx, payload);
    case "submission": return applySubmission(admin, ctx, payload);
    case "signoff": return applySignoff(admin, ctx, payload);
    case "task": return applyTaskProgress(admin, ctx, payload);
    default: throw new Error(`Unsupported entity ${ctx.mutation.entity}`);
  }
}

/** Resolves the job a mutation targets and asserts it is still writable. */
function writableJob(ctx: Ctx, taskId: unknown): JobRef {
  if (typeof taskId !== "string" || !taskId) throw new Error("Missing task_id");
  const job = ctx.jobById.get(taskId);
  if (!job) throw new Error("Not assigned to this inspection");
  // A return visit reopens an approved job for exactly as long as it runs.
  if (job.visit && (job.visit.status === "scheduled" || job.visit.status === "in_progress")) {
    return job;
  }
  if (!isTaskEditableByInspector(job.status as SnaggingTaskStatus)) {
    throw new Error(`Inspection is ${job.status} and cannot be edited`);
  }
  return job;
}

/**
 * The code a snag is stored under: its existing one if it is already on
 * the server, the device's if that is free on the job, else the job's next
 * free number with the device's prefix (JOB-S007 -> JOB-S012).
 */
async function settleSnagCode(
  admin: Admin,
  jobId: string,
  snagId: string,
  requested: unknown,
): Promise<string> {
  const wanted = typeof requested === "string" ? requested.trim() : "";
  const [{ data: existing, error: existingError }, codes] = await Promise.all([
    admin.from("snagging_snags").select("snag_code").eq("id", snagId).maybeSingle(),
    readAllRows<{ id: string; snag_code: string }>(
      (from, to) =>
        admin
          .from("snagging_snags")
          .select("id, snag_code")
          .eq("job_id", jobId)
          .order("id", { ascending: true })
          .range(from, to),
      "snag codes",
    ),
  ]);
  if (existingError) throw new Error(existingError.message);
  if (existing?.snag_code) return existing.snag_code as string;

  const taken = new Set(codes.filter((c) => c.id !== snagId).map((c) => c.snag_code));
  if (wanted && !taken.has(wanted)) return wanted;

  // The device's prefix (everything before the -S number), or the job's own.
  const codePattern = /^(.*)-S(\d+)$/;
  const prefix =
    codePattern.exec(wanted)?.[1] ??
    codes.map((c) => codePattern.exec(c.snag_code)?.[1]).find(Boolean) ??
    "SNAG";
  let highest = 0;
  for (const code of taken) {
    const match = /-S(\d+)$/.exec(code);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  for (let next = highest + 1; ; next += 1) {
    const candidate = `${prefix}-S${String(next).padStart(3, "0")}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * An update for a row the server does not have yet: its insert is still on
 * the phone. Refused with this, so the phone keeps it and sends it again
 * (the app shows it as waiting for the item, not as a failure).
 */
const NOT_ON_SERVER_YET = "Waiting for the item it belongs to to reach the office";

/**
 * Several inspectors share a job and see every snag on it, but a snag is
 * changed only by the inspector who recorded it: an edit, a delete, a
 * photo added or removed, a marker or a verdict from anyone else on the
 * job is refused. A snag nobody recorded (carried onto a round by the
 * office, or older than the app recording it) stays open to the job, and
 * an admin is never restricted.
 */
async function assertMayChangeSnag(
  admin: Admin,
  ctx: Ctx,
  jobId: string,
  snagId: string | null | undefined,
): Promise<void> {
  if (ctx.isAdmin || !snagId) return;
  const { data, error } = await admin
    .from("snagging_snags")
    .select("created_by, recorded_by:created_by(full_name, email)")
    .eq("id", snagId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const author = (data?.created_by as string | null | undefined) ?? null;
  if (!author || author === ctx.userId) return;
  const rosters = await loadJobRosters(admin, [jobId]);
  if (!rosters.get(jobId)?.has(author)) return;
  const who = (Array.isArray(data?.recorded_by) ? data?.recorded_by[0] : data?.recorded_by) as
    | { full_name?: string | null; email?: string | null }
    | null
    | undefined;
  const name = who?.full_name || who?.email || "Another inspector";
  throw new Error(`${name} recorded this snag, so only they can change it.`);
}

async function applySnag(admin: Admin, ctx: Ctx, payload: Record<string, unknown>): Promise<void> {
  const job = writableJob(ctx, payload.task_id);
  // A co-inspector's snag is theirs to change (edits and deletes alike).
  await assertMayChangeSnag(admin, ctx, job.id, ctx.mutation.entity_id);

  if (ctx.mutation.op === "delete") {
    const { error } = await admin
      .from("snagging_snags")
      .update({ status: "withdrawn" })
      .eq("id", ctx.mutation.entity_id)
      .eq("locked", false);
    if (error) throw new Error(error.message);
    auditFrom(ctx, {
      entityType: "snag",
      entityId: ctx.mutation.entity_id,
      taskId: job.id,
      eventType: "snag_withdrawn",
      payload: { code: job.code },
    });
    return;
  }

  const severity = payload.severity;
  if (severity !== "low" && severity !== "medium" && severity !== "high") {
    throw new Error("severity must be low, medium or high");
  }

  /*
    On a visit, a defect from an earlier pass is part of a report the
    client already holds. The visit adds to that report; it does not
    rewrite what was approved. So an existing locked row is refused
    rather than quietly overwritten by the upsert below.
  */
  if (job.visit) {
    const { data: existing, error: existingError } = await admin
      .from("snagging_snags")
      .select("locked")
      .eq("id", ctx.mutation.entity_id)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing?.locked) {
      throw new Error(
        "This snag is from an earlier visit and is part of the approved report, so it cannot be changed on this visit.",
      );
    }
  }
  if (!payload.catalogue_code) throw new Error("Every snag must carry a classification code");

  /*
    The code: settled here, not trusted from the device.

    The phone numbers a new snag from the snags it holds, so it can capture
    with no signal -- and it does not hold everyone's. Several inspectors on
    one job each see only their own findings, and a deleted snag frees its
    number on the phone but not here, so two snags could arrive with the
    same code and the second failed on snag_snags_code_unique with nothing
    the inspector could do. An existing snag keeps the code it has (an edit
    carries the device's copy, which may be stale); a new one keeps the
    device's code when it is free, else gets the job's next free number,
    and the result tells the device which.
  */
  const snagCode = await settleSnagCode(admin, job.id, ctx.mutation.entity_id, payload.snag_code);
  if (snagCode !== payload.snag_code && ctx.outcome) ctx.outcome.snag_code = snagCode;

  const row = {
    id: ctx.mutation.entity_id,
    job_id: job.id,
    area_id: payload.area_id as string,
    snag_code: snagCode,
    catalogue_entry_id: (payload.catalogue_entry_id as string) ?? null,
    catalogue_code: payload.catalogue_code as string,
    /*
      The catalogue's top level (Action Points P1), sent by devices on
      build 18 and later. Older ones send nothing here and their snags
      keep a null category — which reads as "before the restructure"
      rather than as missing data.
    */
    category_label: (payload.category_label as string) ?? null,
    element_label: (payload.element_label as string) ?? null,
    defect_label: (payload.defect_label as string) ?? null,
    severity,
    note: (payload.note as string) ?? null,
    floor_plan_id: (payload.floor_plan_id as string) ?? null,
    pin_x: toNumber(payload.pin_x),
    pin_y: toNumber(payload.pin_y),
    round_created: (payload.round_created as number) ?? 1,
    /*
      Which visit found it, decided here rather than trusted from the
      device: the server knows which visit is live, and the report's
      "found on visit 2" depends on this being right.
    */
    ...(job.visit ? { visit_id: job.visit.id } : {}),
    created_by: ctx.userId,
    created_at: (payload.captured_at as string) ?? new Date().toISOString(),
  };
  let { error } = await admin.from("snagging_snags").upsert(row, { onConflict: "id" });
  /*
    Two new snags in one push run side by side and can both settle on the
    same free number; the one that lands second takes the next.
  */
  for (let attempt = 0; error && error.code === "23505" && /snag_snags_code_unique/.test(error.message) && attempt < 3; attempt += 1) {
    row.snag_code = await settleSnagCode(admin, job.id, ctx.mutation.entity_id, row.snag_code);
    if (ctx.outcome) ctx.outcome.snag_code = row.snag_code;
    ({ error } = await admin.from("snagging_snags").upsert(row, { onConflict: "id" }));
  }
  if (error) throw new Error(error.message);
  if (ctx.outcome && row.snag_code === payload.snag_code) delete ctx.outcome.snag_code;

  auditFrom(ctx, {
    entityType: "snag",
    entityId: ctx.mutation.entity_id,
    taskId: job.id,
    eventType: ctx.mutation.op === "update" ? "snag_updated" : "snag_created",
    // The note is the inspector's own words about the defect, which is
    // the closest thing a capture has to a stated reason.
    justification: (payload.note as string) ?? null,
    payload: {
      snag_code: row.snag_code,
      catalogue_code: row.catalogue_code,
      severity: row.severity,
    },
  });
}

async function applyArea(admin: Admin, ctx: Ctx, payload: Record<string, unknown>): Promise<void> {
  const job = writableJob(ctx, payload.task_id);

  // A floor-plan pin is all-or-nothing so the DB check (pin_x null == pin_y
  // null) always holds, and floor_plan_id follows the pin.
  const pinFields = (): Record<string, unknown> => {
    /*
      A room's outline, drawn on the phone (point 4). Checked with the
      same rule the web and the database use; a malformed one is refused
      rather than stored, so it can never reach another handset.
    */
    if ("zone" in payload) {
      const zone = payload.zone;
      if (zone !== null && !isZone(zone)) {
        throw new Error("That room outline is not valid. Draw it again with at least three corners.");
      }
      const out: Record<string, unknown> = { zone: zone ?? null };
      // An outline sits on a plan; clearing one leaves the pin's plan alone.
      if (zone !== null && "floor_plan_id" in payload) {
        out.floor_plan_id = (payload.floor_plan_id as string | null) ?? null;
      }
      if ("pin_x" in payload || "pin_y" in payload) {
        const x = (payload.pin_x as number | null | undefined) ?? null;
        const y = (payload.pin_y as number | null | undefined) ?? null;
        out.pin_x = x !== null && y !== null ? x : null;
        out.pin_y = x !== null && y !== null ? y : null;
      }
      return out;
    }
    if (!("pin_x" in payload) && !("pin_y" in payload) && !("floor_plan_id" in payload)) return {};
    const x = (payload.pin_x as number | null | undefined) ?? null;
    const y = (payload.pin_y as number | null | undefined) ?? null;
    const placed = x !== null && y !== null;
    return {
      floor_plan_id: placed ? ((payload.floor_plan_id as string | null) ?? null) : null,
      pin_x: placed ? x : null,
      pin_y: placed ? y : null,
    };
  };

  if (ctx.mutation.op === "insert") {
    const row: Record<string, unknown> = {
      id: ctx.mutation.entity_id,
      job_id: job.id,
      name: (payload.name as string) ?? "Area",
      catalogue_area_code: (payload.catalogue_area_code as string) ?? null,
      sort_order: (payload.sort_order as number) ?? 0,
      status: "pending",
      ...pinFields(),
      /*
        A room added on a return visit says so. Rooms have no finish tick
        on a visit, so without this it could never be signed off and the
        job page counted it as the original walk's unfinished work.
      */
      ...(job.visit ? { visit_id: job.visit.id } : {}),
    };
    let { error } = await admin.from("snagging_areas").upsert(row, { onConflict: "id" });
    // Until 20260918110000_area_visit.sql is applied the column does not
    // exist; the room is still saved rather than the inspector's add failing.
    if (error && "visit_id" in row && error.message.includes("visit_id")) {
      delete row.visit_id;
      ({ error } = await admin.from("snagging_areas").upsert(row, { onConflict: "id" }));
    }
    if (error) throw new Error(error.message);
    return;
  }

  // Only the fields the device actually sent are touched. A completion
  // carries note + confirmed_at; an access change carries access_state +
  // access_reason (+ the confirmation it may set); an area-pin change carries
  // floor_plan_id + pin_x/pin_y. Merging blindly would let one mutation blank
  // out what the other owns.
  const update: Record<string, unknown> = {};
  if ("note" in payload) update.note = (payload.note as string | null | undefined)?.trim() || null;
  if ("confirmed_at" in payload) update.confirmed_at = (payload.confirmed_at as string | null) ?? null;
  if ("access_state" in payload) update.access_state = (payload.access_state as string) ?? "accessible";
  if ("access_reason" in payload) update.access_reason = (payload.access_reason as string | null) ?? null;
  // FR-4.01 area start (COALESCE-style: only the first start is kept, so a
  // later mutation without started_at never clears it).
  if ("started_at" in payload) update.started_at = (payload.started_at as string | null) ?? null;
  // FR-4.11 elements not checked under limited access.
  if ("elements_not_checked" in payload) {
    update.elements_not_checked = (payload.elements_not_checked as string | null | undefined)?.trim() || null;
  }
  Object.assign(update, pinFields());
  if (Object.keys(update).length === 0) return;

  // The name comes back on the update so the audit entry can say which
  // area this was. Reading it afterwards would be a second round trip for
  // a string the write already has in hand.
  const { data: area, error } = await admin
    .from("snagging_areas")
    .update(update)
    .eq("id", ctx.mutation.entity_id)
    .eq("job_id", job.id)
    .select("name")
    .maybeSingle();
  if (error) throw new Error(error.message);
  /*
    No row matched: the area's own insert has not arrived (it is parked or
    still queued on the phone). Reported as applied, the confirm, access or
    pin was retired on the phone and lost; refused, it waits beside its
    area and goes again with it.
  */
  if (!area) throw new Error(NOT_ON_SERVER_YET);

  // Access state carries a written reason (a locked door, a room only
  // partly reachable), and confirming an area is a status change on the
  // walk. Pin nudges and timestamps are not trailed — they would bury
  // the entries that matter.
  if ("access_state" in payload || "confirmed_at" in payload) {
    auditFrom(ctx, {
      entityType: "area",
      entityId: ctx.mutation.entity_id,
      taskId: job.id,
      eventType:
        "confirmed_at" in payload && payload.confirmed_at ? "area_confirmed" : "area_access_changed",
      justification:
        ((payload.access_reason as string) || (payload.elements_not_checked as string)) ?? null,
      payload: {
        access_state: (payload.access_state as string) ?? null,
        // Snapshotted rather than resolved on read: an area can be renamed
        // or removed, and the trail should still say what was confirmed.
        area_name: area?.name ?? null,
      },
    });
  }
}

async function applyPhoto(admin: Admin, ctx: Ctx, payload: Record<string, unknown>): Promise<void> {
  const job = writableJob(ctx, payload.task_id);
  // A photo on a co-inspector's snag is theirs to add, move or remove.
  let photoSnagId = (payload.snag_id as string | undefined) ?? null;
  if (!photoSnagId) {
    const { data: photoRow } = await admin
      .from("snagging_snag_photos")
      .select("snag_id")
      .eq("id", ctx.mutation.entity_id)
      .maybeSingle();
    photoSnagId = (photoRow?.snag_id as string | null | undefined) ?? null;
  }
  await assertMayChangeSnag(admin, ctx, job.id, photoSnagId);

  if (ctx.mutation.op === "delete") {
    /*
      The file to remove, from the row itself. The phone keeps a signed
      address where the storage key used to be, so the key it sent was
      often a URL: the record went and the file stayed in storage.
    */
    const { data: stored } = await admin
      .from("snagging_snag_photos")
      .select("storage_path")
      .eq("id", ctx.mutation.entity_id)
      .maybeSingle();
    const sent = payload.storage_path as string | undefined;
    const storagePath =
      (stored?.storage_path as string | null | undefined) ??
      (sent && !/^https?:\/\//.test(sent) ? sent : undefined);
    if (storagePath) await admin.storage.from("snagging").remove([storagePath]);
    const { error } = await admin.from("snagging_snag_photos").delete().eq("id", ctx.mutation.entity_id);
    if (error) throw new Error(error.message);
    return;
  }

  // A marker-only update (FR-4.06) touches just the defect spot, so it does not
  // clobber the photo metadata written when the object was first uploaded.
  if (ctx.mutation.op === "update") {
    if (!("marker_x" in payload) && !("marker_y" in payload)) return;
    const x = (payload.marker_x as number | null | undefined) ?? null;
    const y = (payload.marker_y as number | null | undefined) ?? null;
    const placed = x !== null && y !== null;
    const { data: marked, error } = await admin
      .from("snagging_snag_photos")
      .update({ marker_x: placed ? x : null, marker_y: placed ? y : null })
      .eq("id", ctx.mutation.entity_id)
      .select("id");
    if (error) throw new Error(error.message);
    // The photo itself has not arrived yet: the spot waits for it.
    if (!marked || marked.length === 0) throw new Error(NOT_ON_SERVER_YET);
    return;
  }

  const markerX = toNumber(payload.marker_x);
  const markerY = toNumber(payload.marker_y);
  const markerPlaced = markerX !== null && markerY !== null;
  const row = {
    id: ctx.mutation.entity_id,
    snag_id: payload.snag_id as string,
    job_id: job.id,
    storage_path: payload.storage_path as string,
    media_type: (payload.media_type as string) ?? "photo",
    bytes: toNumber(payload.bytes),
    width: toNumber(payload.width),
    height: toNumber(payload.height),
    taken_at: (payload.taken_at as string) ?? new Date().toISOString(),
    round_number: (payload.round_number as number) ?? 1,
    // Where and (via EXIF) when the photo was actually taken (FR-2.06).
    gps_lat: toNumber(payload.gps_lat),
    gps_lng: toNumber(payload.gps_lng),
    exif: (payload.exif as Record<string, unknown> | null) ?? null,
    // Exact defect spot on the photo (FR-4.06), all-or-nothing.
    marker_x: markerPlaced ? markerX : null,
    marker_y: markerPlaced ? markerY : null,
  };
  const { error } = await admin.from("snagging_snag_photos").upsert(row, { onConflict: "id" });
  if (error) throw new Error(error.message);
}

/** The inspector answering a checklist item (N4): passed / failed / not_checked. */
async function applyChecklist(admin: Admin, ctx: Ctx, payload: Record<string, unknown>): Promise<void> {
  const job = writableJob(ctx, payload.task_id);
  const status = payload.status;
  if (status !== "pending" && status !== "passed" && status !== "failed" && status !== "not_checked") {
    throw new Error("Invalid checklist status");
  }
  const { data: item, error } = await admin
    .from("snagging_job_checklist")
    .update({
      status,
      reason: (payload.reason as string) ?? null,
      /*
        Which return visit answered it (BA v2, change 29), as the handset
        reported. Null on an ordinary inspection, which is what every
        answer given before visits existed already carries.
      */
      visit_id: job.visit?.id ?? (payload.visit_id as string) ?? null,
      updated_at: new Date().toISOString(),
      /*
        Whose answer this is: several inspectors share one checklist, and
        the phone shows "Checked by …" for each item. Once the column exists.
      */
      ...((await hasChecklistAnsweredBy(admin))
        ? { answered_by: status === "pending" ? null : ctx.userId, answered_at: status === "pending" ? null : new Date().toISOString() }
        : {}),
    })
    .eq("id", ctx.mutation.entity_id)
    .eq("job_id", job.id)
    .select("code, label, group_name")
    .maybeSingle();
  if (error) throw new Error(error.message);
  // An answer to an item the server does not have is not an answer given.
  if (!item) throw new Error(NOT_ON_SERVER_YET);

  // Only answers that skip an item are trailed. A plain pass/fail is
  // already the checklist row's own state; "not checked, because …" is
  // the one that has to be explainable later.
  if (status === "not_checked") {
    auditFrom(ctx, {
      entityType: "task",
      entityId: ctx.mutation.entity_id,
      taskId: job.id,
      eventType: "checklist_not_checked",
      justification: (payload.reason as string) ?? null,
      // Which item was skipped. Without this the trail carried the job id
      // and nothing else, so a reviewer could see that something had been
      // skipped but never what.
      payload: item
        ? { code: item.code, label: item.label, group_name: item.group_name }
        : null,
    });
  }
}

/** A de-snag verdict now just moves the snag's status (no history table). */
async function applyVerification(admin: Admin, ctx: Ctx, payload: Record<string, unknown>): Promise<void> {
  const job = writableJob(ctx, payload.round_task_id);
  await assertMayChangeSnag(admin, ctx, job.id, payload.snag_id as string | undefined);
  const verdict = payload.verdict as SnaggingVerdict;
  const allowed: SnaggingVerdict[] = ["verified_closed", "verified_poor_quality", "verified_not_done", "withdrawn"];
  if (!allowed.includes(verdict)) throw new Error(`Unknown verdict ${verdict}`);

  const status = statusFromVerdict(verdict);
  const snagId = payload.snag_id as string;

  /*
    The comment the inspector wrote with the verdict, kept on the round's
    snag (it used to reach only the audit trail). Only when the payload
    carries one: an older phone sends no note key, and a verdict re-tapped
    without touching the comment must not wipe it.
  */
  const update: Record<string, unknown> = { status };
  if ("note" in payload && (await hasVerdictNote(admin))) {
    update.verdict_note = typeof payload.note === "string" ? payload.note.trim() || null : null;
  }

  const { data: verified, error } = await admin
    .from("snagging_snags")
    .update(update)
    .eq("id", snagId)
    .select("id");
  if (error) throw new Error(error.message);
  // A verdict on a snag the server does not have yet waits for it.
  if (!verified || verified.length === 0) throw new Error(NOT_ON_SERVER_YET);

  /*
    BRD 5.2 — the defect is one lasting record, and the round's row is a
    working copy of it. Writing the verdict only onto the copy left the
    original sitting open forever, so the parent still claimed three open
    defects after a round closed all three, and the status history a
    developer is measured on was split across two rows.

    The pair is matched on snag_code, which the round copies verbatim and
    which is unique within a job.
  */
  await writeVerdictThroughToOrigin(admin, snagId, status);

  // A verdict closes or re-opens a defect on the record, so it is a
  // status change in its own right.
  auditFrom(ctx, {
    entityType: "verification",
    entityId: payload.snag_id as string,
    taskId: job.id,
    eventType: "snag_verified",
    justification: (payload.note as string) ?? null,
    payload: { verdict },
  });
}

/** Sign-off writes onto the job and locks the visit (no submissions table). */
/**
 * Stores a sign-off signature sent inside the submission (FR-2.08).
 *
 * The phone used to upload the signature first -- an upload URL, then the
 * file -- and send the submission after, so signing off was three
 * requests, and one made with no signal lost the signature altogether.
 * Now the PNG travels in the submission itself (it is a few KB), queued
 * with it offline and stored here when it lands. Keyed by the
 * submission's id, so a retried submission replaces its own file.
 */
async function storeSignature(
  admin: Admin,
  jobId: string,
  submissionId: string,
  png: unknown,
): Promise<string | null> {
  if (typeof png !== "string" || !png) return null;
  const base64 = png.includes(",") ? png.slice(png.indexOf(",") + 1) : png;
  // A drawn signature is small; anything large is not one.
  if (base64.length > 700_000) throw new Error("The signature image is too large");
  const bytes = Buffer.from(base64, "base64");
  if (bytes.byteLength === 0) return null;
  const path = mediaObjectKey({
    taskId: jobId,
    mediaId: submissionId,
    kind: "signature",
    contentType: "image/png",
  });
  const { error } = await admin.storage
    .from(SNAGGING_BUCKET)
    .upload(path, bytes, { contentType: "image/png", upsert: true });
  if (error) throw new Error(error.message);
  return path;
}

/**
 * One inspector signing off their part of a job (or of a return visit).
 *
 * With two or more inspectors on a job, each signs from their own phone
 * before it can be submitted (signoffs.ts). The signature image travels in
 * the mutation, as a submission's does, and is stored beside it.
 */
async function applySignoff(admin: Admin, ctx: Ctx, payload: Record<string, unknown>): Promise<void> {
  const job = writableJob(ctx, payload.task_id);
  const signaturePath = await storeSignature(admin, job.id, ctx.mutation.entity_id, payload.signature_png);
  if (!signaturePath) throw new Error("A sign-off needs a signature");
  await recordSignoff(admin, {
    jobId: job.id,
    visitId: job.visit?.id ?? null,
    inspectorId: ctx.userId,
    signerName: (payload.signer_name as string) ?? null,
    signaturePath,
    signedAt: (payload.signed_at as string) ?? new Date().toISOString(),
  });
  auditFrom(ctx, {
    entityType: "submission",
    entityId: job.visit?.id ?? job.id,
    taskId: job.id,
    eventType: "inspector_signed_off",
    payload: {
      code: job.code,
      signer_name: (payload.signer_name as string) ?? null,
      visit_number: job.visit?.number ?? null,
    },
  });
}

async function applySubmission(admin: Admin, ctx: Ctx, payload: Record<string, unknown>): Promise<void> {
  const job = writableJob(ctx, payload.task_id);
  if (job.visit) return submitVisit(admin, ctx, job, payload);

  /*
    Any inspector on the job may submit it, once every one of them has
    signed (decided 2026-09-24). It was the lead's alone, so a job waited
    on one person being back in signal even when everyone else was done.
    The signature check below is what holds it until the team is.
  */

  // Every snag must carry at least one photo, and every mandatory checklist
  // item must be answered, before the visit can close (BR-5, BR-12). A
  // de-snag round asks for more than that -- see the after-photo rule below.
  const [visit, snagRows, photoRows, checklistRows] = await Promise.all([
    admin
      .from("snagging_jobs")
      .select("round_number, visit_type, created_at")
      .eq("id", job.id)
      .maybeSingle(),
    admin.from("snagging_snags").select("id, snag_code, status").eq("job_id", job.id).neq("status", "withdrawn"),
    // Paged, so a big job is never reported as having photo-less snags.
    readAllRows<{ snag_id: string; round_number: number | null }>(
      (from, to) =>
        admin
          .from("snagging_snag_photos")
          .select("id, snag_id, round_number")
          .eq("job_id", job.id)
          .order("id", { ascending: true })
          .range(from, to),
      "submission photos",
    ).then(
      (data) => ({ data, error: null as { message: string } | null }),
      (error: Error) => ({ data: null, error: { message: error.message } }),
    ),
    admin
      .from("snagging_job_checklist")
      .select("code, status, reason, updated_at")
      .eq("job_id", job.id)
      .eq("mandatory", true),
  ]);
  // Unchecked, a failure here left `visit.data` null, which quietly turned
  // the round rules below into the rules for an initial inspection.
  if (visit.error) throw new Error(visit.error.message);
  if (snagRows.error) throw new Error(snagRows.error.message);
  if (photoRows.error) throw new Error(photoRows.error.message);
  if (checklistRows.error) throw new Error(checklistRows.error.message);

  /*
    FR-4.13 / FR-4.15 (BRD §8): a mandatory item is only "answered" when it is
    passed, failed, or explicitly marked not-checked WITH a reason. A pending
    item, or a not-checked item with no reason, still blocks submission.

    A de-snag round is exempt. Its checklist is carried context rather than
    a fresh set of questions, and a re-check that genuinely cannot be done
    on the day — a room still locked, a service still not energised — must
    not strand the inspector with a round they are unable to submit. The
    app shows what is outstanding as an advisory; the office sees it on the
    Checklist tab. Nothing is hidden, but it does not hold the sign-off.

    Kept in step with the mobile review screen deliberately: a rule the
    client does not enforce and the server does is a submission that fails
    after the inspector has signed and left.
  */
  const isRound = (visit.data?.visit_type ?? "initial") === "desnag";

  const pendingChecks = isRound
    ? []
    : (checklistRows.data ?? []).filter((c) => {
        if (c.status === "pending") return true;
        if (c.status === "not_checked") {
          return !(c.reason && String(c.reason).trim().length > 0);
        }
        return false;
      });
  if (pendingChecks.length > 0) {
    throw new Error(
      `${pendingChecks.length} mandatory checklist item(s) still need an answer (or a reason for not checking)`,
    );
  }

  const photographed = new Set((photoRows.data ?? []).map((r) => r.snag_id));
  const missing = (snagRows.data ?? []).filter((s) => !photographed.has(s.id));
  if (missing.length > 0) {
    const sample = missing.slice(0, 3).map((s) => s.snag_code).join(", ");
    throw new Error(`${missing.length} snag(s) still have no photo uploaded (${sample}${missing.length > 3 ? ", …" : ""})`);
  }

  /*
    BR-5 on a de-snag round: the verdict needs an AFTER photo, not just a
    photo.

    "Every snag has a photo" was enough while a round carried no evidence
    with it — the only way to satisfy it was to shoot the defect again.
    Now that a round carries the original shot forward so the inspector
    can see what they are re-checking, that same rule would pass on the
    before photo alone, and "verified, closed" could be recorded with no
    picture of the fix. So a round asks for a photo taken on THIS round.

    A defect still sitting at pending_verification is held to it too. It
    was carried in precisely to be re-checked, so submitting a round with
    it untouched closes a visit that never answered the question it was
    opened to ask.

    Withdrawn is already excluded above — the client dropped the item, so
    there is nothing to photograph.

    A video counts: both are rows in snagging_snag_photos, and a
    walkthrough clip is often the better evidence of a fix.
  */
  const round = (visit.data?.round_number as number | null) ?? 1;
  if (visit.data?.visit_type === "desnag" && round > 1) {
    const shotThisRound = new Set(
      (photoRows.data ?? [])
        .filter((r) => ((r.round_number as number | null) ?? 1) === round)
        .map((r) => r.snag_id),
    );
    /*
      Points 10 and 11: every carried defect needs a result, and only a
      Poor quality result needs its evidence -- an after photo or video
      from this round AND a comment. Fixed and Not done stand on their own.
    */
    const list = (codes: Array<{ snag_code?: unknown }>) =>
      `${codes.slice(0, 3).map((s) => s.snag_code).join(", ")}${codes.length > 3 ? ", …" : ""}`;
    const unanswered = (snagRows.data ?? []).filter((s) => s.status === "pending_verification");
    if (unanswered.length > 0) {
      throw new Error(
        `${unanswered.length} carried defect(s) still need a result: Fixed, Not done or Poor quality (${list(unanswered)})`,
      );
    }
    const poor = (snagRows.data ?? []).filter((s) => s.status === "verified_poor_quality");
    if (poor.length > 0) {
      const withNotes = await hasVerdictNote(admin);
      const notes = new Map<string, string | null>();
      if (withNotes) {
        const { data: noteRows, error: noteError } = await admin
          .from("snagging_snags")
          .select("id, verdict_note")
          .in("id", poor.map((s) => s.id as string));
        if (noteError) throw new Error(noteError.message);
        for (const row of noteRows ?? []) notes.set(row.id as string, (row.verdict_note as string | null) ?? null);
      }
      const short = poor.filter(
        (s) =>
          !shotThisRound.has(s.id) ||
          (withNotes && !(notes.get(s.id as string) ?? "").trim()),
      );
      if (short.length > 0) {
        throw new Error(
          `${short.length} Poor quality result(s) still need an after photo and a comment (${list(short)})`,
        );
      }
    }
  }

  // The device is allowed to edit a job in assigned, in_progress or
  // rejected, but only in_progress and rejected may be SUBMITTED. Without
  // this the editability check was the only gate and a job could jump
  // straight from assigned to submitted, skipping in_progress entirely.
  assertTransition(job.status as SnaggingTaskStatus, "submitted");

  // Everyone on the job has signed (the submitter may be signing with this).
  const submitterSigning = Boolean(payload.signature_png || payload.signature_path);
  await assertEveryoneSigned(admin, job.id, null, ctx.userId, submitterSigning);

  // The drawn signature, when it came with the submission rather than ahead of it.
  const signaturePath =
    (payload.signature_path as string | null | undefined) ||
    (await storeSignature(admin, job.id, ctx.mutation.entity_id, payload.signature_png));
  if (signaturePath) {
    await recordSignoff(admin, {
      jobId: job.id,
      visitId: null,
      inspectorId: ctx.userId,
      signerName: (payload.signer_name as string) ?? null,
      signaturePath,
      signedAt: (payload.signed_at as string) ?? new Date().toISOString(),
    });
  }

  const submittedAt = new Date().toISOString();
  const { error } = await admin
    .from("snagging_jobs")
    .update({
      status: "submitted",
      locked: true,
      submitted_at: submittedAt,
      // FR-6.07 — the 48-hour clock starts here and is stored, so the
      // escalation sweep can index it instead of recomputing it per read.
      approval_due_at: approvalDueAt(new Date(submittedAt)),
      // A resubmission is a fresh decision: clear the previous review
      // pass and any escalation so the job is not born already late.
      review_started_at: null,
      reviewed_at: null,
      escalated_at: null,
      signer_name: (payload.signer_name as string) ?? null,
      signed_at: (payload.signed_at as string) ?? submittedAt,
      signature_path: signaturePath ?? null,
    })
    .eq("id", job.id);
  if (error) throw new Error(error.message);

  const { error: lockError } = await admin.from("snagging_snags").update({ locked: true }).eq("job_id", job.id);
  if (lockError) throw new Error(lockError.message);

  // FR-6.04 — the status change that hands the job to the approval queue
  // is audited like every manager-side transition, not just silently
  // written by the sync route.
  auditFrom(ctx, {
    entityType: "submission",
    entityId: job.id,
    taskId: job.id,
    eventType: "task_submitted",
    payload: {
      code: job.code,
      signer_name: (payload.signer_name as string) ?? null,
      from_status: job.status,
      to_status: "submitted",
      // A resubmission after a rejection writes its own row rather than
      // replacing the last one, so both cycles stay readable in the
      // history -- the table refuses updates, so this is structural.
    },
  });

  ctx.jobById.set(job.id, { ...job, status: "submitted" });
}

/**
 * Hands a finished additional visit to its manager (decided 2026-09-18).
 *
 * The visit is submitted, not the job. The job was approved long ago and
 * its report is with the client; what goes for review is only what THIS
 * visit found, so that is what is checked and what is locked.
 *
 * The checklist does not hold it. A visit shows only the items an earlier
 * pass could not reach (change 29), and one that still cannot be reached
 * keeps its earlier "not checked, because" — exactly the rule a de-snag
 * round follows.
 */
async function submitVisit(
  admin: Admin,
  ctx: Ctx,
  job: JobRef,
  payload: Record<string, unknown>,
): Promise<void> {
  const visit = job.visit!;
  if (visit.status !== "in_progress" && visit.status !== "scheduled") {
    throw new Error(`Visit ${visit.number} is ${visit.status} and cannot be submitted`);
  }

  const [snagRows, photoRows] = await Promise.all([
    admin
      .from("snagging_snags")
      .select("id, snag_code")
      .eq("job_id", job.id)
      .eq("visit_id", visit.id)
      .neq("status", "withdrawn"),
    admin.from("snagging_snag_photos").select("snag_id").eq("job_id", job.id),
  ]);
  if (snagRows.error) throw new Error(snagRows.error.message);
  if (photoRows.error) throw new Error(photoRows.error.message);

  // BR-5 still holds on a visit: every defect it raises carries a photo.
  const photographed = new Set((photoRows.data ?? []).map((r) => r.snag_id));
  const missing = (snagRows.data ?? []).filter((s) => !photographed.has(s.id));
  if (missing.length > 0) {
    const sample = missing.slice(0, 3).map((s) => s.snag_code).join(", ");
    throw new Error(
      `${missing.length} snag(s) from this visit still have no photo uploaded (${sample}${missing.length > 3 ? ", …" : ""})`,
    );
  }

  // Everyone on the visit has signed (the submitter may be signing with this).
  const submitterSigning = Boolean(payload.signature_png || payload.signature_path);
  await assertEveryoneSigned(admin, job.id, visit.id, ctx.userId, submitterSigning);
  const visitSignature = await storeSignature(
    admin,
    job.id,
    ctx.mutation.entity_id,
    payload.signature_png,
  );
  if (visitSignature) {
    await recordSignoff(admin, {
      jobId: job.id,
      visitId: visit.id,
      inspectorId: ctx.userId,
      signerName: (payload.signer_name as string) ?? null,
      signaturePath: visitSignature,
      signedAt: (payload.signed_at as string) ?? new Date().toISOString(),
    });
  }

  const submittedAt = new Date().toISOString();
  const { error } = await admin
    .from("snagging_job_visits")
    .update({
      status: "submitted",
      submitted_at: submittedAt,
      // A resubmission after a send-back answers the note; it is cleared.
      review_note: null,
      updated_at: submittedAt,
    })
    .eq("id", visit.id);
  if (error) throw new Error(error.message);

  // What this visit found is now the manager's to judge, not the phone's.
  const { error: lockError } = await admin
    .from("snagging_snags")
    .update({ locked: true })
    .eq("job_id", job.id)
    .eq("visit_id", visit.id);
  if (lockError) throw new Error(lockError.message);

  auditFrom(ctx, {
    entityType: "submission",
    entityId: visit.id,
    taskId: job.id,
    eventType: "visit_submitted",
    payload: {
      code: job.code,
      visit_number: visit.number,
      snag_count: (snagRows.data ?? []).length,
      signer_name: (payload.signer_name as string) ?? null,
    },
  });

  visit.status = "submitted";
}

/** The device reporting that work has started on site (FR-1.06). */
async function applyTaskProgress(admin: Admin, ctx: Ctx, payload: Record<string, unknown>): Promise<void> {
  const job = writableJob(ctx, ctx.mutation.entity_id);
  if (payload.status !== "in_progress") throw new Error("The app may only move an inspection to in_progress");
  // On a visit the start was already recorded against the visit when this
  // push began, and the approved job must not be moved back to on-site.
  if (job.visit) return;
  if (job.status === "in_progress") return;
  // Same rule as submission: the transition map decides, not just whether
  // the inspector may edit the record.
  assertTransition(job.status as SnaggingTaskStatus, "in_progress");

  const { error } = await admin
    .from("snagging_jobs")
    .update({ status: "in_progress", started_at: (payload.started_at as string) ?? new Date().toISOString() })
    .eq("id", job.id)
    .in("status", ["assigned", "rejected"]);
  if (error) throw new Error(error.message);

  // FR-6.04 — start-of-work is a status change, so it belongs in the trail.
  auditFrom(ctx, {
    entityType: "task",
    entityId: job.id,
    taskId: job.id,
    eventType: "task_in_progress",
    payload: { code: job.code },
  });

  ctx.jobById.set(job.id, { ...job, status: "in_progress" });
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Applies a round's verdict to the defect's lasting record on the parent.
 *
 * Silent when there is nothing to write through — a defect first found
 * during the round has no earlier row, which is normal (FR-8.04).
 */
async function writeVerdictThroughToOrigin(
  admin: Admin,
  snagId: string,
  status: string,
): Promise<void> {
  const { data: copy, error: copyError } = await admin
    .from("snagging_snags")
    .select("snag_code, job:job_id(id, parent_job_id, visit_type)")
    .eq("id", snagId)
    .maybeSingle();
  if (copyError) throw new Error(copyError.message);

  const job = (Array.isArray(copy?.job) ? copy?.job[0] : copy?.job) as
    | { id: string; parent_job_id: string | null; visit_type: string | null }
    | undefined;

  // Only a de-snag round re-verifies an earlier defect. An additional
  // visit finds new ones, and its snags are already the original.
  if (!copy || !job?.parent_job_id || job.visit_type !== "desnag") return;

  /*
    Every copy of this defect, not just the original's.

    Writing only to the original was right for a defect the original knows
    about, and a no-op for one that was first raised on an earlier round --
    that defect has no row on the original, so the update matched nothing
    and the verdict lived only on the round that gave it. The round the
    defect was BORN on kept saying "open" no matter how many times a later
    round fixed and closed it.

    Updating the whole family keeps the copies in agreement wherever the
    lasting record happens to sit, which is what "one lasting record per
    defect" has to mean once a defect can be born on a round.
  */
  const rootId = job.parent_job_id;
  const { data: family, error: familyError } = await admin
    .from("snagging_jobs")
    .select("id")
    .eq("parent_job_id", rootId);
  if (familyError) throw new Error(familyError.message);

  const { error } = await admin
    .from("snagging_snags")
    .update({ status })
    .in("job_id", [rootId, ...(family ?? []).map((row) => row.id as string)])
    .eq("snag_code", copy.snag_code)
    // The row that was just given the verdict already holds it.
    .neq("id", snagId);
  if (error) throw new Error(error.message);
}
