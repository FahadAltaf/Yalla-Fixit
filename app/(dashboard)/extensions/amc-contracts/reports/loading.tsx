import { HeadingSkeleton, SectionSkeleton, StatGridSkeleton } from "@/components/dashboard/shared/kaizen-states";

/** The reports while they load: heading, the figures, then one report. */
export default function AmcReportsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <HeadingSkeleton withActions />
      <StatGridSkeleton count={4} />
      <SectionSkeleton />
    </div>
  );
}
