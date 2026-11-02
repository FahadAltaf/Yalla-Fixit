import { NextRequest, NextResponse } from "next/server";
import { ServiceItemImage } from "@/components/dashboard/extensions/quotation-templates/quotation-templates";
import { mapToQuotationData } from "@/lib/quotations/estimate-quotation-data";
import { createServerClientForApi } from "@/lib/supabase/supabase-server-client";

const SUPABASE_FUNCTION_URL = `${process.env.SUPABASE_URL}/functions/v1/get-estimate`;

// NOTE: This is a publishable key provided explicitly in the spec.
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_ANON_KEY!;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = body?.name;
    const id = body?.id;
    const fetchMode: "dashboard" | "review" =
      body?.fetchMode === "review" ? "review" : "dashboard";

    if (!name && !id) {
      return NextResponse.json(
        { success: false, error: "Missing or invalid name or id" },
        { status: 400 },
      );
    }
    let reqPayload: any = {
      includes:
        fetchMode === "review"
          ? ["estimate", "transitions", "revisions"]
          : ["estimate", "contact", "transitions", "revisions"],
    };

    if (id) {
      reqPayload = {
        ...reqPayload,
        id: id,
      };
    } else {
      reqPayload = {
        ...reqPayload,
        name: name,
      };
    }

    const res = await fetch(SUPABASE_FUNCTION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(reqPayload),
    });

    if (!res.ok) {
      let errorBody: unknown;
      try {
        errorBody = await res.json();
      } catch {
        errorBody = { message: "Failed to fetch estimate" };
      }

      return NextResponse.json(
        {
          success: false,
          error: "Failed to fetch estimate",
          details: errorBody,
        },
        { status: res.status },
      );
    }

    const payload = await res.json();

    if (!payload?.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Estimate function returned unsuccessful response",
        },
        { status: 500 },
      );
    }

    const quotation = mapToQuotationData(payload);

    // Surface Zoho FSM current status and available transitions so that
    // clients (dashboard, approval flows, etc.) can react appropriately.
    const currentStatus: string | null =
      typeof payload?.current_status === "string"
        ? payload.current_status
        : null;

    // Surface basic lifecycle information so clients can decide
    // whether this estimate should still be actionable.
    const rawEstimate = payload?.estimate?.data?.[0] ?? null;
    const estimateStatus: string | null =
      rawEstimate && typeof rawEstimate.Status === "string"
        ? rawEstimate.Status
        : null;
    const lifecycle = rawEstimate
      ? {
          Approved_Time: rawEstimate.Approved_Time ?? null,
          Rejected_Time: rawEstimate.Rejected_Time ?? null,
          Cancelled_Time: rawEstimate.Cancelled_Time ?? null,
          Closed_Time: rawEstimate.Closed_Time ?? null,
          Expired_Time: rawEstimate.Expired_Time ?? null,
        }
      : null;
    const revisions = Array.isArray(payload?.revisions)
      ? payload.revisions
      : [];

    const effectiveRootKey = `${quotation.zohoEstimateId}_${quotation.quotationNumber}`;
    console.log("🚀 ~ POST ~ effectiveRootKey:", effectiveRootKey);
    let hasRootOrParentRevision = false;
    const supabase = await createServerClientForApi();
    if (fetchMode === "dashboard") {
      const { data: revisionRows, error: revisionRowsError } = await supabase
        .from("estimate_revisions")
        .select("id")
        .or(
          `parent_quotation_number.eq.${effectiveRootKey},root_quotation_number.eq.${effectiveRootKey}`,
        )
        .limit(1);
      console.log("🚀 ~ POST ~ revisionRows:", revisionRows);
      if (revisionRowsError) {
        throw new Error(revisionRowsError.message);
      }
      hasRootOrParentRevision = (revisionRows?.length ?? 0) > 0;
    }

    const canCreateRevision = !hasRootOrParentRevision;

    let serviceItemImages: ServiceItemImage[] = [];
    if (
      fetchMode === "dashboard" &&
      quotation.zohoEstimateId &&
      quotation.quotationNumber
    ) {
      const { data: imageRows, error: imageRowsError } = await supabase
        .from("estimate_service_items")
        .select("quotation_id,quotation_name,service_item_id,supabase_url")
        .eq("quotation_id", quotation.zohoEstimateId)
        .order("created_at", { ascending: true });

      if (imageRowsError) {
        throw new Error(imageRowsError.message);
      }

      serviceItemImages = (imageRows ?? []).map((row) => ({
        quotationId: row.quotation_id,
        quotationName: row.quotation_name,
        serviceItemId: row.service_item_id,
        supabaseUrl: row.supabase_url,
      }));
    }

    return NextResponse.json(
      {
        success: true,
        quotation: {
          ...quotation,
          serviceItemImages,
        },
        estimateStatus,
        lifecycle,
        currentStatus,
        revisions,
        canCreateRevision,
        serviceItemImages,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("get-estimate API error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Unexpected error while fetching estimate",
      },
      { status: 500 },
    );
  }
}
