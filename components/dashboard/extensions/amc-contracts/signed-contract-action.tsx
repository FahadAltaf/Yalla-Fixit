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
  if (submission.status !== "signed") return null;

  if (submission.contract_id) {
    return (
      <Button asChild variant="outline">
        <Link href={`/extensions/amc-contracts/${submission.contract_id}`}>
          <ScrollText className="size-4" /> Open contract
        </Link>
      </Button>
    );
  }
  /* Older databases (migration not applied) report null, not undefined. */
  if (submission.contract_id === undefined) return null;
  if (submission.is_own === false && !submission.viewer_can_approve) return null;

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <CalendarCheck2 className="size-4" /> Activate AMC
      </Button>
      <ActivateContractDialog
        open={open}
        onOpenChange={setOpen}
        submissionId={submission.id}
        proposalNumber={submission.customer.proposalNumber ?? ""}
        customerName={submission.customer.customerName ?? ""}
        proposedStart={submission.customer.startDate || null}
        proposedEnd={submission.customer.endDate || null}
        onActivated={(contractId) => router.push(`/extensions/amc-contracts/${contractId}`)}
      />
    </>
  );
}
