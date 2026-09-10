"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowRight, CheckCircle2, Clock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

import { InlineError, LinesSkeleton, SectionShell } from "./section-shell";
import { timeAgo } from "../shared";
import { useSection } from "./use-section";

type AttentionItem = {
  id: string;
  severity: "urgent" | "pending";
  title: string;
  subtitle: string;
  at: string | null;
  href: string;
};

type Attention = {
  total: number;
  items: AttentionItem[];
};

const ENDPOINT = "/api/snagging/overview/attention";

/**
 * What needs somebody now (§4).
 *
 * The one section on the page that exists to be acted on rather than
 * read, so it leads the right-hand column and every row goes straight
 * to the job. Colour is doing real work here — red is late, amber is
 * waiting — and it is always paired with an icon and a word, never
 * carried alone.
 *
 * The card shows four. The count in the header is the real total, and
 * "View all" opens the rest, because a card that says 10 and lists 4 owes
 * the reader the other six somewhere.
 */
export function NeedsAttention() {
  const { data, loading, error, reload } = useSection<Attention>(ENDPOINT, {
    staleMs: 60_000,
  });
  const [allOpen, setAllOpen] = useState(false);

  const shown = data?.items.length ?? 0;
  const total = data?.total ?? 0;

  return (
    <>
      <SectionShell
        title="Needs attention"
        description="Inspections that are late, sent back, or waiting on a decision."
        icon={<AlertCircle />}
        action={
          total > 0 ? (
            <Badge
              variant="secondary"
              className="bg-danger/10 text-danger border-0 font-medium"
            >
              {total}
            </Badge>
          ) : null
        }
        loading={loading}
        error={error}
        onRetry={reload}
        isEmpty={!loading && shown === 0}
        empty={
          <EmptyState
            icon={<CheckCircle2 />}
            title="Nothing needs attention"
            description="No inspection is late, sent back, or waiting on a decision right now."
            className="py-10"
          />
        }
        skeleton={<LinesSkeleton rows={4} />}
        bodyClassName="px-0 pb-0"
        footer={
          /*
            Only when there is genuinely more behind it. A "View all" over
            a list that is already showing everything opens a dialog with
            the same four rows in it, which reads as a bug.
          */
          total > shown ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-brand h-auto w-full justify-between px-0 hover:bg-transparent"
              onClick={() => setAllOpen(true)}
            >
              View all {total}
              <ArrowRight className="size-3.5" aria-hidden />
            </Button>
          ) : null
        }
      >
        <ul className="divide-y">
          {(data?.items ?? []).map((item) => (
            <li key={`${item.id}-${item.title}`}>
              <AttentionRow item={item} />
            </li>
          ))}
        </ul>
      </SectionShell>

      <AllAttentionDialog
        open={allOpen}
        onOpenChange={setAllOpen}
        total={total}
      />
    </>
  );
}

/**
 * One row, written once.
 *
 * The card and the dialog render the same thing, so they share this
 * rather than each keeping their own copy — otherwise the two lists
 * drift and the dialog stops looking like the card it opened from.
 */
function AttentionRow({
  item,
  className,
}: {
  item: AttentionItem;
  className?: string;
}) {
  const urgent = item.severity === "urgent";
  const Icon = urgent ? AlertCircle : Clock;

  return (
    <Link
      href={item.href}
      className={cn(
        "hover:bg-muted/50 flex items-start gap-3 px-5 py-3 transition-colors",
        className,
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          urgent ? "text-danger" : "text-warning",
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{item.title}</span>
        <span className="text-muted-foreground block truncate text-sm">
          {item.subtitle}
          {item.at ? <span> · {timeAgo(item.at)}</span> : null}
        </span>
      </span>
      <span className="text-brand mt-0.5 inline-flex shrink-0 items-center gap-1 text-sm font-medium">
        View
        <ArrowRight className="size-3.5" aria-hidden />
      </span>
    </Link>
  );
}

/**
 * The whole backlog, worst first.
 *
 * Shaped like the analytics drill-down: a centred dialog that scrolls its
 * own body, with the count above the list and what is not on screen
 * spelled out underneath.
 *
 * It fetches only once opened — `enabled` holds the request back — so a
 * card nobody clicks costs nothing. The URL differs from the card's by
 * its query string, which is what keeps the two responses in separate
 * cache entries instead of the full list overwriting the four.
 */
function AllAttentionDialog({
  open,
  onOpenChange,
  total,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: number;
}) {
  const { data, loading, error, reload } = useSection<Attention>(
    `${ENDPOINT}?scope=all`,
    { staleMs: 60_000, enabled: open },
  );

  const items = data?.items ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        showCloseButton
      >
        <DialogHeader className="px-6 pt-6 pb-4 text-left">
          <DialogTitle className="pr-10 text-lg">Needs attention</DialogTitle>
          <DialogDescription>
            Inspections that are late, sent back, or waiting on a decision,
            worst first.
          </DialogDescription>
        </DialogHeader>

        {!loading && !error ? (
          <div className="border-y px-6 py-3">
            <p className="text-muted-foreground text-sm">
              {total === 1 ? "1 inspection" : `${total} inspections`}
            </p>
          </div>
        ) : null}

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-6 py-4">
              <LinesSkeleton rows={8} />
            </div>
          ) : error ? (
            <div className="px-6 py-4">
              <InlineError message={error} onRetry={reload} />
            </div>
          ) : items.length === 0 ? (
            <div className="px-6 py-4">
              <EmptyState
                icon={<CheckCircle2 />}
                title="Nothing needs attention"
                description="No inspection is late, sent back, or waiting on a decision right now."
              />
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((item) => (
                <li key={`${item.id}-${item.title}`}>
                  <AttentionRow item={item} className="px-6" />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/*
          The list is capped, so when the backlog runs past it say so
          rather than letting the dialog imply it is showing everything.
        */}
        {!loading && !error && items.length > 0 ? (
          <div className="text-muted-foreground border-t px-6 py-3 text-xs">
            {items.length < total
              ? `Showing the ${items.length} most urgent of ${total}. Clear these to see the rest.`
              : "Open a row to go to the inspection."}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
