import type { Metadata } from "next";
import { Suspense } from "react";

import NewJobWizard from "@/components/dashboard/snagging/new-job-wizard";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
const title = "New quotation | Property Care";
const description =
  "Price a client's property before any job exists. The job is raised once the client approves.";

export const metadata: Metadata = {
  title,
  description,
  robots: { index: false, follow: false },
  alternates: { canonical: `${baseUrl}/snagging/quotations/new` },
  openGraph: { title, description, url: `${baseUrl}/snagging/quotations/new` },
  twitter: { card: "summary", title, description },
};

/**
 * The job wizard, stopped after its first step (BA v2, change 2).
 *
 * Deliberately the same component rather than a second form: a quotation
 * and the job it pays for describe one property, and two forms asking for
 * it separately would drift apart on the first field either of them gained.
 */
export default function NewQuotationPage() {
  return (
    <Suspense fallback={null}>
      <NewJobWizard mode="quote" />
    </Suspense>
  );
}
