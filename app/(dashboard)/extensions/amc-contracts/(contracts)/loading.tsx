import { TablePageSkeleton } from "@/components/dashboard/snagging/route-skeletons";

/** The contracts table while the page loads: heading, then the table card. */
export default function AmcContractsLoading() {
  return <TablePageSkeleton filters={2} columns={8} />;
}
