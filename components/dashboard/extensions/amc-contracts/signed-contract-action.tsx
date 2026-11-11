"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarCheck2, ScrollText } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AmcSubmission } from "@/components/dashboard/extensions/amc/amc-types";

import { ActivateContractDialog } from "./activate-contract-dialog";

/**
 * On a signed proposal's page: the way into its operational contract, or
 * "Activate AMC" when it has none yet. The server decides who may
 * activate (the owner or an approver); this only offers the button.
 */
export function SignedContractAction({ submission }: { submission: AmcSubmission }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  /* Phase 6: the contract exists from the client's approval, so it opens before signing too. */
  if (submission.contract_id && ["proposal_approved", "contract_sent", "signed"].includes(submission.status)) {
    return (
      <Button asChild variant="outline">
        <Link href={`/extensions/amc-contracts/${submission.contract_id}`}>
          <ScrollText className="size-4" />
          Open contract
        </Link>
      </Button>
    );
  }
  if (submission.status !== "signed") return null;
  /* Older databases (migration not applied) report null, not undefined. */
  if (submission.contract_id === undefined) return null;
  if (submission.is_own === false && !submission.viewer_can_approve) return null;

  return (
    <>
      {/* The proposal's last step, so it is the header's primary button. */}
      <Button onClick={() => setOpen(true)}>
        <CalendarCheck2 className="size-4" />
        Activate AMC
      </Button>
      <ActivateContractDialog
        open={open}
        onOpenChange={setOpen}
        submissionId={submission.id}
        onActivated={(contractId) => router.push(`/extensions/amc-contracts/${contractId}`)}
      />
    </>
  );
}
