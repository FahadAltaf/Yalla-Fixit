import type { Metadata } from "next";

import InspectionDetail from "@/components/dashboard/snagging/inspection-detail";
import type { JobDetailInitial } from "@/components/dashboard/snagging/job-detail-context";
import {
  loadJobChecklist,
  loadJobCore,
  loadJobFloorPlans,
  loadJobSnags,
  loadJobVisitStatus,
} from "@/lib/server/snagging/job-detail-sections";
import { canSeeSnaggingPage } from "@/lib/server/snagging/page-access";
import { NoPageAccess } from "@/components/dashboard/snagging/no-page-access";
import { ResourceType } from "@/types/types";
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
 * What the first screen needs, read here on the server.
 *
 * The page used to load in the browser first and only then ask for its
 * seven sections, so nothing could show until after that extra round trip.
 * Reading them here fixed that and left a smaller version of the same
 * problem: `await` on all seven holds the first byte for the SLOWEST of
 * them, and two of the seven are for things the landing tab never shows.
 *
 * So the de-snag quotation and the visit list are left out, and the page
 * fetches each itself after paint. Both were on the critical path for a
 * badge and a button. What stays is what the Snags tab and the header
 * render, which is also the cheap end of the seven.
 *
 * Only for someone signed in with Snagging access; anyone else gets the
 * page's own requests, which the API answers as before. A section that
 * fails here is simply left out, and the page fetches that one itself.
 */
async function readSections(id: string): Promise<JobDetailInitial | undefined> {
  if (!UUID.test(id)) return undefined;
  try {
    if (!(await canSeeSnaggingPage(ResourceType.SNAGGING_JOBS))) return undefined;
    const admin = await createAdminServerClient();
    // A failed section becomes `undefined`, which the page fetches itself.
    const settle = <T,>(work: Promise<T>) =>
      work.catch((error) => {
        console.error("Job section (server) failed; the page will fetch it:", error);
        return undefined;
      });

    /*
      Five, not seven. Each of these is on the first screen:

      `checklist` for the Snags tab's summary line and the tab's count.
      `visitStatus` because the header counts an area as walked unless the
      visit that added it is still with the manager -- an empty set reads
      every such area as walked, so the coverage figure would show too high
      and then correct itself. `floorPlans` for the pin beside each row;
      it signs its URLs in one batched call that is usually already cached,
      so it is not the expense it looks like.
    */
    const [job, checklist, snags, visitStatus, floorPlans] = await Promise.all([
      settle(loadJobCore(admin, id)),
      settle(loadJobChecklist(admin, id)),
      settle(loadJobSnags(admin, id)),
      settle(loadJobVisitStatus(admin, id)),
      settle(loadJobFloorPlans(admin, id)),
    ]);

    // No such job: the page shows its own "not found" from its request.
    if (!job) return undefined;

    /*
      The rows these loaders return are exactly what the section routes
      send as JSON, which the page already reads in these shapes.

      The de-snag quotation and the visit list are absent on purpose: the
      context treats a missing key as "fetch it yourself", so the browser
      requests each one after paint. The header hides the de-snag button
      until its own fetch lands, and the visits badge appears with it.
    */
    return {
      job,
      checklist,
      snags,
      visitStatus,
      floorPlans,
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
  /* The permission decides the page, not just the sidebar entry. */
  if (!(await canSeeSnaggingPage(ResourceType.SNAGGING_JOBS))) return <NoPageAccess page="Jobs" />;

  const { id } = await params;
  const initial = await readSections(id);
  return <InspectionDetail taskId={id} initial={initial} />;
}
