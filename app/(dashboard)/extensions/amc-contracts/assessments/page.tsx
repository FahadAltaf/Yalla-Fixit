import type { Metadata } from "next";

import { AssessmentsPage } from "@/components/dashboard/extensions/amc-contracts/assessments";

export const metadata: Metadata = {
  title: "Property assessments | AMC contracts",
  robots: { index: false, follow: false },
};

export default function Route() {
  return <AssessmentsPage />;
}
