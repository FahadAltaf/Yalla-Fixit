import { PillTabsSkeleton } from "@/components/dashboard/snagging/route-skeletons";
import { FieldsSkeleton, HeadingSkeleton, SectionSkeleton } from "@/components/dashboard/shared/kaizen-states";

/** AMC configuration while it loads: heading, its tabs, then the first section (26 Nov 2026: its own, not AMC settings'). */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <HeadingSkeleton withActions={false} />
      <PillTabsSkeleton count={8} />
      <SectionSkeleton>
        <FieldsSkeleton fields={6} columns={3} />
      </SectionSkeleton>
    </div>
  );
}
