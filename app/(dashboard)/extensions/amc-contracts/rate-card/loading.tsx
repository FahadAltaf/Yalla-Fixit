import { HeadingSkeleton, SectionSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { Skeleton } from "@/components/ui/skeleton";

/** The rate card while it loads: heading, the tab row, then the rates section. */
export default function RateCardLoading() {
  return (
    <div className="flex flex-col gap-6">
      <HeadingSkeleton withActions />
      <Skeleton className="h-9 w-full rounded-lg" />
      <SectionSkeleton />
    </div>
  );
}
