import { OverviewSkeleton } from "@/components/dashboard/snagging/route-skeletons";

/** The overview while it loads: figures, charts, then the lists. */
export default function SnaggingOverviewLoading() {
  return <OverviewSkeleton />;
}
