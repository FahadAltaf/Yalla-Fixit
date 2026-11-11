import type { Metadata } from "next";
import { Suspense } from "react";

import { TablePageSkeleton } from "@/components/dashboard/snagging/route-skeletons";
import { AmcSubmissionsPage } from "@/components/dashboard/extensions/amc/amc-submissions-page";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { canSeeAmcPage } from "@/lib/server/amc/page-access";
import { ResourceType } from "@/types/types";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
const title = "Proposals | AMC";
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

export default async function AmcProposalsRoute() {
  /* The page's own permission decides the page, not just the sidebar entry (as Snagging). */
  if (!(await canSeeAmcPage(ResourceType.AMC_PROPOSALS))) return <NoPageAccess page="Proposals" />;
  // The filters live in the query string (?status=, ?scope=), which needs
  // Suspense under the App Router.
  return (
    <Suspense fallback={<TablePageSkeleton filters={1} columns={5} />}>
      <AmcSubmissionsPage />
    </Suspense>
  );
}
