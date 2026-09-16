import type { Metadata } from "next";
import { Suspense } from "react";

import QuotationsAdmin from "@/components/dashboard/snagging/quotations-admin";
import { HeadingSkeleton } from "@/components/dashboard/shared/kaizen-states";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
const title = "Quotations | Property Care";
const description =
  "Every price quoted for a client's property, and which of them have become jobs.";

export const metadata: Metadata = {
  title,
  description,
  robots: { index: false, follow: false },
  alternates: { canonical: `${baseUrl}/snagging/quotations` },
  openGraph: { title, description, url: `${baseUrl}/snagging/quotations` },
  twitter: { card: "summary", title, description },
};

export default function SnaggingQuotationsPage() {
  // QuotationsAdmin reads the status filter from the query string, so it
  // is wrapped in Suspense as useSearchParams requires under the App
  // Router — the same shape the jobs page uses.
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-6">
          <HeadingSkeleton />
        </div>
      }
    >
      <QuotationsAdmin />
    </Suspense>
  );
}
