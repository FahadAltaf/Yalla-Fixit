import type { Metadata } from "next";

import { AssessmentDetail } from "@/components/dashboard/extensions/amc-contracts/assessments";

export const metadata: Metadata = {
  title: "Assessment | AMC contracts",
  robots: { index: false, follow: false },
};

export default async function Route({ params }: { params: Promise<{ assessmentId: string }> }) {
  const { assessmentId } = await params;
  return <AssessmentDetail id={assessmentId} />;
}
