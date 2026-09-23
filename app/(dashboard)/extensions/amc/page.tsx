import type { Metadata } from "next";
import { Suspense } from "react";

import { HeadingSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { AmcSubmissionsPage } from "@/components/dashboard/extensions/amc/amc-submissions-page";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
const title = "AMC proposals | Extensions";
const description =
  "Every AMC proposal and contract: drafts, those waiting for approval, and where each stands with the client.";

export const metadata: Metadata = {
  title,
  description,
  robots: { index: false, follow: false },
  alternates: { canonical: `${baseUrl}/extensions/amc` },
  openGraph: { title, description, url: `${baseUrl}/extensions/amc` },
  twitter: { card: "summary", title, description },
};

export default function AmcProposalsRoute() {
  // The filters live in the query string (?status=, ?scope=), which needs
  // Suspense under the App Router.
  return (
    <Suspense fallback={<HeadingSkeleton withActions />}>
      <AmcSubmissionsPage />
    </Suspense>
  );
}
