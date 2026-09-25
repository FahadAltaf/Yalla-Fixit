import { QuotationDetailSkeleton } from "@/components/dashboard/snagging/route-skeletons";

/** A quotation while it loads: its toolbar, then the document. */
export default function QuotationLoading() {
  return <QuotationDetailSkeleton />;
}
