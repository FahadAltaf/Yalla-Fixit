/**
 * Reads every row of a query, one page at a time.
 *
 * A single PostgREST request returns at most the project's max-rows (1000
 * by default on Supabase), whatever `.limit()` asks for, and says nothing
 * when it cuts the result. Reports and exports that need every row page
 * through instead. `page(from, to)` must build a FRESH query each call
 * with a stable order ending in a unique column (e.g. `.order("id")`), so
 * pages neither overlap nor skip rows.
 *
 * A page shorter than requested may still be capped by max-rows, so the
 * loop advances by what came back and stops only on an empty page.
 */
export const PAGE_SIZE = 1000;
/** Safety stop: far above any AMC volume we plan for (see docs/amc-database-architecture.md). */
export const MAX_ROWS = 100_000;

type PageResult<T> = { data: T[] | null; error: { code?: string; message: string } | null };

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  options: { pageSize?: number; maxRows?: number } = {},
): Promise<{ data: T[]; error: PageResult<T>["error"]; truncated: boolean }> {
  const pageSize = options.pageSize ?? PAGE_SIZE;
  const maxRows = options.maxRows ?? MAX_ROWS;
  const rows: T[] = [];
  for (let from = 0; from < maxRows; ) {
    const { data, error } = await page(from, Math.min(from + pageSize, maxRows) - 1);
    if (error) return { data: rows, error, truncated: false };
    const got = data ?? [];
    if (got.length === 0) return { data: rows, error: null, truncated: false };
    rows.push(...got);
    from += got.length;
  }
  return { data: rows, error: null, truncated: true };
}

/**
 * Every row of a query ordered by `id`, paged by key (`id > last id`)
 * instead of by offset. With embedded child rows (entitlements under each
 * contract) an offset page makes the database build the children of every
 * skipped row too, so reading N rows by offset costs O(N²); by key it is
 * O(N). `page(afterId, size)` must order by "id" ascending, filter
 * `id > afterId` when afterId is set, and limit to `size`.
 */
export async function fetchAllRowsById<T extends { id?: unknown }>(
  page: (afterId: string | null, size: number) => PromiseLike<PageResult<T>>,
  options: { pageSize?: number; maxRows?: number } = {},
): Promise<{ data: T[]; error: PageResult<T>["error"]; truncated: boolean }> {
  const pageSize = options.pageSize ?? PAGE_SIZE;
  const maxRows = options.maxRows ?? MAX_ROWS;
  const rows: T[] = [];
  let afterId: string | null = null;
  while (rows.length < maxRows) {
    const { data, error } = await page(afterId, Math.min(pageSize, maxRows - rows.length));
    if (error) return { data: rows, error, truncated: false };
    const got = data ?? [];
    if (got.length === 0) return { data: rows, error: null, truncated: false };
    rows.push(...got);
    afterId = String(got[got.length - 1].id);
  }
  return { data: rows, error: null, truncated: true };
}
