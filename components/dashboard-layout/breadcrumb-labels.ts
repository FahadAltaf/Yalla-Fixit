"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Human labels for URL segments that are ids.
 *
 * The breadcrumb builds itself from the path, which is right for
 * `/snagging/jobs` and useless for `/snagging/4d5510bf-4f50-…`: it
 * title-cased the UUID and showed "4d5510Bf 4f50 4948 B5e7 73289E9Ccc19"
 * as the name of the page. A record page knows what it is called, so it
 * registers that name here and the breadcrumb uses it instead.
 *
 * Deliberately a tiny store rather than context: the breadcrumb lives in
 * the layout, above every page that would need to provide the label, so
 * a provider would have to wrap the whole shell to pass a string upward.
 */

const labels = new Map<string, string>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Snapshot identity matters to useSyncExternalStore; bump it on write. */
let version = 0;
function getSnapshot() {
  return version;
}

export function labelForSegment(segment: string): string | undefined {
  return labels.get(segment);
}

/**
 * Names a path segment for as long as the calling page is mounted.
 *
 * Cleared on unmount so a stale job code cannot survive onto the next
 * record the reader opens.
 */
export function useBreadcrumbLabel(segment: string | undefined, label: string | undefined) {
  useEffect(() => {
    if (!segment || !label) return;
    labels.set(segment, label);
    version += 1;
    emit();
    return () => {
      labels.delete(segment);
      version += 1;
      emit();
    };
  }, [segment, label]);
}

/** Re-renders the breadcrumb whenever a page registers or clears a label. */
export function useBreadcrumbLabelVersion(): number {
  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
}
