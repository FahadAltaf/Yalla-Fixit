import { Suspense } from "react";
import type { Metadata } from "next";

import { VisitBoard, VisitBoardSkeleton } from "@/components/dashboard/extensions/amc-contracts/visit-board";

export const metadata: Metadata = {
  title: "Visit board | AMC",
  robots: { index: false, follow: false },
};

/* The board reads its day from ?date=, which needs a Suspense boundary. */
export default function Route() {
  return (
    <Suspense fallback={<VisitBoardSkeleton />}>
      <VisitBoard />
    </Suspense>
  );
}
