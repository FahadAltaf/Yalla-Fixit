import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A short in-process cache for the AMC settings and configuration
 * (13 Nov 2026).
 *
 * Every AMC request read the settings row (the access gate) and most read
 * every row of amc_config as well: one or two database round trips before
 * any real work, for values that change a few times a month. They are now
 * kept for TTL_MS per server process; a save through this server drops them
 * at once, and another server process sees the change within TTL_MS.
 *
 * Keyed by the client's project URL, so only real Supabase clients are
 * cached: a test's in-memory client has none and always reads through.
 * Callers get a copy, so nothing they change reaches the cached value.
 */
const TTL_MS = 20_000;

type Entry = { at: number; value: Promise<unknown> };
const entries = new Map<string, Entry>();

const projectOf = (admin: SupabaseClient): string | null => {
  const url = (admin as unknown as { supabaseUrl?: unknown }).supabaseUrl;
  return typeof url === "string" && url ? url : null;
};

export async function cachedRead<T>(admin: SupabaseClient, name: string, read: () => Promise<T>): Promise<T> {
  const project = projectOf(admin);
  if (!project) return read();
  const key = `${project}|${name}`;
  const hit = entries.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return structuredClone((await hit.value) as T);
  const value = read();
  entries.set(key, { at: Date.now(), value });
  /* A failed read is not kept. */
  value.catch(() => {
    if (entries.get(key)?.value === value) entries.delete(key);
  });
  return structuredClone(await value);
}

/** After a save: the next read goes to the database. */
export function forgetCachedRead(name: string): void {
  for (const key of [...entries.keys()]) if (key.endsWith(`|${name}`)) entries.delete(key);
}
