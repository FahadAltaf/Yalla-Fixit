import { TablePageSkeleton } from "@/components/dashboard/snagging/route-skeletons";

/** The visits table while the page loads: its heading, four filters and rows. */
export default function VisitsLoading() {
  return <TablePageSkeleton filters={4} columns={6} />;
}
