import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAuditBatch, type AuditEntry } from "@/lib/server/snagging/audit";
import {
  approvalDueAt,
  isTaskEditableByInspector,
  statusFromVerdict,
} from "@/lib/server/snagging/workflow";
import { syncPushSchema, type SyncPushInput } from "@/modules/snagging/schemas";
import {
  ActionType,
  ResourceType,
  SnaggingTaskStatus,
  SnaggingVerdict,
} from "@/types/types";

/**
 * Drains the device outbox (§6.3).
 *
 * Contract, in one place because everything else here follows from it:
 *
 *   - Every mutation carries a client-generated UUID. Applying the same
 *     id twice is a no-op, so a retry after a dropped response cannot
 *     duplicate a snag. The ledger row is what makes that true.
 *   - Mutations are applied in the order the device queued them, and
 *     one failure does not abandon the batch: each result comes back
 *     individually so the device can retire what succeeded and retry
 *     only what did not.
 *   - Rows are always keyed by the id the device generated, never by a
 *     server-assigned one, so a record has the same identity on both
 *     sides from the moment it is created offline.
 */

type MutationResult = {
  mutation_id: string;
  status: "applied" | "duplicate" | "rejected";
  error?: string;
};

export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser, origin } = await getRequestUserAccess(req);
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

    await touchDevice(admin, profile.id, input);

    // Which mutation ids has this server already seen? One round trip
    // rather than one per mutation.
    const ids = input.mutations.map((mutation) => mutation.mutation_id);
    const { data: seenRows, error: seenError } = await admin
      .from("snagging_sync_mutations")
      .select("mutation_id")
      .in("mutation_id", ids);
    if (seenError) throw new Error(seenError.message);
    const seen = new Set((seenRows ?? []).map((row) => row.mutation_id));

    // A task the caller is not assigned to is not theirs to write to,
    // whatever the payload claims. Loaded once and consulted per
    // mutation.
    const { data: assignments, error: assignmentError } = await admin
      .from("snagging_task_assignees")
      .select("task_id")
      .eq("user_id", profile.id);
    if (assignmentError) throw new Error(assignmentError.message);
    const assignedTasks = new Set((assignments ?? []).map((row) => row.task_id));

    const taskCache = new Map<string, { id: string; status: string; property_id: string; code: string }>();
    const results: MutationResult[] = [];
    const ledger: Array<Record<string, unknown>> = [];
    const audit: AuditEntry[] = [];

    for (const mutation of input.mutations) {
      if (seen.has(mutation.mutation_id)) {
        results.push({ mutation_id: mutation.mutation_id, status: "duplicate" });
        continue;
      }

      try {
        const taskId = await applyMutation(admin, {
          mutation,
          userId: profile.id,
          assignedTasks,
          taskCache,
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
        audit.push({
          entityType: mutation.entity === "photo" ? "photo" : (mutation.entity as AuditEntry["entityType"]),
          entityId: mutation.entity_id,
          taskId,
          eventType: `${mutation.entity}_${mutation.op}`,
          actorId: profile.id,
          actorLabel: profile.full_name ?? profile.email,
          origin: origin === "mobile" ? "mobile" : "portal",
        });
      } catch (mutationError) {
        const message = (mutationError as Error).message;
        results.push({ mutation_id: mutation.mutation_id, status: "rejected", error: message });
        // Rejections are recorded too. Without this the device would
        // retry a permanently invalid mutation forever.
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

type ApplyContext = {
  mutation: Mutation;
  userId: string;
  assignedTasks: Set<string>;
  taskCache: Map<string, { id: string; status: string; property_id: string; code: string }>;
};

/** Returns the task the mutation belongs to, for the audit row. */
async function applyMutation(admin: SupabaseClient, ctx: ApplyContext): Promise<string | null> {
  const { mutation } = ctx;
  const payload = mutation.payload as Record<string, unknown>;

  switch (mutation.entity) {
    case "snag":
      return applySnag(admin, ctx, payload);
    case "area":
      return applyArea(admin, ctx, payload);
    case "photo":
      return applyPhoto(admin, ctx, payload);
    case "verification":
      return applyVerification(admin, ctx, payload);
    case "submission":
      return applySubmission(admin, ctx, payload);
    case "task":
      return applyTaskProgress(admin, ctx, payload);
    default:
      throw new Error(`Unsupported entity ${mutation.entity}`);
  }
}

async function loadWritableTask(
  admin: SupabaseClient,
  ctx: ApplyContext,
  taskId: unknown,
): Promise<{ id: string; status: string; property_id: string; code: string }> {
  if (typeof taskId !== "string" || !taskId) {
    throw new Error("Missing task_id");
  }
  if (!ctx.assignedTasks.has(taskId)) {
    throw new Error("Not assigned to this inspection");
  }

  const cached = ctx.taskCache.get(taskId);
  if (cached) return assertWritable(cached);

  const { data, error } = await admin
    .from("snagging_tasks")
    .select("id, status, property_id, code")
    .eq("id", taskId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Inspection not found");

  ctx.taskCache.set(taskId, data);
  return assertWritable(data);
}

function assertWritable(task: { id: string; status: string; property_id: string; code: string }) {
  // BR-6/FR-2.09: a submitted inspection is immutable until a manager
  // sends it back. The device enforces this too, but a queued mutation
  // can arrive after the lock was applied, so the server is the one
  // that decides.
  if (!isTaskEditableByInspector(task.status as SnaggingTaskStatus)) {
    throw new Error(`Inspection is ${task.status} and cannot be edited`);
  }
  return task;
}

async function applySnag(
  admin: SupabaseClient,
  ctx: ApplyContext,
  payload: Record<string, unknown>,
): Promise<string> {
  const task = await loadWritableTask(admin, ctx, payload.task_id);

  if (ctx.mutation.op === "delete") {
    // Snags are withdrawn, never removed: the audit trail has to keep
    // showing that something was captured and then retracted (BR-7).
    const { error } = await admin
      .from("snagging_snags")
      .update({ status: "withdrawn" })
      .eq("id", ctx.mutation.entity_id)
      .eq("locked", false);
    if (error) throw new Error(error.message);
    return task.id;
  }

  const severity = payload.severity;
  if (severity !== "low" && severity !== "medium" && severity !== "high") {
    throw new Error("severity must be low, medium or high"); // BR-3
  }
  if (!payload.catalogue_code) {
    throw new Error("Every snag must reference a catalogue entry"); // BR-2
  }

  const row = {
    id: ctx.mutation.entity_id,
    property_id: task.property_id,
    origin_task_id: task.id,
    area_id: payload.area_id as string,
    snag_code: payload.snag_code as string,
    catalogue_entry_id: (payload.catalogue_entry_id as string) ?? null,
    catalogue_code: payload.catalogue_code as string,
    area_code: (payload.area_code as string) ?? null,
    element_code: (payload.element_code as string) ?? null,
    defect_code: (payload.defect_code as string) ?? null,
    area_label: (payload.area_label as string) ?? null,
    element_label: (payload.element_label as string) ?? null,
    defect_label: (payload.defect_label as string) ?? null,
    severity,
    note: (payload.note as string) ?? null,
    floor_plan_id: (payload.floor_plan_id as string) ?? null,
    pin_x: toNumber(payload.pin_x),
    pin_y: toNumber(payload.pin_y),
    round_created: (payload.round_created as number) ?? 1,
    captured_at: (payload.captured_at as string) ?? new Date().toISOString(),
    created_by: ctx.userId,
  };

  // Upsert rather than branch on op: an update that arrives before its
  // insert (queue reordered by a retry) still lands correctly.
  const { error } = await admin
    .from("snagging_snags")
    .upsert(row, { onConflict: "id" });
  if (error) throw new Error(error.message);

  return task.id;
}

async function applyArea(
  admin: SupabaseClient,
  ctx: ApplyContext,
  payload: Record<string, unknown>,
): Promise<string> {
  const task = await loadWritableTask(admin, ctx, payload.task_id);

  // FR-2.01: an inspector can add a room the office did not list. The
  // device sends it as an insert keyed by the id it generated, so an
  // upsert is safe on replay.
  if (ctx.mutation.op === "insert") {
    const { error } = await admin.from("snagging_areas").upsert(
      {
        id: ctx.mutation.entity_id,
        task_id: task.id,
        name: (payload.name as string) ?? "Area",
        catalogue_area_code: (payload.catalogue_area_code as string) ?? null,
        sort_order: (payload.sort_order as number) ?? 0,
        status: "pending",
      },
      { onConflict: "id" },
    );
    if (error) throw new Error(error.message);
    return task.id;
  }

  // FR-2.07: an area with no defects needs the inspector's note as its
  // positive coverage record, otherwise "clear" evidences nothing.
  const confirmedAt = payload.confirmed_at as string | null | undefined;
  const note = (payload.note as string | null | undefined)?.trim() || null;

  const { error } = await admin
    .from("snagging_areas")
    .update({
      note,
      confirmed_at: confirmedAt ?? null,
      confirmed_by: confirmedAt ? ctx.userId : null,
    })
    .eq("id", ctx.mutation.entity_id)
    .eq("task_id", task.id);

  if (error) throw new Error(error.message);
  return task.id;
}

async function applyPhoto(
  admin: SupabaseClient,
  ctx: ApplyContext,
  payload: Record<string, unknown>,
): Promise<string> {
  const task = await loadWritableTask(admin, ctx, payload.task_id);

  if (ctx.mutation.op === "delete") {
    // An inspector removed the photo before submitting. Drop the row, and
    // the object with it, so storage does not accumulate orphans. The
    // object delete is best-effort: a missing key is not a failure.
    const storagePath = payload.storage_path as string | undefined;
    if (storagePath) {
      await admin.storage.from("snagging").remove([storagePath]);
    }
    const { error } = await admin
      .from("snagging_snag_photos")
      .delete()
      .eq("id", ctx.mutation.entity_id);
    if (error) throw new Error(error.message);
    return task.id;
  }

  // The binary went straight to storage under a signed upload URL; this
  // records the metadata and the EXIF that gives the frame its
  // evidentiary weight (R6, FR-4.05).
  const row = {
    id: ctx.mutation.entity_id,
    snag_id: payload.snag_id as string,
    task_id: task.id,
    storage_path: payload.storage_path as string,
    media_type: (payload.media_type as string) ?? "photo",
    bytes: toNumber(payload.bytes),
    width: toNumber(payload.width),
    height: toNumber(payload.height),
    checksum_md5: (payload.checksum_md5 as string) ?? null,
    exif: (payload.exif as Record<string, unknown>) ?? null,
    gps_lat: toNumber(payload.gps_lat),
    gps_lng: toNumber(payload.gps_lng),
    taken_at: (payload.taken_at as string) ?? new Date().toISOString(),
    round_number: (payload.round_number as number) ?? 1,
    uploaded_by: ctx.userId,
  };

  const { error } = await admin
    .from("snagging_snag_photos")
    .upsert(row, { onConflict: "id" });
  if (error) throw new Error(error.message);

  return task.id;
}

async function applyVerification(
  admin: SupabaseClient,
  ctx: ApplyContext,
  payload: Record<string, unknown>,
): Promise<string> {
  const task = await loadWritableTask(admin, ctx, payload.round_task_id);

  const verdict = payload.verdict as SnaggingVerdict;
  const allowed: SnaggingVerdict[] = [
    "verified_closed",
    "verified_poor_quality",
    "verified_not_done",
    "withdrawn",
  ];
  if (!allowed.includes(verdict)) throw new Error(`Unknown verdict ${verdict}`);

  const snagId = payload.snag_id as string;

  const { error } = await admin.from("snagging_snag_verifications").upsert(
    {
      id: ctx.mutation.entity_id,
      snag_id: snagId,
      round_task_id: task.id,
      round_number: (payload.round_number as number) ?? 2,
      verdict,
      note: (payload.note as string) ?? null,
      created_by: ctx.userId,
    },
    { onConflict: "snag_id,round_task_id" },
  );
  if (error) throw new Error(error.message);

  // §5.2: the round updates the snag's status rather than creating a
  // second record of the same defect.
  const { error: statusError } = await admin
    .from("snagging_snags")
    .update({ status: statusFromVerdict(verdict) })
    .eq("id", snagId);
  if (statusError) throw new Error(statusError.message);

  return task.id;
}

async function applySubmission(
  admin: SupabaseClient,
  ctx: ApplyContext,
  payload: Record<string, unknown>,
): Promise<string> {
  const task = await loadWritableTask(admin, ctx, payload.task_id);

  // FR-2.04 and FR-3.04: every snag carries at least one photo, and
  // submission waits until all of them have landed in storage. The
  // device gates this too, but the server is the one that has to be
  // sure — a report cannot reach a client with a missing frame.
  //
  // Done as two id-only reads and a set difference rather than an
  // embedded null filter: filtering a parent row on a left-joined
  // column is not something PostgREST does predictably.
  const [snagRows, photoRows, areaCountResult] = await Promise.all([
    admin
      .from("snagging_snags")
      .select("id, snag_code")
      .eq("origin_task_id", task.id)
      .neq("status", "withdrawn"),
    admin.from("snagging_snag_photos").select("snag_id").eq("task_id", task.id),
    admin
      .from("snagging_areas")
      .select("id", { count: "exact", head: true })
      .eq("task_id", task.id),
  ]);

  if (snagRows.error) throw new Error(snagRows.error.message);
  if (photoRows.error) throw new Error(photoRows.error.message);

  const photographed = new Set((photoRows.data ?? []).map((row) => row.snag_id));
  const missing = (snagRows.data ?? []).filter((snag) => !photographed.has(snag.id));

  if (missing.length > 0) {
    const sample = missing
      .slice(0, 3)
      .map((snag) => snag.snag_code)
      .join(", ");
    throw new Error(
      `${missing.length} snag(s) still have no photo uploaded (${sample}${
        missing.length > 3 ? ", …" : ""
      })`,
    );
  }

  const snagCount = snagRows.data?.length ?? 0;
  const areaCount = areaCountResult.count ?? 0;

  const attempt = Number(payload.attempt ?? 1);

  const { error } = await admin.from("snagging_submissions").upsert(
    {
      id: ctx.mutation.entity_id,
      task_id: task.id,
      attempt,
      signed_at: (payload.signed_at as string) ?? new Date().toISOString(),
      signer_name: (payload.signer_name as string) ?? "",
      signature_path: (payload.signature_path as string) ?? null,
      gps_lat: toNumber(payload.gps_lat),
      gps_lng: toNumber(payload.gps_lng),
      device_id: (payload.device_id as string) ?? null,
      app_version: (payload.app_version as string) ?? null,
      snag_count: snagCount,
      area_count: areaCount,
      submitted_by: ctx.userId,
    },
    { onConflict: "task_id,attempt" },
  );
  if (error) throw new Error(error.message);

  const submittedAt = new Date();
  const { error: taskError } = await admin
    .from("snagging_tasks")
    .update({
      status: "submitted",
      submitted_at: submittedAt.toISOString(),
      submitted_by: ctx.userId,
      locked: true,
      approval_due_at: approvalDueAt(submittedAt),
    })
    .eq("id", task.id);
  if (taskError) throw new Error(taskError.message);

  // BR-6: everything captured in this visit becomes immutable.
  const { error: lockError } = await admin
    .from("snagging_snags")
    .update({ locked: true })
    .eq("origin_task_id", task.id);
  if (lockError) throw new Error(lockError.message);

  const { error: actionError } = await admin.from("snagging_approvals").insert({
    task_id: task.id,
    action: "submitted",
    actor_id: ctx.userId,
  });
  if (actionError) throw new Error(actionError.message);

  // The cache is stale the moment the lock lands.
  ctx.taskCache.delete(task.id);

  return task.id;
}

/** The device reporting that work has started on site (FR-1.06). */
async function applyTaskProgress(
  admin: SupabaseClient,
  ctx: ApplyContext,
  payload: Record<string, unknown>,
): Promise<string> {
  const task = await loadWritableTask(admin, ctx, ctx.mutation.entity_id);

  if (payload.status !== "in_progress") {
    throw new Error("The app may only move an inspection to in_progress");
  }
  if (task.status === "in_progress") return task.id;

  const { error } = await admin
    .from("snagging_tasks")
    .update({
      status: "in_progress",
      started_at: (payload.started_at as string) ?? new Date().toISOString(),
    })
    .eq("id", task.id)
    .in("status", ["assigned", "rejected"]);
  if (error) throw new Error(error.message);

  ctx.taskCache.delete(task.id);
  return task.id;
}

/** FR-3.05 — the free-space figure powers the low-storage warning. */
async function touchDevice(admin: SupabaseClient, userId: string, input: SyncPushInput) {
  if (!input.device_id) return;

  const { error } = await admin.from("snagging_devices").upsert(
    {
      device_id: input.device_id,
      user_id: userId,
      app_version: input.app_version ?? null,
      free_bytes: input.free_bytes ?? null,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "device_id" },
  );

  if (error) console.error("snagging device upsert failed", error.message);
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
