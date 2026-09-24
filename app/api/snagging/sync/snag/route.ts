import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction, isAdminUser } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { mayWriteJob } from "@/lib/server/snagging/job-roster";
import { SNAGGING_BUCKET, mediaObjectKey } from "@/lib/server/snagging/media";
import { handleSyncPull } from "@/lib/server/snagging/sync-pull";
import { handleSyncPush } from "@/lib/server/snagging/sync-push";
import { ActionType, ResourceType } from "@/types/types";

/**
 * POST /api/snagging/sync/snag -- a snag and its photos in one request.
 *
 * Saving a snag used to be four or five round trips from the phone: push
 * the snag, ask for an upload URL, put the file in storage, push the
 * photo's record, and a pull either side. On a site connection each is a
 * second or more, and any one failing left the snag half-sent.
 *
 * This takes the device's queued changes (the same batch /sync/push takes)
 * together with the compressed photo files, as multipart/form-data:
 *
 *   body          JSON: { device_id?, free_bytes?, mutations: [...], photos: [...], since? }
 *   photo:<id>    one file per entry in `photos`
 *
 * With `since` (the job list's cursor) the response also carries the job
 * cards that changed after it -- what /sync/jobs?since would send -- so a
 * whole sync, sending and hearing back, is this one request.
 *
 * The photos are stored here, then their records are applied with the
 * changes through the same push, so the rules -- who may write to a job,
 * a photo never before its snag, a retry never applied twice -- are the
 * push's, not a copy of them. Videos and anything too big for one request
 * still go straight to storage (/media/sign); the phone decides which.
 *
 * Offline is the phone's concern: it queues exactly as before, and sends
 * the queue through here once there is signal.
 */

export const runtime = "nodejs";

const photoSchema = z.object({
  id: z.string().uuid(),
  task_id: z.string().uuid(),
  snag_id: z.string().uuid(),
  content_type: z.string().trim().min(3).max(100),
  bytes: z.number().int().nonnegative().nullish(),
  width: z.number().int().nonnegative().nullish(),
  height: z.number().int().nonnegative().nullish(),
  gps_lat: z.number().nullish(),
  gps_lng: z.number().nullish(),
  exif: z.record(z.string(), z.unknown()).nullish(),
  marker_x: z.number().nullish(),
  marker_y: z.number().nullish(),
  taken_at: z.string().nullish(),
  round_number: z.number().int().positive().nullish(),
});

const bodySchema = z.object({
  device_id: z.string().optional(),
  free_bytes: z.number().optional(),
  mutations: z.array(z.unknown()).default([]),
  photos: z.array(photoSchema).max(20).default([]),
  since: z.string().datetime({ offset: true }).optional(),
});

