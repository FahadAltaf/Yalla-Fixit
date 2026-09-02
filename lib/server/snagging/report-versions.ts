import type { SupabaseClient } from "@supabase/supabase-js";

import { loadJobFamily } from "./job-family";

/**
 * The client's report, and its history.
 *
 * BRD Module 9: an additional visit does NOT produce a report of its own.
 * Its snags join the original inspection's report, which is reissued as a
 * new version — so the client holds one document that grows, not a stack
 * of separate ones they have to reconcile.
 *
 * Earlier versions are kept because they were actually sent. A client may
 * be holding a printout of V1 while V2 is being prepared, and "which
 * snags were in the version you received" has to have an answer.
 */
export type ReportVersion = {
  id: string;
  version: number;
  source_visit_id: string | null;
  snag_count: number;
  generated_at: string;
  reason: string | null;
};

/** Whether the versions table has been migrated in yet. */
async function versioningAvailable(admin: SupabaseClient): Promise<boolean> {
  const { error } = await admin.from("snagging_report_versions").select("id").limit(1);
  // PostgREST reports an unknown relation rather than throwing; treating
  // that as "not yet migrated" keeps every caller working on an
  // environment where the migration has not been applied.
  return !error;
}

export async function listReportVersions(
  admin: SupabaseClient,
  jobId: string,
): Promise<ReportVersion[]> {
  if (!(await versioningAvailable(admin))) return [];

  const { data, error } = await admin
    .from("snagging_report_versions")
    .select("id, version, source_visit_id, snag_count, generated_at, reason")
    .eq("job_id", jobId)
    .order("version", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ReportVersion[];
}

/**
 * Issues the next version of an inspection's report.
 *
 * Reads the family's snags at this moment and records exactly which ones
 * the version contained, so a superseded version stays explainable after
 * the live rows have moved on.
 *
 * Idempotent per visit: reissuing for a visit that already has a version
 * returns that version rather than minting a duplicate, because delivery
 * can be retried and a retry is not a new issue of the document.
 */
export async function issueReportVersion(
  admin: SupabaseClient,
  input: {
    jobId: string;
    sourceVisitId?: string | null;
    generatedBy?: string | null;
    reason?: string | null;
  },
): Promise<{ version: number; snagCount: number; created: boolean } | null> {
  if (!(await versioningAvailable(admin))) return null;

  const family = await loadJobFamily(admin, input.jobId);
  const rootId = family.rootId;

  if (input.sourceVisitId) {
    const { data: already } = await admin
      .from("snagging_report_versions")
      .select("version, snag_count")
      .eq("job_id", rootId)
      .eq("source_visit_id", input.sourceVisitId)
      .maybeSingle();
    if (already) {
      return {
        version: already.version as number,
        snagCount: already.snag_count as number,
        created: false,
      };
    }
  }

  /*
    What the client's report contains: the original inspection's snags
    plus everything found on its additional visits. De-snag rounds are
    excluded — their rows are working copies whose verdicts write through
    to the originals, so counting them would double every carried defect.
  */
  const reportJobIds = [rootId, ...family.additionalVisitIds];
  const { data: snags, error: snagError } = await admin
    .from("snagging_snags")
    .select("id")
    .in("job_id", reportJobIds)
    .neq("status", "withdrawn");
  if (snagError) throw new Error(snagError.message);

  const snagIds = (snags ?? []).map((s) => s.id as string);

  const { data: latest } = await admin
    .from("snagging_report_versions")
    .select("version")
    .eq("job_id", rootId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = ((latest?.version as number | undefined) ?? 0) + 1;

  const { error: insertError } = await admin.from("snagging_report_versions").insert({
    job_id: rootId,
    version: nextVersion,
    source_visit_id: input.sourceVisitId ?? null,
    snag_count: snagIds.length,
    snag_ids: snagIds,
    generated_by: input.generatedBy ?? null,
    reason: input.reason ?? null,
  });
  if (insertError) throw new Error(insertError.message);

  return { version: nextVersion, snagCount: snagIds.length, created: true };
}
