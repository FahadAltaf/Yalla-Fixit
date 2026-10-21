"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BarChart3, ReceiptText } from "lucide-react";

import { getFinanceQueueColumns } from "@/components/data-table/columns/column-finance-queue";
import {
  FinanceQueueToolbar,
  type FinanceQueueToolbarFilters,
} from "@/components/data-table/toolbars/finance-queue-toolbar";
import { DataTable } from "@/components/data-table";
import { PageHeading, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ErrorState, StatGridSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useDebounce } from "@/hooks/use-debounce";
import type { QueueSummary } from "@/lib/finance/metrics";
import type { QueueStatus } from "@/lib/server/finance/queue";
import type { QueueRow } from "@/lib/server/finance/queue-read";
import { financeService } from "@/modules/finance/finance-service";

import { QUEUE_STATUS_LABELS, aed } from "./shared";

/**
 * The Ready-to-Invoice queue (BRD §6.4; DEV-435): the summary strip, then
 * the list with its filters. Everything is filtered and paged on the
 * server; the row opens the item.
 */

const OPEN: QueueStatus[] = ["pending", "in_progress", "query_raised", "on_hold"];
const STATUS_FILTERS: { value: string; label: string; statuses: QueueStatus[] }[] = [
  { value: "open", label: "Awaiting action", statuses: OPEN },
  { value: "all", label: "All statuses", statuses: [] },
  ...(Object.keys(QUEUE_STATUS_LABELS) as QueueStatus[]).map((status) => ({
    value: status,
    label: QUEUE_STATUS_LABELS[status],
    statuses: [status],
  })),
];

const EMPTY_FILTERS: FinanceQueueToolbarFilters = { status: "open", client: "", coordinator: "", from: "", to: "", aged: false };

export function FinanceQueuePage() {
  const router = useRouter();
  const [filters, setFilters] = useState<FinanceQueueToolbarFilters>(EMPTY_FILTERS);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 400);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<QueueSummary | null>(null);
  const [options, setOptions] = useState<{ clients: string[]; coordinators: string[] }>({ clients: [], coordinators: [] });
  const [agedAfterDays, setAgedAfterDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const statuses = useMemo(
    () => STATUS_FILTERS.find((f) => f.value === filters.status)?.statuses ?? OPEN,
    [filters.status],
  );

  /* Only the latest request fills the table. */
  const ticket = useRef(0);
  const load = useCallback(async () => {
    const mine = ++ticket.current;
    setLoading(true);
    setError(null);
    try {
      const response = await financeService.listQueue({
        statuses,
        client: filters.client || undefined,
        coordinator: filters.coordinator || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
        aged: filters.aged,
        q: debouncedSearch || undefined,
        page,
        pageSize,
      });
      if (mine !== ticket.current) return;
      setRows(response.rows);
      setTotal(response.total);
      setSummary(response.summary);
      setOptions(response.options);
      setAgedAfterDays(response.agedAfterDays);
    } catch (e) {
      if (mine !== ticket.current) return;
      setError(e instanceof Error ? e.message : "Could not load the queue");
      setRows([]);
      setTotal(0);
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  }, [statuses, filters, debouncedSearch, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns = useMemo(() => getFinanceQueueColumns(agedAfterDays), [agedAfterDays]);
  const filtered = Boolean(filters.client || filters.coordinator || filters.from || filters.to || filters.aged || debouncedSearch);

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Finance"
        title="Ready to invoice"
        description="Completed, commercially ready work at line-item level. Pick an item up, raise a query, or record the MAHER invoice."
        actions={
          <Button asChild variant="outline">
            <Link href="/finance/metrics">
              <BarChart3 className="size-4" />
              Invoicing metrics
            </Link>
          </Button>
        }
      />

      {summary ? (
        <StatCardGrid columns={5}>
          <StatCard label="Pending" value={summary.pending.count} headline={aed(summary.pending.value)} />
          <StatCard
            label="In progress"
            value={summary.inProgress.count + summary.queryRaised.count}
            headline={summary.queryRaised.count ? `${summary.queryRaised.count} with a query open` : aed(summary.inProgress.value)}
            tone="progress"
          />
          <StatCard label="On hold" value={summary.onHold.count} headline={aed(summary.onHold.value)} />
          <StatCard label="Excluded value" value={aed(summary.excluded.value)} headline={`${summary.excluded.count} item(s), verified`} />
          <StatCard
            label="Average days to invoice"
            value={summary.averageDaysToInvoice === null ? "—" : summary.averageDaysToInvoice}
            headline={summary.averageDaysToInvoice === null ? "No invoices recorded yet" : `Over ${summary.invoiced.count} invoice(s)`}
          />
        </StatCardGrid>
      ) : (
        <StatGridSkeleton count={5} columns={5} />
      )}

      {error ? <ErrorState title="Could not load the queue" message={error} onRetry={() => void load()} retrying={loading} /> : null}

      <Card className="py-0">
        <DataTable
          data={rows}
          columns={columns}
          toolbar={
            <FinanceQueueToolbar
              onSearchChange={(value) => {
                setSearch(value);
                setPage(0);
              }}
              loading={loading}
              pageSize={pageSize}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(0);
              }}
              onRefresh={() => void load()}
              statusOptions={STATUS_FILTERS.map(({ value, label }) => ({ value, label }))}
              clients={options.clients}
              coordinators={options.coordinators}
              filters={filters}
              onFiltersChange={(next) => {
                setFilters(next);
                setPage(0);
              }}
              agedAfterDays={agedAfterDays}
            />
          }
          onGlobalFilterChange={() => undefined}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
          pageSize={pageSize}
          currentPage={page}
          loading={loading}
          rowCount={total}
          isPagination
          handleRowClick={(row) => router.push(`/finance/queue/${row.id}`)}
          emptyState={
            <EmptyState
              icon={<ReceiptText />}
              title={filtered ? "Nothing matches these filters" : "Nothing waiting to be invoiced"}
              description={
                filtered
                  ? "Clear a filter or search to see more."
                  : "Items appear here when a job is completed in FSM and marked Ready to be Invoiced."
              }
            />
          }
        />
      </Card>
    </div>
  );
}
