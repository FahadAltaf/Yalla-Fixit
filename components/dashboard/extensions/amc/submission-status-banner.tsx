"use client";

import { FileText, Undo2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

import { AMC_STATUS_LABELS, type AmcSubmissionStatus } from "./amc-types";

/**
 * FR5.8 — the status of the submission being edited, shown on the
 * submission itself and not only in My AMC Submissions.
 *
 * The one state that needs more than a label is "sent back". FR5.2 returns
 * the submission to its owner to fix, and the fix is only possible if the
 * owner can see what the approver asked for while they are editing — the
 * reason used to be visible in the list and nowhere else.
 */
export function SubmissionStatusBanner({
  status,
  sentBackReason,
  clientReason,
  clientName,
  proposalNumber,
}: {
  status: AmcSubmissionStatus;
  sentBackReason: string | null;
  /* What the client wrote when they asked for changes (FR5.5). */
  clientReason?: string | null;
  clientName?: string | null;
  proposalNumber?: string;
}) {
  if (status === "proposal_rejected") {
    return (
      <Alert variant="destructive">
        <Undo2 className="size-4" />
        <AlertTitle>
          {clientName?.trim() || "The client"} asked for changes
          {proposalNumber ? ` (${proposalNumber})` : ""}
        </AlertTitle>
        <AlertDescription>
          <p className="whitespace-pre-line">
            {clientReason || "No reason was given."}
          </p>
          <p className="mt-1">
            Make the changes, then press Submit for approval on the last step.
            Once it is approved again, send the revised proposal to the client.
            The link they have now stops working when you submit.
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  if (status === "sent_back") {
    return (
      <Alert variant="destructive">
        <Undo2 className="size-4" />
        <AlertTitle>
          Sent back by the approver
          {proposalNumber ? ` (${proposalNumber})` : ""}
        </AlertTitle>
        <AlertDescription>
          <p className="whitespace-pre-line">
            {sentBackReason || "No reason was recorded."}
          </p>
          <p className="mt-1">
            Make the changes, then press Submit for approval on the last step to
            send it back for review.
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
      <FileText className="size-4" />
      <span>
        Editing{" "}
        {proposalNumber ? (
          <span className="text-foreground font-medium">{proposalNumber}</span>
        ) : (
          "this proposal"
        )}
      </span>
      <Badge variant="secondary">{AMC_STATUS_LABELS[status] ?? status}</Badge>
    </div>
  );
}
