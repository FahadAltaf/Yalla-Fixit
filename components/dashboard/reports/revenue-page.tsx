"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleDollarSign } from "lucide-react";
import { toast } from "sonner";

import { aed } from "@/components/dashboard/finance/shared";
import { PageHeading, PillTabs, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ErrorState, StatGridSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { DataTable } from "@/components/data-table";
import {
  REVENUE_CLIENT_COLUMNS,
  REVENUE_EXPORT_COLUMNS,
  REVENUE_MONTH_COLUMNS,
  REVENUE_TECHNICIAN_COLUMNS,
  REVENUE_WORK_ORDER_COLUMNS,
  revenueExportRow,
} from "@/components/data-table/columns/column-revenue";
import { ReportToolbar, type ReportSelect } from "@/components/data-table/toolbars/report-toolbar";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useDebounce } from "@/hooks/use-debounce";
import type { RevenueReport } from "@/lib/server/reports/revenue";
import { exportFilename, exportTable, type ExportFormat } from "@/lib/snagging/export-table";
import { reportsService } from "@/modules/reports/reports-service";

import { HowItWorks, revenueHowItWorks } from "./how-it-works";
import { ReportDateRange, SavedFiltersMenu, lastThirtyDays, plural, useReportFilters } from "./shared";

/**
 * Revenue (BRD 5.2 B5; DEV-454): the value of the work completed in FSM in
 * the dates, by client, technician (split by hours, D-17) and month, with
 * the AMC mix, what is invoiced and the customers' ratings. The cards follow
 * the dates only; the filters narrow the tables.
 */

type View = RevenueReport["view"];
type Can = { can: { view: boolean; export: boolean } };

const DEFAULTS = { view: "clients", from: "", to: "", client: "", technician: "", team: "", kind: "", q: "" };

const VIEW_WORDS: Record<View, { tab: string; search: string; sheet: string; file: string }> = {
  clients: { tab: "By client", search: "Search by client…", sheet: "By client", file: "revenue-by-client" },
  technicians: { tab: "By technician", search: "Search by technician or team…", sheet: "By technician", file: "revenue-by-technician" },
  months: { tab: "By month", search: "", sheet: "By month", file: "revenue-by-month" },
  work_orders: { tab: "Work orders", search: "Search by work order, client or technician…", sheet: "Work orders", file: "revenue-work-orders" },
};

