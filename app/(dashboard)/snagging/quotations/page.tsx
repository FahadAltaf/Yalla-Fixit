import type { Metadata } from "next";
import { Suspense } from "react";

import QuotationsAdmin from "@/components/dashboard/snagging/quotations-admin";
import { canViewSnagging } from "@/lib/server/snagging/page-access";
import { listQuotations } from "@/lib/server/snagging/quotation-list";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import type { SnaggingQuotationSummary } from "@/modules/snagging";
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

/**
 * The first page of quotations, read here on the server so it arrives with
 * the page instead of being asked for after the page has loaded. Same
 * query as the API (listQuotations); the status comes from ?status=, as
 * the table reads it. Anyone without Snagging access, or a failed read,
 * gets no data here and the table asks for it itself.
 */
async function firstPage(address: Record<string, string | string[] | undefined>) {
  try {
    if (!(await canViewSnagging())) return null;
    const status = Array.isArray(address.status) ? address.status[0] : address.status;
    const params = new URLSearchParams({ page: "0", pageSize: String(QUOTATIONS_FIRST_PAGE_SIZE) });
    if (status && status !== "all") params.set("status", status);
    const admin = await createAdminServerClient();
    // The same rows the API sends, which the table reads as summaries.
    return (await listQuotations(admin, params)) as unknown as {
      data: SnaggingQuotationSummary[];
      totalCount: number;
      counts: Record<string, number>;
    };
  } catch (error) {
    console.error("Quotations first page (server) failed; the table will fetch it:", error);
    return null;
  }
}

/* The table's first page size; it opens on 10 rows. */
const QUOTATIONS_FIRST_PAGE_SIZE = 10;

export default async function SnaggingQuotationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const initial = await firstPage(await searchParams);
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
      <QuotationsAdmin initial={initial} />
    </Suspense>
  );
}
