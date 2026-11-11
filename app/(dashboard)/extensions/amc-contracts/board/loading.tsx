import { VisitBoardSkeleton } from "@/components/dashboard/extensions/amc-contracts/visit-board";

/** The visit board while the route loads: heading, the To place panel and the day grid. */
export default function AmcVisitBoardLoading() {
  return <VisitBoardSkeleton />;
}
