import { FieldsSkeleton, HeadingSkeleton, SectionSkeleton } from "@/components/dashboard/shared/kaizen-states";

/** Operations settings while they load: the two forms, then the checklist. */
export default function AmcOpsSettingsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <HeadingSkeleton withActions />
      <SectionSkeleton>
        <FieldsSkeleton fields={4} columns={2} />
      </SectionSkeleton>
      <SectionSkeleton>
        <FieldsSkeleton fields={3} columns={3} />
      </SectionSkeleton>
      <SectionSkeleton />
    </div>
  );
}
