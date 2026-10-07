"use client";

import { useCallback, useState } from "react";

/**
 * The Snagging job page's tab behaviour (inspection-detail.tsx), shared by
 * the AMC client and property pages: the tab lives in ?tab= so a link or a
 * refresh lands on it, and a tab stays mounted once opened so going back to
 * it shows it as it was, without fetching again.
 */
export function useUrlTab<T extends string>(tabs: readonly T[], fallback: T) {
  const [tab, setTabState] = useState<T>(() => {
    if (typeof window === "undefined") return fallback;
    const asked = new URLSearchParams(window.location.search).get("tab") as T | null;
    return asked && tabs.includes(asked) ? asked : fallback;
  });
  const [opened, setOpened] = useState<Set<T>>(() => new Set([tab]));

  const setTab = useCallback((next: string) => {
    const value = next as T;
    setTabState(value);
    setOpened((prev) => (prev.has(value) ? prev : new Set(prev).add(value)));
    const query = new URLSearchParams(window.location.search);
    query.set("tab", value);
    window.history.replaceState(null, "", `?${query.toString()}`);
  }, []);

  return { tab, setTab, isOpened: (value: T) => opened.has(value) };
}
