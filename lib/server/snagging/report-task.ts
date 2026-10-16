import type { SupabaseClient } from "@supabase/supabase-js";

import { approvedOnly } from "@/lib/snagging/report-approved";
import type { SnaggingTask } from "@/types/types";

import {
  loadJobChecklist,
  loadJobCore,
  loadJobFloorPlans,
  loadJobSnags,
  loadJobVisitStatus,
} from "./job-detail-sections";

/**
 * The job as the report page renders it, for the client's report link.
 *
 * The same sections the portal's report page loads (the job, its snags with
 * photos signed, the checklist, the floor plans and which visits are still
 * unapproved), merged the way the browser merges them, then cut to what the
 * client may see: nothing from a visit the manager has not approved. So the
 * client's page is the report page's own component on the same data.
 */
export async function loadReportTask(admin: SupabaseClient, jobId: string): Promise<SnaggingTask | null> {
  const [core, checklist, snags, floorPlans, visitStatus] = await Promise.all([
    loadJobCore(admin, jobId),
    loadJobChecklist(admin, jobId),
    loadJobSnags(admin, jobId),
    loadJobFloorPlans(admin, jobId),
    loadJobVisitStatus(admin, jobId),
  ]);
  if (!core) return null;
  const task = {
    ...(core as unknown as SnaggingTask),
    checklist: checklist as unknown as SnaggingTask["checklist"],
    snags: snags as unknown as SnaggingTask["snags"],
    floor_plans: floorPlans as unknown as SnaggingTask["floor_plans"],
    unapproved_visit_ids: (visitStatus as { unapproved_visit_ids?: string[] } | null)?.unapproved_visit_ids ?? [],
  } as SnaggingTask;
  return approvedOnly(task);
}
