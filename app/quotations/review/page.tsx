"use client";

import { AlertCircle, FileText } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { QuotationData } from "@/components/dashboard/extensions/quotation-templates/quotation-templates";
import { formatCurrency } from "@/utils/format-currentcy";
import { ActionSection } from "./ActionSection";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import Loader from "@/components/ui/loader";
import { EmptyState } from "@/components/ui/empty-state";



async function fetchQuotation(
  quotationNumber: string
): Promise<{ quotation: QuotationData | null; isActionable: boolean }> {
  try {
    const res = await fetch(`/api/get-estimate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: quotationNumber }),
      cache: "no-store",
    });

    if (!res.ok) {
      console.error("Failed to fetch quotation for review page", res.status);
      return { quotation: null, isActionable: false };
    }

    const json = (await res.json()) as {
      success: boolean;
      quotation?: QuotationData;
      estimateStatus?: string | null;
      lifecycle?: {
        Approved_Time: string | null;
        Rejected_Time: string | null;
        Cancelled_Time: string | null;
        Closed_Time: string | null;
        Expired_Time: string | null;
      } | null;
    };

    if (!json.success || !json.quotation) {
      return { quotation: null, isActionable: false };
    }

    const status = (json.estimateStatus || "").toLowerCase();
    const lc = json.lifecycle;

    const hasTerminalTimestamp =
      !!lc?.Approved_Time ||
      !!lc?.Rejected_Time ||
      !!lc?.Cancelled_Time ||
      !!lc?.Closed_Time ||
      !!lc?.Expired_Time;

    // Treat only "new" estimates without any terminal timestamp as actionable.
    const isActionable = status === "new" && !hasTerminalTimestamp;

    return { quotation: json.quotation, isActionable };
  } catch (error) {
    console.error("Review page get-estimate error:", error);
    return { quotation: null, isActionable: false };
  }
}

export default  function ReviewQuotationPage() {
  const searchParams = useSearchParams();
  const quotationNumber = searchParams?.get("quotationNumber");
  const [quotation, setQuotation] = useState<QuotationData | null>(null);
  const [isActionable, setIsActionable] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!quotationNumber) {
        setIsLoading(false);
        return;
      };
      setIsLoading(true);
      const { quotation, isActionable } = await fetchQuotation(quotationNumber);
      setQuotation(quotation);
      setIsActionable(isActionable);
      setIsLoading(false);
    };
    void fetchData();
  }, [quotationNumber]);

  if (isLoading) {
    return <div className="flex items-center justify-center py-8 h-[calc(100vh)]"><Loader/></div>;
  }

  if (!quotationNumber) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 py-10">
       <EmptyState title="Invalid quotation link" description="The quotation reference is missing from this link. Please use the original email button again or contact Yalla Fixit support." icon={<AlertCircle className="" />} />
      </main>
    );
  }


  if (!quotation) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 py-10">
      <EmptyState title="We could not load this quotation" description="The quotation may have expired, been updated, or the link is no longer valid. Please reach out to Yalla Fixit so we can resend an updated quotation." icon={<AlertCircle className="" />} />
      </main>
    );
  }

  if (!isActionable) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 py-10">
        <EmptyState
          title="This quotation is no longer available for approval"
          description="It looks like this estimate has already been approved, rejected, cancelled, closed, or expired in Zoho FSM. Please contact Yalla Fixit if you need a new quotation."
          icon={<AlertCircle className="" />}
        />
      </main>
    );
  }


  return (
    <main className="min-h-screen bg-linear-to-b from-slate-50 to-slate-100 flex items-center justify-center px-4 py-10">
      <Card className="w-full max-w-2xl shadow-lg border-slate-200">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className=" flex items-center gap-2 sm:text-lg">
                <FileText className="h-4 w-4 text-primary" />
                Review your quotation
              </CardTitle>
              <CardDescription className="sm:text-sm">
                Check the summary below, then choose to approve or reject this
                quotation.
              </CardDescription>
            </div>
            <Badge variant="outline" className="whitespace-nowrap text-xs">
              Quotation #{quotation.quotationNumber}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          <section className="space-y-3 rounded-lg border bg-slate-50 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                  From
                </p>
                <p className="text-sm font-semibold text-slate-900">
                  {quotation.companyName}
                </p>
                  <p className="text-xs text-slate-500 max-w-md">
                    Office 102, Building 6, Gold & Diamond Park, Dubai
                  </p>
           
              </div>

              <div className="text-right space-y-0.5">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                  Issued on
                </p>
                <p className="text-sm font-semibold text-slate-900">
                  {quotation.quotationDate}
                </p>
                {quotation.validityDays != null && (
                  <p className="text-xs text-slate-500">
                    Valid for {quotation.validityDays} day
                    {quotation.validityDays === 1 ? "" : "s"} from issue
                  </p>
                )}
              </div>
            </div>

            <Separator className="my-2" />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                  Billed to
                </p>
                <p className="text-sm font-semibold text-slate-900">
                  {quotation.customerCompanyName}
                </p>
                {quotation.customerContact && (
                  <p className="text-xs text-slate-600">
                    {quotation.customerContact}
                  </p>
                )}
                {quotation.customerEmail && (
                  <p className="text-xs text-slate-500">
                    {quotation.customerEmail}
                  </p>
                )}
                {quotation.customerPhone && (
                  <p className="text-xs text-slate-500">
                    {quotation.customerPhone}
                  </p>
                )}
              </div>

              {quotation.serviceAddress && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                    Service location
                  </p>
                  <p className="flex items-start gap-1.5 text-xs text-slate-600">
                    <span>{quotation.serviceAddress}</span>
                  </p>
                </div>
              )}
            </div>
          </section>

          <section className="space-y-3 rounded-lg border bg-white px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-slate-500" />
                <p className="text-sm font-medium text-slate-900">
                  Quotation summary
                </p>
              </div>
              <Badge variant="secondary" className="text-xs">
                Total items: {quotation.lineItems.length}
              </Badge>
            </div>

            <div className="space-y-1.5 text-xs text-slate-600">
              {quotation.lineItems.slice(0, 3).map((item, index) => (
                <div
                  key={`${item.description}-${index}`}
                  className="flex items-center justify-between gap-2"
                >
                  <p className="truncate max-w-[70%]">
                    {item.description}
                    {item.details ? ` – ${item.details}` : ""}
                  </p>
                  <p className="whitespace-nowrap font-medium">
                    {formatCurrency(item.unitPrice * item.quantity)}
                  </p>
                </div>
              ))}
              {quotation.lineItems.length > 3 && (
                <p className="text-[11px] text-slate-500">
                  + {quotation.lineItems.length - 3} more line
                  {quotation.lineItems.length - 3 === 1 ? "" : "s"} in this
                  quotation
                </p>
              )}
            </div>

            <Separator className="my-2" />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                  Grand total
                </p>
                <p className="text-lg font-semibold text-slate-900">
                  {formatCurrency(quotation.grandTotal ?? 0)}
                </p>
              </div>
              {quotation.taxAmount != null && (
                <div className="text-right space-y-0.5">
                  <p className="text-[11px] text-slate-500">
                    Includes estimated tax / VAT of{" "}
                    {formatCurrency(quotation.taxAmount)}
                  </p>
                </div>
              )}
            </div>
          </section>

          <ActionSection
            estimateId={quotation.zohoEstimateId}
            quotationNumber={quotation.quotationNumber}
          />
        </CardContent>
      </Card>
    </main>
  );
}

