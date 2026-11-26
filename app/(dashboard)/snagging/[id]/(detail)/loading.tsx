import { JobDetailSkeleton } from "@/components/dashboard/snagging/route-skeletons";

/** A job while its sections are read on the server: the toolbar, then its tabs. */
export default function JobDetailLoading() {
  return <JobDetailSkeleton />;
}
