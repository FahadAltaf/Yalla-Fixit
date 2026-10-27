"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Info, Loader2, ReceiptText } from "lucide-react";
import { toast } from "sonner";

import { PageHeading, PillTabs, StatCard, StatCardGrid, timeAgo } from "@/components/dashboard/shared/kaizen";
import { ErrorState, StatGridSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { refreshAll, useSection } from "@/components/dashboard/snagging/overview/use-section";
import { DataTable } from "@/components/data-table";
import { getWorkOrderQueueColumns } from "@/components/data-table/columns/column-finance-work-orders";
import { FinanceQueueToolbar, type FinanceQueueToolbarFilters } from "@/components/data-table/toolbars/finance-queue-toolbar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useDebounce } from "@/hooks/use-debounce";
import { QUEUE_STATUS_LABELS, type QueueStatus } from "@/lib/finance/line-status";
import { addDaysToDateString, todayInZone } from "@/lib/scheduling/org-time";
import type { WorkOrderList } from "@/lib/server/finance/work-orders";

import { aed, formatDuration } from "./shared";

/* How long a page turn, or a filter, shows the table loading: the rows are already here, but the change should be seen. */
const PAGE_TURN_MS = 1000;
const FILTER_MS = 500;

/* The list's default dates and furthest reach, as the server works them out (lib/server/finance/work-orders.ts). */
const DEFAULT_DAYS = 30;
const MAX_DAYS = 122;

/**
 * Ready to invoice (BRD 5.1, 6.4): the summary strip, then the list with
 * its filters, one row per FSM work order read live from Zoho FSM (the
 * user's direction, 22 Oct). The last 30 days unless the dates are
 * changed, at most four months back, every status unless one is chosen.
 * The row opens the work order.
 *
 * Two views (26 Oct): Finance sees work ready to invoice (Completed in FSM
 * and flagged To Be Invoiced, or X % done to invoice); Operations sees
 * every work order, with a standing reminder of those whose appointments
 * are all done but which nobody has marked Completed in FSM.
 *
 * The list is cached in the browser by its URL and on the server for ten
 * minutes, so opening a work order and coming back costs nothing; Refresh
 * asks Zoho FSM again. The filters live in the URL, so Back keeps them.
 */

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "open", label: "Awaiting action" },
  /* Non-billable and Void are FSM's: they are under "In Zoho FSM" in the same dropdown (27 Oct). */
  ...(Object.keys(QUEUE_STATUS_LABELS) as QueueStatus[])
    .filter((status) => status !== "non_billable" && status !== "void")
    .map((status) => ({ value: status, label: QUEUE_STATUS_LABELS[status] })),
];

const LIST_STALE_MS = 10 * 60_000;

/* A query string with its keys in order, to tell whether the URL is the one asked for. */
const sortedQuery = (query: URLSearchParams | { toString(): string }) => {
  const copy = new URLSearchParams(query.toString());
  copy.sort();
  return copy.toString();
};

