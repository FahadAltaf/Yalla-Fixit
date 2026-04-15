"use client";

import { AlertCircle, AlertTriangle, CheckCircle2, XCircle, Clock } from "lucide-react";

import { QuotationData } from "@/components/dashboard/extensions/quotation-templates/quotation-templates";
import { YallaClassicTemplate } from "@/components/dashboard/extensions/quotation-templates/templates/YallaClassicTemplate";
import { ActionSection } from "./ActionSection";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import Loader from "@/components/ui/loader";
import { EmptyState } from "@/components/ui/empty-state";



async function fetchQuotation(
  estimateId: string
): Promise<{
  quotation: QuotationData | null;
  isActionable: boolean;
  currentStatus: string | null;
}> {
  try {
    const res = await fetch(`/api/estimates`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      // Review page does not need dashboard-only extras.
      body: JSON.stringify({ id: estimateId, fetchMode: "review" }),
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
const STATUS_CONFIG: Record<
  string,
  {
    title: string;
    description: string;
    icon: React.ReactNode;
    iconBg: string;
  }
> = {
  approved: {
    title: "Quotation Already Approved",
    description:
      "This estimate has already been approved. For any questions or changes, please contact the Yalla Fixit team.",
    icon: <CheckCircle2 size={32} className="text-green-600" />,
    iconBg: "bg-green-100",
  },
  approved2: {
    title: "Quotation Approved",
    description:
      "This estimate has been approved. For any questions or changes, please contact the Yalla Fixit team.",
    icon: <CheckCircle2 size={32} className="text-green-600" />,
    iconBg: "bg-green-100",
  },
  rejected: {
    title: "Quotation Already Rejected",
    description:
      "This estimate has already been rejected. If this is unexpected, please contact the Yalla Fixit team.",
    icon: <XCircle size={32} className="text-red-600" />,
    iconBg: "bg-red-100",
  },
  rejected2: {
    title: "Quotation Rejected",
    description:
      "This estimate has been rejected. If this was done in error, please reach out to the Yalla Fixit team.",
    icon: <XCircle size={32} className="text-red-600" />,
    iconBg: "bg-red-100",
  },
  cancelled: {
    title: "Quotation Cancelled",
    description:
      "This estimate has been cancelled. If you have any questions about this cancellation, please contact the Yalla Fixit team.",
    icon: <AlertTriangle size={32} className="text-yellow-600" />,
    iconBg: "bg-yellow-100",
  },
  closed: {
    title: "Quotation Closed",
    description:
      "This estimate has been closed and is no longer active. If you have any questions, please contact the Yalla Fixit team.",
    icon: <AlertCircle size={32} className="text-gray-600" />,
    iconBg: "bg-gray-100",
  },
  expired: {
    title: "Quotation Expired",
    description:
      "This estimate has expired. To discuss next steps, please contact the Yalla Fixit team.",
    icon: <Clock size={32} className="text-orange-600" />,
    iconBg: "bg-orange-100",
  },
  new: {
    title: "Quotation Error",
    description:
      "An error occurred while loading this quotation. Please contact Yalla Fixit support.",
    icon: <AlertCircle size={32} className="text-red-600" />,
    iconBg: "bg-red-100",
  }
};

// Active statuses where approve/reject UI should be shown
const ACTIVE_STATUSES = ["waiting for approval"];

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

export default function ReviewQuotationPage() {
  const searchParams = useSearchParams();
  const estimateId = searchParams?.get("id");
  const discountMode = searchParams?.get("mode");
  const [quotation, setQuotation] = useState<QuotationData | null>(null);
  const [currentStatus, setCurrentStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!estimateId) {
        setIsLoading(false);
        return;
      };
      setIsLoading(true);
      const { quotation, currentStatus } = await fetchQuotation(estimateId);
      setQuotation(quotation);
      setCurrentStatus(currentStatus);
      setIsLoading(false);
    };
    void fetchData();
  }, [estimateId]);

  if (isLoading) {
    return <div className="flex items-center justify-center py-8 h-[calc(100vh)]"><Loader /></div>;
  }

  if (!estimateId) {
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
        <div className="flex flex-col items-center gap-4">

          {/* Approve / Reject actions at the top */}
          <div className="w-full flex justify-center">
            <div className="w-full max-w-[794px]">
              <ActionSection
                estimateId={quotation.zohoEstimateId}
                quotationNumber={quotation.quotationNumber}
                currentStatus={currentStatus}
                setCurrentStatus={setCurrentStatus}
                ownerEmail={quotation.ownerEmail}
                ownerName={quotation.ownerName}
                customerName={quotation.customerContact || quotation.customerCompanyName}
                customerEmail={quotation.customerEmail}
                quotationDate={quotation.quotationDate}
              />
            </div>
          </div>

          {/* Exact quotation design using YallaClassicTemplate */}
          <div className="overflow-x-auto">
            <YallaClassicTemplate data={quotation} type="review" discountMode={discountMode ?? "with"} />
          </div>
        </div>
      </main>
    </EstimateStatusGuard>
  );
}

