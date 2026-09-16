/**
 * One row per defect, out of a family's many copies of it.
 *
 * A defect is captured once but stored many times: the original inspection
 * holds it, and every de-snag round that re-checks it gets its own working
 * copy carrying the same `snag_code`. Anything counting defects across a
 * family therefore has to collapse those copies, or a unit with three
 * defects and two rounds reports nine.
 *
 * The rule is "prefer the copy that is the lasting record":
 *
 *   - a row on the original (or on an additional visit, whose snags ARE the
 *     original's) wins, because that is what a verdict writes through to;
 *   - failing that — a defect first raised DURING a round, which has no row
 *     on the original at all — the earliest round holding it wins, because
 *     that is the row that carries the capture evidence and the one later
 *     rounds were copied from.
 *
 * Without the second case such a defect is dropped entirely rather than
 * deduplicated: it is absent from the original, so a reader looking only
 * there never learns it exists.
 */

export type FamilyDefectRow = {
  job_id: string;
  snag_code: string;
};

export function dedupeDefects<T extends FamilyDefectRow>(
  rows: T[],
  options: {
    /** Jobs whose rows are the lasting record: the root and its visits. */
    preferredJobIds: Iterable<string>;
    /** Round number per job, used to break ties between round copies. */
    roundOf: Map<string, number>;
  },
): T[] {
  const preferred = new Set(options.preferredJobIds);
  const best = new Map<string, T>();

  for (const row of rows) {
    const current = best.get(row.snag_code);
    if (!current) {
      best.set(row.snag_code, row);
      continue;
    }

    const rowPreferred = preferred.has(row.job_id);
    const currentPreferred = preferred.has(current.job_id);
    if (rowPreferred && !currentPreferred) {
      best.set(row.snag_code, row);
      continue;
    }
    if (rowPreferred !== currentPreferred) continue;

    // Both sides are the same kind, so fall back to the earlier round.
    // Ties are settled by id purely so the result is reproducible: a
    // report that reshuffles between renders is not a report.
    const mine = options.roundOf.get(row.job_id) ?? Number.MAX_SAFE_INTEGER;
    const theirs = options.roundOf.get(current.job_id) ?? Number.MAX_SAFE_INTEGER;
    if (mine < theirs || (mine === theirs && row.job_id < current.job_id)) {
      best.set(row.snag_code, row);
    }
  }

  return [...best.values()];
}
