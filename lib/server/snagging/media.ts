import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Signed-URL helpers for the private `snagging` bucket.
 *
 * Property photos are personal data under PDPL (§7), so no object is
 * ever public. Anything the portal or the app displays gets a
 * short-lived signed URL minted at read time.
 */

export const SNAGGING_BUCKET = "snagging";

/** Long enough to review a full inspection, short enough not to leak. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

type WithPath = { storage_path?: string | null };
type WithNestedPhotos = { photos?: WithPath[] | null };

/**
 * Adds `signed_url` to every row and to any nested photos.
 *
 * Signing is done in one batch call per set of paths rather than per
 * row: a 478-snag inspection carries the best part of a thousand
 * photos, and a round trip each would take longer than the review.
 */
export async function signMediaPaths<T extends WithPath | WithNestedPhotos>(
  admin: SupabaseClient,
  rows: T[],
  expiresIn = SIGNED_URL_TTL_SECONDS,
): Promise<T[]> {
  if (!rows || rows.length === 0) return rows ?? [];

  const paths = new Set<string>();
  for (const row of rows) {
    const direct = (row as WithPath).storage_path;
    if (direct) paths.add(direct);

    for (const photo of (row as WithNestedPhotos).photos ?? []) {
      if (photo?.storage_path) paths.add(photo.storage_path);
    }
  }

  if (paths.size === 0) return rows;

  const urlByPath = await signPaths(admin, [...paths], expiresIn);

  return rows.map((row) => {
    const next = { ...row } as T & { signed_url?: string | null };

    const direct = (row as WithPath).storage_path;
    if (direct) next.signed_url = urlByPath.get(direct) ?? null;

    const photos = (row as WithNestedPhotos).photos;
    if (photos) {
      (next as WithNestedPhotos & { photos: unknown }).photos = photos.map((photo) => ({
        ...photo,
        signed_url: photo?.storage_path ? urlByPath.get(photo.storage_path) ?? null : null,
      }));
    }

    return next;
  });
}

export async function signPaths(
  admin: SupabaseClient,
  paths: string[],
  expiresIn = SIGNED_URL_TTL_SECONDS,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (paths.length === 0) return result;

  // createSignedUrls caps out on very large batches, so chunk it.
  const CHUNK = 100;
  for (let index = 0; index < paths.length; index += CHUNK) {
    const chunk = paths.slice(index, index + CHUNK);
    const { data, error } = await admin.storage
      .from(SNAGGING_BUCKET)
      .createSignedUrls(chunk, expiresIn);

    if (error) {
      console.error("snagging signed url batch failed", error.message);
      continue;
    }

    for (const entry of data ?? []) {
      // The batch API reports per-object failures inline rather than
      // failing the call, so a missing object skips instead of
      // poisoning the whole page.
      if (entry.error || !entry.signedUrl) continue;
      const key = entry.path ?? "";
      if (key) result.set(key, entry.signedUrl);
    }
  }

  return result;
}

/**
 * Object key for a piece of captured media.
 *
 * Keyed by the client-generated media id so a retry after a dropped
 * upload overwrites the same object instead of leaving an orphan, and
 * partitioned by task so a whole job's evidence can be located, listed,
 * or purged at retention time (§7) without a database lookup.
 */
export function mediaObjectKey(options: {
  taskId: string;
  mediaId: string;
  kind: "snag_photo" | "snag_video" | "signature" | "floor_plan";
  contentType: string;
}): string {
  const folder =
    options.kind === "floor_plan"
      ? "floor-plans"
      : options.kind === "signature"
        ? "signatures"
        : "snags";

  return `tasks/${options.taskId}/${folder}/${options.mediaId}${extensionFor(options.contentType)}`;
}

function extensionFor(contentType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "application/pdf": ".pdf",
  };
  return map[contentType.toLowerCase()] ?? "";
}
