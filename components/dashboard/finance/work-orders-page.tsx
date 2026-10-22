"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BarChart3, FileUp, Info, ReceiptText } from "lucide-react";
import { toast } from "sonner";

import { PageHeading, StatCard, StatCardGrid, timeAgo } from "@/components/dashboard/shared/kaizen";
import { ErrorState, StatGridSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { refreshAll, useSection } from "@/components/dashboard/snagging/overview/use-section";
import { DataTable } from "@/components/data-table";
import { getWorkOrderQueueColumns } from "@/components/data-table/columns/column-finance-work-orders";
import { FinanceQueueToolbar, type FinanceQueueToolbarFilters } from "@/components/data-table/toolbars/finance-queue-toolbar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useDebounce } from "@/hooks/use-debounce";
import { QUEUE_STATUS_LABELS, type QueueStatus } from "@/lib/finance/line-status";
import type { WorkOrderList } from "@/lib/server/finance/work-orders";

import { aed } from "./shared";
import { UploadInvoiceDialog } from "./upload-invoice-dialog";

/**
 * Ready to invoice (BRD 5.1, 6.4): the summary strip, then the list with
 * its filters, one row per FSM work order read live from Zoho FSM (the
 * user's direction, 22 Oct). The last 30 days unless the dates are
 * changed, at most four months back. The row opens the work order.
 *
 * The list is cached in the browser by its URL and on the server for ten
 * minutes, so opening a work order and coming back costs nothing; Refresh
 * asks Zoho FSM again. The filters live in the URL, so Back keeps them.
 */

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "open", label: "Awaiting action" },
  { value: "all", label: "All statuses" },
  ...(Object.keys(QUEUE_STATUS_LABELS) as QueueStatus[]).map((status) => ({ value: status, label: QUEUE_STATUS_LABELS[status] })),
];

const LIST_STALE_MS = 10 * 60_000;

