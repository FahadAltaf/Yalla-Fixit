"use client";

import { UserCog } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { SnaggingTask } from "@/types/types";

/**
 * Says, wherever the job is being read, that nobody is going to walk it.
 *
 * An unassigned job looks completely normal: it has a property, an
 * appointment and a checklist, and the only thing missing is the person, one
 * tab away in a field that reads "Unassigned". Additional visits make this
 * worse: the dialog never asks who is going, and the endpoint carries the
 * parent's inspector over -- so a visit raised against a parent that had
 * none quietly has none either, with nothing on screen saying so.
 *
 * Rendered above the Snags tab and at the top of Setup, so the gap is on
 * screen wherever somebody opens the job rather than only where it is fixed.
 */
export function InspectorAssignmentAlert({
  task,
  onAssign,
}: {
  task: SnaggingTask;
  /**
   * Takes the reader to the assignment field. Setup scrolls to it; the
   * Snags tab switches tab first, because the field is not on that page.
   */
  onAssign?: () => void;
}) {
  if (task.inspector_id) return null;

  // A job that is finished, cancelled or already delivered is not waiting
  // on anybody -- flagging those would make the banner background noise.
  const openStatus = ["draft", "assigned", "in_progress", "rejected"].includes(
    task.status,
  );
  if (!openStatus) return null;

  const isAdditional = task.visit_type === "additional";
  const isRound = (task.round_number ?? 1) > 1;

  return (
    <Alert>
      <UserCog />
      <AlertTitle>No inspector assigned</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>
          {isAdditional
            ? "This additional visit has no inspector: the visit it follows had none to carry over, and the visit dialog does not ask for one. Nobody is booked to attend."
            : isRound
              ? "This de-snag round has no inspector, so nobody is booked to re-check the outstanding defects."
              : "Nobody is booked to walk this unit. The job cannot start on site until an inspector is assigned."}
        </span>
        {onAssign ? (
          <Button size="sm" variant="outline" onClick={onAssign}>
            <UserCog className="size-4" />
            Assign an inspector
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