export function FinanceWorkOrdersPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filters: FinanceQueueToolbarFilters = useMemo(
    () => ({
      status: params.get("status") ?? "all",
      fsm: params.get("fsm") ?? "",
      /* No client filter (27 Oct): one left in an old link must not filter unseen. */
      client: "",
      /* The coordinator filter is hidden here (23 Oct): one left in an old link must not filter unseen. */
      coordinator: "",
      from: params.get("from") ?? "",
      to: params.get("to") ?? "",
      aged: params.get("aged") === "1",
    }),
    [params],
  );
  /*
    The tab clicked, held here until the URL catches up: Next only commits the
    new URL once the route has answered, which left the old tab lit meanwhile.
  */
  const [pickedView, setPickedView] = useState<"finance" | "operations" | null>(null);
  const urlView = params.get("view");
  useEffect(() => {
    if (pickedView && urlView === pickedView) setPickedView(null);
  }, [pickedView, urlView]);
  const askedView = pickedView ?? urlView;
  const attention = params.get("attention") === "1";
  /* The date boxes always show the dates in use: the last 30 days until changed. */
  const today = todayInZone();
  const shownTo = filters.to || today;
  const dates = {
    from: filters.from || addDaysToDateString(shownTo, -(DEFAULT_DAYS - 1)),
    to: shownTo,
    min: addDaysToDateString(today, -(MAX_DAYS - 1)),
    max: today,
  };
  const page = Number(params.get("page") ?? 0) || 0;
  const pageSize = Number(params.get("pageSize") ?? 25) || 25;
  const [search, setSearch] = useState(params.get("q") ?? "");
  const debouncedSearch = useDebounce(search, 400);
  const [refreshing, setRefreshing] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);
  const [turning, setTurning] = useState(false);
  const turnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (turnTimer.current) clearTimeout(turnTimer.current);
  }, []);
  const flash = (ms: number) => {
    setTurning(true);
    if (turnTimer.current) clearTimeout(turnTimer.current);
    turnTimer.current = setTimeout(() => setTurning(false), ms);
  };
  /* A new page or page size: back to the top of the table, loading for a moment. */
  const turnPage = (next: Record<string, string | number | boolean>) => {
    setParams(next);
    flash(PAGE_TURN_MS);
    tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  /* A filter or a search: loading for a moment, so the new rows read as new. */
  const filterBy = (next: Record<string, string | number | boolean>) => {
    setParams(next);
    flash(FILTER_MS);
  };

  /* The URL is the state: Back from a work order lands on the same filters and page. */
  const setParams = (next: Record<string, string | number | boolean>) => {
    const merged = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      const text = typeof value === "boolean" ? (value ? "1" : "") : String(value);
      if (text === "" || text === "0" || (key === "pageSize" && text === "25") || (key === "status" && text === "all")) merged.delete(key);
      else merged.set(key, text);
    }
    if (sortedQuery(merged) !== sortedQuery(params)) setPendingQuery(sortedQuery(merged));
    router.replace(`${pathname}${merged.size ? `?${merged}` : ""}`, { scroll: false });
  };
  /*
    Loading from the click until the new rows are in (27 Oct): Next changes
    the URL only once the route answers, so until then the old rows would
    show again. Held until the URL is the one asked for (ten seconds at most).
  */
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const currentQuery = sortedQuery(params);
  useEffect(() => {
    if (pendingQuery === null) return;
    if (currentQuery === pendingQuery) {
      setPendingQuery(null);
      return;
    }
    const give = setTimeout(() => setPendingQuery(null), 10_000);
    return () => clearTimeout(give);
  }, [pendingQuery, currentQuery]);

  const query = new URLSearchParams();
  if (askedView === "finance" || askedView === "operations") query.set("view", askedView);
  if (attention) query.set("attention", "1");
  if (filters.status !== "all") query.set("status", filters.status);
  for (const key of ["fsm", "from", "to"] as const) if (filters[key]) query.set(key, filters[key]);
  if (filters.aged) query.set("aged", "1");
  if (debouncedSearch) query.set("q", debouncedSearch);
  query.set("page", String(page));
  query.set("pageSize", String(pageSize));
  const url = `/api/finance/work-orders?${query}`;
  const { data, loading, error, reload } = useSection<WorkOrderList & { can?: { invoice: boolean; finance: boolean; operations: boolean } }>(url, {
    staleMs: LIST_STALE_MS,
  });
  /* Which address the rows on screen answer: rows of the last address are not this one's. */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (data) setLoadedFor(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- when an answer arrives
  }, [data]);
  const rowsLoading = loading || turning || pendingQuery !== null || (data !== null && loadedFor !== url);
  /* A page past the end (fewer rows after a filter or new dates): back to the last page that has rows. */
  useEffect(() => {
    if (!data || loading || page === 0 || data.rows.length > 0 || data.total === 0) return;
    setParams({ page: Math.max(0, Math.ceil(data.total / pageSize) - 1) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when an answer arrives
  }, [data, loading]);
  /*
    The tab clicked shows at once (the URL), not when its data arrives; one
    the person may not see falls back to what the server answered.
  */
  const askedAllowed =
    (askedView === "finance" || askedView === "operations") &&
    (!data?.can || (askedView === "finance" ? data.can.finance : data.can.operations));
  const view: "finance" | "operations" = askedAllowed ? (askedView as "finance" | "operations") : (data?.view ?? "finance");
  const operations = view === "operations";
  /* The other view is still being read from FSM: its cards and rows are not shown under this tab. */
  const switching = Boolean(data && data.view !== view);

  /* Ask Zoho FSM again (the server keeps the last answer ten minutes), then show it. */
  const refresh = async () => {
    setRefreshing(true);
    try {
      const response = await fetch(`${url}&refresh=1`, { credentials: "same-origin" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error ?? "Zoho FSM could not be read");
      toast.success(`Read from Zoho FSM (${payload.data?.fsm?.calls ?? 0} calls)`);
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Zoho FSM could not be read");
    } finally {
      setRefreshing(false);
    }
  };

  const columns = useMemo(() => getWorkOrderQueueColumns(data?.agedAfterDays ?? 7, operations), [data?.agedAfterDays, operations]);
  const summary = switching ? undefined : data?.summary;
  const filtered = Boolean(
    filters.status !== "all" || filters.fsm || filters.from || filters.to || filters.aged || attention || debouncedSearch,
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Finance"
        title="Ready to invoice"
        description={
          operations
            ? "Every FSM work order, read live from Zoho FSM. Mark finished work Completed in FSM, and record how far unfinished work has got so Finance can invoice it or book the revenue."
            : "Work Completed in FSM with its quotation flagged To Be Invoiced, and work Operations has recorded as partly done to invoice. Record the MAHER invoice in full or in part, or raise a query."
        }
      />

      {data?.can?.finance && data.can.operations ? (
        <PillTabs<"finance" | "operations">
          value={view}
          onChange={(next) => {
            setPickedView(next);
            filterBy({ view: next, attention: false, status: "all", page: 0 });
          }}
          tabs={[
            { value: "finance", label: "Finance" },
            { value: "operations", label: "Operations", count: data.view === "operations" && !switching ? data.needsCompleting : undefined },
          ]}
        />
      ) : null}

      {loading || refreshing ? (
        <p className="text-muted-foreground -mt-3 flex items-center gap-1.5 text-xs">
          <Loader2 className="size-3.5 animate-spin" />
          {operations ? "Reading every work order and its appointments from Zoho FSM…" : "Reading Zoho FSM…"}
        </p>
      ) : data ? (
        <p className="text-muted-foreground -mt-3 text-xs">
          Work orders raised {data.from} to {data.to}, read from Zoho FSM {timeAgo(data.fsm.fetchedAt)}
          {data.fsm.cached ? " (kept for ten minutes; Refresh reads again)" : ""}.
          {data.outsideDates > 0
            ? ` Also ${data.outsideDates} raised outside these dates that ${data.outsideDates === 1 ? "is" : "are"} still awaiting action, as last read when worked on.`
            : ""}
        </p>
      ) : null}

      {data && !data.ledgerReady ? (
        <Alert>
          <Info className="size-4" />
          <AlertTitle>Ready marks, workflow and invoices are off</AlertTitle>
          <AlertDescription>Apply migration 20261024100000 to record MAHER invoices, queries and holds.</AlertDescription>
        </Alert>
      ) : null}
      {data?.clamped ? (
        <Alert>
          <Info className="size-4" />
          <AlertTitle>Shown from {data.earliest}</AlertTitle>
          <AlertDescription>Ready to invoice looks back four months at most, so earlier dates are left out.</AlertDescription>
        </Alert>
      ) : null}

      {summary && operations && data ? (
        <StatCardGrid columns={5}>
          <StatCard
            label="Needs completing in FSM"
            value={data.needsCompleting}
            headline={attention ? "Showing only these · select to show all" : "Appointments all done, not marked Completed"}
            tone={data.needsCompleting > 0 ? "progress" : "neutral"}
            onSelect={() => filterBy({ attention: !attention, page: 0 })}
            selectLabel={attention ? "Show every work order" : "Show only work orders that need completing in FSM"}
          />
          <StatCard label="Not ready" value={summary.notReady.count} headline={`${aed(summary.notReady.valueWithVat)} incl. VAT`} />
          <StatCard label="Pending invoice" value={summary.pending.count} headline={`${aed(summary.pending.valueWithVat)} to invoice, incl. VAT`} />
          <StatCard
            label="Query raised"
            value={summary.queryRaised.count}
            headline={summary.queryRaised.count ? "Waiting on a coordinator's answer" : "No query open"}
            tone={summary.queryRaised.count ? "progress" : "neutral"}
          />
          <StatCard label="Non-billable" value={summary.nonBillable.count} headline={`${aed(summary.nonBillable.valueWithVat)} incl. VAT, not invoiced`} />
        </StatCardGrid>
      ) : summary ? (
        <StatCardGrid columns={5}>
          <StatCard
            label="Pending"
            value={summary.pending.count}
            headline={`${aed(summary.pending.valueWithVat)} to invoice, incl. VAT`}
          />
          <StatCard
            label="In progress"
            value={summary.inProgress.count + summary.queryRaised.count}
            headline={
              summary.queryRaised.count
                ? `${summary.queryRaised.count} with a query open`
                : `${aed(summary.inProgress.valueWithVat)} left, incl. VAT`
            }
            tone="progress"
          />
          <StatCard
            label="On hold"
            value={summary.onHold.count}
            headline={`${aed(summary.onHold.valueWithVat)} incl. VAT`}
          />
          <StatCard
            label="Non-billable"
            value={summary.nonBillable.count}
            headline={`${aed(summary.nonBillable.valueWithVat)} incl. VAT, not invoiced`}
          />
          <StatCard
            label="Average time to invoice"
            value={formatDuration(summary.averageDaysToInvoice)}
            headline={summary.averageDaysToInvoice === null ? "No invoices recorded yet" : `Over ${summary.invoices} invoice(s)`}
          />
        </StatCardGrid>
      ) : error ? null : (
        <StatGridSkeleton count={5} columns={5} />
      )}

      {error && !data ? <ErrorState title="Could not load Ready to invoice" message={error} onRetry={reload} retrying={loading} /> : null}

      <div ref={tableRef} className="scroll-mt-20">
      <Card className="py-0">
        <DataTable
          data={switching ? [] : (data?.rows ?? [])}
          columns={columns}
          toolbar={
            <FinanceQueueToolbar
              onSearchChange={(value) => {
                setSearch(value);
                filterBy({ q: value, page: 0 });
              }}
              initialSearch={params.get("q") ?? ""}
              loading={loading || refreshing}
              pageSize={pageSize}
              onPageSizeChange={(size) => turnPage({ pageSize: size, page: 0 })}
              onRefresh={() => void refresh()}
              statusOptions={STATUS_FILTERS}
              fsmStatuses={data?.options.fsmStatuses ?? []}
              filters={{ ...filters, from: dates.from, to: dates.to }}
              onFiltersChange={(next) =>
                filterBy({
                  ...next,
                  /* A date left at its default stays out of the URL. */
                  from: next.from === dates.from && !filters.from ? "" : next.from,
                  to: next.to === dates.to && !filters.to ? "" : next.to,
                  page: 0,
                })
              }
              dateBounds={{ min: dates.min, max: dates.max }}
              activeFilters={(filters.from || filters.to ? 1 : 0) + (filters.aged ? 1 : 0)}
              agedAfterDays={data?.agedAfterDays ?? 7}
              dateLabel="Raised"
            />
          }
          onGlobalFilterChange={() => undefined}
          onPageChange={(next) => turnPage({ page: next })}
          onPageSizeChange={(size) => turnPage({ pageSize: size, page: 0 })}
          pageSize={pageSize}
          currentPage={page}
          /* Loading until the rows for the new status, filters, search or page arrive (27 Oct). */
          loading={rowsLoading}
          rowCount={data?.total ?? 0}
          isPagination
          handleRowClick={(row) => router.push(`/finance/queue/${row.id}?as=${view}`)}
          emptyState={
            <EmptyState
              icon={<ReceiptText />}
              title={filtered ? "No work orders match these filters" : operations ? "No work orders in these dates" : "Nothing ready to invoice in these dates"}
              description={
                filtered
                  ? "Try clearing a filter or widening the dates (up to four months back)."
                  : operations
                    ? "Zoho FSM has no work order raised in these dates. Widen the dates (up to four months back)."
                    : "Work shows here once it is Completed in FSM with its quotation flagged To Be Invoiced, or Operations records it partly done to invoice."
              }
            />
          }
        />
      </Card>
      </div>

    </div>
  );
}
