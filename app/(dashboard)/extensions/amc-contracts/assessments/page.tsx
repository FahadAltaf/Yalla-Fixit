import type { Metadata } from "next";

import { AssessmentsPage } from "@/components/dashboard/extensions/amc-contracts/assessments";

export const metadata: Metadata = {
  title: "Site visits | AMC",
  robots: { index: false, follow: false },
};

export default function Route() {
  return <AssessmentsPage />;
}
