"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { toast } from "sonner";

import { aed } from "@/components/dashboard/finance/shared";
import { PageHeading, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ErrorState, StatGridSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { DataTable } from "@/components/data-table";
import { QUOTATION_COLUMNS, QUOTATION_EXPORT_COLUMNS, quotationExportRow } from "@/components/data-table/columns/column-reports";
import { ReportToolbar } from "@/components/data-table/toolbars/report-toolbar";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useDebounce } from "@/hooks/use-debounce";
import { fsmRecordLink } from "@/lib/fsm-links";
import { VALUE_BANDS } from "@/lib/reports/quotations";
import type { QuotationReport } from "@/lib/server/reports/reports";
import { exportFilename, exportTable, type ExportFormat } from "@/lib/snagging/export-table";
import { reportsService } from "@/modules/reports/reports-service";

import { DataAsOf, SavedFiltersMenu, plural, useReportFilters } from "./shared";

/**
 * The quotation summary (BRD 5.2 B1; DEV-442). Per status: how many, how
 * much, how long they sit. A status card filters the list to it; a row
 * opens the quotation in FSM when the FSM link is configured. Quotations
 * past their status's limit (N7) and close to the end of their validity
 * (N8) are flagged.
 */

const DEFAULTS = { status: "open", owner: "", client: "", band: "", flag: "", from: "", to: "", q: "" };

const FLAG_OPTIONS = [
  { value: "breached", label: "Past their limit" },
  { value: "expiring", label: "Expiring soon" },
  { value: "past_validity", label: "Validity ended, no answer" },
];

