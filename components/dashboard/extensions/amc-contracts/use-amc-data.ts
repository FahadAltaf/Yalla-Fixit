"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { AMC_REFRESH_EVENT, amcFresh, amcRefreshing, subscribeAmcRefreshing } from "@/lib/amc/http-cache";

/**
 * Loads data for a page or card: the latest answer wins, an answer for a
 * page already left is dropped, and `reload` fetches again.
 *
 * The first load may be answered from the AMC cache (lib/amc/http-cache), so
 * a tab or card asking for what its page just read costs nothing. `reload`
 * (Refresh, or after a save) always goes to the server.
 */
export function useAmcData<T>(load: () => Promise<T>, key: string) {
  const [state, setState] = useState<{ key: string; version: number; data: T | null; error: string | null }>({ key: "", version: 0, data: null, error: null });
  const [version, setVersion] = useState(0);
  /* The version last loaded: a higher one is a reload, which skips the cache. */
  const loadedVersion = useRef(0);

  useEffect(() => {
    let stale = false;
    const reloading = version > loadedVersion.current;
    loadedVersion.current = version;
    (reloading ? amcFresh(load) : load()).then(
      (data) => !stale && setState({ key, version, data, error: null }),
      (e) => !stale && setState({ key, version, data: null, error: e instanceof Error ? e.message : "Something went wrong." }),
    );
    return () => {
      stale = true;
    };
    // `key` stands for everything `load` depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  /* The page's Refresh reads every card again, not only the page's own record (27 Nov 2026). */
  useAmcRefreshSignal(reload);
  const current = state.key === key ? state : { data: null, error: null, version };
  return {
    data: current.data,
    error: current.error,
    loading: current.data === null && current.error === null,
    /* A reload (Refresh, after a save) on its way: the last answer stays on screen meanwhile. */
    reloading: current.data !== null && current.version !== version,
    reload,
  };
}

/**
 * Runs `onRefresh` when the page's Refresh is pressed (amcRefresh), for a
 * card that loads its data itself rather than through useAmcData.
 */
export function useAmcRefreshSignal(onRefresh: () => void | Promise<unknown>): void {
  const latest = useRef(onRefresh);
  useEffect(() => {
    latest.current = onRefresh;
  });
  useEffect(() => {
    const run = () => void latest.current();
    window.addEventListener(AMC_REFRESH_EVENT, run);
    return () => window.removeEventListener(AMC_REFRESH_EVENT, run);
  }, []);
}

/** Whether a Refresh is still loading: for the Refresh button to turn. */
export function useAmcRefreshing(): boolean {
  return useSyncExternalStore(subscribeAmcRefreshing, amcRefreshing, () => false);
}
