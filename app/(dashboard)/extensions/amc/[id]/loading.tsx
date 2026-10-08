import { ProposalDetailSkeleton } from "@/components/dashboard/extensions/amc/proposal-skeletons";

/** A proposal while the route loads: the toolbar, the header, then its tabs. */
export default function AmcProposalLoading() {
  return <ProposalDetailSkeleton />;
}
