"use client";

import { useMemo, useState, type ReactNode } from "react";
import { History } from "lucide-react";

import { DataRow, ListPager, SectionCard } from "@/components/dashboard/shared/kaizen";
import { ErrorState, ListSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface HistoryEntry {
  key: string;
  /** A lucide icon element, shown in its own square. */
  icon: ReactNode;
  /** What happened: the headline. */
  title: ReactNode;
  /** Who did it (null: the system). */
  actor: string | null;
  /** A line after who: the reason, the from → to, a note. */
  detail?: ReactNode;
  at: string;
}

/** "24 Oct, 14:55" in Dubai time, as Snagging's activity. */
export const historyWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" });

/**
 * Every AMC History tab looks the same as a Snagging job's Activity: one row
 * per event with its icon in a square, what happened, who and why under it,
 * and when on the right; newest or oldest first, a page at a time.
 * `entries` come newest first.
 */
export function HistoryCard({
  title = "History",
  description,
  entries,
  loading = false,
  error = null,
  onRetry,
  emptyTitle = "Nothing recorded yet",
  emptyDescription = "Each change appears here as it happens, with who made it.",
  noun = "events",
}: {
  title?: string;
  description: string;
  entries: HistoryEntry[] | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  noun?: string;
}) {
  const [order, setOrder] = useState<"desc" | "asc">("desc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const ordered = useMemo(() => (order === "desc" ? (entries ?? []) : [...(entries ?? [])].reverse()), [entries, order]);
  const rows = ordered.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <SectionCard
      title={title}
      icon={<History />}
      description={entries ? `${description} ${entries.length} ${entries.length === 1 ? noun.replace(/s$/, "") : noun}.` : description}
      bodyClassName="border-t"
      action={
        <Select
          value={order}
          onValueChange={(value) => {
            setOrder(value as "desc" | "asc");
            setPage(0);
          }}
        >
          <SelectTrigger size="sm" className="w-[130px]" aria-label="Sort history">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="desc">Newest first</SelectItem>
            <SelectItem value="asc">Oldest first</SelectItem>
          </SelectContent>
        </Select>
      }
    >
      {error ? (
        <div className="p-5">
          <ErrorState title="Could not load the history" message={error} onRetry={onRetry} />
        </div>
      ) : loading || !entries ? (
        <ListSkeleton rows={4} />
      ) : entries.length === 0 ? (
        <EmptyState icon={<History className="size-6" />} title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          <ol className="divide-y">
            {rows.map((e) => (
              <li key={e.key}>
                <DataRow
                  icon={e.icon}
                  title={e.title}
                  subtitle={
                    <>
                      {e.actor ?? "System"}
                      {e.detail ? <span> · {e.detail}</span> : null}
                    </>
                  }
                  trailing={<span className="text-muted-foreground text-xs whitespace-nowrap">{historyWhen(e.at)}</span>}
                />
              </li>
            ))}
          </ol>
          {entries.length > 10 ? (
            <ListPager page={page} pageSize={pageSize} total={entries.length} onPageChange={setPage} onPageSizeChange={setPageSize} noun={noun} className="border-t" />
          ) : null}
        </>
      )}
    </SectionCard>
  );
}
