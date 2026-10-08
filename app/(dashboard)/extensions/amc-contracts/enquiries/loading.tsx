import { TablePageSkeleton } from "@/components/dashboard/snagging/route-skeletons";

/** The enquiries table while the page loads: its heading, filters and rows. */
export default function EnquiriesLoading() {
  return <TablePageSkeleton filters={5} columns={8} />;
}
