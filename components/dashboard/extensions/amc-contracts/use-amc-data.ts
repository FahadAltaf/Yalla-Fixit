"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Loads data for a page or card: the latest answer wins, an answer for a
 * page already left is dropped, and `reload` fetches again.
 */
export function useAmcData<T>(load: () => Promise<T>, key: string) {
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null }>({ key: "", data: null, error: null });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let stale = false;
    load().then(
      (data) => !stale && setState({ key, data, error: null }),
      (e) => !stale && setState({ key, data: null, error: e instanceof Error ? e.message : "Something went wrong." }),
    );
    return () => {
      stale = true;
    };
    // `key` stands for everything `load` depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const current = state.key === key ? state : { data: null, error: null };
  return { data: current.data, error: current.error, loading: current.data === null && current.error === null, reload };
}
