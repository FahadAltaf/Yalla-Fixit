import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction, isAdminUser } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAuditBatch, type AuditEntry } from "@/lib/server/snagging/audit";
import { isTaskEditableByInspector, statusFromVerdict } from "@/lib/server/snagging/workflow";
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
type JobRef = { id: string; status: string; code: string };

type MutationResult = {
  mutation_id: string;
  status: "applied" | "duplicate" | "rejected";
  error?: string;
};

export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = syncPushSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const input = parsed.data;

    const admin = await createAdminServerClient();

    // Which ids has this server already seen?
    const ids = input.mutations.map((m) => m.mutation_id);
    const { data: seenRows, error: seenError } = await admin
      .from("snagging_sync_mutations")
      .select("mutation_id")
      .in("mutation_id", ids);
    if (seenError) throw new Error(seenError.message);
    const seen = new Set((seenRows ?? []).map((r) => r.mutation_id));

    // The jobs this inspector may write to (single inspector per job now).
    // An admin is never restricted in snagging, so they may write to any job.
    let jobsQuery = admin.from("snagging_jobs").select("id, status, code");
    if (!isAdminUser(accessUser)) jobsQuery = jobsQuery.eq("inspector_id", profile.id);
    const { data: myJobs, error: jobsError } = await jobsQuery;
    if (jobsError) throw new Error(jobsError.message);
    const jobById = new Map<string, JobRef>((myJobs ?? []).map((j) => [j.id, j as JobRef]));

    const results: MutationResult[] = [];
    const ledger: Array<Record<string, unknown>> = [];
    const audit: AuditEntry[] = [];

    for (const mutation of input.mutations) {
      if (seen.has(mutation.mutation_id)) {
        results.push({ mutation_id: mutation.mutation_id, status: "duplicate" });
        continue;
      }
      try {
        await applyMutation(admin, {
          mutation,
          userId: profile.id,
          actorLabel: profile.full_name ?? profile.email ?? null,
          jobById,
          audit,
        });
        results.push({ mutation_id: mutation.mutation_id, status: "applied" });
        ledger.push({
          mutation_id: mutation.mutation_id,
          user_id: profile.id,
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
          user_id: profile.id,
          device_id: input.device_id ?? null,
          entity: mutation.entity,
          entity_id: mutation.entity_id,
          op: mutation.op,
          status: "rejected",
          error_message: message,
        });
      }
    }

    if (ledger.length > 0) {
      const { error: ledgerError } = await admin
        .from("snagging_sync_mutations")
        .upsert(ledger, { onConflict: "mutation_id", ignoreDuplicates: true });
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
  jobById: Map<string, JobRef>;
  /**
   * FR-6.04 — audit rows collected across the whole push and inserted
   * once at the end. A device drains its outbox in batches of dozens, so
   * one INSERT per mutation would multiply the round trips for a payload
   * that is already the slowest thing the app does.
   */
  audit: AuditEntry[];
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
    case "task": return applyTaskProgress(admin, ctx, payload);
    default: throw new Error(`Unsupported entity ${ctx.mutation.entity}`);
  }
}

/** Resolves the job a mutation targets and asserts it is still writable. */
function writableJob(ctx: Ctx, taskId: unknown): JobRef {
  if (typeof taskId !== "string" || !taskId) throw new Error("Missing task_id");
  const job = ctx.jobById.get(taskId);
  if (!job) throw new Error("Not assigned to this inspection");
  if (!isTaskEditableByInspector(job.status as SnaggingTaskStatus)) {
    throw new Error(`Inspection is ${job.status} and cannot be edited`);
  }
  return job;
}

async function applySnag(admin: Admin, ctx: Ctx, payload: Record<string, unknown>): Promise<void> {
  const job = writableJob(ctx, payload.task_id);

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
  if (!payload.catalogue_code) throw new Error("Every snag must carry a classification code");

  const row = {
    id: ctx.mutation.entity_id,
    job_id: job.id,
    area_id: payload.area_id as string,
    snag_code: payload.snag_code as string,
    catalogue_entry_id: (payload.catalogue_entry_id as string) ?? null,
    catalogue_code: payload.catalogue_code as string,
    element_label: (payload.element_label as string) ?? null,
    defect_label: (payload.defect_label as string) ?? null,
    severity,
    note: (payload.note as string) ?? null,
    floor_plan_id: (payload.floor_plan_id as string) ?? null,
    pin_x: toNumber(payload.pin_x),
    pin_y: toNumber(payload.pin_y),
    round_created: (payload.round_created as number) ?? 1,
    created_by: ctx.userId,
    created_at: (payload.captured_at as string) ?? new Date().toISOString(),
  };
  const { error } = await admin.from("snagging_snags").upsert(row, { onConflict: "id" });
  if (error) throw new Error(error.message);

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
    const { error } = await admin.from("snagging_areas").upsert(
      {
        id: ctx.mutation.entity_id,
        job_id: job.id,
        name: (payload.name as string) ?? "Area",
        catalogue_area_code: (payload.catalogue_area_code as string) ?? null,
        sort_order: (payload.sort_order as number) ?? 0,
        status: "pending",
        ...pinFields(),
      },
      { onConflict: "id" },
    );
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

  const { error } = await admin
    .from("snagging_areas")
    .update(update)
    .eq("id", ctx.mutation.entity_id)
    .eq("job_id", job.id);
  if (error) throw new Error(error.message);

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
      payload: { access_state: (payload.access_state as string) ?? null },
    });
  }
}

