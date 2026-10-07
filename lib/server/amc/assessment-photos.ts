import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { PHOTO_EXTENSION, checkPhotoRemoval, checkPhotoUpload } from "@/lib/amc/photos";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { ContractError } from "@/lib/server/amc/contracts";
import { AMC_DOCUMENTS_BUCKET } from "@/lib/server/amc/signed-archive";

/**
 * Assessment photos in the private `amc-documents` bucket. Only the API
 * reads or writes the bucket (it has no storage policy); the browser gets
 * short-lived signed URLs after the same access check as the assessment.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Who = { userId: string; canApprove: boolean };
type Actor = { id: string; label: string | null };

export interface AssessmentPhoto {
  id: string;
  url: string | null;
  contentType: string;
  byteSize: number;
  caption: string | null;
  createdAt: string;
}

const TABLE = "amc_assessment_photos";
const missing = (error: { code?: string } | null | undefined) => error?.code === "42P01" || error?.code === "PGRST205";

async function assessmentState(admin: Admin, assessmentId: string) {
  const { data, error } = await admin
    .from("amc_assessments")
    .select("id, status, created_by, assessor_id")
    .eq("id", assessmentId)
    .maybeSingle<Row>();
  if (error) throw new ContractError(error.message, 400);
  if (!data) throw new ContractError("Assessment not found.", 404);
  return { status: String(data.status), createdBy: (data.created_by as string | null) ?? null, assessorId: (data.assessor_id as string | null) ?? null };
}

/* Its creator, the assessor sent on it (site visit), or an approver. */
const canEdit = (who: Who, state: { createdBy: string | null; assessorId: string | null }) =>
  who.canApprove || (!!state.createdBy && state.createdBy === who.userId) || (!!state.assessorId && state.assessorId === who.userId);

/** The photos of an assessment, each with a link valid for ten minutes. */
export async function listAssessmentPhotos(admin: Admin, assessmentId: string): Promise<{ photos: AssessmentPhoto[]; migrated: boolean }> {
  const { data, error } = await admin
    .from(TABLE)
    .select("id, storage_path, content_type, byte_size, caption, created_at")
    .eq("assessment_id", assessmentId)
    .order("created_at");
  if (error) {
    if (missing(error)) return { photos: [], migrated: false };
    throw new ContractError(error.message, 400);
  }
  const rows = (data ?? []) as Row[];
  const urls = new Map<string, string>();
  if (rows.length > 0) {
    const { data: signed } = await admin.storage
      .from(AMC_DOCUMENTS_BUCKET)
      .createSignedUrls(rows.map((r) => String(r.storage_path)), 600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  return {
    migrated: true,
    photos: rows.map((r) => ({
      id: String(r.id),
      url: urls.get(String(r.storage_path)) ?? null,
      contentType: String(r.content_type),
      byteSize: Number(r.byte_size),
      caption: (r.caption as string | null) ?? null,
      createdAt: String(r.created_at),
    })),
  };
}

export async function addAssessmentPhoto(
  admin: Admin,
  who: Who,
  assessmentId: string,
  file: { bytes: Uint8Array; caption?: string | null },
  actor: Actor,
): Promise<AssessmentPhoto> {
  const state = await assessmentState(admin, assessmentId);
  const { count } = await admin.from(TABLE).select("id", { count: "exact", head: true }).eq("assessment_id", assessmentId);
  const check = checkPhotoUpload({
    assessmentStatus: state.status,
    canEdit: canEdit(who, state),
    existingCount: count ?? 0,
    bytes: file.bytes,
  });
  if (!check.ok) throw new ContractError(check.error, check.status);

  const id = randomUUID();
  const path = `assessments/${assessmentId}/${id}.${PHOTO_EXTENSION[check.type]}`;
  const { error: uploadError } = await admin.storage
    .from(AMC_DOCUMENTS_BUCKET)
    .upload(path, file.bytes, { contentType: check.type, upsert: false });
  if (uploadError) throw new ContractError(`Could not store the photo: ${uploadError.message}`, 500);

  const caption = file.caption?.trim().slice(0, 300) || null;
  const { error } = await admin.from(TABLE).insert({
    id,
    assessment_id: assessmentId,
    storage_path: path,
    content_type: check.type,
    byte_size: file.bytes.byteLength,
    file_sha256: createHash("sha256").update(file.bytes).digest("hex"),
    caption,
    uploaded_by: actor.id,
  });
  if (error) {
    await admin.storage.from(AMC_DOCUMENTS_BUCKET).remove([path]);
    /* The trigger: the assessment was completed a moment ago. */
    if (error.code === "23514") throw new ContractError("The assessment was completed a moment ago; its photos are now fixed.", 409);
    if (missing(error)) throw new ContractError("Assessment photos are not set up on this database yet (migration 20261006150000).", 503);
    throw new ContractError(error.message, 400);
  }
  await recordAmcAudit(admin, {
    entityType: "assessment",
    entityId: assessmentId,
    eventType: "assessment_photo_added",
    actorId: actor.id,
    actorLabel: actor.label,
    /* What was added, never the file itself. */
    payload: { photoId: id, contentType: check.type, byteSize: file.bytes.byteLength },
  });
  const { data: signed } = await admin.storage.from(AMC_DOCUMENTS_BUCKET).createSignedUrl(path, 600);
  return {
    id,
    url: signed?.signedUrl ?? null,
    contentType: check.type,
    byteSize: file.bytes.byteLength,
    caption,
    createdAt: new Date().toISOString(),
  };
}

export async function removeAssessmentPhoto(admin: Admin, who: Who, assessmentId: string, photoId: string, actor: Actor): Promise<void> {
  const state = await assessmentState(admin, assessmentId);
  const check = checkPhotoRemoval({ assessmentStatus: state.status, canEdit: canEdit(who, state) });
  if (!check.ok) throw new ContractError(check.error, check.status);
  const { data, error } = await admin
    .from(TABLE)
    .delete()
    .eq("id", photoId)
    .eq("assessment_id", assessmentId)
    .select("storage_path")
    .maybeSingle<Row>();
  if (error) {
    if (error.code === "23514") throw new ContractError("The assessment was completed a moment ago; its photos are now fixed.", 409);
    throw new ContractError(error.message, 400);
  }
  if (!data) throw new ContractError("Photo not found.", 404);
  await admin.storage.from(AMC_DOCUMENTS_BUCKET).remove([String(data.storage_path)]);
  await recordAmcAudit(admin, {
    entityType: "assessment",
    entityId: assessmentId,
    eventType: "assessment_photo_removed",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { photoId },
  });
}

/** The stored files of a draft about to be deleted (rows go with it by cascade). */
export async function removeDraftPhotoFiles(admin: Admin, assessmentId: string): Promise<void> {
  const { data, error } = await admin.from(TABLE).select("storage_path").eq("assessment_id", assessmentId);
  if (error || !data?.length) return;
  await admin.storage.from(AMC_DOCUMENTS_BUCKET).remove((data as Row[]).map((r) => String(r.storage_path)));
}
