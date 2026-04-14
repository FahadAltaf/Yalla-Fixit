import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerClientForApi } from "@/lib/supabase/supabase-server-client";

const GET_ESTIMATE_EDGE_URL = `${process.env.SUPABASE_URL}/functions/v1/get-estimate`;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const ZOHO_BASE_URL = "https://fsm.zoho.com/fsm/v1";

const createRevisionSchema = z.object({
  estimateId: z.string().min(1),
  rootQuotationNumber: z.string().min(1),
  parentQuotationNumber: z.string().min(1),
  revisionType: z.enum(["Internal", "External"]),
  reason: z.string().trim().max(500).optional(),
});

type RevisionRow = {
  root_quotation_number: string;
  parent_quotation_number: string;
  revision_quotation_number: string;
  revision_type: "Internal" | "External";
  reason: string | null;
  revision_number: number;
};

function relationId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (
    value &&
    typeof value === "object" &&
    "id" in value &&
    typeof value.id === "string" &&
    value.id.trim()
  ) {
    return value.id;
  }
  return undefined;
}

async function getAccessToken(): Promise<string> {
  const supabase = await createServerClientForApi();
  const { data, error } = await supabase
    .from("settings")
    .select("oauth_access_token")
    .eq("id", 1)
    .single();

  if (error || !data?.oauth_access_token) {
    throw new Error("Failed to load Zoho access token.");
  }

  return data.oauth_access_token as string;
}

function getEstimateId(estimate: Record<string, unknown>): string | undefined {
  if (typeof estimate.id === "string" && estimate.id.trim()) {
    return estimate.id;
  }
  if (typeof estimate.ID === "string" && estimate.ID.trim()) {
    return estimate.ID;
  }
  return undefined;
}

function buildIdNameValue(id: string, name: string): string {
  return `${id}_${name}`;
}

function buildRevisionPayload(
  sourceEstimate: Record<string, unknown>,
  sourceEstimateId: string,
  revisionType: "Internal" | "External",
  reason?: string,
) {
  const contactId = relationId(sourceEstimate.Contact);
  const companyId = relationId(sourceEstimate.Company);
  const territoryId = relationId(sourceEstimate.Territory);
  const assetId = relationId(sourceEstimate.Asset);

  const sourceName =
    typeof sourceEstimate.Name === "string" ? sourceEstimate.Name : undefined;
  const sourceIdName = sourceName
    ? buildIdNameValue(sourceEstimateId, sourceName)
    : undefined;
  const rootQuotationNumber =
    typeof sourceEstimate.Root_Quotation_Number__C === "string" &&
    sourceEstimate.Root_Quotation_Number__C.trim()
      ? sourceEstimate.Root_Quotation_Number__C
      : sourceIdName;

  const serviceLineItems = Array.isArray(sourceEstimate.Service_Line_Items)
    ? sourceEstimate.Service_Line_Items.map((item) => {
        const line = item as Record<string, unknown>;
        return {
          Service: relationId(line.Service),
          Description:
            typeof line.Description === "string" ? line.Description : null,
          Quantity: typeof line.Quantity === "number" ? line.Quantity : 1,
          Unit: typeof line.Unit === "string" ? line.Unit : null,
          List_Price:
            typeof line.List_Price === "number"
              ? line.List_Price
              : typeof line.Amount === "number"
                ? line.Amount
                : 0,
          Amount: typeof line.Amount === "number" ? line.Amount : undefined,
          Discount: typeof line.Discount === "number" ? line.Discount : 0,
          Sequence:
            typeof line.Sequence === "number" ? line.Sequence : undefined,
          Tax: line.Tax ?? undefined,
          Discount_Type:
            typeof line.Discount_Type === "string"
              ? line.Discount_Type
              : undefined,
          Part_Line_Items: Array.isArray(line.Part_Line_Items)
            ? line.Part_Line_Items.map((part) => {
                const partLine = part as Record<string, unknown>;
                return {
                  Part: relationId(partLine.Part),
                  Description:
                    typeof partLine.Description === "string"
                      ? partLine.Description
                      : null,
                  Quantity:
                    typeof partLine.Quantity === "number"
                      ? partLine.Quantity
                      : 1,
                  Unit:
                    typeof partLine.Unit === "string" ? partLine.Unit : null,
                  List_Price:
                    typeof partLine.List_Price === "number"
                      ? partLine.List_Price
                      : typeof partLine.Amount === "number"
                        ? partLine.Amount
                        : 0,
                  Amount:
                    typeof partLine.Amount === "number"
                      ? partLine.Amount
                      : undefined,
                  Discount:
                    typeof partLine.Discount === "number"
                      ? partLine.Discount
                      : 0,
                  Sequence:
                    typeof partLine.Sequence === "number"
                      ? partLine.Sequence
                      : undefined,
                  Tax: partLine.Tax ?? undefined,
                  Discount_Type:
                    typeof partLine.Discount_Type === "string"
                      ? partLine.Discount_Type
                      : undefined,
                };
              })
            : [],
        };
      })
    : [];

  return {
    data: [
      {
        Summary:
          typeof sourceEstimate.Summary === "string"
            ? sourceEstimate.Summary
            : null,
        Expiry_Date:
          typeof sourceEstimate.Expiry_Date === "string"
            ? sourceEstimate.Expiry_Date
            : undefined,
        Contact: contactId,
        Company: companyId,
        Email:
          typeof sourceEstimate.Email === "string"
            ? sourceEstimate.Email
            : null,
        Phone:
          typeof sourceEstimate.Phone === "string"
            ? sourceEstimate.Phone
            : null,
        Asset: assetId ?? null,
        Territory: territoryId,
        Service_Address: sourceEstimate.Service_Address ?? null,
        Billing_Address: sourceEstimate.Billing_Address ?? null,
        Currency:
          typeof sourceEstimate.Currency === "string"
            ? sourceEstimate.Currency
            : undefined,
        Exchange_Rate: sourceEstimate.Exchange_Rate ?? undefined,
        Adjustment:
          typeof sourceEstimate.Adjustment === "number"
            ? sourceEstimate.Adjustment
            : 0,
        Service_Line_Items: serviceLineItems,
        Root_Quotation_Number__C: rootQuotationNumber,
        Previous_Quotation_Number__C: sourceIdName ?? null,
        Revision_Type__C: revisionType,
        Quotation_Type__C: "Revision",
        Reason__C: reason?.trim() ? reason.trim() : null,
      },
    ],
  };
}

