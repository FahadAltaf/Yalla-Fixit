"use client";

import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import type { SnaggingSnagStatus } from "@/types/types";

import { SnagStatusBadge } from "./shared";

/** One visit's record of the defect. */
type Leg = {
  job_id: string;
  job_code: string;
  round_number: number;
  visit_type: string;
  status: string;
  photo_count: number;
};

/** "Initial inspection", "De-snag round 2", "Additional visit 2". */
function legTitle(leg: Leg): string {
  if (leg.visit_type === "additional") return `Additional visit ${leg.round_number}`;
  if (leg.visit_type === "desnag") return `De-snag round ${leg.round_number}`;
  return "Initial inspection";
}

/**
 * FR-8.05 — the defect's status history, across every visit.
 *
 * A defect outlives the visit it was found on. It is raised on the
 * original inspection, carried into a round, ruled on there, and carried
 * again if the fix was poor. Each of those is a separate row, so the
 * dialog was showing a reviewer one leg of the story and calling it the
 * status: a defect that had been re-checked twice and failed twice read
 * exactly like one nobody had looked at yet.
 *
 * Loaded on demand rather than with the job: it is one defect's history,
 * and fetching it for every snag in a list would cost a request per row
 * for a panel most of them are never opened to.
 */
export function SnagHistory({ snagId }: { snagId: string }) {
  const [legs, setLegs] = useState<Leg[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLegs(null);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/snagging/snags/${snagId}/history`);
        const body = await res.json();
        if (!active) return;
        if (!res.ok) throw new Error(body.error ?? "Could not load the history");
        setLegs(body.data.legs as Leg[]);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Could not load the history");
      }
    })();
    return () => {
      active = false;
    };
  }, [snagId]);

  if (error) {
    return <p className="text-muted-foreground text-xs">{error}</p>;
  }

  if (legs === null) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  if (legs.length <= 1) {
    return (
      <p className="text-muted-foreground text-xs">
        This defect has only been seen on this visit.
      </p>
    );
  }

  return (
    <ol className="relative space-y-3">
      {legs.map((leg, index) => (
        <li key={`${leg.job_id}-${index}`} className="flex gap-3">
          {/* A rail down the left, so the legs read as one thread rather
              than as separate rows that happen to be stacked. */}
          <div className="flex flex-col items-center">
            <span className="bg-brand mt-1.5 size-2 shrink-0 rounded-full" />
            {index < legs.length - 1 ? (
              <span className="bg-border mt-1 w-px flex-1" aria-hidden />
            ) : null}
          </div>

          <div className="min-w-0 flex-1 pb-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium">{legTitle(leg)}</span>
              <SnagStatusBadge status={leg.status as SnaggingSnagStatus} />
            </div>
            <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
              <span className="font-mono">{leg.job_code}</span>
              {leg.photo_count > 0 ? (
                <span>
                  · {leg.photo_count} {leg.photo_count === 1 ? "photo" : "photos"}
                </span>
              ) : null}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
