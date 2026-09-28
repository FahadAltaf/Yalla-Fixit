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

/**
 * One inspector's own sign-off on a pass, when they gave it ahead of the
 * submission ("Sign off my part").
 *
 * The client's report carries one signature: the one on the job. An
 * inspector who signed early and then submits sends no second drawing,
 * which used to leave the job -- and so the report -- with no signature
 * at all. The submission takes this one instead.
 */
export async function loadOwnSignoff(
  admin: Admin,
  jobId: string,
  visitId: string | null,
  inspectorId: string,
): Promise<{ signature_path: string | null; signer_name: string | null; signed_at: string } | null> {
  if (!(await hasSignoffs(admin))) return null;
  let query = admin
    .from(TABLE)
    .select("signature_path, signer_name, signed_at")
    .eq("job_id", jobId)
    .eq("inspector_id", inspectorId);
  query = visitId ? query.eq("visit_id", visitId) : query.is("visit_id", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { signature_path: string | null; signer_name: string | null; signed_at: string } | null) ?? null;
}

/**
 * The one signature a report shows when the job itself carries none.
 *
 * With two or more inspectors the client is shown one signature. It is
 * the job's own (the submitter's); a job submitted before that was kept --
 * the submitter had signed their part earlier and the submission cleared
 * it -- has none, so the report takes one inspector's sign-off from the
 * job's own pass: `preferInspectorId`'s when they signed (the name the
 * report prints beside it), otherwise the first to sign.
 */
export async function loadReportSignoff(
  admin: Admin,
  jobId: string,
  preferInspectorId: string | null,
): Promise<{ inspector_id: string; signer_name: string | null; signed_at: string; signature_path: string } | null> {
  if (!(await hasSignoffs(admin))) return null;
  const { data, error } = await admin
    .from(TABLE)
    .select("inspector_id, signer_name, signed_at, signature_path")
    .eq("job_id", jobId)
    .is("visit_id", null)
    .not("signature_path", "is", null)
    .order("signed_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{
    inspector_id: string;
    signer_name: string | null;
    signed_at: string;
    signature_path: string;
  }>;
  return rows.find((row) => row.inspector_id === preferInspectorId) ?? rows[0] ?? null;
}

/** One inspector's sign-off, for the portal's internal record. */
export type SignoffRecord = {
  id: string;
  visit_id: string | null;
  inspector_id: string;
  inspector_name: string;
  signer_name: string | null;
  signed_at: string;
  /** Short-lived link to the drawn signature, or null if none was drawn. */
  signature_url: string | null;
};

/**
 * Every inspector's signature on a job, its own pass and its visits.
 *
 * The client is shown one signature, on the report. The office keeps all
 * of them: this is what the job page shows its staff. Never sent to the
 * client -- only the portal's staff-only job sections read it.
 */
export async function loadSignoffRecords(
  admin: Admin,
  jobId: string,
  sign: (paths: string[]) => Promise<Map<string, string>>,
): Promise<SignoffRecord[]> {
  if (!(await hasSignoffs(admin))) return [];
  const { data, error } = await admin
    .from(TABLE)
    .select("id, visit_id, inspector_id, signer_name, signature_path, signed_at")
    .eq("job_id", jobId)
    .order("signed_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{
    id: string;
    visit_id: string | null;
    inspector_id: string;
    signer_name: string | null;
    signature_path: string | null;
    signed_at: string;
  }>;
  if (!rows.length) return [];

  const ids = [...new Set(rows.map((row) => row.inspector_id))];
  const paths = rows.map((row) => row.signature_path).filter((p): p is string => Boolean(p));
  const [people, urls] = await Promise.all([
    admin.from("user_profile").select("id, full_name, email").in("id", ids),
    paths.length ? sign(paths) : Promise.resolve(new Map<string, string>()),
  ]);
  if (people.error) throw new Error(people.error.message);
  const nameById = new Map(
    (people.data ?? []).map((p) => [
      p.id as string,
      ((p.full_name as string | null) || (p.email as string | null) || "Inspector") as string,
    ]),
  );
  return rows.map((row) => ({
    id: row.id,
    visit_id: row.visit_id,
    inspector_id: row.inspector_id,
    inspector_name: nameById.get(row.inspector_id) ?? row.signer_name ?? "Inspector",
    signer_name: row.signer_name,
    signed_at: row.signed_at,
    signature_url: row.signature_path ? (urls.get(row.signature_path) ?? null) : null,
  }));
}
