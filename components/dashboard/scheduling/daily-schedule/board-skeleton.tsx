"use client";

import { Skeleton } from "@/components/ui/skeleton";

// Loading state for the schedule board.
//
// Replaces a single centred spinner: that gave no sense of what was coming
// and made the whole page jump once the day landed. This mirrors the real
// shift-section shell -- header bar, frozen technician column, hour ruler,
// and a few rows with bars at varied offsets -- so the layout holds its
// shape and only the content fills in.

const TECH_COL_WIDTH = 180;

// Fixed offsets/widths so the placeholder reads as a schedule rather than a
// uniform grid, and so it never re-randomises between renders.
const BARS: Array<Array<[number, number]>> = [
  [[4, 22], [34, 18]],
  [[12, 30]],
  [[0, 14], [26, 12], [58, 20]],
  [[40, 26]],
  [[8, 18], [52, 24]],
];

function ShiftSectionSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-md border">
      <div className="bg-muted/50 flex items-center justify-between gap-2 rounded-t-md border-b px-3 py-1.5">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-28" />
      </div>

      <div className="overflow-hidden">
        {/* Hour ruler */}
        <div className="flex border-b">
          <div className="shrink-0 border-r px-2 py-2" style={{ width: TECH_COL_WIDTH }}>
            <Skeleton className="h-3 w-16" />
          </div>
          <div className="flex flex-1 items-center gap-8 px-2 py-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-3 w-8" />
            ))}
          </div>
        </div>

        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex border-b last:border-b-0">
            <div
              className="flex shrink-0 items-center gap-2 border-r px-2 py-2.5"
              style={{ width: TECH_COL_WIDTH }}
            >
              <Skeleton className="size-6 shrink-0 rounded-full" />
              <div className="flex flex-col gap-1">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-2.5 w-12" />
              </div>
            </div>
            <div className="relative min-w-0 flex-1 py-2.5">
              {(BARS[r % BARS.length] ?? []).map(([left, width], i) => (
                <Skeleton
                  key={i}
                  className="absolute top-2.5 h-6 rounded-sm"
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              ))}
              {/* Reserves the row height the absolute bars sit inside. */}
              <div className="h-6" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ScheduleBoardSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading schedule">
      <ShiftSectionSkeleton rows={4} />
      <ShiftSectionSkeleton rows={5} />
    </div>
  );
}
