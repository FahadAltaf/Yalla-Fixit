import { NextRequest, NextResponse } from "next/server";
import {
  QuotationData,
  QuotationLineItem,
} from "@/components/dashboard/extensions/quotation-templates/quotation-templates";

const SUPABASE_FUNCTION_URL =
  "https://sxzpigyphjotuubxpooj.supabase.co/functions/v1/get-estimate";

// NOTE: This is a publishable key provided explicitly in the spec.
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_EDGE_KEY ??
  "sb_publishable_mLzJL084J23o1UZloyJoWA_TetNZ3Mf";

function mapToQuotationData(payload: any): QuotationData {
  const estimate = payload?.estimate?.data?.[0];
  if (!estimate) {
    throw new Error("No estimate data found");
  }

  const companyName =
    estimate.Territory?.name ?? "Yalla Fix It";

  const companyAddress =
    estimate.Billing_Address?.Billing_Address_Name ??
    estimate.Billing_Address?.Billing_Street_1 ??
    "";

  const customerName =
    estimate.Company?.name ??
    estimate.Contact?.name ??
    "";

  const customerContact = estimate.Contact?.name ?? null;
  const customerPhone = estimate.Phone ?? null;
  const customerEmail = estimate.Email ?? null;

  const serviceAddress =
    estimate.Service_Address?.Service_Address_Name ??
    estimate.Service_Address?.Service_Street_1 ??
    null;

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
  }));

  const discountAmount =
    typeof estimate.Discount === "number" ? estimate.Discount : 0;

  const notes: string | undefined =
    estimate.Summary ??
    estimate.Terms_And_Conditions?.value ??
    undefined;

  const quotation: QuotationData = {
    companyName,
    companyAddress,
    companyWebsite: undefined,
    companyPhone: undefined,
    companyLogo: undefined,

    customerName,
    customerContact: customerContact ?? undefined,
    customerPhone: customerPhone ?? undefined,
    customerEmail: customerEmail ?? undefined,

    serviceAddress: serviceAddress ?? undefined,

    quotationNumber,
    quotationDate,
    validityDays,

    lineItems,

    discountAmount,
    notes,
  };

  return quotation;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const id = body?.id;

    if (!id || typeof id !== "string") {
      return NextResponse.json(
        { success: false, error: "Missing or invalid id" },
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
      body: JSON.stringify({ id }),
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

    return NextResponse.json(
      {
        success: true,
        quotation,
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

