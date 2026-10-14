"use client";

import { useCallback, useEffect, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Clock, History, ScrollText, UserRound } from "lucide-react";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { DataTable } from "@/components/data-table";
import { IconText } from "@/components/data-table/columns/icon-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { snaggingService } from "@/modules/snagging";
import type { SnaggingChangeHistoryItem } from "@/types/types";

/** What each audited change is called on screen. */
const EVENT_LABELS: Record<string, string> = {
  quotation_generated: "Quotation created",
  quotation_edited: "Quotation edited",
  quotation_regenerated: "Quotation repriced",
  quotation_sent: "Sent to the client",
  quotation_link_shared: "Approval link shared",
  quotation_rate_approved: "Rate outside the band approved",
  quotation_approved: "Approved",
  quotation_rejected: "Rejected",
  pricing_updated: "Rate card or charges changed",
  scope_updated: "Scope of work changed",
  terms_updated: "Terms and conditions changed",
  catalogue_entry_created: "Catalogue entry added",
  catalogue_entry_updated: "Catalogue entry edited",
  catalogue_entry_retired: "Catalogue entry retired",
  catalogue_entry_reactivated: "Catalogue entry put back in use",
  checklist_item_created: "Check added to the library",
  checklist_item_updated: "Check edited",
  checklist_item_deactivated: "Check taken out of use",
  checklist_item_reactivated: "Check put back in use",
};

function labelFor(eventType: string): string {
  return (
    EVENT_LABELS[eventType] ??
    eventType.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
  );
}

const num = (value: unknown) =>
  value === null || value === undefined || value === "" ? null : Number(value);

