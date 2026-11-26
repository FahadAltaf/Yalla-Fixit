import { FieldsSkeleton, HeadingSkeleton, SectionSkeleton } from "@/components/dashboard/shared/kaizen-states";

/** AMC settings while they load: heading with Save, then the first block of fields. */
export default function AmcSettingsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <HeadingSkeleton withActions />
      <SectionSkeleton>
        <FieldsSkeleton fields={6} columns={3} />
      </SectionSkeleton>
    </div>
  );
}
