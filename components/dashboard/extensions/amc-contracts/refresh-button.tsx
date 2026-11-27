"use client";

import { RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { amcRefresh } from "@/lib/amc/http-cache";
import { cn } from "@/lib/utils";

import { useAmcRefreshing } from "./use-amc-data";

/**
 * Every AMC list's Refresh (27 Nov 2026): drops the cached reads, reads
 * the list and every card on the page again, and turns while that is on
 * its way, so pressing it visibly does something.
 */
export function AmcRefreshButton({ onRefresh, loading = false, className }: { onRefresh: () => void; loading?: boolean; className?: string }) {
  const refreshing = useAmcRefreshing();
  const busy = loading || refreshing;
  return (
    <Button onClick={() => amcRefresh(onRefresh)} variant="outline" disabled={busy} aria-label="Refresh" className={className}>
      <RefreshCwIcon className={cn("size-4 sm:mr-1", busy && "animate-spin")} />
      <span className="hidden sm:inline">Refresh</span>
    </Button>
  );
}
