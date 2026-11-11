import { TablePageSkeleton } from "@/components/dashboard/snagging/route-skeletons";

/** The AMC clients table while the route loads, shaped like Snagging's. */
export default function AmcClientsLoading() {
  return <TablePageSkeleton filters={1} columns={6} />;
}
