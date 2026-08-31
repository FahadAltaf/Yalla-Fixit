"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * One section's data, fetched independently of every other section.
 *
 * The overview is eight cards that each answer a different question, and
 * they are deliberately not one request: a slow inspector aggregation
 * must not hold up the KPI row, and a failing quotation query must not
 * blank the page. So each section owns a hook, a skeleton and an error
 * of its own, and the page has no combined loading state at all.
 *
 * The cache is module-level and keyed by URL. A section that has been
 * seen recently renders from memory instead of refetching, which is what
 * makes tabbing back to the page instant; `refreshAll()` clears it so
 * "Pull changes" genuinely goes back to the server.
 */

type Entry = { data: unknown; at: number };

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();

/** "Pull changes": drop everything cached and tell every section to re-read. */
export function refreshAll() {
  cache.clear();
  inFlight.clear();
  for (const listener of listeners) listener();
}

/** When the freshest section was last fetched, for "Last updated". */
export function lastFetchedAt(): number | null {
  let newest: number | null = null;
  for (const entry of cache.values()) {
    if (newest === null || entry.at > newest) newest = entry.at;
  }
  return newest;
}

export type Section<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

export function useSection<T>(
  url: string,
  options: {
    /** How long a cached response stays good, in milliseconds. */
    staleMs?: number;
    /**
     * Below-the-fold sections pass false until they scroll into view, so
     * the page does not spend its first round trips on analytics nobody
     * has looked at yet.
     */
    enabled?: boolean;
  } = {},
): Section<T> {
  const { staleMs = 60_000, enabled = true } = options;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Re-read whenever "Pull changes" fires.
  useEffect(() => {
    const listener = () => setTick((value) => value + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const run = useCallback(async () => {
    const cached = cache.get(url);
    if (cached && Date.now() - cached.at < staleMs) {
      setData(cached.data as T);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Two sections asking for the same URL at once share one request
      // rather than racing each other.
      let promise = inFlight.get(url);
      if (!promise) {
        promise = fetch(url, { credentials: "same-origin" }).then(async (response) => {
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload?.error ?? "This section could not be loaded");
          }
          return payload.data;
        });
        inFlight.set(url, promise);
      }

      const result = (await promise) as T;
      cache.set(url, { data: result, at: Date.now() });
      if (mounted.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (mounted.current) {
        setError(err instanceof Error ? err.message : "This section could not be loaded");
      }
    } finally {
      inFlight.delete(url);
      if (mounted.current) setLoading(false);
    }
  }, [url, staleMs]);

  useEffect(() => {
    if (!enabled) return;
    void run();
    // `tick` is what re-runs this after a manual refresh or a retry.
  }, [run, enabled, tick]);

  const reload = useCallback(() => {
    cache.delete(url);
    inFlight.delete(url);
    setTick((value) => value + 1);
  }, [url]);

  return { data, loading, error, reload };
}

/**
 * True once the element has been on screen, and true for good after.
 *
 * Used to hold back the two analytics sections until somebody scrolls to
 * them. Once loaded they stay loaded — a section that unloaded itself on
 * scroll-away would refetch every time the reader moved.
 */
export function useInView<T extends Element>(ref: React.RefObject<T | null>): boolean {
  // Without IntersectionObserver (older Safari, a test renderer) the
  // section simply loads: a missing optimisation is better than a
  // section that never appears. Decided at mount rather than inside the
  // effect, so nothing sets state on the way through a render.
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    if (seen) return;
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      // Start fetching a little before it reaches the viewport, so the
      // skeleton is usually gone by the time it is actually read.
      { rootMargin: "300px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, seen]);

  return seen;
}
