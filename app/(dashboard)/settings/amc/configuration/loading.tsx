import { FieldsSkeleton, HeadingSkeleton, SectionSkeleton } from "@/components/dashboard/shared/kaizen-states";

/** AMC configuration while it loads: heading, then the first section's fields. */
export default function AmcConfigurationLoading() {
  return (
    <div className="flex flex-col gap-6">
      <HeadingSkeleton />
      <SectionSkeleton>
        <FieldsSkeleton />
      </SectionSkeleton>
    </div>
  );
}
