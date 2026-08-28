import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * An inspection and everything opened against it.
 *
 * A de-snag round and an additional visit are both their own
 * `snagging_jobs` row pointing back at a parent, which keeps scheduling
 * and pricing clean but scatters the record across several ids. Two
 * requirements need it gathered back up:
 *
 *   FR-9.03 — snags found on an additional visit belong to the original
 *   inspection record, not to a separate report of their own.
 *
 *   FR-8.05 — the status history shown to reviewers, managers and
 *   operations has to be the whole chain, not just the leg being viewed.
 */

export type JobFamily = {
  /** The original inspection every other row hangs off. */
  rootId: string;
  /** Root plus every round and visit opened against it. */
  allIds: string[];
  /** Additional visits only — the ones whose snags merge into the root. */
  additionalVisitIds: string[];
};

export async function loadJobFamily(
  admin: SupabaseClient,
  jobId: string,
): Promise<JobFamily> {
  const { data: self, error: selfError } = await admin
    .from("snagging_jobs")
    .select("id, parent_job_id")
    .eq("id", jobId)
    .maybeSingle();
  if (selfError) throw new Error(selfError.message);

  // Viewing a round or a visit still means the family of its parent.
  const rootId = (self?.parent_job_id as string | null) ?? jobId;

  const { data: children, error: childError } = await admin
    .from("snagging_jobs")
    .select("id, visit_type")
    .eq("parent_job_id", rootId);
  if (childError) throw new Error(childError.message);

  const rows = children ?? [];
  return {
    rootId,
    allIds: [rootId, ...rows.map((row) => row.id as string)],
    additionalVisitIds: rows
      .filter((row) => row.visit_type === "additional")
      .map((row) => row.id as string),
  };
}
