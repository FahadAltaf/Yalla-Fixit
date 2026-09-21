"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Clock,
  UserRound,
} from "lucide-react";

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
import { formatTimeAmPm } from "@/components/ui/time-select";
import { cn } from "@/lib/utils";

import { ListPager, POPUP_PAGE_SIZES, PROPERTY_TYPE_ICON } from "../shared";
import { InlineError, LinesSkeleton, SectionShell } from "./section-shell";
import { useSection } from "./use-section";

type UpcomingItem = {
  id: string;
  unit: string | null;
  day: string | null;
  time: string | null;
  /** The appointment instant, when there is one. */
  at?: string | null;
  propertyType: string | null;
  place: string | null;
  inspector: string | null;
  href: string;
};

type Upcoming = {
  total: number;
  items: UpcomingItem[];
};

/** The kind of unit, as a glyph — read before the words are. */
const TYPE_ICON = PROPERTY_TYPE_ICON;

const ENDPOINT = "/api/snagging/overview/upcoming";

/**
 * What is booked next (§4), grouped by the day it falls on.
 *
 * The card shows the next few. The count in the header is the whole
 * booked diary from today onwards, and "View all" opens it, because a
 * card that says 23 and lists 6 owes the reader the other seventeen.
 */
export function UpcomingInspections() {
  const { data, loading, error, reload } = useSection<Upcoming>(ENDPOINT, {
    staleMs: 300_000,
  });
  const [allOpen, setAllOpen] = useState(false);

  const shown = data?.items.length ?? 0;
  const total = data?.total ?? 0;

  return (
    <>
      <SectionShell
        title="Upcoming inspections"
        description="The next appointments, in the order the day happens."
        icon={<CalendarDays />}
        action={
          total > 0 ? (
            // The count opens the whole booked diary — see NeedsAttention.
            <button
              type="button"
              onClick={() => setAllOpen(true)}
              aria-label={`Show all ${total} upcoming inspections`}
            >
              <Badge
                variant="secondary"
                className="bg-mist text-ink-soft hover:bg-muted border-0 font-medium transition-colors"
              >
                {total}
              </Badge>
            </button>
          ) : null
        }
        loading={loading}
        error={error}
        onRetry={reload}
        isEmpty={!loading && shown === 0}
        empty={
          <EmptyState
            icon={<CalendarDays />}
            title="Nothing scheduled"
            description="No inspection is booked from today onwards. Schedule one from the jobs list."
            className="py-10"
          />
        }
        skeleton={<LinesSkeleton rows={4} />}
        bodyClassName="px-0 pb-0"
        footer={
          // Only when there is genuinely more behind it: a "View all" over
          // a list already showing everything reads as a bug.
          total > shown ? (
            <Button
              variant="outline"
              size="sm"
              className="whitespace-nowrap"
              onClick={() => setAllOpen(true)}
            >
              View all {total}
              <ArrowRight className="size-3.5" aria-hidden />
            </Button>
          ) : null
        }
      >
        <AppointmentList items={data?.items ?? []} />
      </SectionShell>

      <AllUpcomingDialog
        open={allOpen}
        onOpenChange={setAllOpen}
        total={total}
      />
    </>
  );
}

/**
 * The appointments, one row each, in the order the days happen.
 *
 * No day bands. The list is short and already ordered, so a "TOMORROW"
 * heading above a single row cost a line of chrome to say what the row's
 * own date says — and the relative label stopped being useful the moment
 * the list ran past the day after next.
 *
 * Written once and used by both the card and the dialog; two copies would
 * drift, and the dialog would stop looking like the card it opened from.
 */
function AppointmentList({
  items,
  className,
}: {
  items: UpcomingItem[];
  className?: string;
}) {
  return (
    <ul className={cn("divide-y", className)}>
      {items.map((item) => (
        <li key={item.id}>
          <Link
            href={item.href}
            className="hover:bg-muted/50 flex items-center gap-3 px-5 py-2.5 transition-colors"
          >
            <TypeGlyph type={item.propertyType} />

            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {item.unit ?? "Unnamed unit"}
              </span>
              <span className="text-muted-foreground block truncate text-xs">
                {[item.propertyType, item.place].filter(Boolean).join(" · ") ||
                  "No property detail"}
              </span>
            </span>

            {/*
              Who is going, and when — together at the end of the row.
              These are the two things a coordinator scans this card for,
              and they answer one question, so they read as one block.
            */}
            <span className="shrink-0 text-right">
              <span
                className={cn(
                  "flex items-center justify-end gap-1.5 text-xs font-medium",
                  item.inspector ? "text-foreground" : "text-warning",
                )}
              >
                <UserRound className="size-3.5 shrink-0" aria-hidden />
                <span className="max-w-[9rem] truncate">
                  {item.inspector ?? "Unassigned"}
                </span>
              </span>
              <span className="text-muted-foreground mt-0.5 flex items-center justify-end gap-1.5 text-xs tabular-nums">
                <Clock className="size-3.5 shrink-0" aria-hidden />
                {whenLabel(item.day, item.time, item.at)}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function TypeGlyph({ type }: { type: string | null }) {
  const Icon = (type && TYPE_ICON[type]) || Building2;
  return (
    <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md">
      <Icon className="size-3.5" aria-hidden />
    </span>
  );
}

/**
 * The whole booked diary from today onwards.
 *
 * Fetches only once opened, and under its own URL, so the full list lands
 * in its own cache entry rather than overwriting the card's six.
 */
function AllUpcomingDialog({
  open,
  onOpenChange,
  total,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: number;
}) {
  // A page of the diary at a time; the server counts the whole of it.
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(POPUP_PAGE_SIZES[0]);
  const [openedAt, setOpenedAt] = useState(open);
  if (open !== openedAt) {
    setOpenedAt(open);
    if (open) setPage(0);
  }
  const { data, loading, error, reload } = useSection<Upcoming>(
    `${ENDPOINT}?scope=all&page=${page}&pageSize=${pageSize}`,
    { staleMs: 300_000, enabled: open },
  );

  const items = data?.items ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        showCloseButton
      >
        <DialogHeader className="px-6 pt-6 pb-4 text-left">
          <DialogTitle className="pr-10 text-lg">
            Upcoming inspections
          </DialogTitle>
          <DialogDescription>
            Everything booked from today onwards, in the order the days
            happen.
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
                icon={<CalendarDays />}
                title="Nothing scheduled"
                description="No inspection is booked from today onwards."
              />
            </div>
          ) : (
            <AppointmentList items={items} className="px-1" />
          )}
        </div>

        {!loading && !error && items.length > 0 ? (
          <div className="border-t">
            <ListPager
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(0);
              }}
              pageSizes={POPUP_PAGE_SIZES}
              noun="inspections"
            />
            {/* <p className="text-muted-foreground px-6 pb-3 text-xs">
              Open a row to go to the inspection.
            </p> */}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Wed 16 Sep · 9:00 AM" — the actual day, not a relative one, on the
 * viewer's own clock when the appointment has a time. A job with only a
 * date keeps that calendar date as written.
 */
function whenLabel(day: string | null, time: string | null, at?: string | null): string {
  if (at) {
    const instant = new Date(at);
    if (!Number.isNaN(instant.getTime())) {
      const date = instant.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
      });
      const clock = instant.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      return `${date} · ${clock}`;
    }
  }
  if (!day) return time ? formatTimeAmPm(time) : "Not scheduled";
  const date = new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return time ? `${date} · ${formatTimeAmPm(time)}` : date;
}
