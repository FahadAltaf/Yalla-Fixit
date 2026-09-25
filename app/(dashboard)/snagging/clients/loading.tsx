import { TablePageSkeleton } from "@/components/dashboard/snagging/route-skeletons";

/** The clients table while its first page is read on the server. */
export default function SnaggingClientsLoading() {
  return <TablePageSkeleton filters={0} columns={5} />;
}
