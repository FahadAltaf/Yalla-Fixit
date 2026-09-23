"use client";

import { useRouter } from "next/navigation";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { PageHeading } from "@/components/dashboard/shared/kaizen";

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
