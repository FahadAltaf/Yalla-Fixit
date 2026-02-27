"use client";

import { AlertCircle, FileText, AlertTriangle, CheckCircle2, XCircle, Clock } from "lucide-react";


import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { QuotationData } from "@/components/dashboard/extensions/quotation-templates/quotation-templates";
import { formatCurrency } from "@/utils/format-currentcy";
import { ActionSection } from "./ActionSection";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import Loader from "@/components/ui/loader";
import { EmptyState } from "@/components/ui/empty-state";
import yallaFixit from "@/public/yalla-fixit.png";
import Image from "next/image";



async function fetchQuotation(
  quotationNumber: string
): Promise<{
  quotation: QuotationData | null;
  isActionable: boolean;
  currentStatus: string | null;
}> {
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
      return { quotation: null, isActionable: false, currentStatus: null };
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
      currentStatus?: string | null;
    };

    if (!json.success || !json.quotation) {
      return { quotation: null, isActionable: false, currentStatus: null };
    }

    const status = (json.estimateStatus || json.currentStatus || "").toLowerCase();
    const lc = json.lifecycle;

    const hasTerminalTimestamp =
      !!lc?.Approved_Time ||
      !!lc?.Rejected_Time ||
      !!lc?.Cancelled_Time ||
      !!lc?.Closed_Time ||
      !!lc?.Expired_Time;

    // Treat only "new" estimates without any terminal timestamp as actionable.
    const isActionable = status === "new" && !hasTerminalTimestamp;

    return {
      quotation: json.quotation,
      isActionable,
      currentStatus: json.currentStatus ?? null,
    };
  } catch (error) {
    console.error("Review page get-estimate error:", error);
    return { quotation: null, isActionable: false, currentStatus: null };
  }
}



// ─── Status Config ────────────────────────────────────────────
const STATUS_CONFIG: Record<string, {
  title: string;
  description: string;
  icon: React.ReactNode;
  iconBg: string;
}> = {
  approved: {
    title: "Quotation Already Approved",
    description: "This estimate has already been approved. Please contact Yalla Fixit if you need a new quotation.",
    icon: <CheckCircle2 size={32} className="text-green-600" />,
    iconBg: "bg-green-100",
  },
  rejected: {
    title: "Quotation Already Rejected",
    description: "This estimate has already been rejected. Please contact Yalla Fixit if you need a new quotation.",
    icon: <XCircle size={32} className="text-red-600" />,
    iconBg: "bg-red-100",
  },
  cancelled: {
    title: "Quotation Cancelled",
    description: "This estimate has already been cancelled. Please contact Yalla Fixit if you need a new quotation.",
    icon: <AlertTriangle size={32} className="text-yellow-600" />,
    iconBg: "bg-yellow-100",
  },
  closed: {
    title: "Quotation Closed",
    description: "This estimate has already been closed. Please contact Yalla Fixit if you need a new quotation.",
    icon: <AlertCircle size={32} className="text-gray-600" />,
    iconBg: "bg-gray-100",
  },
  expired: {
    title: "Quotation Expired",
    description: "This estimate has expired. Please contact Yalla Fixit if you need a new quotation.",
    icon: <Clock size={32} className="text-orange-600" />,
    iconBg: "bg-orange-100",
  },
};

// Active statuses where approve/reject UI should be shown
const ACTIVE_STATUSES = ["new", "waiting for approval"];

// Fallback for unknown statuses
const DEFAULT_CONFIG = {
  title: "Quotation No Longer Available",
  description: "This estimate is no longer available for any actions. Please contact Yalla Fixit if you need assistance.",
  icon: <AlertCircle size={32} className="text-gray-500" />,
  iconBg: "bg-gray-100",
};

// ─── Props ────────────────────────────────────────────────────
interface EstimateStatusGuardProps {
  currentStatus: string | null | undefined;
  children: React.ReactNode;
}

// ─── Status Message Card ──────────────────────────────────────
function StatusMessageCard({
  title,
  description,
  icon,
  iconBg,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  iconBg: string;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10 bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-100 px-8 py-10 flex flex-col items-center text-center gap-5">
        {/* Icon circle */}
        <div className={`w-16 h-16 rounded-full flex items-center justify-center ${iconBg}`}>
          {icon}
        </div>

        {/* Text */}
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
          <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
        </div>

        {/* Contact button */}
        {/* <a
          href="mailto:support@yallafixit.com"
          className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 transition-colors"
        >
          Contact Yalla Fixit
        </a> */}
      </div>
    </main>
  );
}

