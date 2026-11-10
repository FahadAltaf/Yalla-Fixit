"use client";

import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The top of every AMC record page (client, property, enquiry, site visit,
 * contract, proposal): a way back and Refresh above, then a card naming the
 * record with its state and what can be done with it.
 */

/** "14:32" on the viewer's own clock, for the "Updated" note beside Refresh. */
export function formatClock(at: number): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(at));
}

/** Back link on the left; when it was read and Refresh on the right. It never waits on the record. */
export function DetailToolbar({
  backHref,
  backLabel,
  fetchedAt,
  refreshing,
  onRefresh,
}: {
  backHref: string;
  backLabel: string;
  fetchedAt?: number | null;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href={backHref}>
          <ArrowLeft className="size-4" />
          {backLabel}
        </Link>
      </Button>
      {onRefresh ? (
        <div className="flex items-center gap-3">
          {fetchedAt ? <span className="text-muted-foreground hidden text-xs sm:inline">Updated {formatClock(fetchedAt)}</span> : null}
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing} aria-label="Refresh this page">
            <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The record's card: small outline badges (its number, its kind), the name
 * with its state, one muted line of what matters about it, and its actions
 * on the right. Anything under the card's own row (a warning strip) goes in
 * `children`.
 */
export function DetailHeaderCard({
  badges,
  title,
  status,
  subline,
  actions,
  children,
}: {
  badges?: React.ReactNode;
  title: React.ReactNode;
  status?: React.ReactNode;
  subline?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <Card className="gap-0 p-0">
      <div className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="min-w-0 space-y-1">
          {badges ? <div className="flex flex-wrap items-center gap-2">{badges}</div> : null}
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl">{title}</h2>
            {status}
          </div>
          {subline ? <p className="text-muted-foreground text-sm">{subline}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </Card>
  );
}

/** The header card's shape while the record loads, so the page does not jump when it lands. */
export function DetailHeaderSkeleton() {
  return (
    <Card className="gap-0 p-0">
      <div className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="space-y-2">
          <Skeleton className="h-5 w-28 rounded-full" />
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-36" />
        </div>
      </div>
    </Card>
  );
}
