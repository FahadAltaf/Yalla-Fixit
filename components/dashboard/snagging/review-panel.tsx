"use client";

import type { SnaggingTask } from "@/types/types";

import { InspectionHeaderCard } from "./inspection-header-card";
import { SnagWalkList } from "./snag-walk-list";

/**
 * The approvals workspace view of one inspection: the decision at the
 * top, the evidence under it, in one scroll.
 *
 * Both halves are shared with the job detail page, which arranges them
 * differently — the header pinned above a set of tabs. Keeping them as
 * two components rather than two copies means a change to how a snag
 * reads, or to what Approve does, lands on both screens at once.
 */
export function ReviewPanel({
  task,
  onChanged,
}: {
  task: SnaggingTask;
  onChanged: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <InspectionHeaderCard task={task} onChanged={onChanged} />
      <SnagWalkList task={task} />
    </div>
  );
}
