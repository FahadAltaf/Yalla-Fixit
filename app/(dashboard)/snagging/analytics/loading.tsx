import { AnalyticsSkeleton } from "@/components/dashboard/snagging/route-skeletons";

/** Analytics while it loads: figures, then the charts and tables. */
export default function SnaggingAnalyticsLoading() {
  return <AnalyticsSkeleton />;
}
