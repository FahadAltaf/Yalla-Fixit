import type { Metadata } from "next";

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
  return <NewJobWizard />;
}
