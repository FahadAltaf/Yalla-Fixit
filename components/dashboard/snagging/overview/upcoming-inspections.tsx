"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

import { LinesSkeleton, SectionShell } from "./section-shell";
import { SubHeading } from "../shared";
import { useSection } from "./use-section";

type Upcoming = {
  items: Array<{
    id: string;
    code: string;
    day: string | null;
    time: string | null;
    propertyType: string | null;
    place: string | null;
    inspector: string | null;
    href: string;
  }>;
};

/** What is booked next (§4), grouped by the day it falls on. */
export function UpcomingInspections() {
  const { data, loading, error, reload } = useSection<Upcoming>(
    "/api/snagging/overview/upcoming",
    { staleMs: 300_000 },
  );

  const groups = new Map<string, Upcoming["items"]>();
  for (const item of data?.items ?? []) {
    const key = item.day ?? "unscheduled";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  return (
    <SectionShell
      title="Upcoming inspections"
      description="The next appointments, in the order the day happens."
      icon={<CalendarDays />}
      action={
        data && data.items.length > 0 ? (
          <Badge
            variant="secondary"
            className="bg-mist text-ink-soft border-0 font-medium"
          >
            {data.items.length}
          </Badge>
        ) : null
      }
      loading={loading}
      error={error}
      onRetry={reload}
      isEmpty={!loading && (data?.items.length ?? 0) === 0}
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
    >
      <div className="divide-y">
        {[...groups.entries()].map(([day, items]) => (
          <div key={day} className="px-5 py-3">
            <SubHeading className="mb-2">{dayLabel(day)}</SubHeading>
            <ul className="space-y-1">
              {items.map((item) => (
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
                        {item.code}
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
    </SectionShell>
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
