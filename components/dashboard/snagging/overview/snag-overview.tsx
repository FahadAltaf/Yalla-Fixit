"use client";

import Link from "next/link";
import { Bug } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

import { LinesSkeleton, SectionShell } from "./section-shell";
import { useSection } from "./use-section";

type Summary = {
  total: number;
  open: number;
  resolved: number;
  reopened: number;
};

/**
 * The four snag counts (§5), as a stat list rather than four more cards.
 *
 * A card row here would compete with the KPI row at the top of the page
 * for the same glance; a list says these are one figure broken down, not
 * four headlines.
 */
export function SnagOverview() {
  const { data, loading, error, reload } = useSection<Summary>(
    "/api/snagging/overview/snag-summary",
    { staleMs: 120_000 },
  );

  const rows = data
    ? [
        { label: "Total recorded", value: data.total, href: null, tone: "" },
        {
          label: "Open",
          value: data.open,
          href: "/snagging/jobs?status=in_progress",
          tone: "",
        },
        {
          label: "Resolved",
          value: data.resolved,
          href: null,
          tone: "text-success",
        },
        {
          label: "Reopened",
          value: data.reopened,
          href: null,
          tone: data.reopened > 0 ? "text-danger" : "",
        },
      ]
    : [];

  return (
    <SectionShell
      title="Snag overview"
      description="Every defect recorded across the portfolio."
      icon={<Bug />}
      loading={loading}
      error={error}
      onRetry={reload}
      isEmpty={!loading && (data?.total ?? 0) === 0}
      empty={
        <EmptyState
          icon={<Bug />}
          title="No snags recorded"
          description="Defects appear here once an inspector captures them on site."
          className="py-10"
        />
      }
      skeleton={<LinesSkeleton rows={4} />}
      bodyClassName="px-0 pb-0"
    >
      <dl className="divide-y">
        {rows.map((row) => {
          const body = (
            <>
              <dt className="text-muted-foreground text-sm">{row.label}</dt>
              <dd
                className={cn("text-lg font-semibold tabular-nums", row.tone)}
              >
                {row.value}
              </dd>
            </>
          );
          return row.href ? (
            <Link
              key={row.label}
              href={row.href}
              className="hover:bg-muted/50 flex items-center justify-between px-5 py-3 transition-colors"
            >
              {body}
            </Link>
          ) : (
            <div
              key={row.label}
              className="flex items-center justify-between px-5 py-3"
            >
              {body}
            </div>
          );
        })}
      </dl>
    </SectionShell>
  );
}
