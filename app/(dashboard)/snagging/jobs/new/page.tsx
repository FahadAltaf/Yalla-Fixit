import type { Metadata } from "next";
import { Suspense } from "react";

import NewJobWizard from "@/components/dashboard/snagging/new-job-wizard";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
const title = "New job | Property Care Snagging";
const description = "Create an inspection task and the offline reference pack an inspector pulls.";

export const metadata: Metadata = {
  title,
  description,
  robots: { index: false, follow: false },
  alternates: { canonical: `${baseUrl}/snagging/jobs/new` },
  openGraph: { title, description, url: `${baseUrl}/snagging/jobs/new` },
  twitter: { card: "summary", title, description },
};

export default function NewJobPage() {
  /*
    The wizard reads `?quotation=` to open pre-filled from an approved
    quotation (BA v2, change 3), and `useSearchParams` has to sit under a
    Suspense boundary or the route cannot be prerendered.
  */
  return (
    <Suspense fallback={null}>
      <NewJobWizard />
    </Suspense>
  );
}
