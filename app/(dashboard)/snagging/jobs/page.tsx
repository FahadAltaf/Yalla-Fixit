import type { Metadata } from "next";
import { Suspense } from "react";

import JobsTable from "@/components/dashboard/snagging/jobs-table";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
const title = "Jobs | Property Care Snagging";
const description =
  "Every inspection task, its round, its inspector, and the snag counts the field has sent back.";

export const metadata: Metadata = {
  title,
  description,
  robots: { index: false, follow: false },
  alternates: { canonical: `${baseUrl}/snagging/jobs` },
  openGraph: { title, description, url: `${baseUrl}/snagging/jobs` },
  twitter: { card: "summary", title, description },
};

export default function SnaggingJobsPage() {
  // JobsTable reads the status filter from the query string, so it is
  // wrapped in Suspense as useSearchParams requires under the App Router.
  return (
    <Suspense>
      <JobsTable />
    </Suspense>
  );
}
