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
  /** De-snag rounds only. A defect can be BORN on one of these. */
  desnagRoundIds: string[];
  /** Round number per job in the family, for ordering copies of one defect. */
  roundOf: Map<string, number>;
};

/*
  Lookups already on their way, by job id.

  The job page asks for its sections in parallel, and five of those
  routes each needed this same family at the same moment -- five copies of
  the same two queries. A request that arrives while one is in flight now
  waits on that one. Nothing is kept once it settles, so a round or visit
  created a moment later is always seen.
*/
const inFlight = new Map<string, Promise<JobFamily>>();

export function loadJobFamily(admin: SupabaseClient, jobId: string): Promise<JobFamily> {
  const pending = inFlight.get(jobId);
  if (pending) return pending;
  const work = fetchJobFamily(admin, jobId).finally(() => inFlight.delete(jobId));
  inFlight.set(jobId, work);
  return work;
}

/**
 * Runs `read` against the family's root without waiting for the family
 * first.
 *
 * Most jobs ARE their own root, so the read starts at once on the job's id
 * alongside the family lookup, and is only repeated on the real root when
 * the job turns out to be a round or a visit. The common case costs one
 * round trip instead of two in a row.
 */
export async function readOnRoot<T>(
  admin: SupabaseClient,
  jobId: string,
  read: (rootId: string) => Promise<T>,
): Promise<{ family: JobFamily; result: T }> {
  const [family, guess] = await Promise.all([loadJobFamily(admin, jobId), read(jobId)]);
  return { family, result: family.rootId === jobId ? guess : await read(family.rootId) };
}

type FamilyRow = {
  id: string;
  parent_job_id: string | null;
  visit_type: string | null;
  round_number: number | null;
};

type SelfRow = FamilyRow & {
  children: FamilyRow[] | null;
  parent: { id: string; children: FamilyRow[] | null } | null;
};

const MEMBER = "id, parent_job_id, visit_type, round_number";

async function fetchJobFamily(admin: SupabaseClient, jobId: string): Promise<JobFamily> {
  /*
    One round trip whatever is being viewed: the job, what was opened
    against it, and -- for a round or a visit -- its parent and the
    parent's other children. This was two queries in a row, and the
    second one waited on the answer to the first.
  */
  const { data: self, error: selfError } = await admin
    .from("snagging_jobs")
    .select<string, SelfRow>(
      `${MEMBER}, children:snagging_jobs!parent_job_id(${MEMBER}),
       parent:parent_job_id(id, children:snagging_jobs!parent_job_id(${MEMBER}))`,
    )
    .eq("id", jobId)
    .maybeSingle();
  if (selfError) throw new Error(selfError.message);

  // Viewing a round or a visit still means the family of its parent.
  const rootId = self?.parent_job_id ?? jobId;
  const children: FamilyRow[] =
    (rootId === jobId ? self?.children : self?.parent?.children) ?? [];

  const rows = children;
  const roundOf = new Map<string, number>([[rootId, 1]]);
  // The root's own number when we are looking at it; a child viewed
  // directly does not tell us the root's, which is 1 by definition anyway.
  if (self?.id === rootId) roundOf.set(rootId, (self.round_number as number | null) ?? 1);
  for (const row of rows) {
    roundOf.set(row.id as string, (row.round_number as number | null) ?? 1);
  }

  return {
    rootId,
    allIds: [rootId, ...rows.map((row) => row.id as string)],
    additionalVisitIds: rows
      .filter((row) => row.visit_type === "additional")
      .map((row) => row.id as string),
    desnagRoundIds: rows
      .filter((row) => row.visit_type === "desnag")
      .map((row) => row.id as string),
    roundOf,
  };
}
