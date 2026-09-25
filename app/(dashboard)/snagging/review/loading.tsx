import { ReviewSkeleton } from "@/components/dashboard/snagging/route-skeletons";

/** The review workspace while it loads: the queue beside the inspection. */
export default function SnaggingReviewLoading() {
  return <ReviewSkeleton />;
}
