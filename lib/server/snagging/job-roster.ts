import type { SupabaseClient } from "@supabase/supabase-js";

import { hasAreaInspector, hasJobInspectors } from "@/lib/server/snagging/columns";
import { readAllRows } from "@/lib/server/snagging/read-all";

/**
 * Who is on a job: every inspector in snagging_job_inspectors, plus the
 * job's own inspector_id (the first of them, kept for submission and the
 * report cover). A database without the roster table falls back to
 * inspector_id alone.
 *
 * Used by the sync to decide which jobs reach an inspector's phone, who may
 * open and write to one, and whose snags are a co-inspector's to hide.
 */
export async function loadJobRosters(
  admin: SupabaseClient,
  jobIds: string[],
): Promise<Map<string, Set<string>>> {
  const rosters = new Map<string, Set<string>>();
  if (jobIds.length === 0) return rosters;
  const add = (jobId: string, inspectorId: string | null | undefined) => {
    if (!inspectorId) return;
    const set = rosters.get(jobId) ?? new Set<string>();
    set.add(inspectorId);
    rosters.set(jobId, set);
  };

  const [leads, roster] = await Promise.all([
    readAllRows<{ id: string; inspector_id: string | null }>(
      (from, to) =>
        admin
          .from("snagging_jobs")
          .select("id, inspector_id")
          .in("id", jobIds)
          .order("id", { ascending: true })
          .range(from, to),
      "job leads",
    ),
    (async () =>
      (await hasJobInspectors(admin))
        ? readAllRows<{ job_id: string; inspector_id: string }>(
            (from, to) =>
              admin
                .from("snagging_job_inspectors")
                .select("job_id, inspector_id")
                .in("job_id", jobIds)
                .order("job_id", { ascending: true })
                .order("inspector_id", { ascending: true })
                .range(from, to),
            "job rosters",
          )
        : [])(),
  ]);
  for (const job of leads) add(job.id, job.inspector_id);
  for (const row of roster) add(row.job_id, row.inspector_id);
  return rosters;
}

/** Whether this person is one of the job's inspectors. */
export async function isOnJobRoster(
  admin: SupabaseClient,
  jobId: string,
  userId: string,
): Promise<boolean> {
  const rosters = await loadJobRosters(admin, [jobId]);
  return rosters.get(jobId)?.has(userId) ?? false;
}

/**
 * Whether this person may write to a job from the app: one of its
 * inspectors (the roster), the inspector booked on its live visit, or one
 * holding a room on it. The same people the push accepts changes from.
 */
export async function mayWriteJob(
  admin: SupabaseClient,
  jobId: string,
  userId: string,
): Promise<boolean> {
  const [onRoster, visit, room] = await Promise.all([
    isOnJobRoster(admin, jobId, userId),
    admin
      .from("snagging_job_visits")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jobId)
      .eq("inspector_id", userId)
      .in("status", ["scheduled", "in_progress"]),
    (async () =>
      (await hasAreaInspector(admin))
        ? admin
            .from("snagging_areas")
            .select("id", { count: "exact", head: true })
            .eq("job_id", jobId)
            .eq("inspector_id", userId)
        : { count: 0 })(),
  ]);
  return onRoster || (visit.count ?? 0) > 0 || (room.count ?? 0) > 0;
}
