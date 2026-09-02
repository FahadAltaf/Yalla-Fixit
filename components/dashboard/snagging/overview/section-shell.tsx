"use client";

import * as React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { SectionCard } from "../shared";

/**
 * The four states one section can be in, inside one card.
 *
 * Every section on the overview renders through this, which is what
 * makes them behave as independent units: a failure shows a small retry
 * where that card is, and the seven cards around it carry on. There is
 * no page-level spinner and no page-level error — by design.
 */
export function SectionShell({
  title,
  description,
  icon,
  action,
  loading,
  error,
  onRetry,
  isEmpty,
  empty,
  skeleton,
  footer,
  muted,
  centerBody,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  isEmpty?: boolean;
  empty?: React.ReactNode;
  /** Shaped like the content it stands in for, so nothing reflows. */
  skeleton: React.ReactNode;
  /**
   * The "View all" link at the foot of a list card.
   *
   * A slot rather than the last child of `children`, because `children` is
   * only rendered in the loaded state -- a card whose list happened to be
   * empty lost its footer, so two cards side by side had one link between
   * them.
   */
  footer?: React.ReactNode;
  /** Below-the-fold analytics: a quieter header so it does not compete. */
  muted?: boolean;
  /**
   * Centres the body in whatever height the grid row gives the card.
   *
   * A chart is a fixed height and its row neighbour is often a tall
   * empty state, so the shorter card used to stretch and leave the
   * difference as dead white space under the chart. Centring spends that
   * space evenly instead, and the two cards read as a pair.
   */
  centerBody?: boolean;
  className?: string;
  /** Applied to the loaded content only, not to the skeleton or error. */
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <SectionCard
      title={title}
      description={description}
      icon={icon}
      action={error ? null : action}
      className={cn("h-full", muted && "bg-muted/20", className)}
      bodyClassName={cn(centerBody && "flex flex-1 flex-col justify-center")}
    >
      {/*
        The inset sits on each state rather than on the card body. A section
        whose rows pad themselves passes bodyClassName="px-0 pb-0"; when that
        lived on the body it also un-padded the skeleton and the error, and
        both render flush to the card border with nothing to inset them.
      */}
      {error ? (
        <div className="px-5 pb-5">
          <InlineError message={error} onRetry={onRetry} />
        </div>
      ) : loading ? (
        <div className="px-5 pb-5">{skeleton}</div>
      ) : isEmpty ? (
        <div className="px-5 pb-5">{empty}</div>
      ) : (
        <div className={cn("px-5 pb-5", bodyClassName)}>{children}</div>
      )}

      {footer && !error ? (
        <div className="border-t px-5 py-3">{footer}</div>
      ) : null}
    </SectionCard>
  );
}

/**
 * A failure the size of the card it happened in.
 *
 * Deliberately small and undramatic: one section failing is a retry, not
 * an incident, and a full-width red panel would make the page look
 * broken when seven eighths of it is fine.
 */
export function InlineError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="border-border/70 flex flex-col items-start gap-3 rounded-lg border border-dashed p-4">
      <div className="flex items-start gap-2.5">
        <AlertTriangle
          className="text-warning mt-0.5 size-4 shrink-0"
          aria-hidden
        />
        <div>
          <p className="text-sm font-medium">Couldn&apos;t load this section</p>
          <p className="text-muted-foreground mt-0.5 text-sm">{message}</p>
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={onRetry}>
        <RefreshCw className="size-3.5" />
        Retry
      </Button>
    </div>
  );
}

/** Stacked lines, for a list or a stat column. */
export function LinesSkeleton({
  rows = 4,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-8 shrink-0 rounded-md" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="h-3 w-12 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/** Bars of varying height, so a chart does not pop into a flat grey box. */
export function ChartSkeleton({
  bars = 12,
  className,
}: {
  bars?: number;
  className?: string;
}) {
  // Fixed heights rather than random ones: a skeleton that reshuffles on
  // every render reads as movement where there is no news.
  const heights = [
    "45%",
    "70%",
    "35%",
    "85%",
    "55%",
    "95%",
    "40%",
    "75%",
    "60%",
    "50%",
    "80%",
    "65%",
  ];
  return (
    <div className={cn("flex h-56 items-end gap-2", className)}>
      {Array.from({ length: bars }).map((_, index) => (
        <Skeleton
          key={index}
          className="flex-1"
          style={{ height: heights[index % heights.length] }}
        />
      ))}
    </div>
  );
}

/** A circle, for the severity donut. */
export function DonutSkeleton() {
  return (
    <div className="flex h-56 items-center justify-center">
      <Skeleton className="size-40 rounded-full" />
    </div>
  );
}

/** Header row plus body rows, matching the real table's rhythm. */
export function TableSkeleton({
  rows = 4,
  columns = 4,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="bg-muted/40 flex gap-4 border-b px-4 py-2.5">
        {Array.from({ length: columns }).map((_, index) => (
          <Skeleton
            key={index}
            className={cn("h-3", index === 0 ? "flex-1" : "w-16")}
          />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, row) => (
        <div
          key={row}
          className="flex gap-4 border-b px-4 py-3 last:border-b-0"
        >
          {Array.from({ length: columns }).map((_, index) => (
            <Skeleton
              key={index}
              className={cn("h-4", index === 0 ? "flex-1" : "w-16")}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
