"use client";

import Link from "next/link";
import { AlertCircle, ArrowRight, CheckCircle2, Clock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

import { LinesSkeleton, SectionShell } from "./section-shell";
import { timeAgo } from "../shared";
import { useSection } from "./use-section";

type Attention = {
  total: number;
  items: Array<{
    id: string;
    severity: "urgent" | "pending";
    title: string;
    subtitle: string;
    at: string | null;
    href: string;
  }>;
};

/**
 * What needs somebody now (§4).
 *
 * The one section on the page that exists to be acted on rather than
 * read, so it leads the right-hand column and every row goes straight
 * to the job. Colour is doing real work here — red is late, amber is
 * waiting — and it is always paired with an icon and a word, never
 * carried alone.
 */
export function NeedsAttention() {
  const { data, loading, error, reload } = useSection<Attention>(
    "/api/snagging/overview/attention",
    { staleMs: 60_000 },
  );

  return (
    <SectionShell
      title="Needs attention"
      description="Inspections that are late, sent back, or waiting on a decision."
      icon={<AlertCircle />}
      action={
        data && data.total > 0 ? (
          <Badge
            variant="secondary"
            className="bg-danger/10 text-danger border-0 font-medium"
          >
            {data.total}
          </Badge>
        ) : null
      }
      loading={loading}
      error={error}
      onRetry={reload}
      isEmpty={!loading && (data?.items.length ?? 0) === 0}
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
    >
      <ul className="divide-y">
        {(data?.items ?? []).map((item) => {
          const urgent = item.severity === "urgent";
          const Icon = urgent ? AlertCircle : Clock;
          return (
            <li key={`${item.id}-${item.title}`}>
              <Link
                href={item.href}
                className="hover:bg-muted/50 flex items-start gap-3 px-5 py-3 transition-colors"
              >
                <Icon
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    urgent ? "text-danger" : "text-warning",
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {item.title}
                  </span>
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
            </li>
          );
        })}
      </ul>
    </SectionShell>
  );
}