export function FinanceWorkOrdersPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filters: FinanceQueueToolbarFilters = useMemo(
    () => ({
      status: params.get("status") ?? "open",
      client: params.get("client") ?? "",
      coordinator: params.get("coordinator") ?? "",
      from: params.get("from") ?? "",
      to: params.get("to") ?? "",
      aged: params.get("aged") === "1",
    }),
    [params],
  );
  const page = Number(params.get("page") ?? 0) || 0;
  const pageSize = Number(params.get("pageSize") ?? 25) || 25;
  const [search, setSearch] = useState(params.get("q") ?? "");
  const debouncedSearch = useDebounce(search, 400);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  /* The URL is the state: Back from a work order lands on the same filters and page. */
  const setParams = (next: Record<string, string | number | boolean>) => {
    const merged = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      const text = typeof value === "boolean" ? (value ? "1" : "") : String(value);
      if (text === "" || text === "0" || (key === "pageSize" && text === "25") || (key === "status" && text === "open")) merged.delete(key);
      else merged.set(key, text);
    }
    router.replace(`${pathname}${merged.size ? `?${merged}` : ""}`, { scroll: false });
  };

  const query = new URLSearchParams();
  if (filters.status !== "open") query.set("status", filters.status);
  for (const key of ["client", "coordinator", "from", "to"] as const) if (filters[key]) query.set(key, filters[key]);
  if (filters.aged) query.set("aged", "1");
  if (debouncedSearch) query.set("q", debouncedSearch);
  query.set("page", String(page));
  query.set("pageSize", String(pageSize));
  const url = `/api/finance/work-orders?${query}`;
  const { data, loading, error, reload } = useSection<WorkOrderList & { can?: { invoice: boolean } }>(url, { staleMs: LIST_STALE_MS });

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

  const columns = useMemo(() => getWorkOrderQueueColumns(data?.agedAfterDays ?? 7), [data?.agedAfterDays]);
  const summary = data?.summary;
  const filtered = Boolean(filters.client || filters.coordinator || filters.from || filters.to || filters.aged || debouncedSearch);

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Finance"
        title="Ready to invoice"
        description="FSM work orders, read live from Zoho FSM, at line-item level. Mark work ready, pick it up, raise a query, or record the MAHER invoice in full or in part."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/finance/metrics">
                <BarChart3 className="size-4" />
                Invoicing metrics
              </Link>
            </Button>
            {data?.can?.invoice && data.ledgerReady ? (
              <Button onClick={() => setUploadOpen(true)}>
                <FileUp className="size-4" />
                Upload invoice
              </Button>
            ) : null}
          </div>
        }
      />

      {data ? (
        <p className="text-muted-foreground -mt-3 text-xs">
          Work orders raised {data.from} to {data.to}, read from Zoho FSM {timeAgo(data.fsm.fetchedAt)}
          {data.fsm.cached ? " (kept for ten minutes; Refresh reads again)" : ""}.
        </p>
      ) : null}

      {data && !data.ledgerReady ? (
        <Alert>
          <Info className="size-4" />
          <AlertTitle>Ready marks, workflow and invoices are off</AlertTitle>
          <AlertDescription>Apply migration 20261024100000 to mark work ready, pick it up and record MAHER invoices.</AlertDescription>
        </Alert>
      ) : null}
      {data?.clamped ? (
        <Alert>
          <Info className="size-4" />
          <AlertTitle>Shown from {data.earliest}</AlertTitle>
          <AlertDescription>Ready to invoice looks back four months at most, so earlier dates are left out.</AlertDescription>
        </Alert>
      ) : null}

      {summary ? (
        <StatCardGrid columns={5}>
          <StatCard label="Pending" value={summary.pending.count} headline={`${aed(summary.pending.value)} ready`} />
          <StatCard
            label="In progress"
            value={summary.inProgress.count + summary.queryRaised.count}
            headline={summary.queryRaised.count ? `${summary.queryRaised.count} with a query open` : aed(summary.inProgress.value)}
            tone="progress"
          />
          <StatCard label="On hold" value={summary.onHold.count} headline={aed(summary.onHold.value)} />
          <StatCard label="Excluded value" value={aed(summary.excluded.value)} headline={`${summary.excluded.count} work order(s), verified`} />
          <StatCard
            label="Average days to invoice"
            value={summary.averageDaysToInvoice === null ? "—" : summary.averageDaysToInvoice}
            headline={summary.averageDaysToInvoice === null ? "No invoices recorded yet" : `Over ${summary.invoices} invoice(s)`}
          />
        </StatCardGrid>
      ) : error ? null : (
        <StatGridSkeleton count={5} columns={5} />
      )}

      {error && !data ? <ErrorState title="Could not load Ready to invoice" message={error} onRetry={reload} retrying={loading} /> : null}

      <Card className="py-0">
        <DataTable
          data={data?.rows ?? []}
          columns={columns}
          toolbar={
            <FinanceQueueToolbar
              onSearchChange={(value) => {
                setSearch(value);
                setParams({ q: value, page: 0 });
              }}
              initialSearch={params.get("q") ?? ""}
              loading={loading || refreshing}
              pageSize={pageSize}
              onPageSizeChange={(size) => setParams({ pageSize: size, page: 0 })}
              onRefresh={() => void refresh()}
              statusOptions={STATUS_FILTERS}
              clients={data?.options.clients ?? []}
              coordinators={data?.options.coordinators ?? []}
              filters={filters}
              onFiltersChange={(next) => setParams({ ...next, page: 0 })}
              agedAfterDays={data?.agedAfterDays ?? 7}
              dateLabel="Raised"
            />
          }
          onGlobalFilterChange={() => undefined}
          onPageChange={(next) => setParams({ page: next })}
          onPageSizeChange={(size) => setParams({ pageSize: size, page: 0 })}
          pageSize={pageSize}
          currentPage={page}
          loading={loading && !data}
          rowCount={data?.total ?? 0}
          isPagination
          handleRowClick={(row) => router.push(`/finance/queue/${row.id}`)}
          emptyState={
            <EmptyState
              icon={<ReceiptText />}
              title={filtered ? "No work orders match these filters" : "Nothing awaiting action"}
              description={
                filtered
                  ? "Try clearing a filter or widening the dates (up to four months back)."
                  : "No work order raised in these dates has lines marked ready to invoice. Choose All statuses to see every work order."
              }
            />
          }
        />
      </Card>

      {uploadOpen ? (
        <UploadInvoiceDialog
          onClose={() => setUploadOpen(false)}
          onRecorded={() => {
            setUploadOpen(false);
            refreshAll();
          }}
        />
      ) : null}
    </div>
  );
}
