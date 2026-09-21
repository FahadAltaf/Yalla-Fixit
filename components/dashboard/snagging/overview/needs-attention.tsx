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
import { ListPager, POPUP_PAGE_SIZES, timeAgo } from "../shared";
import { useSection } from "./use-section";

type AttentionItem = {
  id: string;
  /** Which kind of problem this is, for the filter strip. */
  category: string;
  severity: "urgent" | "pending";
  title: string;
  subtitle: string;
  at: string | null;
  href: string;
};

type AttentionCategory = {
  key: string;
  label: string;
  count: number;
  severity: "urgent" | "pending";
};

type Attention = {
  total: number;
  /** The real totals per kind, counted server-side, not from `items`. */
  categories: AttentionCategory[];
  items: AttentionItem[];
};

/** The card's URL for the chosen kind. The server does the narrowing. */
function endpointFor(filter: string | null, scope?: "all"): string {
  const params = new URLSearchParams();
  if (scope) params.set("scope", scope);
  if (filter) params.set("category", filter);
  const query = params.toString();
  return query ? `${ENDPOINT}?${query}` : ENDPOINT;
}

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
  const [allOpen, setAllOpen] = useState(false);
  /* Which kind the list is narrowed to, or all of them. */
  const [filter, setFilter] = useState<string | null>(null);

  const { data, loading, error, reload } = useSection<Attention>(
    endpointFor(filter),
    { staleMs: 60_000 },
  );

  const items = data?.items ?? [];
  const shown = items.length;
  const total = data?.total ?? 0;
  /*
    How many of the chosen kind there are in total, so the footer can
    still offer the rest of them.
  */
  const inView =
    filter
      ? (data?.categories ?? []).find((c) => c.key === filter)?.count ?? 0
      : total;

  return (
    <>
      <SectionShell
        title="Needs attention"
        description="Inspections that are late, sent back, or waiting on a decision."
        icon={<AlertCircle />}
        action={
          total > 0 ? (
            /*
              The count is the figure, so it opens what it counts
              (FR-10.01). There is no single URL behind it — these items
              span jobs in four states and quotations — so the matching
              "list" is the full dialog the footer already opens.
            */
            <button
              type="button"
              onClick={() => setAllOpen(true)}
              aria-label={`Show all ${total} items needing attention`}
            >
              {/* <Badge
                variant="secondary"
                className="bg-danger/10 text-danger hover:bg-danger/20 border-0 font-medium transition-colors"
              >
                {total}
              </Badge> */}
            </button>
          ) : null
        }
        loading={loading}
        error={error}
        onRetry={reload}
        isEmpty={!loading && total === 0}
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
          inView > shown ? (
            <Button
              variant="outline"
              size="sm"
              className="whitespace-nowrap"
              onClick={() => setAllOpen(true)}
            >
              View all {inView}
              <ArrowRight className="size-3.5" aria-hidden />
            </Button>
          ) : null
        }
      >
        <CategoryStrip
          categories={data?.categories ?? []}
          active={filter}
          onPick={setFilter}
        />
        {items.length === 0 && filter ? (
          <p className="text-muted-foreground px-5 pb-4 text-sm">
            Nothing of that kind right now. Pick another, or clear it to see
            the whole backlog.
          </p>
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <li key={`${item.id}-${item.category}`}>
                <AttentionRow item={item} />
              </li>
            ))}
          </ul>
        )}
      </SectionShell>

      <AllAttentionDialog
        open={allOpen}
        onOpenChange={setAllOpen}
        total={total}
        initialFilter={filter}
      />
    </>
  );
}


/**
 * The backlog by kind, as figures you can click.
 *
 * Deliberately not a chart (BA v2, change 9). These are five things
 * somebody has to go and do, and a pie of your own problems is a
 * picture you cannot click through to a job. Numbers with their labels
 * read faster, and each one filters the list underneath it.
 *
 * Only the kinds that actually have something in them are drawn. A row
 * of zeroes would say "here are five problems you do not have", which is
 * the opposite of what an attention card is for.
 */
function CategoryStrip({
  categories,
  active,
  onPick,
}: {
  categories: AttentionCategory[];
  active: string | null;
  onPick: (key: string | null) => void;
}) {
  const shown = categories.filter((category) => category.count > 0);
  if (shown.length < 2) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-5 pb-3">
      {shown.map((category) => {
        const on = active === category.key;
        return (
          <button
            key={category.key}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(on ? null : category.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
              on
                ? "border-brand bg-brand-50 text-brand"
                : "border-border hover:bg-muted/60",
            )}
          >
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                category.severity === "urgent" ? "bg-danger" : "bg-warning",
              )}
              aria-hidden
            />
            <span className="font-medium tabular-nums">{category.count}</span>
            <span className={on ? "" : "text-muted-foreground"}>
              {category.label}
            </span>
          </button>
        );
      })}
    </div>
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
  initialFilter,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: number;
  /** Opened from a chip, the dialog arrives on that same kind. */
  initialFilter: string | null;
}) {
  const [filter, setFilter] = useState<string | null>(initialFilter);
  /*
    The card's chip is the dialog's starting point, and changing it while
    the dialog is closed moves it. Compared during render rather than
    synchronised in an effect, which would render one frame on the old
    kind first.
  */
  const [lastInitial, setLastInitial] = useState(initialFilter);
  if (lastInitial !== initialFilter) {
    setLastInitial(initialFilter);
    setFilter(initialFilter);
  }

  const { data, loading, error, reload } = useSection<Attention>(
    endpointFor(filter, "all"),
    { staleMs: 60_000, enabled: open },
  );

  const items = data?.items ?? [];
  // A page at a time, back to the first whenever the filter changes.
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(POPUP_PAGE_SIZES[0]);
  const [pagedFor, setPagedFor] = useState(filter);
  if (pagedFor !== filter) {
    setPagedFor(filter);
    setPage(0);
  }
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const shown = items.slice(safePage * pageSize, safePage * pageSize + pageSize);

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
          <div className="space-y-2 border-y px-6 py-3">
            <p className="text-muted-foreground text-sm">
              {filter
                ? `${items.length} of ${total}`
                : total === 1
                  ? "1 inspection"
                  : `${total} inspections`}
            </p>
            {/* The same strip as the card, so the dialog it opened from
                is still the thing you are looking at. */}
            <div className="-mx-6">
              <CategoryStrip
                categories={data?.categories ?? []}
                active={filter}
                onPick={setFilter}
              />
            </div>
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
                title={filter ? "Nothing of that kind" : "Nothing needs attention"}
                description={
                  filter
                    ? "Clear the filter to see the rest of the backlog."
                    : "No inspection is late, sent back, or waiting on a decision right now."
                }
              />
            </div>
          ) : (
            <ul className="divide-y">
              {shown.map((item) => (
                <li key={`${item.id}-${item.category}`}>
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
          <div className="border-t">
            <ListPager
              page={safePage}
              pageSize={pageSize}
              total={items.length}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(0);
              }}
              pageSizes={POPUP_PAGE_SIZES}
              noun="inspections"
            />
            <p className="text-muted-foreground px-6 py-3 text-xs">
              {filter
                ? "Filtered. Clear the chip above to see the whole backlog."
                : items.length < total
                  ? `Showing the ${items.length} most urgent of ${total}. Clear these to see the rest.`
                  : "Open a row to go to the inspection."}
            </p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