function EstimateStatusGuard({
  currentStatus,
  children,
}: EstimateStatusGuardProps) {
  const normalizedStatus = currentStatus?.toLowerCase() ?? "";

  // Active status → show children (approve/reject UI)
  if (ACTIVE_STATUSES.includes(normalizedStatus)) {
    return <>{children}</>;
  }

  // Inactive status → show appropriate message card
  const config = STATUS_CONFIG[normalizedStatus] ?? DEFAULT_CONFIG;

  return (
    <StatusMessageCard
      title={config.title}
      description={config.description}
      icon={config.icon}
      iconBg={config.iconBg}
    />
  );
}

export default  function ReviewQuotationPage() {
  const searchParams = useSearchParams();
  const quotationNumber = searchParams?.get("quotationNumber");
  const [quotation, setQuotation] = useState<QuotationData | null>(null);
  const [currentStatus, setCurrentStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);


  

  useEffect(() => {
    const fetchData = async () => {
      if (!quotationNumber) {
        setIsLoading(false);
        return;
      };
      setIsLoading(true);
      const { quotation, currentStatus } = await fetchQuotation(quotationNumber);
      setQuotation(quotation);
      setCurrentStatus(currentStatus);
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




  return (
    <EstimateStatusGuard currentStatus={currentStatus}>

    <main className="min-h-screen bg-slate-100 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-4xl bg-white shadow-lg border border-slate-200 rounded-lg overflow-hidden">
        {/* Header – mirrors YallaClassicTemplate structure */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
          <Image src={yallaFixit} alt="Yalla Fixit" width={70} height={70} />

            <div>
              <div className="text-base font-semibold tracking-tight text-slate-900">
                {quotation.companyName}
              </div>
              <div className="mt-1 text-xs text-slate-600 space-y-0.5">
                <p>Office 102, Building 6, Gold &amp; Diamond Park, Dubai</p>
                <p>
                  <a
                    href="https://www.yallafixit.ae"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    https://www.yallafixit.ae
                  </a>
                </p>
              </div>
            </div>
          </div>

          <div className="text-right space-y-1">
            <div className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">
              Quotation
            </div>
            <div className="text-lg font-semibold text-slate-900">
              {quotation.quotationNumber}
            </div>
            <div className="text-xs text-slate-500">
              {quotation.quotationDate}
            </div>
            {quotation.validityDays != null && (
              <div className="text-[11px] text-slate-500">
                Valid for {quotation.validityDays} day
                {quotation.validityDays === 1 ? "" : "s"} from issue
              </div>
            )}
            {currentStatus && currentStatus.toLowerCase() !== "new" && (
              <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-slate-900 text-slate-50 px-2 py-0.5 text-[10px] font-medium">
                {currentStatus.toLowerCase() === "approved" && (
                  <CheckCircle2 className="h-3 w-3" />
                )}
                {currentStatus.toLowerCase() === "rejected" && (
                  <XCircle className="h-3 w-3" />
                )}
                {currentStatus.toLowerCase() === "cancelled" && (
                  <AlertTriangle className="h-3 w-3" />
                )}
                <span>{currentStatus}</span>
              </div>
            )}
          </div>
        </div>

        {/* Body – customer + service info + summary */}
        <div className="px-6 py-5 space-y-6">
          {/* From / Billed to / Service location */}
          <section className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                  From
                </p>
                <p className="text-sm font-semibold text-slate-900">
                  {quotation.companyName}
                </p>
                <p className="text-xs text-slate-500 max-w-md">
                  Office 102, Building 6, Gold &amp; Diamond Park, Dubai
                </p>
              </div>
              <div className="text-right space-y-0.5">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                  Issued on
                </p>
                <p className="text-sm font-semibold text-slate-900">
                  {quotation.quotationDate}
                </p>
              </div>
            </div>

            <Separator className="my-2" />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
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
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                    Service address
                  </p>
                  <p className="text-xs text-slate-600">
                    {quotation.serviceAddress}
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* Summary block – mirrors totals section style */}
          <section className="space-y-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-slate-500" />
                <p className="text-sm font-semibold text-slate-900">
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
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
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

          {/* Approve / Reject actions (logic preserved) */}
          <ActionSection
            estimateId={quotation.zohoEstimateId}
            quotationNumber={quotation.quotationNumber}
            currentStatus={currentStatus}
            setCurrentStatus={setCurrentStatus}
          />
        </div>
      </div>
    </main>
    </EstimateStatusGuard>
  );
}

