import { DetailBodySkeleton, DetailHeaderSkeleton } from "@/components/dashboard/extensions/amc-contracts/detail-header";

/** A visit while its page loads: the header card, the tabs, the tiles and a section, as the page draws them. */
export default function VisitLoading() {
  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <DetailHeaderSkeleton />
      <DetailBodySkeleton />
    </div>
  );
}
