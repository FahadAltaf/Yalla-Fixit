import { HeadingSkeleton, SectionSkeleton, StatGridSkeleton } from "@/components/dashboard/shared/kaizen-states";

/**
 * The shape of a snagging screen while its route chunk loads.
 *
 * Every snagging page opens with a heading and then either stat cards or
 * a section card, so one placeholder covers the whole segment: the
 * navigation lands on a page-shaped page rather than a blank panel, and
 * the client component's own skeleton takes over for the data fetch.
 */
export default function SnaggingLoading() {
  return (
    <div className="flex flex-col gap-6">
      <HeadingSkeleton withActions />
      <StatGridSkeleton />
      <SectionSkeleton />
    </div>
  );
}
