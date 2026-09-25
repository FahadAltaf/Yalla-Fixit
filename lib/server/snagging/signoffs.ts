import type { SupabaseClient } from "@supabase/supabase-js";

import { hasTable } from "@/lib/server/snagging/columns";
import { loadJobRosters, loadVisitRosters } from "@/lib/server/snagging/job-roster";

/**
 * Every inspector on a job signs it off before it is submitted.
 *
 * A job can be walked by two or more inspectors, each owning their own
 * rooms and findings, and it went to the office on one signature: the
 * submitter's. Each inspector now signs for their part from their own
 * phone (snagging_job_signoffs, one row per inspector per pass), and the
 * submission is refused until everyone on the pass has.
 *
 * A "pass" is the job itself, or a return visit on it (visit_id). A pass
 * with one inspector works as it always has: their signature arrives with
 * the submission and is recorded as their sign-off.
 */

type Admin = SupabaseClient;

export type Signer = { id: string; name: string; signed_at: string | null };

const TABLE = "snagging_job_signoffs";

/** Whether this database has sign-offs yet (the migration may not have run). */
export function hasSignoffs(admin: Admin): Promise<boolean> {
  return hasTable(admin, TABLE);
}

/**
 * Who must sign this pass, in the order they are listed on the job (the
 * lead first), each with when they signed or null. A visit with its own
 * crew is signed by that crew; otherwise by the job's inspectors.
 */
export async function loadSigners(
  admin: Admin,
  jobId: string,
  visitId: string | null,
): Promise<Signer[]> {
  const [jobRosters, visitRosters] = await Promise.all([
    loadJobRosters(admin, [jobId]),
    visitId ? loadVisitRosters(admin, [visitId]) : Promise.resolve(new Map<string, string[]>()),
  ]);
  const crew = visitId ? (visitRosters.get(visitId) ?? []) : [];
  const ids = crew.length > 0 ? crew : [...(jobRosters.get(jobId) ?? new Set<string>())];
  if (ids.length === 0) return [];

  const [people, signed] = await Promise.all([
    admin.from("user_profile").select("id, full_name, email").in("id", ids),
    (async () => {
      if (!(await hasSignoffs(admin))) return [] as Array<{ inspector_id: string; signed_at: string }>;
      let query = admin.from(TABLE).select("inspector_id, signed_at").eq("job_id", jobId);
      query = visitId ? query.eq("visit_id", visitId) : query.is("visit_id", null);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<{ inspector_id: string; signed_at: string }>;
    })(),
  ]);
  if (people.error) throw new Error(people.error.message);

  const nameById = new Map(
    (people.data ?? []).map((p) => [
      p.id as string,
      ((p.full_name as string | null) || (p.email as string | null) || "Inspector") as string,
    ]),
  );
  const signedAt = new Map(signed.map((s) => [s.inspector_id, s.signed_at]));
  return ids.map((id) => ({
    id,
    name: nameById.get(id) ?? "Inspector",
    signed_at: signedAt.get(id) ?? null,
  }));
}

/**
 * Records one inspector's sign-off on a pass, replacing any earlier one of
 * theirs (a retried or repeated signature).
 */
export async function recordSignoff(
  admin: Admin,
  input: {
    jobId: string;
    visitId: string | null;
    inspectorId: string;
    signerName: string | null;
    signaturePath: string | null;
    signedAt: string;
  },
): Promise<void> {
  if (!(await hasSignoffs(admin))) return;
  let clear = admin.from(TABLE).delete().eq("job_id", input.jobId).eq("inspector_id", input.inspectorId);
  clear = input.visitId ? clear.eq("visit_id", input.visitId) : clear.is("visit_id", null);
  const { error: clearError } = await clear;
  if (clearError) throw new Error(clearError.message);

  const { error } = await admin.from(TABLE).insert({
    job_id: input.jobId,
    visit_id: input.visitId,
    inspector_id: input.inspectorId,
    signer_name: input.signerName,
    signature_path: input.signaturePath,
    signed_at: input.signedAt,
  });
  if (error) throw new Error(error.message);
}

/**
 * Refuses a submission while anyone on the pass has not signed. The
 * submitter counts as signed when their signature came with it.
 */
export async function assertEveryoneSigned(
  admin: Admin,
  jobId: string,
  visitId: string | null,
  submitterId: string,
  submitterSigned: boolean,
): Promise<void> {
  if (!(await hasSignoffs(admin))) return;
  const signers = await loadSigners(admin, jobId, visitId);
  const waiting = signers.filter(
    (s) => !s.signed_at && !(submitterSigned && s.id === submitterId),
  );
  if (waiting.length > 0) {
    throw new Error(
      `${SIGNATURES_WAITING} ${waiting.map((s) => s.name).join(", ")}`,
    );
  }
}

/** The start of the refusal above; the phone recognises it. */
export const SIGNATURES_WAITING = "Waiting for signatures from";
