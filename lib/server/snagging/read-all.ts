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
