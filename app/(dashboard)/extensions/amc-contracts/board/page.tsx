import { Suspense } from "react";
import type { Metadata } from "next";

import { VisitBoard, VisitBoardSkeleton } from "@/components/dashboard/extensions/amc-contracts/visit-board";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeAmcPage } from "@/lib/server/amc/page-access";
import { ResourceType } from "@/types/types";

export const metadata: Metadata = {
  title: "Visit board | AMC",
  robots: { index: false, follow: false },
};

/* The board reads its day from ?date=, which needs a Suspense boundary. */
export default async function Route() {
  /* The page's own permission decides the page, not just the sidebar entry (as Snagging). */
  if (!(await canSeeAmcPage(ResourceType.AMC_VISITS))) return <NoPageAccess page="the Visit board" />;
  return (
    <Suspense fallback={<VisitBoardSkeleton />}>
      <VisitBoard />
    </Suspense>
  );
}
