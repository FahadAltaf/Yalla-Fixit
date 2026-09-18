import type { Metadata } from "next";
import { Suspense } from "react";

import NewJobWizard from "@/components/dashboard/snagging/new-job-wizard";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
const title = "Edit quotation | Property Care";
const description =
  "Correct a draft quotation before it goes to the client. The document is repriced on save.";

export const metadata: Metadata = {
  title,
  description,
  robots: { index: false, follow: false },
  alternates: { canonical: `${baseUrl}/snagging/quotations` },
  openGraph: { title, description, url: `${baseUrl}/snagging/quotations` },
  twitter: { card: "summary", title, description },
};

/**
 * The quotation form, reopened on a draft (BA v2, changes 1-2).
 *
 * The same component the quotation was written in, not a second edit
 * form: one of them owns the property fields, the band rules and the
 * validation, so a correction is made under exactly the constraints the
 * original was made under.
 */
export default async function EditQuotationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <NewJobWizard mode="quote" editQuotationId={id} />
    </Suspense>
  );
}
