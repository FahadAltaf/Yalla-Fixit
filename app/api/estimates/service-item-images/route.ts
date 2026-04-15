import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerClientForApi } from "@/lib/supabase/supabase-server-client";
import { ServiceItemImage } from "@/components/dashboard/extensions/quotation-templates/quotation-templates";

const querySchema = z.object({
  quotationId: z.string().trim().min(1),
  quotationName: z.string().trim().min(1).optional(),
});
const deleteSchema = z.object({
  quotationId: z.string().trim().min(1),
  serviceItemId: z.string().trim().min(1),
  supabaseUrl: z.string().trim().url(),
});

const MAX_IMAGES_PER_SERVICE_ITEM = 2;
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const STORAGE_BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_BUCKET_NAME || "uploads";

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function getStoragePathFromPublicUrl(
  supabaseUrl: string,
  bucket: string,
): string | null {
  const marker = `/object/public/${bucket}/`;
  const markerIndex = supabaseUrl.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }
  const path = supabaseUrl.slice(markerIndex + marker.length);
  return path || null;
}

export async function GET(req: NextRequest) {
  try {
    const parsed = querySchema.safeParse({
      quotationId: req.nextUrl.searchParams.get("quotationId"),
      quotationName: req.nextUrl.searchParams.get("quotationName") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const supabase = await createServerClientForApi();
    let query = supabase
      .from("estimate_service_items")
      .select("quotation_id,quotation_name,service_item_id,supabase_url")
      .eq("quotation_id", parsed.data.quotationId);

    const { data, error } = await query.order("created_at", { ascending: true });
    if (error) {
      throw new Error(error.message);
    }

    const images: ServiceItemImage[] = (data ?? []).map((row) => ({
      quotationId: row.quotation_id,
      quotationName: row.quotation_name,
      serviceItemId: row.service_item_id,
      supabaseUrl: row.supabase_url,
    }));

    return NextResponse.json({ success: true, images });
  } catch (error) {
    console.error("service-item-images GET error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load service item images." },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const quotationId = formData.get("quotationId");
    const quotationName = formData.get("quotationName");
    const serviceItemId = formData.get("serviceItemId");
    const files = formData
      .getAll("images")
      .filter((entry): entry is File => entry instanceof File);

    const parsed = querySchema.extend({
      quotationName: z.string().trim().min(1),
      serviceItemId: z.string().trim().min(1),
    }).safeParse({
      quotationId,
      quotationName,
      serviceItemId,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.flatten() },
        { status: 400 },
      );
    }

    if (files.length === 0) {
      return NextResponse.json(
        { success: false, error: "Please upload at least one image." },
        { status: 400 },
      );
    }

    const invalidFile = files.find(
      (file) => !file.type.startsWith("image/") || file.size > MAX_IMAGE_SIZE_BYTES,
    );
    if (invalidFile) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid file. Only images up to 5MB are allowed.",
        },
        { status: 400 },
      );
    }

    const supabase = await createServerClientForApi();
    const { data: existingRows, error: existingError } = await supabase
      .from("estimate_service_items")
      .select("id")
      .eq("quotation_id", parsed.data.quotationId)
      .eq("service_item_id", parsed.data.serviceItemId);

    if (existingError) {
      throw new Error(existingError.message);
    }

    const existingCount = existingRows?.length ?? 0;
    if (existingCount + files.length > MAX_IMAGES_PER_SERVICE_ITEM) {
      return NextResponse.json(
        {
          success: false,
          error: `Maximum ${MAX_IMAGES_PER_SERVICE_ITEM} images allowed per service item.`,
        },
        { status: 400 },
      );
    }

    const uploadedRows: {
      quotation_id: string;
      quotation_name: string;
      service_item_id: string;
      supabase_url: string;
    }[] = [];

    const safeQuotationId = sanitizePathSegment(parsed.data.quotationId);
    const safeServiceItemId = sanitizePathSegment(parsed.data.serviceItemId);

    for (const file of files) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `quotation-service-item-images/${safeQuotationId}/${safeServiceItemId}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${ext}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, file, {
          upsert: false,
          cacheControl: "3600",
          contentType: file.type,
        });

      if (uploadError || !uploadData?.path) {
        throw new Error(uploadError?.message || "Image upload failed.");
      }

      const { data: urlData } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(uploadData.path);

      uploadedRows.push({
        quotation_id: parsed.data.quotationId,
        quotation_name: parsed.data.quotationName,
        service_item_id: parsed.data.serviceItemId,
        supabase_url: urlData.publicUrl,
      });
    }

    const { data: inserted, error: insertError } = await supabase
      .from("estimate_service_items")
      .insert(uploadedRows)
      .select("quotation_id,quotation_name,service_item_id,supabase_url");

    if (insertError) {
      throw new Error(insertError.message);
    }

    const images: ServiceItemImage[] = (inserted ?? []).map((row) => ({
      quotationId: row.quotation_id,
      quotationName: row.quotation_name,
      serviceItemId: row.service_item_id,
      supabaseUrl: row.supabase_url,
    }));

    return NextResponse.json({ success: true, images });
  } catch (error) {
    console.error("service-item-images POST error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to upload images." },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const parsed = deleteSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const supabase = await createServerClientForApi();
    const { error: deleteRowError } = await supabase
      .from("estimate_service_items")
      .delete()
      .eq("quotation_id", parsed.data.quotationId)
      .eq("service_item_id", parsed.data.serviceItemId)
      .eq("supabase_url", parsed.data.supabaseUrl);

    if (deleteRowError) {
      throw new Error(deleteRowError.message);
    }

    const storagePath = getStoragePathFromPublicUrl(
      parsed.data.supabaseUrl,
      STORAGE_BUCKET,
    );
    if (storagePath) {
      const { error: removeStorageError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([storagePath]);
      if (removeStorageError) {
        throw new Error(removeStorageError.message);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("service-item-images DELETE error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete service item image." },
      { status: 500 },
    );
  }
}
