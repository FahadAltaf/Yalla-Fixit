"use client";

import { useState } from "react";
import { CircleHelp, Info, RefreshCwIcon } from "lucide-react";

import { ListPager, PageHeading, PillTabs, SectionCard, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ErrorState, ListSkeleton, StatGridSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { refreshAll, useSection } from "@/components/dashboard/snagging/overview/use-section";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { QueryList, QuerySide } from "@/lib/server/finance/queries";

import { QueryThreadView, SIDE_LABEL, type QueryPeople } from "./query-thread";
import { daysSince } from "./shared";

/**
 * The Queries page (2 Nov): every query between Finance and Operations on
 * a work order, as a conversation. Either side asks; the other side is told
 * and replies; either side closes it. Waiting on you, open, closed or all,
 * switched at the top; a thread each, paged by the server, with the reply
 * box for your side. From the portal's records only: no FSM call.
 */

type Data = QueryList & { sides: QuerySide[]; tagOptions: QueryPeople };
type View = "waiting" | "open" | "resolved" | "all";
type RaisedBy = "all" | QuerySide;

export function FinanceQueriesPage() {
  const [view, setView] = useState<View>("waiting");
  const [raisedBy, setRaisedBy] = useState<RaisedBy>("all");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const url = `/api/finance/queries?view=${view}&raisedBy=${raisedBy}&page=${page}&pageSize=${pageSize}`;
  const { data, loading, error, reload } = useSection<Data>(url, { staleMs: 60_000 });

  const counts = data?.counts;
  const oldest = counts?.oldestOpenAt ? daysSince(counts.oldestOpenAt) : null;
  const rows = data?.rows ?? [];
  const yourSide = data?.sides.length === 1 ? SIDE_LABEL[data.sides[0]] : null;

  /* A page left empty by a change (its last query closed) falls back to the last page there is. */
  const lastPage = data ? Math.max(0, Math.ceil(data.total / pageSize) - 1) : page;
  if (page > lastPage) setPage(lastPage);

  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(0);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Finance"
        title="Queries"
        description="Questions between Finance and Operations on work orders, as a conversation. Reply here or on the work order; the other side is told each time. Either side closes a query once it is settled."
      />

      {data && !data.ready ? (
        <Alert>
          <Info className="size-4" />
          <AlertTitle>Queries are off</AlertTitle>
          <AlertDescription>Queries can be raised and answered once a database update is applied.</AlertDescription>
        </Alert>
      ) : null}

      {counts ? (
        <StatCardGrid columns={4}>
          <StatCard
            label="Waiting on you"
            value={counts.waitingOnYou}
            headline={counts.waitingOnYou ? `Waiting on ${yourSide ?? "your side"} to reply` : "Nothing waiting on you"}
            tone={counts.waitingOnYou ? "progress" : "good"}
          />
          <StatCard
            label="Waiting on Operations"
            value={counts.waitingOnOperations}
            headline="Questions and replies from Finance"
            tone={counts.waitingOnOperations ? "progress" : "neutral"}
          />
          <StatCard label="Waiting on Finance" value={counts.waitingOnFinance} headline="Questions and replies from Operations" tone={counts.waitingOnFinance ? "progress" : "neutral"} />
          <StatCard
            label="Oldest open"
            value={oldest === null ? "—" : `${oldest} ${oldest === 1 ? "day" : "days"}`}
            headline={counts.overWeek ? `${counts.overWeek} open 7 days or more` : `${counts.resolved} closed so far`}
            tone={counts.overWeek ? "progress" : "neutral"}
          />
        </StatCardGrid>
      ) : error ? null : (
        <StatGridSkeleton count={4} columns={4} />
      )}

      {error && !data ? <ErrorState title="Could not load the queries" message={error} onRetry={reload} retrying={loading} /> : null}

      <SectionCard
        icon={<CircleHelp />}
        title={view === "waiting" ? "Waiting on you" : view === "open" ? "Open" : view === "resolved" ? "Closed" : "All queries"}
        description={view === "resolved" ? "Newest first." : "Latest reply first."}
        bodyClassName="border-t"
        action={
          <Button variant="outline" size="sm" onClick={() => refreshAll()} disabled={loading}>
            <RefreshCwIcon className="size-4" />
            Refresh
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
          <PillTabs<View>
            value={view}
            onChange={reset(setView)}
            tabs={[
              { value: "waiting", label: "Waiting on you", count: counts?.waitingOnYou },
              { value: "open", label: "Open", count: counts ? counts.waitingOnFinance + counts.waitingOnOperations : undefined },
              { value: "resolved", label: "Closed", count: counts?.resolved },
              { value: "all", label: "All" },
            ]}
          />
          <Select value={raisedBy} onValueChange={(v) => reset(setRaisedBy)(v as RaisedBy)}>
            <SelectTrigger size="sm" className="w-full sm:w-48" aria-label="Filter by who raised it">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Raised by anyone</SelectItem>
              <SelectItem value="finance">Raised by Finance</SelectItem>
              <SelectItem value="operations">Raised by Operations</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {!data || loading ? (
          <ListSkeleton rows={Math.min(pageSize, 4)} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<CircleHelp className="size-6" />}
            title={view === "waiting" ? "Nothing waiting on you" : view === "resolved" ? "Nothing closed yet" : "No queries"}
            description="Raise a query from a work order's page. Each one stays here, with every reply, until it is closed, and after."
          />
        ) : (
          <ul className="divide-y">
            {rows.map((t) => (
              <li key={t.id} className="px-5 py-4">
                <QueryThreadView thread={t} sides={data.sides} people={data.tagOptions} showWorkOrder onChanged={() => refreshAll()} />
              </li>
            ))}
          </ul>
        )}
        <ListPager
          page={page}
          pageSize={pageSize}
          total={data?.total ?? 0}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
          noun="queries"
          className="border-t"
        />
      </SectionCard>
    </div>
  );
}
