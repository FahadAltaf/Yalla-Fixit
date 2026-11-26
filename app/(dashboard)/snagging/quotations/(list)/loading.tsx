import { TablePageSkeleton } from "@/components/dashboard/snagging/route-skeletons";

/** The quotations table while its first page is read on the server. */
export default function SnaggingQuotationsLoading() {
  return <TablePageSkeleton filters={1} columns={5} />;
}
