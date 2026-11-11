import { DetailHeaderSkeleton } from "@/components/dashboard/extensions/amc-contracts/detail-header";
import { SectionSkeleton } from "@/components/dashboard/shared/kaizen-states";

/** A visit while its page loads: the header card, then a section. */
export default function VisitLoading() {
  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <DetailHeaderSkeleton />
      <SectionSkeleton />
    </div>
  );
}
