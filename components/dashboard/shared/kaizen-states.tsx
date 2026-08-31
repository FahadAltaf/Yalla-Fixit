"use client";

import * as React from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { StatCardGrid } from "@/components/dashboard/shared/kaizen";

/**
 * The four data states, in one vocabulary.
 *
 * Every dashboard screen answers the same four questions — is it
 * loading, did it fail, is there nothing here, or is there something to
 * show — and before this file each screen answered them differently: a
 * skeleton here, the word "Loading…" there, a swallowed catch somewhere
 * else. A reviewer cannot tell "the server is down" from "this unit has
 * no snags" when both render as grey text, so the states are defined
 * once, here, and screens choose a shape rather than inventing one.
 *
 * The rules the whole dashboard now keeps:
 *   - Loading is always a skeleton in the shape of the real content, so
 *     nothing jumps when the data lands.
 *   - A failure always says so and always offers a way to try again.
 *     Nothing is ever swallowed into an empty-looking screen.
 *   - Empty says what would be here and, where the user can act, how to
 *     put something here.
 *   - Anything irreversible asks first.
 */

/* ────────────────────────────── skeletons ────────────────────────────── */

/**
 * A row of stat cards, matching StatCard's padding and type scale.
 *
 * It renders through StatCardGrid rather than repeating the grid, so the
 * skeleton sits on the same columns the real cards land on and the row
 * does not reflow the moment the data arrives.
 */
export function StatGridSkeleton({
  count = 4,
  columns,
  className,
}: {
  count?: number;
  columns?: 3 | 4 | 5;
  className?: string;
}) {
  return (
    <StatCardGrid columns={columns ?? (count === 3 || count === 5 ? count : 4)} className={className}>
      {Array.from({ length: count }).map((_, index) => (
        <Card key={index} className="h-full">
          <div className="flex items-start justify-between gap-2 px-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-7 w-20" />
            </div>
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
          <div className="space-y-1.5 px-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-28" />
          </div>
        </Card>
      ))}
    </StatCardGrid>
  );
}

/**
 * Rows inside a SectionCard body. Widths are staggered so it reads as
 * text rather than a barcode.
 */
export function ListSkeleton({
  rows = 5,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  const widths = ["w-2/5", "w-3/5", "w-1/2", "w-2/3", "w-1/3"];
  return (
    <div className={cn("divide-y", className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 px-5 py-3.5">
          <Skeleton className="size-7 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className={cn("h-4", widths[index % widths.length])} />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-6 w-16 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}

// Note: there is deliberately no table skeleton here. Tables render
// through the shared DataTable, which draws its own skeleton rows inside
// the real table body — a second, differently-shaped placeholder above
// it only made the load flicker between two looks.

/** A form/detail panel: label + control pairs in a grid. */
export function FieldsSkeleton({
  fields = 6,
  columns = 3,
  className,
}: {
  fields?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-4 p-5",
        columns === 2 ? "sm:grid-cols-2" : columns === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3",
        className,
      )}
    >
      {Array.from({ length: fields }).map((_, index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-full rounded-md" />
        </div>
      ))}
    </div>
  );
}

/** The page heading block, so the title does not pop in after the body. */
export function HeadingSkeleton({ withActions = false }: { withActions?: boolean }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      {withActions ? <Skeleton className="h-9 w-32 rounded-md" /> : null}
    </div>
  );
}

/** A titled card shell wrapping any of the skeletons above. */
export function SectionSkeleton({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("gap-0 overflow-hidden p-0", className)}>
      <div className="space-y-2 px-5 pt-5 pb-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3.5 w-64 max-w-full" />
      </div>
      <div className="border-t">{children ?? <ListSkeleton />}</div>
    </Card>
  );
}

/* ──────────────────────────── error + empty ──────────────────────────── */

/**
 * A load failure the user can act on.
 *
 * Toasts disappear; a screen that failed to load must keep saying so,
 * because a silent empty screen reads as "there is nothing here" and
 * sends a coordinator looking for data that exists. Retry is part of the
 * state, not a toolbar button somewhere else.
 */
export function ErrorState({
  title = "Could not load this",
  message,
  onRetry,
  retrying = false,
  className,
}: {
  title?: string;
  message?: string | null;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <Alert variant="destructive" className={cn("border-destructive/30 items-start p-4", className)}>
      <AlertTriangle />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{message?.trim() || "Something went wrong while loading this section."}</p>
        {onRetry ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRetry}
            disabled={retrying}
            className="mt-3"
          >
            {retrying ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {retrying ? "Retrying…" : "Try again"}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

/* ──────────────────────────── the wrapper ────────────────────────────── */

/**
 * Renders exactly one of: skeleton, error, empty, or the content.
 *
 * Screens pass the shapes rather than re-deriving the branch order, so
 * error can never be masked by a spinner and empty can never be shown
 * for a failed request — the two mistakes this module kept making.
 */
export function DataState({
  loading,
  error,
  onRetry,
  retrying,
  isEmpty = false,
  skeleton,
  empty,
  errorTitle,
  children,
}: {
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
  retrying?: boolean;
  isEmpty?: boolean;
  skeleton: React.ReactNode;
  empty?: React.ReactNode;
  errorTitle?: string;
  children: React.ReactNode;
}) {
  // Only the first load shows a skeleton; a refresh keeps the current
  // content on screen so the page does not blink on every poll.
  if (loading) return <>{skeleton}</>;
  if (error) {
    return (
      <ErrorState title={errorTitle} message={error} onRetry={onRetry} retrying={retrying} />
    );
  }
  if (isEmpty && empty) return <>{empty}</>;
  return <>{children}</>;
}

/* ─────────────────────────── pending actions ─────────────────────────── */

/**
 * A button that shows its own work.
 *
 * The module previously disabled a button and left it looking simply
 * unavailable, so "Approve" and "broken" looked identical. Here the icon
 * is replaced by a spinner and, where a verb reads better, the label
 * changes too.
 */
export function SubmitButton({
  pending = false,
  pendingLabel,
  icon,
  children,
  disabled,
  ...props
}: React.ComponentProps<typeof Button> & {
  pending?: boolean;
  pendingLabel?: string;
  icon?: React.ReactNode;
}) {
  return (
    <Button {...props} disabled={disabled || pending} aria-busy={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : icon}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}

/* ────────────────────────────── confirm ──────────────────────────────── */

export type ConfirmOptions = {
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "destructive";
};

/**
 * `await confirm({...})` before anything irreversible.
 *
 * One hook per screen covers every action on it: the caller awaits a
 * boolean and keeps its own pending state, so adding a confirmation to
 * an existing handler is a single line at the top of it.
 */
export function useConfirm() {
  const [request, setRequest] = React.useState<{
    options: ConfirmOptions;
    resolve: (confirmed: boolean) => void;
  } | null>(null);

  const confirm = React.useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setRequest({ options, resolve })),
    [],
  );

  const settle = React.useCallback(
    (confirmed: boolean) => {
      setRequest((current) => {
        current?.resolve(confirmed);
        return null;
      });
    },
    [],
  );

  const options = request?.options;

  const dialog = (
    <AlertDialog
      open={request !== null}
      onOpenChange={(open) => {
        // Dismissing by Escape or the overlay is a "no".
        if (!open) settle(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{options?.title}</AlertDialogTitle>
          <AlertDialogDescription>{options?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>
            {options?.cancelText ?? "Cancel"}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={options?.variant === "destructive" ? "destructive" : "default"}
            onClick={() => settle(true)}
          >
            {options?.confirmText ?? "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, dialog };
}
