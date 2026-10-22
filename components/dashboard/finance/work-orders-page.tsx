"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ClipboardList, FileUp, Info } from "lucide-react";
import { toast } from "sonner";

import { DataAsOf, plural } from "@/components/dashboard/reports/shared";
import { PageHeading, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { StatGridSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { InlineError } from "@/components/dashboard/snagging/overview/section-shell";
import { refreshAll, useSection } from "@/components/dashboard/snagging/overview/use-section";
import { DataTable } from "@/components/data-table";
import { FINANCE_WORK_ORDER_COLUMNS } from "@/components/data-table/columns/column-finance-work-orders";
import { ReportToolbar, type ReportSelect } from "@/components/data-table/toolbars/report-toolbar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useDebounce } from "@/hooks/use-debounce";
import { INVOICE_STATUS_LABELS, type InvoiceStatus } from "@/lib/finance/line-status";
import type { WorkOrderList } from "@/lib/server/finance/work-orders";
import { financeService } from "@/modules/finance/finance-service";

import { aed } from "./shared";
import { UploadInvoiceDialog } from "./upload-invoice-dialog";

/**
 * Invoicing → Work orders: every work order raised in the chosen dates
 * (the last 30 days unless changed, never more than four months back),
 * from the portal's copy of FSM.
 *
 * Loading costs no FSM calls and is cached by its URL, so opening a work
 * order and coming back is instant; the filters live in the URL so Back
 * returns to the same list. Refresh reads what changed in FSM (headers
 * only) and then reloads. A work order's lines are read when it is opened.
 */

const FILTER_KEYS = ["from", "to", "q", "client", "status", "invoice"] as const;
const LIST_STALE_MS = 10 * 60_000;

export function FinanceWorkOrdersPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filters = useMemo(
    () => Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) ?? ""])) as Record<(typeof FILTER_KEYS)[number], string>,
    [params],
  );
  const page = Number(params.get("page") ?? 0) || 0;
  const pageSize = Number(params.get("pageSize") ?? 25) || 25;
  const [search, setSearch] = useState(filters.q);
  const debouncedSearch = useDebounce(search, 400);
  const [refreshing, setRefreshing] = useState(false);

  /* The URL is the state: Back from a work order lands on the same filters and page. */
  const setParams = (next: Record<string, string | number>) => {
    const merged = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === "" || value === 0 || (key === "pageSize" && value === 25)) merged.delete(key);
      else merged.set(key, String(value));
    }
    router.replace(`${pathname}${merged.size ? `?${merged}` : ""}`, { scroll: false });
  };

  const query = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = key === "q" ? debouncedSearch : filters[key];
    if (value) query.set(key, value);
  }
  query.set("page", String(page));
  query.set("pageSize", String(pageSize));
  const { data, loading, error, reload } = useSection<WorkOrderList & { can?: { invoice: boolean } }>(`/api/finance/work-orders?${query}`, {
    staleMs: LIST_STALE_MS,
  });
  const [uploadOpen, setUploadOpen] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const result = await financeService.refreshWorkOrders();
      toast.success(
        result.skipped
          ? "Already up to date (synced in the last minute)"
          : `Synced from Zoho FSM: ${plural(result.written, "change")} in ${plural(result.calls, "call")}`,
      );
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Zoho FSM could not be read");
    } finally {
      setRefreshing(false);
    }
  };

  const selects: ReportSelect[] = [
    { key: "client", allLabel: "All clients", options: (data?.options.clients ?? []).map((c) => ({ value: c, label: c })) },
    { key: "status", allLabel: "All FSM statuses", options: (data?.options.statuses ?? []).map((s) => ({ value: s, label: s })), width: "w-full sm:w-48" },
    {
      key: "invoice",
      allLabel: "Any invoicing",
      options: (Object.keys(INVOICE_STATUS_LABELS) as InvoiceStatus[]).map((s) => ({ value: s, label: INVOICE_STATUS_LABELS[s] })),
      width: "w-full sm:w-44",
    },
  ];

  const asOf = data ? Object.fromEntries(data.freshness.map((f) => [f.resource, f.lastSuccessAt])) : null;
  const summary = data?.summary;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Finance"
        title="Work orders"
        description="Work orders from Zoho FSM with their quotation and line items: the work to be invoiced. The last 30 days unless you change the dates; up to four months back."
        actions={
          data?.can?.invoice && data.ledgerReady ? (
            <Button onClick={() => setUploadOpen(true)}>
              <FileUp className="size-4" />
              Upload invoice
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-1">
        <DataAsOf asOf={asOf} resources={["work_orders", "estimates", "appointments"]} />
        {data ? (
          <p className="text-muted-foreground text-xs">
            Raised {data.from} to {data.to}. Refresh reads what changed in FSM; a work order&apos;s line items are read when you open it.
          </p>
        ) : null}
      </div>

      {data && !data.ledgerReady ? (
        <Alert>
          <Info className="size-4" />
          <AlertTitle>Ready marks and invoices are off</AlertTitle>
          <AlertDescription>Apply migration 20261024100000 (the line ledger) to mark work Ready to invoice and record MAHER invoices.</AlertDescription>
        </Alert>
      ) : null}

      {data?.clamped ? (
        <Alert>
          <Info className="size-4" />
          <AlertTitle>Shown from {data.earliest}</AlertTitle>
          <AlertDescription>Invoicing looks back four months at most, so earlier dates are left out.</AlertDescription>
        </Alert>
      ) : null}

      {error && !data ? (
        <InlineError message={error} onRetry={reload} />
      ) : summary ? (
        <StatCardGrid columns={5}>
          <StatCard
            label="Work orders"
            value={summary.workOrders.toLocaleString("en-US")}
            headline={`${summary.withQuotation} with a quotation · ${summary.completed} completed in FSM`}
            caption={`Raised ${data!.from} to ${data!.to}`}
          />
          <StatCard label="Value" value={aed(summary.value)} headline="Before VAT, as totalled in FSM" caption={`Line items read for ${summary.linesRead} of ${summary.workOrders}`} />
          <StatCard
            label="Ready to invoice"
            value={aed(summary.readyValue)}
            headline={plural(summary.byStatus.ready, "work order") + " ready"}
            caption="Ready lines not invoiced yet, before VAT"
            tone={summary.readyValue > 0 ? "progress" : "neutral"}
            onSelect={() => setParams({ invoice: "ready", page: 0 })}
            selectLabel="Show work orders ready to invoice"
          />
          <StatCard
            label="Partially invoiced"
            value={summary.byStatus.partially_invoiced}
            headline="Some of the work invoiced, the rest to follow"
            onSelect={() => setParams({ invoice: "partially_invoiced", page: 0 })}
            selectLabel="Show partially invoiced work orders"
          />
          <StatCard
            label="Invoiced"
            value={aed(summary.invoicedValue)}
            headline={plural(summary.byStatus.invoiced, "work order") + " fully invoiced"}
            caption="On MAHER invoices recorded here"
            tone={summary.invoicedValue > 0 ? "good" : "neutral"}
            onSelect={() => setParams({ invoice: "invoiced", page: 0 })}
            selectLabel="Show invoiced work orders"
          />
        </StatCardGrid>
      ) : (
        <StatGridSkeleton count={5} columns={5} />
      )}

      <Card className="py-0">
        <DataTable
          data={data?.rows ?? []}
          columns={FINANCE_WORK_ORDER_COLUMNS}
          toolbar={
            <ReportToolbar
              idPrefix="finance-work-orders"
              searchPlaceholder="Search by work order, client or contact…"
              initialSearch={filters.q}
              onSearchChange={(q) => {
                setSearch(q);
                setParams({ q, page: 0 });
              }}
              loading={loading || refreshing}
              pageSize={pageSize}
              onPageSizeChange={(size) => setParams({ pageSize: size, page: 0 })}
              onRefresh={() => void refresh()}
              filters={filters}
              onFiltersChange={(next) => setParams({ ...Object.fromEntries(FILTER_KEYS.map((k) => [k, next[k] ?? ""])), page: 0 })}
              selects={selects}
              dateLabel="Raised"
              clearable={["client", "status", "invoice", "from", "to"]}
              canExport={false}
              exporting={false}
              onExport={() => undefined}
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
          handleRowClick={(row) => router.push(`/finance/work-orders/${row.id}`)}
          emptyState={
            <EmptyState
              icon={<ClipboardList />}
              title="No work orders"
              description="None were raised in these dates with these filters. Widen the dates (up to four months back) or press Refresh to read what changed in FSM."
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
