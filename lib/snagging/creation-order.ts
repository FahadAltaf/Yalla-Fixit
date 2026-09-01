/**
 * Creation order for lists whose rows are written in one batch.
 *
 * Areas and checklist items are inserted in a single transaction when a
 * job is set up, so they can share a created_at to the microsecond.
 * Ordering on that column alone would leave them in whatever order the
 * database happened to return — arbitrary, and different between two
 * reads of the same job.
 *
 * So creation leads and the defined sequence breaks the tie: rows created
 * at distinguishable moments (a de-snag round inserts them one by one) sort
 * chronologically, and rows from one batch keep a stable, sensible order
 * instead of shuffling. Both halves are needed; neither is sufficient.
 */
type Orderable = {
  created_at?: string | null;
  sort_order?: number | null;
};

export function byCreation<T extends Orderable>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    // A row with no timestamp sorts last rather than first: an unstamped
    // row is one this code has not seen a creation time for, and guessing
    // it is the oldest would put it above rows that genuinely are.
    const at = a.created_at ? Date.parse(a.created_at) : Number.POSITIVE_INFINITY;
    const bt = b.created_at ? Date.parse(b.created_at) : Number.POSITIVE_INFINITY;
    if (at !== bt) return at - bt;
    return (a.sort_order ?? 0) - (b.sort_order ?? 0);
  });
}