export function RevenuePage() {
  const { filters, setFilters, ready, saved, saveAs, remove, apply } = useReportFilters("revenue", DEFAULTS);
  const view: View = filters.view === "technicians" || filters.view === "months" || filters.view === "work_orders" ? filters.view : "clients";
  const debouncedQ = useDebounce(filters.q, 400);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<(RevenueReport & Can) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const query = useMemo(
    () => ({
      view,
      from: filters.from,
      to: filters.to,
      client: filters.client,
      technician: filters.technician,
      team: filters.team,
      kind: filters.kind,
      q: view === "months" ? "" : debouncedQ,
    }),
    [view, filters, debouncedQ],
  );

  const ticket = useRef(0);
  const viewLogged = useRef(false);
  const load = useCallback(async () => {
    const mine = ++ticket.current;
    setLoading(true);
    setError(null);
    try {
      const response = await reportsService.revenue(query, { page, pageSize, logView: !viewLogged.current });
      viewLogged.current = true;
      if (mine !== ticket.current) return;
      setData(response);
    } catch (e) {
      if (mine !== ticket.current) return;
      setError(e instanceof Error ? e.message : "Could not load the revenue report");
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  }, [query, page, pageSize]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  const change = (next: Record<string, string>) => {
    setFilters({ ...DEFAULTS, ...next });
    setPage(0);
  };
  /* The dates and filters carry across the tabs; a client or technician row opens its work orders. */
  const switchView = (next: View, patch: Record<string, string> = {}) => change({ ...filters, view: next, q: "", ...patch });

  const doExport = async (format: ExportFormat) => {
    setExporting(true);
    try {
      const all = await reportsService.revenue(query, { exportFormat: format });
      const words = VIEW_WORDS[all.view];
      const rows =
        all.view === "clients"
          ? all.clients.map(revenueExportRow.clients)
          : all.view === "technicians"
            ? all.technicians.map(revenueExportRow.technicians)
            : all.view === "months"
              ? all.months.map(revenueExportRow.months)
              : all.workOrders.map(revenueExportRow.work_orders);
      await exportTable({
        columns: [...REVENUE_EXPORT_COLUMNS[all.view]],
        rows,
        filename: exportFilename([words.file, all.from, all.to]),
        format,
        sheetName: words.sheet,
      });
      toast.success(`Exported ${plural(all.total, "row")}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not export");
    } finally {
      setExporting(false);
    }
  };

  const selects: ReportSelect[] = [
    { key: "client", allLabel: "All clients", options: (data?.options.clients ?? []).map((c) => ({ value: c, label: c })) },
    { key: "technician", allLabel: "All technicians", options: (data?.options.technicians ?? []).map((t) => ({ value: t.id, label: t.name })) },
    { key: "team", allLabel: "All teams", options: (data?.options.teams ?? []).map((t) => ({ value: t.id, label: t.name })) },
    {
      key: "kind",
      allLabel: "AMC and one-time",
      options: [
        { value: "amc", label: "AMC only" },
        { value: "one_time", label: "One-time only" },
      ],
    },
  ];

  const toolbar = (
    <ReportToolbar
      key={view}
      idPrefix={`revenue-${view}`}
      searchPlaceholder={VIEW_WORDS[view].search || "Search…"}
      initialSearch={filters.q}
      onSearchChange={(q) => {
        setFilters({ ...filters, q });
        setPage(0);
      }}
      loading={loading}
      pageSize={pageSize}
      onPageSizeChange={(size) => {
        setPageSize(size);
        setPage(0);
      }}
      onRefresh={() => void load()}
      filters={filters}
      onFiltersChange={change}
      selects={selects}
      clearable={["client", "technician", "team", "kind"]}
      canExport={Boolean(data?.can.export)}
      exporting={exporting}
      onExport={(format) => void doExport(format)}
    />
  );

  const tablePaging = {
    onGlobalFilterChange: () => undefined,
    onPageChange: setPage,
    onPageSizeChange: (size: number) => {
      setPageSize(size);
      setPage(0);
    },
    pageSize,
    currentPage: page,
    loading,
    rowCount: data?.total ?? 0,
    isPagination: true,
  };

  const s = data?.summary;
  const empty = (
    <EmptyState
      icon={<CircleDollarSign />}
      title="No completed work in these dates"
      description="No work order was completed in Zoho FSM in these dates with these filters. Work still in progress counts once it is marked Completed in FSM."
    />
  );
  /* What the figures leave out or estimate, in one line under the cards. */
  const notes = s
    ? [
        s.unassignedWorkOrders ? `${plural(s.unassignedWorkOrders, "work order")} (${aed(s.unassigned)}) with nobody from the technician list on them` : "",
        s.equalSplitWorkOrders ? `${plural(s.equalSplitWorkOrders, "work order")} had no hours recorded and were split equally` : "",
        s.quotationValued ? `${plural(s.quotationValued, "work order")} valued from the quotation` : "",
        s.noValueWorkOrders ? `${plural(s.noValueWorkOrders, "work order")} with no value in FSM` : "",
      ].filter(Boolean)
    : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Reports"
        title="Revenue"
        description="Completed work by client, technician and month, with the AMC mix, invoicing and ratings."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <HowItWorks content={revenueHowItWorks()} />
            <ReportDateRange
              from={filters.from || data?.from || lastThirtyDays().from}
              to={filters.to || data?.to || lastThirtyDays().to}
              onChange={(from, to) => change({ ...filters, from, to })}
            />
            <SavedFiltersMenu
              saved={saved}
              current={filters}
              onApply={(entry) => {
                apply(entry);
                setPage(0);
              }}
              onSave={saveAs}
              onRemove={remove}
            />
          </div>
        }
      />

      {error ? <ErrorState title="Could not load the revenue report" message={error} onRetry={() => void load()} retrying={loading} /> : null}

      {s ? (
        <StatCardGrid columns={4}>
          <StatCard label="Revenue" value={aed(s.revenue)} headline={`${plural(s.workOrders, "work order")} completed, before VAT`} />
          <StatCard
            label="AMC share"
            value={s.amcPercent === null ? "—" : `${s.amcPercent}%`}
            headline={`AMC ${aed(s.amc)} · One-time ${aed(s.oneTime)}`}
          />
          <StatCard
            label="Invoiced"
            value={aed(s.invoiced)}
            headline={s.invoicedPercent === null ? "Nothing completed to invoice" : `${s.invoicedPercent}% of the revenue, in Ready to invoice`}
          />
          <StatCard
            label="Customer rating"
            value={s.averageRating === null ? "—" : `${s.averageRating} / 5`}
            headline={s.ratings ? `${plural(s.ratings, "rating")} on service reports` : "No ratings given in these dates"}
          />
        </StatCardGrid>
      ) : (
        <StatGridSkeleton count={4} columns={4} />
      )}
      {notes.length ? <p className="text-muted-foreground -mt-3 text-xs">{notes.join(" · ")}.</p> : null}

      {/* The views sit right above the table they switch, as on the other reports. */}
      <PillTabs<View>
        value={view}
        onChange={(next) => switchView(next)}
        tabs={(Object.keys(VIEW_WORDS) as View[]).map((value) => ({ value, label: VIEW_WORDS[value].tab }))}
      />

      <Card className="py-0">
        {view === "clients" ? (
          <DataTable
            data={data?.clients ?? []}
            columns={REVENUE_CLIENT_COLUMNS}
            toolbar={toolbar}
            {...tablePaging}
            handleRowClick={(row) => switchView("work_orders", { client: row.name })}
            emptyState={empty}
          />
        ) : view === "technicians" ? (
          <DataTable
            data={data?.technicians ?? []}
            columns={REVENUE_TECHNICIAN_COLUMNS}
            toolbar={toolbar}
            {...tablePaging}
            handleRowClick={(row) => (row.key === "none" ? undefined : switchView("work_orders", { technician: row.key }))}
            emptyState={empty}
          />
        ) : view === "months" ? (
          <DataTable data={data?.months ?? []} columns={REVENUE_MONTH_COLUMNS} toolbar={toolbar} {...tablePaging} emptyState={empty} />
        ) : (
          <DataTable data={data?.workOrders ?? []} columns={REVENUE_WORK_ORDER_COLUMNS} toolbar={toolbar} {...tablePaging} emptyState={empty} />
        )}
      </Card>
    </div>
  );
}
