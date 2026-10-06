"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/dashboard/shared/kaizen";
import { AmcNotificationsBell } from "@/components/dashboard/extensions/amc-contracts/amc-notifications-bell";

import { AmcApprovalNotice } from "./amc-approval-notice";
import { SubmissionsList } from "./submissions-list";

/**
 * /extensions/amc -- where AMC proposals start: every proposal the viewer
 * can see, filtered by status. Creating one and reading one are their own
 * pages, reached from here.
 */
export function AmcSubmissionsPage() {
  const router = useRouter();
  useBreadcrumbLabel("amc", "AMC proposals");

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="Extensions"
        title="AMC proposals"
        description="Create AMC proposals and contracts, send them for approval, and track each one until the client signs."
        /* Beside the title, where Jobs and Quotations put theirs. It sat
           in the table's toolbar, so the one action that starts the work
           was below the filters for finding work already started. */
        actions={
          <div className="flex items-center gap-2">
            <AmcNotificationsBell className="size-9" />
            <Button asChild>
              <Link href="/extensions/amc/new">
                <Plus className="size-4" />
                Create New
              </Link>
            </Button>
          </div>
        }
      />

      {/* Approvers only: proposals waiting for their approval. */}
      <AmcApprovalNotice
        onShowAll={() =>
          router.replace("/extensions/amc?status=awaiting_approval", { scroll: false })
        }
      />

      <SubmissionsList />
    </div>
  );
}
