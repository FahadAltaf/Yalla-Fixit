import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FieldsSkeleton,
  SectionSkeleton,
  StatGridSkeleton,
} from "@/components/dashboard/shared/kaizen-states";

/*
  A proposal before it arrives, in the shape of its page: the header card,
  the tab bar and the Details tab it opens on. The route's loading.tsx and
  the page's own first read draw the same thing, so nothing changes shape
  between the two.
*/

/** The header card, the tab bar and the first tab. */
export function ProposalBodySkeleton() {
  return (
    <>
      <Card className="gap-0 p-0">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-56" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-20" />
            <Skeleton className="h-9 w-32" />
          </div>
        </div>
      </Card>
      <div className="bg-muted flex w-full items-center gap-1 rounded-lg p-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="bg-background/60 h-7 flex-1 rounded-md" />
        ))}
      </div>
      <StatGridSkeleton count={4} />
      <SectionSkeleton>
        <FieldsSkeleton fields={8} columns={2} />
      </SectionSkeleton>
    </>
  );
}

/** /extensions/amc/[id]: the back link and Refresh, then the body. */
export function ProposalDetailSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-24" />
      </div>
      <ProposalBodySkeleton />
    </div>
  );
}
