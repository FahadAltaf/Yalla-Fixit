import type { Metadata } from "next";

import InspectionDetail from "@/components/dashboard/snagging/inspection-detail";
import type { JobDetailInitial } from "@/components/dashboard/snagging/job-detail-context";
import {
  loadJobChecklist,
  loadJobCore,
  loadJobDesnagQuotation,
  loadJobFloorPlans,
  loadJobSnags,
  loadJobVisitStatus,
  loadJobVisits,
} from "@/lib/server/snagging/job-detail-sections";
import { canViewSnagging } from "@/lib/server/snagging/page-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

/**
 * The title carries the inspection id rather than a generic label so a
 * manager with several review tabs open can tell them apart.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const title = `Inspection ${id.slice(0, 8)} | Property Care Snagging`;
  const description =
    "Review captured defects, photo evidence, and area coverage before approving the client report.";

  return {
    title,
    description,
    robots: { index: false, follow: false },
    alternates: { canonical: `${baseUrl}/snagging/${id}` },
    openGraph: { title, description, url: `${baseUrl}/snagging/${id}` },
    twitter: { card: "summary", title, description },
  };
}

/*
  Only a real job id is read here; anything else is left to the page,
  which shows its own "not found".
*/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every section of the job, read here on the server, all at once.
 *
 * The page used to load in the browser first and only then ask for its
 * seven sections -- the job, checklist, snags, plans, visit status, de-snag
 * quotation and visits -- so nothing could show until after that extra
 * round trip. They now arrive with the page. Each section is read by the
 * same function its API route uses, so what the server sends is exactly
 * what a refresh would fetch.
 *
 * Only for someone signed in with Snagging access; anyone else gets the
 * page's own requests, which the API answers as before. A section that
 * fails here is simply left out, and the page fetches that one itself.
 */
async function readSections(id: string): Promise<JobDetailInitial | undefined> {
  if (!UUID.test(id)) return undefined;
  try {
    if (!(await canViewSnagging())) return undefined;
    const admin = await createAdminServerClient();
    // A failed section becomes `undefined`, which the page fetches itself.
    const settle = <T,>(work: Promise<T>) =>
      work.catch((error) => {
        console.error("Job section (server) failed; the page will fetch it:", error);
        return undefined;
      });

    const [job, checklist, snags, floorPlans, visitStatus, desnag, visits] = await Promise.all([
      settle(loadJobCore(admin, id)),
      settle(loadJobChecklist(admin, id)),
      settle(loadJobSnags(admin, id)),
      settle(loadJobFloorPlans(admin, id)),
      settle(loadJobVisitStatus(admin, id)),
      settle(loadJobDesnagQuotation(admin, id)),
      settle(loadJobVisits(admin, id)),
    ]);

    // No such job: the page shows its own "not found" from its request.
    if (!job) return undefined;

    /*
      The rows these loaders return are exactly what the section routes
      send as JSON, which the page already reads in these shapes.
    */
    return {
      job,
      checklist,
      snags,
      floorPlans,
      visitStatus,
      desnag,
      visits,
    } as unknown as JobDetailInitial;
  } catch (error) {
    console.error("Job sections (server) failed; the page will fetch them:", error);
    return undefined;
  }
}

export default async function SnaggingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const initial = await readSections(id);
  return <InspectionDetail taskId={id} initial={initial} />;
}
