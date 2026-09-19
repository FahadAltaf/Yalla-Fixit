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

/*
  Signed URLs, reused for most of their life.

  Every read re-signed every path, and a fresh signature is a different
  URL -- so the browser could never reuse an image it had already
  downloaded. Each re-read of a job after an edit downloaded every photo
  again. A path's URL is now kept here and handed out again while it
  still has more than REUSE_MARGIN_MS to run: the same URL across
  re-reads, so the browser's own cache serves the image.

  The margin is the trade-off. A page is always handed a URL with at least
  that long left (at least 30 of its 60 minutes), where a fresh signature
  used to give it the full hour. The job page re-reads anything older than
  two minutes when it comes back into view, which re-signs a URL that
  is getting old.

  Keyed by lifetime as well as path, so the report's two-hour links are
  not handed out as one-hour ones or the other way round. Two requests
  signing the same path at the same moment share one signing call. The
  cache lives in this server process; another instance signs its own.
*/
const REUSE_MARGIN_MS = 30 * 60 * 1000;
const MAX_CACHED_URLS = 20_000;
type CachedUrl = { url: string; expiresAt: number };
const urlCache = new Map<string, CachedUrl>();
const pendingUrls = new Map<string, Promise<string | null>>();

const cacheKey = (path: string, expiresIn: number) => `${expiresIn}|${path}`;

function pruneUrlCache(now: number) {
  if (urlCache.size < MAX_CACHED_URLS) return;
  for (const [key, entry] of urlCache) {
    if (entry.expiresAt - now <= REUSE_MARGIN_MS) urlCache.delete(key);
  }
  if (urlCache.size >= MAX_CACHED_URLS) urlCache.clear();
}

/** One createSignedUrls call. A failed batch signs nothing, as before. */
async function signChunk(
  admin: SupabaseClient,
  chunk: string[],
  expiresIn: number,
): Promise<Map<string, string>> {
  const signed = new Map<string, string>();
  const { data, error } = await admin.storage
    .from(SNAGGING_BUCKET)
    .createSignedUrls(chunk, expiresIn);

  if (error) {
    console.error("snagging signed url batch failed", error.message);
    return signed;
  }

  for (const entry of data ?? []) {
    // The batch API reports per-object failures inline rather than
    // failing the call, so a missing object skips instead of
    // poisoning the whole page.
    if (entry.error || !entry.signedUrl) continue;
    const key = entry.path ?? "";
    if (key) signed.set(key, entry.signedUrl);
  }
  return signed;
}

export async function signPaths(
  admin: SupabaseClient,
  paths: string[],
  expiresIn = SIGNED_URL_TTL_SECONDS,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (paths.length === 0) return result;

  const now = Date.now();
  pruneUrlCache(now);

  const waiting: Promise<void>[] = [];
  const toSign: string[] = [];
  for (const path of new Set(paths)) {
    const key = cacheKey(path, expiresIn);
    const cached = urlCache.get(key);
    if (cached && cached.expiresAt - now > REUSE_MARGIN_MS) {
      result.set(path, cached.url);
      continue;
    }
    const pending = pendingUrls.get(key);
    if (pending) {
      waiting.push(
        pending.then((url) => {
          if (url) result.set(path, url);
        }),
      );
      continue;
    }
    toSign.push(path);
  }

  // createSignedUrls caps out on very large batches, so chunk it -- and
  // sign the chunks side by side rather than one after another.
  const CHUNK = 100;
  const chunks: string[][] = [];
  for (let index = 0; index < toSign.length; index += CHUNK) {
    chunks.push(toSign.slice(index, index + CHUNK));
  }

  const signing = chunks.map(async (chunk) => {
    // Timed from before the call, so the recorded expiry is never later
    // than the real one.
    const signedAt = Date.now();
    const batch = signChunk(admin, chunk, expiresIn);
    for (const path of chunk) {
      const key = cacheKey(path, expiresIn);
      pendingUrls.set(
        key,
        batch.then((signed) => signed.get(path) ?? null, () => null),
      );
    }
    let signed = new Map<string, string>();
    try {
      signed = await batch;
    } finally {
      for (const path of chunk) pendingUrls.delete(cacheKey(path, expiresIn));
    }
    for (const path of chunk) {
      const url = signed.get(path);
      if (!url) continue;
      urlCache.set(cacheKey(path, expiresIn), { url, expiresAt: signedAt + expiresIn * 1000 });
      result.set(path, url);
    }
  });

  await Promise.all([...signing, ...waiting]);
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