const money = (value: unknown) => {
  const n = num(value);
  return n === null || !Number.isFinite(n)
    ? null
    : `AED ${n.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;
};

/** The detail line under a change: the figures or the item it touched. */
function detailFor(item: SnaggingChangeHistoryItem): string | null {
  const p = item.payload ?? {};
  switch (item.eventType) {
    case "quotation_generated": {
      const parts = [money(p.total) && `Total ${money(p.total)}`];
      if (num(p.rate_per_sqft) !== null) {
        parts.push(
          `rate AED ${num(p.rate_per_sqft)}/sq ft` +
            (num(p.rate_suggested) !== null && num(p.rate_suggested) !== num(p.rate_per_sqft)
              ? ` (suggested ${num(p.rate_suggested)})`
              : ""),
        );
      }
      return parts.filter(Boolean).join(", ") || null;
    }
    case "quotation_edited": {
      const parts: string[] = [];
      if (num(p.total_before) !== num(p.total_after)) {
        parts.push(`Total ${money(p.total_before) ?? "–"} → ${money(p.total_after) ?? "–"}`);
      }
      if (num(p.rate_before) !== num(p.rate_after)) {
        parts.push(`rate ${num(p.rate_before) ?? "–"} → ${num(p.rate_after) ?? "–"} per sq ft`);
      }
      if (p.client_changed === true) parts.push("client changed");
      if (p.notes_changed === true) parts.push("office notes changed");
      if (typeof p.reopened_from === "string") {
        parts.push(`was ${p.reopened_from === "sent" ? "with the client" : "rejected"}, back to Draft`);
      }
      return parts.join(", ") || "Details saved, price unchanged";
    }
    case "quotation_regenerated":
      return money(p.total) ? `New total ${money(p.total)}` : null;
    case "quotation_sent":
      return typeof p.recipient === "string" ? `To ${p.recipient}` : null;
    case "quotation_rate_approved":
      return typeof p.reason === "string" && p.reason ? `Reason: ${p.reason}` : null;
    case "quotation_rejected":
      return item.justification ? `Reason: ${item.justification}` : null;
    default: {
      const subject = [p.code, p.label ?? p.name].filter(Boolean).join(" · ");
      return subject || null;
    }
  }
}

const COLUMNS: ColumnDef<SnaggingChangeHistoryItem>[] = [
  {
    id: "change",
    header: "Change",
    cell: ({ row }) => {
      const detail = detailFor(row.original);
      return (
        <div className="min-w-0">
          <Badge variant="secondary" className="border-0 font-medium">
            {labelFor(row.original.eventType)}
          </Badge>
          {detail ? (
            <p className="text-muted-foreground mt-1 max-w-xl text-xs">{detail}</p>
          ) : null}
        </div>
      );
    },
    enableSorting: false,
  },
  {
    id: "actor",
    header: "Changed by",
    cell: ({ row }) => (
      <IdentityCell
        title={row.original.actorName ?? "System"}
        subtitle={null}
        icon={UserRound}
      />
    ),
    enableSorting: false,
  },
  {
    id: "when",
    header: "When",
    cell: ({ row }) => (
      <IconText icon={Clock} muted>
        <time dateTime={row.original.createdAt}>
          {new Date(row.original.createdAt).toLocaleString("en-GB", {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </time>
      </IconText>
    ),
    enableSorting: false,
  },
];

/**
 * The same history as a timeline, newest first: what changed, the figures
 * behind it, and who did it when. Sized for a side column; the column
 * scrolls, so the list is never cut.
 */
function HistoryTimeline({
  items,
  loading,
  scope,
}: {
  items: SnaggingChangeHistoryItem[];
  loading: boolean;
  scope: "quotation" | "settings";
}) {
  if (loading) {
    return (
      <div className="space-y-4 px-5 py-4">
        {[0, 1, 2].map((key) => (
          <div key={key} className="flex gap-3">
            <Skeleton className="mt-1 size-2.5 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <p className="text-muted-foreground px-5 py-4 text-sm">
        {scope === "quotation"
          ? "Changes appear here as the quotation is edited, sent and decided."
          : "Changes appear here as the settings are edited."}
      </p>
    );
  }
  return (
    <ol className="px-5 py-4">
      {items.map((item, index) => {
        const detail = detailFor(item);
        const last = index === items.length - 1;
        return (
          <li key={item.id} className="relative flex gap-3 pb-4 last:pb-0">
            {/* The rail joining one entry to the next. */}
            {!last ? (
              <span aria-hidden className="bg-border absolute top-4 bottom-0 left-[4.5px] w-px" />
            ) : null}
            <span
              aria-hidden
              className={
                index === 0
                  ? "bg-brand ring-brand/20 mt-1.5 size-2.5 shrink-0 rounded-full ring-4"
                  : "bg-muted-foreground/40 mt-1.5 size-2.5 shrink-0 rounded-full"
              }
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{labelFor(item.eventType)}</p>
              {detail ? (
                <p className="text-muted-foreground mt-0.5 text-xs break-words">{detail}</p>
              ) : null}
              <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-1.5 text-xs">
                <span className="text-foreground/80 font-medium">{item.actorName ?? "System"}</span>
                <span aria-hidden>·</span>
                <time dateTime={item.createdAt}>
                  {new Date(item.createdAt).toLocaleString("en-GB", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Who changed what, and when, in the house table (SNG-037). Used on a
 * quotation and on the Snagging settings.
 */
export function ChangeHistoryCard({
  scope,
  id,
  description,
  variant = "table",
}: {
  scope: "quotation" | "settings";
  id?: string;
  description?: string;
  /**
   * "table" for a full-width page (the settings); "timeline" for a side
   * column, where three columns do not fit (the quotation page).
   */
  variant?: "table" | "timeline";
}) {
  const [items, setItems] = useState<SnaggingChangeHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await snaggingService.getChangeHistory(scope, id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the history");
    } finally {
      setLoading(false);
    }
  }, [scope, id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SectionCard
      icon={<History />}
      title="Change history"
      description={
        description ??
        (scope === "quotation"
          ? "Who created this quotation, who changed it, and when."
          : "Every change to the rates, wording, catalogue and checklist: who made it and when.")
      }
      bodyClassName="border-t"
    >
      {error ? (
        <div className="flex items-center justify-between gap-3 p-4 text-sm">
          <span className="text-destructive">{error}</span>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : variant === "timeline" ? (
        <HistoryTimeline items={items} loading={loading} scope={scope} />
      ) : (
        <DataTable
          columns={COLUMNS}
          data={items}
          loading={loading}
          rowCount={items.length}
          pageSize={Math.max(items.length, 1)}
          currentPage={0}
          onPageChange={() => undefined}
          onPageSizeChange={() => undefined}
          onGlobalFilterChange={() => undefined}
          emptyState={
            <EmptyState
              className="border-0"
              icon={<ScrollText className="size-5" />}
              title="No changes yet"
              description={
                scope === "quotation"
                  ? "Changes appear here as the quotation is edited, sent and decided."
                  : "Changes appear here as the settings are edited."
              }
            />
          }
        />
      )}
    </SectionCard>
  );
}