export async function POST(req: NextRequest) {
  try {
    const parsed = createRevisionSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const {
      estimateId,
      rootQuotationNumber,
      parentQuotationNumber,
      revisionType,
      reason,
    } = parsed.data;

    const sourceEstimateRes = await fetch(GET_ESTIMATE_EDGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: estimateId }),
    });

    const sourceEstimateJson = await sourceEstimateRes.json().catch(() => null);
    if (!sourceEstimateRes.ok || !sourceEstimateJson?.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Failed to load source estimate.",
          details: sourceEstimateJson,
        },
        { status: sourceEstimateRes.status || 500 },
      );
    }

    const sourceEstimate = sourceEstimateJson?.estimate?.data?.[0];
    if (!sourceEstimate) {
      return NextResponse.json(
        { success: false, error: "Source estimate data not found." },
        { status: 404 },
      );
    }

    const sourceEstimateRecord = sourceEstimate as Record<string, unknown>;
    const sourceEstimateId = getEstimateId(sourceEstimateRecord);
    const sourceQuotationNumber =
      typeof sourceEstimateRecord.Name === "string"
        ? sourceEstimateRecord.Name
        : null;

    if (!sourceEstimateId || !sourceQuotationNumber) {
      return NextResponse.json(
        {
          success: false,
          error: "Source estimate id/name is missing. Cannot create revision.",
        },
        { status: 400 },
      );
    }

    const supabase = await createServerClientForApi();

    const { data: revisionRows, error: revisionRowsError } = await supabase
      .from("estimate_revisions")
      .select(
        "root_quotation_number,parent_quotation_number,revision_quotation_number,revision_type",
      )
      .eq("root_quotation_number", rootQuotationNumber);
    if (revisionRowsError) {
      throw new Error(revisionRowsError.message);
    }

    const revisionNumber = (revisionRows?.length ?? 0) + 1;

    const payload = buildRevisionPayload(
      sourceEstimate,
      sourceEstimateId,
      revisionType,
      reason,
    );
    const accessToken = await getAccessToken();

    const createRes = await fetch(`${ZOHO_BASE_URL}/Estimates`, {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const createJson = await createRes.json().catch(() => null);
    console.log(
      "🚀 ~ POST ~ createJson (full):\n",
      JSON.stringify(createJson, null, 2),
    );
    if (!createRes.ok) {
      return NextResponse.json(
        {
          success: false,
          error: "Failed to create estimate revision.",
          details: createJson,
        },
        { status: createRes.status },
      );
    }

    const createdEstimate =
      createJson?.data?.Estimates?.[0] ??
      createJson?.data?.estimates?.[0] ??
      createJson?.data?.[0] ??
      null;
    const createdEstimateRecord = createdEstimate as Record<string, unknown>;
    const createdEstimateId = getEstimateId(createdEstimateRecord);
    let createdEstimateNumber =
      typeof createdEstimateRecord?.Name === "string"
        ? createdEstimateRecord.Name
        : null;

    if (!createdEstimateId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Revision estimate was created in Zoho, but response did not include estimate id.",
          details: createJson,
        },
        { status: 502 },
      );
    }

    // Fallback: only fetch again when create response does not include Name.
    if (!createdEstimateNumber) {
      const createdEstimateLookupRes = await fetch(GET_ESTIMATE_EDGE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          apikey: SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: createdEstimateId }),
      });

      if (createdEstimateLookupRes.ok) {
        const createdEstimateLookupJson = await createdEstimateLookupRes
          .json()
          .catch(() => null);
        const lookedUpEstimate = createdEstimateLookupJson?.estimate?.data?.[0];
        if (typeof lookedUpEstimate?.Name === "string") {
          createdEstimateNumber = lookedUpEstimate.Name;
        }
      }
    }

    const revisionQuotationNumber = createdEstimateNumber
      ? buildIdNameValue(createdEstimateId, createdEstimateNumber)
      : createdEstimateId;

    const insertPayload: RevisionRow = {
      root_quotation_number: rootQuotationNumber,
      parent_quotation_number: parentQuotationNumber,
      revision_quotation_number: revisionQuotationNumber,
      revision_type: revisionType,
      reason: reason?.trim() ? reason.trim() : null,
      revision_number: revisionNumber,
    };

    const { error: insertError } = await supabase
      .from("estimate_revisions")
      .insert(insertPayload);
    if (insertError) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Revision estimate was created, but failed to save revision record in Supabase.",
          details: insertError.message,
          revisionEstimateId: createdEstimateId,
          revisionEstimateNumber: createdEstimateNumber,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      revisionEstimateId: createdEstimateId,
      revisionEstimateNumber: createdEstimateNumber,
      revisionNumber,
      data: createJson,
    });
  } catch (error) {
    console.error("create revision API error:", error);
    return NextResponse.json(
      { success: false, error: "Unexpected error while creating revision." },
      { status: 500 },
    );
  }
}
