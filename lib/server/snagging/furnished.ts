import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Whether each job's unit was quoted furnished (UAT SNG-100).
 *
 * The client declares it on the quotation (FR-2.15), not on the unit, so it
 * is read from the inspection quotation the job was raised from. A de-snag
 * round or an additional visit has no quotation of that kind of its own, so
 * it takes its parent job's. Null when no quotation says either way.
 *
 * The inspector sees it on the job in the app, so they know before walking
 * in whether to expect furniture.
 */
export async function furnishedByJob(
  admin: SupabaseClient,
  jobs: { id: string; parent_job_id?: string | null }[],
): Promise<Map<string, boolean | null>> {
  const result = new Map<string, boolean | null>();
  if (jobs.length === 0) return result;
  const ids = [
    ...new Set(jobs.flatMap((job) => [job.id, job.parent_job_id ?? null]).filter(Boolean)),
  ] as string[];

  const byJob = new Map<string, boolean>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin
      .from("snagging_quotations")
      .select("job_id, furnished, created_at")
      .in("job_id", ids.slice(i, i + 200))
      .eq("quote_kind", "inspection")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const jobId = row.job_id as string;
      // Newest first: the first one seen is the quotation that stands.
      if (!byJob.has(jobId)) byJob.set(jobId, Boolean(row.furnished));
    }
  }

  for (const job of jobs) {
    result.set(
      job.id,
      byJob.get(job.id) ?? (job.parent_job_id ? byJob.get(job.parent_job_id) : undefined) ?? null,
    );
  }
  return result;
}
