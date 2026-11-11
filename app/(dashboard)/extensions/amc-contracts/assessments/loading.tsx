import { TablePageSkeleton } from "@/components/dashboard/snagging/route-skeletons";

/** The site visits table while the page loads: its heading, filter and rows. */
export default function SiteVisitsLoading() {
  return <TablePageSkeleton filters={1} columns={7} />;
}
