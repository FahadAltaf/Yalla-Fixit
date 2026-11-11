import { TablePageSkeleton } from "@/components/dashboard/snagging/route-skeletons";

/** Finance's payments while the route loads: heading, then the instalments table. */
export default function AmcPaymentsLoading() {
  return <TablePageSkeleton filters={1} columns={8} />;
}
