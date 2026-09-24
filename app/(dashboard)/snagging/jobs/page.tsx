import type { Metadata } from "next";
import { Suspense } from "react";

import JobsTable from "@/components/dashboard/snagging/jobs-table";
import { HeadingSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { listJobs } from "@/lib/server/snagging/job-list";
import { canViewSnagging } from "@/lib/server/snagging/page-access";
import { firstJobsPageParams } from "@/lib/snagging/job-filters";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import type { SnaggingTaskSummary } from "@/types/types";

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

/**
 * The first page of jobs, read here on the server.
 *
 * The table used to ask for it only after the page had loaded in the
 * browser -- one more round trip, after everything else, before a single
 * row could show. It now arrives with the page. Only for someone signed in
 * with Snagging access; anyone else gets the table's own request, which
 * the API answers as before. A failed read here is not an error: the
 * table simply asks for the page itself.
 */
async function firstPage(address: Record<string, string | string[] | undefined>) {
  const one = (key: string) => {
    const value = address[key];
    return Array.isArray(value) ? value[0] : value;
  };
  try {
    if (!(await canViewSnagging())) return null;
    const admin = await createAdminServerClient();
    // The same rows the API sends, which the table reads as summaries.
    return (await listJobs(
      admin,
      firstJobsPageParams({
        status: one("status"),
        assignee: one("assignee"),
        createdFrom: one("createdFrom"),
        createdTo: one("createdTo"),
      }),
    )) as unknown as { data: SnaggingTaskSummary[]; totalCount: number };
  } catch (error) {
    console.error("Jobs first page (server) failed; the table will fetch it:", error);
    return null;
  }
}

export default async function SnaggingJobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const initial = await firstPage(await searchParams);

  // JobsTable reads the status filter from the query string, so it is
  // wrapped in Suspense as useSearchParams requires under the App Router.
  return (
    <Suspense
      fallback={
        // Only the heading: the table below owns its own in-body loading,
        // and a second table-shaped placeholder here would flash a
        // different skeleton before that one takes over.
        <div className="flex flex-col gap-6">
          <HeadingSkeleton />
        </div>
      }
    >
      <JobsTable initial={initial} />
    </Suspense>
  );
}
