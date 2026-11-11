"use server";
import { createServerClientWithCookies } from "@/lib/supabase/supabase-helpers";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";

/* Logos and profile photos: images only. */
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml", "image/x-icon", "image/vnd.microsoft.icon"]);

/**
 * Uploads a logo or profile photo to the public `uploads` bucket.
 *
 * A server action is a public endpoint: anyone can invoke it, signed in or
 * not. It used to upload whatever it was given, and the bucket accepted
 * anonymous uploads, so the company's public file host took files from
 * anybody. Now only an active, signed-in user, only images, at most 5 MB
 * (and migration 20261006161000 closes anonymous uploads in storage too).
 */
export const saveFile = async (file: File) => {
  try {
    const { authUserId, profile } = await getAuthenticatedUserAccess();
    if (!authUserId || !profile || profile.is_active === false) {
      throw new Error("Sign in to upload files");
    }
    if (!(file instanceof File) || !ALLOWED_TYPES.has(file.type)) {
      throw new Error("Only image files can be uploaded here");
    }
    // Enforce 5 MB max across the app
    const MAX_SIZE_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_SIZE_BYTES) {
      throw new Error("File size exceeds 5MB limit");
    }

    const bucketName =
      process.env.NEXT_PUBLIC_SUPABASE_BUCKET_NAME || "uploads";

    const supabase = await createServerClientWithCookies()
    const { data } = await supabase
      .storage.from(bucketName)
      .upload(`public/${Date.now()}.${file.name?.split(".")?.pop()}`, file, {
        upsert: true,
        cacheControl: "3600",
        contentType: file.type,
      });
    const {
      data: { publicUrl },
    } = supabase
      .storage.from(bucketName)
      .getPublicUrl(data?.path || "");

    return publicUrl;
  } catch (error) {
    console.error("Error saving file:", error);
    // return null;
    throw new Error(
      error instanceof Error ? error.message : "Error saving file"
    );
  }
};
