import { NextRequest, NextResponse } from "next/server";
import {
  QuotationData,
  QuotationLineItem,
} from "@/components/dashboard/extensions/quotation-templates/quotation-templates";

const SUPABASE_FUNCTION_URL =
  "https://sxzpigyphjotuubxpooj.supabase.co/functions/v1/get-estimate";

// NOTE: This is a publishable key provided explicitly in the spec.
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_ANON_KEY!;

function mapToQuotationData(payload: any): QuotationData {
  const estimate = payload?.estimate?.data?.[0];
  if (!estimate) {
    throw new Error("No estimate data found");
  }

  // Try to capture Zoho FSM estimate record id (field name may vary slightly).
  const zohoEstimateId: string | null =
    typeof estimate.id === "string"
      ? estimate.id
      : typeof estimate.ID === "string"
      ? estimate.ID
      : null;

  const companyName =
    estimate.Territory?.name ?? "Yalla Fix It";

  const companyAddress =
    estimate.Billing_Address?.Billing_Address_Name ??
    estimate.Billing_Address?.Billing_Street_1 ??
    "";

  const customerCompanyName =
    estimate.Company?.name || "";

  const customerContact = estimate.Contact?.name ?? null;
  const customerPhone = estimate.Phone ?? null;
  const customerEmail = estimate.Email ?? null;

  const serviceAddressParts = [
    estimate.Service_Address?.Service_Street_1,
    estimate.Service_Address?.Service_Street_2,
    estimate.Service_Address?.Service_City,
    estimate.Service_Address?.Service_Country,
  ].filter((part) => typeof part === "string" && part.trim().length > 0);

  const serviceAddress =
    serviceAddressParts.length > 0 ? serviceAddressParts.join(", ") : null;
const customerId = payload?.contact?.data?.[0]?.Customer_Id__C ?? null;
  const quotationNumber = estimate.Name ?? "";

  const quotationDateRaw =
    estimate.Creation_Date__C ?? estimate.Created_Time ?? null;
  const quotationDate = quotationDateRaw
    ? new Date(quotationDateRaw).toLocaleDateString("en-GB", {
        year: "numeric",
        month: "short",
        day: "2-digit",
      })
    : "";

  let validityDays: number | undefined;
  if (estimate.Creation_Date__C && estimate.Expiry_Date) {
    const created = new Date(estimate.Creation_Date__C);
    const expiry = new Date(estimate.Expiry_Date);
    const diffMs = expiry.getTime() - created.getTime();
    validityDays = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
  }

  const serviceLineItems: any[] = estimate.Service_Line_Items ?? [];

  const lineItems: QuotationLineItem[] = serviceLineItems.map((item) => ({
    description: item.Service?.name ?? item.Name ?? "Service",
    details: item.Description ?? undefined,
    quantity: typeof item.Quantity === "number" ? item.Quantity : 1,
    unit: item.Unit ?? "L/S",
    unitPrice:
      typeof item.List_Price === "number"
        ? item.List_Price
        : typeof item.Amount === "number"
        ? item.Amount
        : 0,
    taxRate:
      typeof item.Tax?.Tax_Percentage === "number"
        ? item.Tax.Tax_Percentage
        : 0,
    lineAmount:
      typeof item.Line_Item_Amount === "number"
        ? item.Line_Item_Amount
        : undefined,
    discountAmount:
      typeof item.Discount === "number"
        ? item.Discount
        : undefined,
  }));

  const discountAmount =
    typeof estimate.Discount === "number" ? estimate.Discount : 0;

  const subTotal =
    typeof estimate.Sub_Total === "number" ? estimate.Sub_Total : undefined;
  const taxAmount =
    typeof estimate.Tax_Amount === "number" ? estimate.Tax_Amount : undefined;
  const grandTotal =
    typeof estimate.Grand_Total === "number"
      ? estimate.Grand_Total
      : undefined;

  const termsAndConditions =
    typeof estimate.Terms_And_Conditions?.value === "string"
      ? estimate.Terms_And_Conditions.value
      : undefined;

  const notes: string | undefined = estimate.Summary ?? undefined;

  const quotation: QuotationData = {
    companyName,
    companyAddress,
    companyWebsite: undefined,
    companyPhone: undefined,
    companyLogo: undefined,
    customerId,
    customerCompanyName,
    customerContact: customerContact ?? undefined,
    customerPhone: customerPhone ?? undefined,
    customerEmail: customerEmail ?? undefined,

    serviceAddress: serviceAddress ?? undefined,

    quotationNumber,
    quotationDate,
    validityDays,
    lineItems,

    discountAmount,
    subTotal,
    taxAmount,
    grandTotal,
    termsAndConditions,
    notes,
    zohoEstimateId: zohoEstimateId ?? undefined,
  };

  return quotation;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = body?.name;

    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { success: false, error: "Missing or invalid name" },
        { status: 400 }
      );
    }

    const res = await fetch(SUPABASE_FUNCTION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name }),
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
        { status: res.status }
      );
    }

    const payload = await res.json();

    if (!payload?.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Estimate function returned unsuccessful response",
        },
        { status: 500 }
      );
    }

    const quotation = mapToQuotationData(payload);

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

    return NextResponse.json(
      {
        success: true,
        quotation,
        estimateStatus,
        lifecycle,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("get-estimate API error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Unexpected error while fetching estimate",
      },
      { status: 500 }
    );
  }
}

