"use server";
import { createServerClientWithCookies } from "@/lib/supabase/supabase-helpers";

export const saveFile = async (file: File) => {
  try {
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
