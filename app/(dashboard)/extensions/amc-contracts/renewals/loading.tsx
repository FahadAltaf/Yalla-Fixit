import { TablePageSkeleton } from "@/components/dashboard/snagging/route-skeletons";

/** Renewals while the page loads: heading, then the table card (26 Nov 2026: its own, not its section's). */
export default function Loading() {
  return <TablePageSkeleton filters={2} columns={7} />;
}
