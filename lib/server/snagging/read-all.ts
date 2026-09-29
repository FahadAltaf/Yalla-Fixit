/**
 * Every row a query matches, read a page at a time.
 *
 * The hosted API returns at most 1,000 rows per request and says nothing
 * when it stops there. The sync used single selects, so a snapshot for an
 * inspector with more than 1,000 photos (or checklist answers, or rooms)
 * came back short, and the phone -- which treats a snapshot as the whole
 * truth -- deleted the rows it had not been sent. Paging here makes a
 * snapshot complete whatever its size.
 *
 * `build` must return a fresh query each call, ordered by a unique column
 * so pages neither skip nor repeat rows.
 */

const PAGE_SIZE = 1000;

type PageResult<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>;

export async function readAllRows<T>(
  build: (from: number, to: number) => PageResult<T>,
  label: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

/*
  Ids per request when a query filters on a list of them. Each uuid costs
  about 37 characters of URL, and an `in.(…)` list built from an inspector's
  whole job history grows without end: past a few hundred ids the request
  is longer than the gateway accepts and the whole sync fails.
*/
export const ID_CHUNK = 150;

/** Splits a list of ids into request-sized groups. */
export function chunkIds<T>(ids: readonly T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < ids.length; at += size) out.push(ids.slice(at, at + size));
  return out;
}

/**
 * Every row matching a filter on a list of ids, however long the list.
 *
 * The ids go a chunk at a time (a few at once), and each chunk is paged
 * with readAllRows, so neither the URL length nor the 1,000-row cap can
 * cut the answer short. `build` receives the chunk and a page range and
 * must order by a unique column, as readAllRows requires.
 */
export async function readAllByIds<T, I = string>(
  ids: readonly I[],
  build: (chunk: I[], from: number, to: number) => PageResult<T>,
  label: string,
  concurrency = 4,
): Promise<T[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const chunks = chunkIds(unique);
  const results: T[][] = new Array(chunks.length);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const index = next++;
      results[index] = await readAllRows<T>(
        (from, to) => build(chunks[index], from, to),
        `${label} (${index + 1}/${chunks.length})`,
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker));
  return results.flat();
}
