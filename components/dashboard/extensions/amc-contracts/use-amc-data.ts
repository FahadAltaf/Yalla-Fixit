"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { amcFresh } from "@/lib/amc/http-cache";

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
