"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays } from "lucide-react";

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
import { SubHeading } from "../shared";
import { useSection } from "./use-section";

type UpcomingItem = {
  id: string;
  unit: string | null;
  day: string | null;
  time: string | null;
  propertyType: string | null;
  place: string | null;
  inspector: string | null;
  href: string;
};

type Upcoming = {
  total: number;
  items: UpcomingItem[];
};

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
            <Badge
              variant="secondary"
              className="bg-mist text-ink-soft border-0 font-medium"
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
        <DayGroups items={data?.items ?? []} />
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
 * The appointments, banded by day.
 *
 * Written once and used by both the card and the dialog — two copies
 * would drift, and the dialog would stop looking like the card it opened
 * from.
 */
function DayGroups({
  items,
  className,
}: {
  items: UpcomingItem[];
  className?: string;
}) {
  const groups = new Map<string, UpcomingItem[]>();
  for (const item of items) {
    const key = item.day ?? "unscheduled";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  return (
    <div className="divide-y">
      {[...groups.entries()].map(([day, dayItems]) => (
        <div key={day} className={cn("px-5 py-3", className)}>
          <SubHeading className="mb-2">{dayLabel(day)}</SubHeading>
          <ul className="space-y-1">
            {dayItems.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="hover:bg-muted/50 -mx-2 flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors"
                >
                  <span className="w-12 shrink-0 text-sm font-medium tabular-nums">
                    {item.time ?? "—"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {item.unit ?? "Unnamed unit"}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {[item.propertyType, item.place]
                        .filter(Boolean)
                        .join(" · ") || "No property detail"}
                    </span>
                  </span>
                  <span className="text-muted-foreground shrink-0 truncate text-xs">
                    {item.inspector ?? "Unassigned"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
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
  const { data, loading, error, reload } = useSection<Upcoming>(
    `${ENDPOINT}?scope=all`,
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
            <DayGroups items={items} className="px-6" />
          )}
        </div>

        {!loading && !error && items.length > 0 ? (
          <div className="text-muted-foreground border-t px-6 py-3 text-xs">
            {items.length < total
              ? `Showing the next ${items.length} of ${total}.`
              : "Open a row to go to the inspection."}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** "Today" and "Tomorrow" read faster than a date somebody has to parse. */
function dayLabel(day: string): string {
  if (day === "unscheduled") return "Not scheduled";
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  if (day === today) return "Today";
  if (day === tomorrow) return "Tomorrow";
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
