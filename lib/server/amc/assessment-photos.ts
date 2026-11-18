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
  /** What the photo is (Equipment, Fault, or a name the assessor typed), chosen on the phone; older photos have none. */
  category: string | null;
  createdAt: string;
}

/* The category column is new: until migration 20261113100000 is applied, photos are read and written without it. */
export const noCategoryColumn = (error: { code?: string; message?: string } | null | undefined) =>
  error?.code === "42703" || (error?.code === "PGRST204" && /category/.test(error.message ?? ""));

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

/**
 * The photos of an assessment, each with a link valid for ten minutes (the
 * mobile app keeps an opened site visit, so it asks for longer).
 */
export async function listAssessmentPhotos(admin: Admin, assessmentId: string, linkSeconds = 600): Promise<{ photos: AssessmentPhoto[]; migrated: boolean }> {
  const read = (columns: string) => admin.from(TABLE).select(columns).eq("assessment_id", assessmentId).order("created_at");
  let { data, error } = await read("id, storage_path, content_type, byte_size, caption, category, created_at");
  if (noCategoryColumn(error)) ({ data, error } = await read("id, storage_path, content_type, byte_size, caption, created_at"));
  if (error) {
    if (missing(error)) return { photos: [], migrated: false };
    throw new ContractError(error.message, 400);
  }
  const rows = (data ?? []) as unknown as Row[];
  const urls = new Map<string, string>();
  if (rows.length > 0) {
    const { data: signed } = await admin.storage
      .from(AMC_DOCUMENTS_BUCKET)
      .createSignedUrls(rows.map((r) => String(r.storage_path)), linkSeconds);
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
      category: (r.category as string | null) ?? null,
      createdAt: String(r.created_at),
    })),
  };
}

export async function addAssessmentPhoto(
  admin: Admin,
  who: Who,
  assessmentId: string,
  file: {
    bytes: Uint8Array;
    caption?: string | null;
    category?: string | null;
    /** The mobile app names its photos, so a replay after a lost response finds the photo already there. */
    id?: string | null;
  },
  actor: Actor,
): Promise<AssessmentPhoto & { duplicate?: true }> {
  if (file.id) {
    const { data: existing } = await admin.from(TABLE).select("*").eq("id", file.id).maybeSingle<Row>();
    if (existing) {
      if (String(existing.assessment_id) !== assessmentId) throw new ContractError("That photo belongs to another site visit.", 409);
      return {
        id: file.id,
        url: null,
        contentType: String(existing.content_type),
        byteSize: Number(existing.byte_size),
        caption: (existing.caption as string | null) ?? null,
        category: (existing.category as string | null) ?? null,
        createdAt: String(existing.created_at),
        duplicate: true,
      };
    }
  }
  const state = await assessmentState(admin, assessmentId);
  const { count } = await admin.from(TABLE).select("id", { count: "exact", head: true }).eq("assessment_id", assessmentId);
  const check = checkPhotoUpload({
    assessmentStatus: state.status,
    canEdit: canEdit(who, state),
    existingCount: count ?? 0,
    bytes: file.bytes,
  });
  if (!check.ok) throw new ContractError(check.error, check.status);

  const id = file.id ?? randomUUID();
  const path = `assessments/${assessmentId}/${id}.${PHOTO_EXTENSION[check.type]}`;
  const { error: uploadError } = await admin.storage
    .from(AMC_DOCUMENTS_BUCKET)
    .upload(path, file.bytes, { contentType: check.type, upsert: false });
  if (uploadError) throw new ContractError(`Could not store the photo: ${uploadError.message}`, 500);

  const caption = file.caption?.trim().slice(0, 300) || null;
  const category = file.category?.trim().slice(0, 60) || null;
  const row = {
    id,
    assessment_id: assessmentId,
    storage_path: path,
    content_type: check.type,
    byte_size: file.bytes.byteLength,
    file_sha256: createHash("sha256").update(file.bytes).digest("hex"),
    caption,
    uploaded_by: actor.id,
  };
  let { error } = await admin.from(TABLE).insert(category ? { ...row, category } : row);
  if (category && noCategoryColumn(error)) ({ error } = await admin.from(TABLE).insert(row));
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
    category,
    createdAt: new Date().toISOString(),
  };
}

/**
 * A photo's description and category, changed while the site visit is a
 * draft (the database allows nothing else to change on a photo, and nothing
 * at all once the visit is completed).
 */
export async function setAssessmentPhotoDetails(
  admin: Admin,
  assessmentId: string,
  photoId: string,
  details: { caption: string | null; category?: string | null },
): Promise<void> {
  const caption = details.caption?.trim().slice(0, 300) || null;
  const category = details.category === undefined ? undefined : details.category?.trim().slice(0, 60) || null;
  const update = (patch: Record<string, unknown>) => admin.from(TABLE).update(patch).eq("id", photoId).eq("assessment_id", assessmentId);
  let { error } = await update(category !== undefined ? { caption, category } : { caption });
  if (category !== undefined && noCategoryColumn(error)) ({ error } = await update({ caption }));
  if (error) {
    if (error.code === "23514") {
      throw new ContractError(
        /completed/.test(error.message)
          ? "A completed site visit's photos are kept as they are."
          : "Photo details cannot be changed on this database yet (migration 20261113100000).",
        409,
      );
    }
    throw new ContractError(error.message, 500);
  }
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