export function QuotationSummaryPage() {
  const { filters, setFilters, ready, saved, saveAs, remove, apply } = useReportFilters("quotations", DEFAULTS);
  const debouncedQ = useDebounce(filters.q, 400);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<(QuotationReport & { can: { view: boolean; export: boolean } }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const query = useMemo(() => ({ ...filters, q: debouncedQ }), [filters, debouncedQ]);

  /* Only the latest request fills the page; the first one logs the visit. */
  const ticket = useRef(0);
  const viewLogged = useRef(false);
  const load = useCallback(async () => {
    const mine = ++ticket.current;
    setLoading(true);
    setError(null);
    try {
      const response = await reportsService.quotations(query, { page, pageSize, logView: !viewLogged.current });
      viewLogged.current = true;
      if (mine !== ticket.current) return;
      setData(response);
    } catch (e) {
      if (mine !== ticket.current) return;
      setError(e instanceof Error ? e.message : "Could not load the quotation summary");
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

  const doExport = async (format: ExportFormat) => {
    setExporting(true);
    try {
      const all = await reportsService.quotations(query, { exportFormat: format });
      await exportTable({
        columns: QUOTATION_EXPORT_COLUMNS,
        rows: all.rows.map(quotationExportRow),
        filename: exportFilename(["quotation-summary", all.today]),
        format,
        sheetName: "Quotations",
      });
      toast.success(`Exported ${plural(all.rows.length, "quotation")}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not export");
    } finally {
      setExporting(false);
    }
  };

  const statusOptions = useMemo(
    () => [
      { value: "open", label: "Awaiting action" },
      { value: "all", label: "All statuses" },
      ...(data?.summary ?? []).map((s) => ({ value: s.key, label: s.label })),
    ],
    [data?.summary],
  );
  const filtered = Boolean(filters.owner || filters.client || filters.band || filters.flag || filters.from || filters.to || debouncedQ);
  const statusFilter = filters.status === "all" ? "" : filters.status;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Reports"
        title="Quotation summary"
        description="The quotation pipeline from FSM: what is waiting in each status, for how long, and what is about to lapse. Values are before VAT."
        actions={<SavedFiltersMenu saved={saved} current={filters} onApply={(entry) => { apply(entry); setPage(0); }} onSave={saveAs} onRemove={remove} />}
      />
      <DataAsOf asOf={data?.dataAsOf ?? null} resources={["estimates"]} />

      {data ? (
        <StatCardGrid columns={4}>
          {data.summary
            .filter((s) => s.count > 0 || !s.key.startsWith("other:"))
            .map((s) => (
              <StatCard
                key={s.key}
                label={s.label}
                value={s.count}
                headline={
                  !s.count
                    ? "None"
                    : [aed(s.value), s.averageDays === null ? null : `avg ${s.averageDays} days`, s.breached ? `${s.breached} over ${s.ageingLimit}` : null]
                        .filter(Boolean)
                        .join(" · ")
                }
                tone={s.breached ? "bad" : filters.status === s.key ? "review" : "neutral"}
                onSelect={() => change({ ...filters, status: filters.status === s.key ? "open" : s.key })}
                selectLabel={`Show ${s.label} quotations`}
              />
            ))}
        </StatCardGrid>
      ) : (
        <StatGridSkeleton count={8} columns={4} />
      )}

      {data && (data.totals.breached || data.totals.expiring) ? (
        <p className="text-sm">
          {data.totals.breached ? (
            <button type="button" className="text-destructive font-medium hover:underline" onClick={() => change({ ...filters, flag: "breached" })}>
              {plural(data.totals.breached, "quotation")} past the limit for their status
            </button>
          ) : null}
          {data.totals.breached && data.totals.expiring ? <span className="text-muted-foreground"> · </span> : null}
          {data.totals.expiring ? (
            <button type="button" className="text-warning font-medium hover:underline" onClick={() => change({ ...filters, flag: "expiring" })}>
              {plural(data.totals.expiring, "quotation")} expiring within {data.expiryWarningDays} days
            </button>
          ) : null}
          {data.totals.estimated ? (
            <span className="text-muted-foreground"> · ≈ marks days estimated from the last change, for quotations already in their status when the portal first read them</span>
          ) : null}
        </p>
      ) : null}

      {error ? <ErrorState title="Could not load the quotation summary" message={error} onRetry={() => void load()} retrying={loading} /> : null}

      <Card className="py-0">
        <DataTable
          data={data?.rows ?? []}
          columns={QUOTATION_COLUMNS}
          toolbar={
            <ReportToolbar
              idPrefix="quotations"
              searchPlaceholder="Search by quotation, client or owner…"
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
              filters={{ ...filters, status: filters.status || "open" }}
              onFiltersChange={change}
              selects={[
                { key: "status", allLabel: "Status", options: statusOptions, required: true },
                { key: "owner", allLabel: "All owners", options: (data?.options.owners ?? []).map((o) => ({ value: o, label: o })) },
                { key: "client", allLabel: "All clients", options: (data?.options.clients ?? []).map((c) => ({ value: c, label: c })) },
                { key: "band", allLabel: "Any value", options: VALUE_BANDS.map((b) => ({ value: b.key, label: b.label })), width: "w-full sm:w-52" },
                { key: "flag", allLabel: "Any flag", options: FLAG_OPTIONS },
              ]}
              dateLabel="Created"
              clearable={["owner", "client", "band", "flag", "from", "to"]}
              canExport={Boolean(data?.can.export)}
              exporting={exporting}
              onExport={(format) => void doExport(format)}
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
          rowCount={data?.total ?? 0}
          isPagination
          handleRowClick={(row) => {
            const link = fsmRecordLink("Estimates", row.id);
            if (link) window.open(link, "_blank", "noopener,noreferrer");
          }}
          emptyState={
            <EmptyState
              icon={<FileText />}
              title={filtered || statusFilter ? "No quotations match these filters" : "No quotations yet"}
              description={
                filtered || statusFilter
                  ? "Clear a filter, or choose All statuses, to see more."
                  : "Quotations appear here once the FSM sync has copied them."
              }
            />
          }
        />
      </Card>
    </div>
  );
}
