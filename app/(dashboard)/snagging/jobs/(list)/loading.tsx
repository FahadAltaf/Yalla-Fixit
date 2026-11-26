import { TablePageSkeleton } from "@/components/dashboard/snagging/route-skeletons";

/** The jobs table while its first page is read on the server. */
export default function SnaggingJobsLoading() {
  return <TablePageSkeleton filters={1} columns={6} />;
}