async function applyPhoto(admin: Admin, ctx: Ctx, payload: Record<string, unknown>): Promise<void> {
  const job = writableJob(ctx, payload.task_id);

  if (ctx.mutation.op === "delete") {
    const storagePath = payload.storage_path as string | undefined;
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
    const { error } = await admin
      .from("snagging_snag_photos")
      .update({ marker_x: placed ? x : null, marker_y: placed ? y : null })
      .eq("id", ctx.mutation.entity_id);
    if (error) throw new Error(error.message);
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
  const { error } = await admin
    .from("snagging_job_checklist")
    .update({
      status,
      reason: (payload.reason as string) ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ctx.mutation.entity_id)
    .eq("job_id", job.id);
  if (error) throw new Error(error.message);

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
    });
  }
}

/** A de-snag verdict now just moves the snag's status (no history table). */
async function applyVerification(admin: Admin, ctx: Ctx, payload: Record<string, unknown>): Promise<void> {
  const job = writableJob(ctx, payload.round_task_id);
  const verdict = payload.verdict as SnaggingVerdict;
  const allowed: SnaggingVerdict[] = ["verified_closed", "verified_poor_quality", "verified_not_done", "withdrawn"];
  if (!allowed.includes(verdict)) throw new Error(`Unknown verdict ${verdict}`);

  const { error } = await admin
    .from("snagging_snags")
    .update({ status: statusFromVerdict(verdict) })
    .eq("id", payload.snag_id as string);
  if (error) throw new Error(error.message);

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
async function applySubmission(admin: Admin, ctx: Ctx, payload: Record<string, unknown>): Promise<void> {
  const job = writableJob(ctx, payload.task_id);

  // Every snag must carry at least one photo, and every mandatory checklist
  // item must be answered, before the visit can close (BR-5, BR-12).
  const [snagRows, photoRows, checklistRows] = await Promise.all([
    admin.from("snagging_snags").select("id, snag_code").eq("job_id", job.id).neq("status", "withdrawn"),
    admin.from("snagging_snag_photos").select("snag_id").eq("job_id", job.id),
    admin.from("snagging_job_checklist").select("code, status, reason").eq("job_id", job.id).eq("mandatory", true),
  ]);
  if (snagRows.error) throw new Error(snagRows.error.message);
  if (photoRows.error) throw new Error(photoRows.error.message);
  if (checklistRows.error) throw new Error(checklistRows.error.message);

  // FR-4.13 / FR-4.15 (BRD §8): a mandatory item is only "answered" when it is
  // passed, failed, or explicitly marked not-checked WITH a reason. A pending
  // item, or a not-checked item with no reason, still blocks submission.
  const pendingChecks = (checklistRows.data ?? []).filter((c) => {
    if (c.status === "pending") return true;
    if (c.status === "not_checked") return !(c.reason && String(c.reason).trim().length > 0);
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

  const submittedAt = new Date().toISOString();
  const { error } = await admin
    .from("snagging_jobs")
    .update({
      status: "submitted",
      locked: true,
      submitted_at: submittedAt,
      signer_name: (payload.signer_name as string) ?? null,
      signed_at: (payload.signed_at as string) ?? submittedAt,
      signature_path: (payload.signature_path as string) ?? null,
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
    payload: { code: job.code, signer_name: (payload.signer_name as string) ?? null },
  });

  ctx.jobById.set(job.id, { ...job, status: "submitted" });
}

/** The device reporting that work has started on site (FR-1.06). */
async function applyTaskProgress(admin: Admin, ctx: Ctx, payload: Record<string, unknown>): Promise<void> {
  const job = writableJob(ctx, ctx.mutation.entity_id);
  if (payload.status !== "in_progress") throw new Error("The app may only move an inspection to in_progress");
  if (job.status === "in_progress") return;

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
