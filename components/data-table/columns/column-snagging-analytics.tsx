"use client";

import { ColumnDef } from "@tanstack/react-table";
import { TrendingDown, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SnaggingAnalytics } from "@/types/types";

/**
 * How many times one defect has to recur on a developer's units before
 * it stops being an incident and starts being a pattern worth colouring.
 */
export const RECURRING_DEFECT_THRESHOLD = 3;

/** The stat-card trend badge, reused so movement reads the same page-wide. */
function TrendBadge({ value }: { value: number | null }) {
  if (value === null || value === 0) {
    return <span className="text-muted-foreground text-xs">No change</span>;
  }
  const Icon = value > 0 ? TrendingUp : TrendingDown;
  return (
    <Badge variant="outline" className="gap-1 font-normal tabular-nums">
      <Icon className="size-3.5" aria-hidden />
      {value > 0 ? `+${value}` : value}
    </Badge>
  );
}

type SnaggingDeveloperRow = SnaggingAnalytics["byDeveloper"][number];
type SnaggingInspectorRow = SnaggingAnalytics["byInspector"][number];

/**
 * Columns for the two analytics breakdowns (FR-10.03, FR-10.04).
 *
 * Both are read-only rankings the API has already sorted, so sorting is
 * off on every column: re-sorting only the rows on the current page
 * would silently reorder a leaderboard against the totals shown beside
 * it. Headers therefore render raw, which is what keeps the right-hand
 * alignment on the numeric columns.
 */
export function getSnaggingDeveloperColumns(): ColumnDef<SnaggingDeveloperRow>[] {
  return [
    {
      id: "developer_name",
      header: "Developer",
      accessorKey: "developer_name",
      cell: ({ row }) => (
        <div className="font-medium">{row.original.developer_name}</div>
      ),
      enableSorting: false,
    },
    {
      id: "unit_count",
      header: () => <span className="block text-right">Units inspected</span>,
      accessorKey: "unit_count",
      cell: ({ row }) => (
        <div className="text-right tabular-nums">{row.original.unit_count}</div>
      ),
      enableSorting: false,
    },
    {
      id: "snags_per_unit",
      header: () => <span className="block text-right">Snags per unit</span>,
      accessorKey: "snags_per_unit",
      // The one number the section exists to show, so it keeps the
      // emphasis it had in the raw table.
      cell: ({ row }) => (
        <div className="text-right font-medium tabular-nums">
          {row.original.snags_per_unit}
        </div>
      ),
      enableSorting: false,
    },
    {
      id: "outstanding_count",
      header: () => <span className="block text-right">Still outstanding</span>,
      accessorKey: "outstanding_count",
      cell: ({ row }) => (
        <div className="text-right tabular-nums">
          {row.original.outstanding_count}
        </div>
      ),
      enableSorting: false,
    },
    {
      id: "unit_trend",
      header: () => <span className="block text-right">Trend</span>,
      accessorKey: "unit_trend",
      // Signed against the window before this one. Same badge shape as
      // the stat cards, so "up" reads the same everywhere on the page.
      cell: ({ row }) => (
        <div className="flex justify-end">
          <TrendBadge value={row.original.unit_trend} />
        </div>
      ),
      enableSorting: false,
    },
    {
      id: "last_inspection_at",
      header: () => <span className="block text-right">Last inspection</span>,
      accessorKey: "last_inspection_at",
      cell: ({ row }) => (
        <div className="text-muted-foreground text-right tabular-nums">
          {row.original.last_inspection_at
            ? row.original.last_inspection_at.slice(0, 10)
            : "—"}
        </div>
      ),
      enableSorting: false,
    },
    {
      id: "defect_mix",
      header: "Defect mix",
      // FR-10.03. Scoped to the developer on the row — the portfolio-wide
      // version of this is the chart FR-10.05 rules out.
      cell: ({ row }) => {
        const mix = row.original.defect_mix;
        if (mix.length === 0) {
          return (
            <span className="text-muted-foreground text-sm">
              No defects logged
            </span>
          );
        }
        return (
          <div className="flex flex-wrap gap-1">
            {mix.map((entry) => {
              // Neutral unless the same defect has come up enough times on
              // one developer's units to be a pattern rather than an
              // incident. A pill that is coloured for no stated reason is
              // just noise the reader has to learn to ignore.
              const recurring = entry.count >= RECURRING_DEFECT_THRESHOLD;
              return (
                <Badge
                  key={entry.label}
                  variant="secondary"
                  className={cn(
                    "font-normal",
                    recurring && "bg-danger/10 text-danger",
                  )}
                  title={
                    recurring
                      ? `Recurring: ${entry.count} times across this developer's units`
                      : undefined
                  }
                >
                  {entry.label}
                  <span
                    className={cn(
                      "ml-1 tabular-nums",
                      recurring ? "text-danger/80" : "text-muted-foreground",
                    )}
                  >
                    {entry.count}
                  </span>
                </Badge>
              );
            })}
          </div>
        );
      },
      enableSorting: false,
    },
  ];
}

export function getSnaggingInspectorColumns(): ColumnDef<SnaggingInspectorRow>[] {
  return [
    {
      id: "name",
      header: "Inspector",
      accessorKey: "name",
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name}</span>
      ),
      enableSorting: false,
    },
    {
      id: "inspection_count",
      header: () => <span className="block text-right">Inspections</span>,
      accessorKey: "inspection_count",
      cell: ({ row }) => (
        <div className="text-right tabular-nums">
          {row.original.inspection_count}
        </div>
      ),
      enableSorting: false,
    },
    {
      id: "firstTimeApprovalRate",
      header: () => (
        <span className="block text-right">First-time approval</span>
      ),
      accessorKey: "firstTimeApprovalRate",
      cell: ({ row }) => (
        <div className="text-right tabular-nums">
          {row.original.firstTimeApprovalRate === null ? (
            <span className="text-muted-foreground">No approvals yet</span>
          ) : (
            <>
              {row.original.firstTimeApprovalRate}%
              <span className="text-muted-foreground block text-xs">
                over {row.original.approvalSample}
              </span>
            </>
          )}
        </div>
      ),
      enableSorting: false,
    },
    {
      id: "avgSubmitToApprovalMinutes",
      header: () => (
        <span className="block text-right">Submit to approval</span>
      ),
      accessorKey: "avgSubmitToApprovalMinutes",
      cell: ({ row }) => (
        <div className="text-right tabular-nums">
          {row.original.avgSubmitToApprovalMinutes === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            formatMinutes(row.original.avgSubmitToApprovalMinutes)
          )}
        </div>
      ),
      enableSorting: false,
    },
    {
      id: "avgMinutesPerInspection",
      header: () => <span className="block text-right">Average time</span>,
      accessorKey: "avgMinutesPerInspection",
      // There is no snag column here and there is not meant to be
      // (FR-10.04): snag count measures the building an inspector was
      // sent to, so ranking people by it rewards drawing easy work.
      cell: ({ row }) => {
        const minutes = row.original.avgMinutesPerInspection;
        return (
          <div className="text-right tabular-nums">
            {minutes === null ? (
              <span className="text-muted-foreground">Not submitted yet</span>
            ) : (
              <>
                {formatMinutes(minutes)}
                {row.original.timedSample < row.original.inspection_count ? (
                  <span className="text-muted-foreground block text-xs">
                    over {row.original.timedSample} of{" "}
                    {row.original.inspection_count}
                  </span>
                ) : null}
              </>
            )}
          </div>
        );
      },
      enableSorting: false,
    },
  ];
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
