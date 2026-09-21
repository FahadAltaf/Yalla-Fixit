/**
 * A search box's text as an `ilike` pattern safe to drop into a PostgREST
 * `.or()` filter. Commas, brackets and quotes would end the filter early
 * or change its meaning, and `%`/`_`/`*` are wildcards, so they are
 * dropped rather than passed through. Returns null when nothing is left.
 */
export function likeTerm(raw: string | null | undefined): string | null {
  const cleaned = (raw ?? "").replace(/[,()"'\%_*:]/g, " ").trim().replace(/\s+/g, " ");
  if (!cleaned) return null;
  return `%${cleaned.slice(0, 100)}%`;
}

/** Page and page size from the query string, clamped to sane values. */
export function pageParams(
  params: URLSearchParams,
  { defaultSize = 25, maxSize = 100 }: { defaultSize?: number; maxSize?: number } = {},
): { page: number; pageSize: number; from: number; to: number } {
  const pageSize = Math.min(Math.max(Math.floor(Number(params.get("pageSize"))) || defaultSize, 1), maxSize);
  const page = Math.max(Math.floor(Number(params.get("page"))) || 0, 0);
  return { page, pageSize, from: page * pageSize, to: page * pageSize + pageSize - 1 };
}
