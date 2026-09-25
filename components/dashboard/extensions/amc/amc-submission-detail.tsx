"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ScrollText } from "lucide-react";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { HeadingSkeleton, SectionSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { EmptyState } from "@/components/ui/empty-state";
import { amcSubmissionsService } from "@/modules/amc-submissions";

import { SubmissionDetails } from "./submission-details";
import type { AmcSubmission } from "./amc-types";
import { useAmcActions } from "./use-amc-actions";

/**
 * /extensions/amc/<id> -- one proposal, on its own page.
 *
 * Reads the proposal once (the server says whether the viewer may approve
 * it), shows everything about it, and offers the same actions as the list.
 * After an action it reads the proposal again, so the status, the buttons
 * and the history move on together.
 */
export function AmcSubmissionDetail({ id }: { id: string }) {
  const router = useRouter();
  const [submission, setSubmission] = useState<AmcSubmission | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");

  const apply = useCallback((next: AmcSubmission) => {
    setSubmission(next);
    setState("ready");
  }, []);
  const fail = useCallback((error: unknown) => {
    console.error(error);
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    setState(message.includes("not found") ? "missing" : "error");
  }, []);

  // Read again after an action, or from "Try again".
  const load = useCallback(
    () => amcSubmissionsService.getSubmission(id).then(apply, fail),
    [id, apply, fail],
  );

  // The first read. A reply for a proposal you have already left is dropped.
  useEffect(() => {
    let cancelled = false;
    amcSubmissionsService.getSubmission(id).then(
      (next) => !cancelled && apply(next),
      (error) => !cancelled && fail(error),
    );
    return () => {
      cancelled = true;
    };
  }, [id, apply, fail]);

  const actions = useAmcActions({ onChanged: load });

  // The breadcrumb names the proposal by its customer, not its id.
  useBreadcrumbLabel("amc", "AMC proposals");
  useBreadcrumbLabel(id, submission?.customer.customerName || undefined);

  if (state === "loading") {
    return (
      <div className="flex flex-col gap-4">
        <HeadingSkeleton withActions />
        <SectionSkeleton />
      </div>
    );
  }

  if (state !== "ready" || !submission) {
    return (
      <EmptyState
        icon={<ScrollText className="size-5" />}
        title={state === "missing" ? "This proposal isn't available" : "Couldn't load this proposal"}
        description={
          state === "missing"
            ? "It may have been deleted, or it may belong to someone else and not be waiting for your approval."
            : "Something went wrong while loading it. Try again in a moment."
        }
        action={
          state === "error"
            ? { label: "Try again", onClick: () => void load() }
            : { label: "All proposals", onClick: () => router.push("/extensions/amc"), variant: "outline" }
        }
      />
    );
  }

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      {actions.dialogs}
      <SubmissionDetails
        submission={submission}
        canApprove={Boolean(submission.viewer_can_approve)}
        deciding={actions.deciding}
        downloading={actions.downloadingId === submission.id}
        sending={actions.sendingId === submission.id}
        onView={actions.view}
        onApprove={actions.approve}
        onSendBack={actions.sendBack}
        onDownload={actions.download}
        onSend={actions.requestSend}
      />
    </div>
  );
}
