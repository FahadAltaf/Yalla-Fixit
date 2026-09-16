/**
 * The order a batch of pushed mutations may safely be applied in.
 *
 * The route applied them one after another, which is correct but slow in
 * a way that scales badly: every mutation costs a round trip or three to
 * the database, and a full outbox is a hundred of them. At the measured
 * ~220ms per round trip that is twenty seconds to a minute for one push,
 * and it gets worse the longer an inspector has been offline — exactly
 * when they most need the sync to finish.
 *
 * Most of those mutations are independent. What is NOT independent:
 *
 *   - a photo or a verdict needs its snag to exist first
 *   - a submission reads every snag and check on the job, so it must be
 *     last and must see the finished state
 *   - two mutations against the SAME row must keep their order, or a
 *     create-then-update collapses into whichever lands second
 *
 * So mutations run in waves. Within a wave every row is independent and
 * runs concurrently; between waves the dependency is respected; and
 * mutations touching one row stay in their original sequence inside a
 * single task.
 */

/** Entity kinds, in the order their waves must run. */
const WAVES: string[][] = [
  // Nothing here depends on a snag existing.
  ["task", "area", "checklist"],
  // Snags must exist before their evidence.
  ["snag"],
  // Evidence and verdicts, which reference a snag.
  ["photo", "verification"],
  // Reads the whole job, so it goes last and alone.
  ["submission"],
];

export type PlannableMutation = {
  mutation_id: string;
  entity: string;
  entity_id: string;
};

/**
 * Groups a batch into waves of independent chains.
 *
 * Returns an array of waves; each wave is an array of chains; each chain
 * is a list of mutations against one row, in their original order. A wave
 * may be run with every chain in parallel. Chains within a wave never
 * touch the same row, so they cannot race each other.
 */
export function planWaves<T extends PlannableMutation>(mutations: T[]): T[][][] {
  const waveIndexFor = (entity: string) => {
    const index = WAVES.findIndex((wave) => wave.includes(entity));
    // An entity nobody planned for is treated as its own final wave rather
    // than being quietly run early alongside things it might depend on.
    return index === -1 ? WAVES.length : index;
  };

  const byWave = new Map<number, Map<string, T[]>>();

  for (const mutation of mutations) {
    const wave = waveIndexFor(mutation.entity);
    const chains = byWave.get(wave) ?? new Map<string, T[]>();
    // Keyed by the row, so a create and its later update stay in sequence.
    const key = `${mutation.entity}:${mutation.entity_id}`;
    const chain = chains.get(key) ?? [];
    chain.push(mutation);
    chains.set(key, chain);
    byWave.set(wave, chains);
  }

  return [...byWave.keys()]
    .sort((a, b) => a - b)
    .map((wave) => [...byWave.get(wave)!.values()]);
}

/**
 * Runs tasks with a ceiling on how many are in flight.
 *
 * Without one, a hundred-mutation push would open a hundred simultaneous
 * connections and PostgREST would start refusing them — trading a slow
 * sync for a failing one. Twelve keeps the pipe full without that.
 */
export async function inParallel<T>(
  tasks: Array<() => Promise<T>>,
  limit = 12,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= tasks.length) return;
      results[index] = await tasks[index]();
    }
  });

  await Promise.all(workers);
  return results;
}
