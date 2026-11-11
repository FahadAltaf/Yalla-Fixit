import { TablePageSkeleton } from "@/components/dashboard/snagging/route-skeletons";

/** The technicians table while it loads. */
export default function TechniciansLoading() {
  return <TablePageSkeleton filters={2} columns={6} />;
}
