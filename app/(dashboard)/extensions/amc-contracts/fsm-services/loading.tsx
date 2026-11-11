import { TablePageSkeleton } from "@/components/dashboard/snagging/route-skeletons";

/** The service mapping table while it loads. */
export default function FsmServiceMappingLoading() {
  return <TablePageSkeleton filters={1} columns={4} />;
}
