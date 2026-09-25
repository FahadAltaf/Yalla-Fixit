import { TablePageSkeleton } from "@/components/dashboard/snagging/route-skeletons";

/** The defect catalogue table while it loads. */
export default function SnaggingCatalogueLoading() {
  return <TablePageSkeleton filters={2} columns={6} />;
}
