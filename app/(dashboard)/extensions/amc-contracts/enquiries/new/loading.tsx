import { FieldsSkeleton, HeadingSkeleton, SectionSkeleton } from "@/components/dashboard/shared/kaizen-states";

/** New enquiry while it loads: heading, then the form's fields (26 Nov 2026: its own, not the enquiries table). */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <HeadingSkeleton withActions={false} />
      <SectionSkeleton>
        <FieldsSkeleton fields={8} columns={2} />
      </SectionSkeleton>
      <SectionSkeleton>
        <FieldsSkeleton fields={4} columns={2} />
      </SectionSkeleton>
    </div>
  );
}