type PhotoOutcome = {
  id: string;
  status: "applied" | "rejected";
  storage_path?: string;
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

    const form = await req.formData();
    const rawBody = form.get("body");
    let parsedJson: unknown;
    try {
      parsedJson = typeof rawBody === "string" ? JSON.parse(rawBody) : null;
    } catch {
      parsedJson = null;
    }
    const parsed = bodySchema.safeParse(parsedJson);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const input = parsed.data;
    const admin = await createAdminServerClient();
    const isAdmin = isAdminUser(accessUser);

    // Which of the photos' jobs this person may write to, asked once per job.
    const jobIds = [...new Set(input.photos.map((photo) => photo.task_id))];
    const writable = new Map<string, boolean>();
    await Promise.all(
      jobIds.map(async (jobId) => {
        writable.set(jobId, isAdmin || (await mayWriteJob(admin, jobId, profile.id)));
      }),
    );

    // The files go to storage side by side; a failed one costs its own photo.
    const outcomes = new Map<string, PhotoOutcome>();
    const photoMutations: Array<Record<string, unknown>> = [];
    const mutationToPhoto = new Map<string, string>();
    await Promise.all(
      input.photos.map(async (photo) => {
        if (!writable.get(photo.task_id)) {
          outcomes.set(photo.id, {
            id: photo.id,
            status: "rejected",
            error: "Not assigned to this inspection",
          });
          return;
        }
        const file = form.get(`photo:${photo.id}`);
        if (!(file instanceof Blob)) {
          outcomes.set(photo.id, { id: photo.id, status: "rejected", error: "The file did not arrive" });
          return;
        }
        const isVideo = photo.content_type.startsWith("video/");
        const path = mediaObjectKey({
          taskId: photo.task_id,
          mediaId: photo.id,
          kind: isVideo ? "snag_video" : "snag_photo",
          contentType: photo.content_type,
        });
        // Keyed by the photo's own id, so a retry replaces its own object.
        const { error } = await admin.storage
          .from(SNAGGING_BUCKET)
          .upload(path, file, { contentType: photo.content_type, upsert: true });
        if (error) {
          outcomes.set(photo.id, { id: photo.id, status: "rejected", error: error.message });
          return;
        }
        const mutationId = randomUUID();
        mutationToPhoto.set(mutationId, photo.id);
        outcomes.set(photo.id, { id: photo.id, status: "applied", storage_path: path });
        photoMutations.push({
          mutation_id: mutationId,
          entity: "photo",
          entity_id: photo.id,
          op: "insert",
          payload: {
            task_id: photo.task_id,
            snag_id: photo.snag_id,
            storage_path: path,
            media_type: isVideo ? "video" : "photo",
            bytes: photo.bytes ?? file.size,
            width: photo.width ?? null,
            height: photo.height ?? null,
            gps_lat: photo.gps_lat ?? null,
            gps_lng: photo.gps_lng ?? null,
            exif: photo.exif ?? null,
            marker_x: photo.marker_x ?? null,
            marker_y: photo.marker_y ?? null,
            taken_at: photo.taken_at ?? new Date().toISOString(),
            round_number: photo.round_number ?? 1,
          },
        });
      }),
    );

    // The changes and the photos' records, applied together by the push.
    type Pushed = {
      data?: {
        server_time: string;
        results: Array<{ mutation_id: string; status: string; error?: string }>;
      };
      error?: unknown;
    };
    const allMutations = [...input.mutations, ...photoMutations];
    let payload: Pushed = {
      data: { server_time: new Date().toISOString(), results: [] },
    };
    // Nothing to send is a sync that only asks what changed.
    if (allMutations.length > 0) {
      const pushed = await handleSyncPush(req, {
        device_id: input.device_id,
        free_bytes: input.free_bytes,
        mutations: allMutations,
      });
      payload = (await pushed.json()) as Pushed;
      if (!pushed.ok || !payload.data) {
        return NextResponse.json(payload, { status: pushed.status });
      }
    }
    if (!payload.data) throw new Error("Push returned nothing");

    /*
      What changed on the job list, asked after the push so the phone's own
      changes are part of it. Same handler and shape as /sync/jobs?since.
    */
    let changes: unknown = null;
    if (input.since) {
      const listed = await handleSyncPull(req, { view: "list", since: input.since });
      const body = (await listed.json()) as { data?: unknown };
      if (listed.ok && body.data) changes = body.data;
    }

    // A photo stored but whose record was refused (its snag was) is refused too.
    for (const result of payload.data.results) {
      const photoId = mutationToPhoto.get(result.mutation_id);
      if (!photoId) continue;
      if (result.status === "rejected") {
        outcomes.set(photoId, {
          id: photoId,
          status: "rejected",
          error: result.error ?? "Rejected by the server",
        });
      }
    }

    const results = payload.data.results.filter((r) => !mutationToPhoto.has(r.mutation_id));
    return NextResponse.json({
      data: {
        server_time: payload.data.server_time,
        results,
        applied: results.filter((r) => r.status === "applied").length,
        rejected: results.filter((r) => r.status === "rejected").length,
        photos: [...outcomes.values()],
        changes,
      },
    });
  } catch (error) {
    console.error("Snagging sync snag error:", error);
    return NextResponse.json({ error: "Failed to save the snag" }, { status: 500 });
  }
}
