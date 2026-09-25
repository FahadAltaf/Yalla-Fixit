import { TablePageSkeleton } from "@/components/dashboard/snagging/route-skeletons";

/** The checklist library table while it loads. */
export default function SnaggingChecklistLoading() {
  return <TablePageSkeleton filters={2} columns={5} />;
}
