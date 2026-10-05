import type { SupabaseClient } from "@supabase/supabase-js";

import { isDesignatedApprovalManager } from "@/lib/server/snagging/workflow";

/**
 * The approval manager gate, for routes that do not already hold the job.
 *
 * FR-6.01 reserves every act that puts a signature on a client's report --
 * approving, sending back, delivering, and reissuing or revoking what was
 * delivered -- for the one person named as the job's approval manager.
 * The decision routes read the job for other reasons and check it inline;
 * these ones would otherwise have no reason to read it at all, so the read
 * lives here rather than being copied into each of them.
 *
 * Returns null when the caller may act, or the message to refuse them with.
 */
export async function refuseUnlessApprovalManager(
  admin: SupabaseClient,
  jobId: string,
  actorId: string,
  act: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("snagging_jobs")
    .select("approval_manager_id")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return "Inspection not found.";

  const managerId = (data as { approval_manager_id: string | null }).approval_manager_id;
  if (isDesignatedApprovalManager(actorId, managerId)) return null;

  return managerId
    ? `Only the approval manager named on this inspection can ${act}.`
    : `This inspection has no approval manager, so nobody can ${act} yet. Name one on its Setup tab.`;
}
