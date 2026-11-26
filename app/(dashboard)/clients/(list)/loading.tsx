import { TablePageSkeleton } from "@/components/dashboard/snagging/route-skeletons";

/** The clients table while the route loads. */
export default function ClientsLoading() {
  return <TablePageSkeleton filters={1} columns={6} />;
}
