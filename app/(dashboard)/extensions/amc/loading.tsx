import { TablePageSkeleton } from "@/components/dashboard/snagging/route-skeletons";

/** The proposals table while the route loads: heading, toolbar, rows. */
export default function AmcProposalsLoading() {
  return <TablePageSkeleton filters={1} columns={5} />;
}
