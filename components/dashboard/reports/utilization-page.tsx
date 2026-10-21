"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Gauge, TrendingUp, Users, Wrench } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import { PageHeading, PillTabs, SectionCard, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ErrorState, StatGridSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { DataTable } from "@/components/data-table";
import {
  TECHNICIAN_UTILIZATION_COLUMNS,
  TECHNICIAN_UTILIZATION_EXPORT_COLUMNS,
  UTILIZATION_APPOINTMENT_COLUMNS,
  UTILIZATION_APPOINTMENT_EXPORT_COLUMNS,
  hrs,
  pct,
  technicianUtilizationExportRow,
  utilizationAppointmentExportRow,
} from "@/components/data-table/columns/column-utilization";
import { ReportToolbar, type ReportSelect } from "@/components/data-table/toolbars/report-toolbar";
import { Card } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDebounce } from "@/hooks/use-debounce";
import { fsmRecordLink } from "@/lib/fsm-links";
import { CHARGEABILITY_LABELS, type TeamUtilization } from "@/lib/reports/utilization";
import type { UtilizationReport } from "@/lib/server/reports/planning";
import { exportFilename, exportTable, type ExportFormat } from "@/lib/snagging/export-table";
import { CHART_COLOR } from "@/lib/snagging/chart-palette";
import { reportsService } from "@/modules/reports/reports-service";

import { DataAsOf, SavedFiltersMenu, plural, useReportFilters } from "./shared";

/**
 * Technician utilization (BRD 5.2 B2; DEV-444; screen in BRD 6.4): time
 * and commercial utilization side by side, per technician and team, with
 * the trend, data completeness and the appointments underneath. Travel is
 * a column waiting for FSM trips (B-01).
 */

type View = "technicians" | "teams" | "appointments";
type Can = { can: { view: boolean; export: boolean } };

const DEFAULTS = {
  view: "technicians",
  from: "",
  to: "",
  granularity: "",
  technician: "",
  team: "",
  chargeability: "",
  missing: "",
  q: "",
};

const chartConfig = {
  time: { label: "Time utilization", color: CHART_COLOR.brand },
  commercial: { label: "Commercial utilization", color: CHART_COLOR.good },
} satisfies ChartConfig;

export function UtilizationPage() {
  const { filters, setFilters, ready, saved, saveAs, remove, apply } = useReportFilters("utilization", DEFAULTS);
  const view: View = filters.view === "teams" || filters.view === "appointments" ? filters.view : "technicians";
  const debouncedQ = useDebounce(filters.q, 400);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<(UtilizationReport & Can) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const query = useMemo(() => {
    const shared = {
      view,
      from: filters.from,
      to: filters.to,
      granularity: filters.granularity,
      technician: filters.technician,
      team: filters.team,
      q: debouncedQ,
    };
    return view === "appointments" ? { ...shared, chargeability: filters.chargeability, missing: filters.missing } : shared;
  }, [view, filters, debouncedQ]);

  const ticket = useRef(0);
  const viewLogged = useRef(false);
  const load = useCallback(async () => {
    const mine = ++ticket.current;
    setLoading(true);
    setError(null);
    try {
      const response = await reportsService.utilization(query, { page, pageSize, logView: !viewLogged.current });
      viewLogged.current = true;
      if (mine !== ticket.current) return;
      setData(response);
    } catch (e) {
      if (mine !== ticket.current) return;
      setError(e instanceof Error ? e.message : "Could not load the utilization report");
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
  /* The period and the people chosen carry across the tabs. */
  const switchView = (next: View, patch: Record<string, string> = {}) => change({ ...filters, view: next, q: "", ...patch });

  const doExport = async (format: ExportFormat) => {
    setExporting(true);
    try {
      const all = await reportsService.utilization(query, { exportFormat: format });
      if (all.view === "appointments") {
        await exportTable({
          columns: UTILIZATION_APPOINTMENT_EXPORT_COLUMNS,
          rows: all.appointments.map(utilizationAppointmentExportRow),
          filename: exportFilename(["utilization-appointments", all.from, all.to]),
          format,
          sheetName: "Appointments",
        });
      } else {
        await exportTable({
          columns: TECHNICIAN_UTILIZATION_EXPORT_COLUMNS,
          rows: all.technicians.map(technicianUtilizationExportRow),
          filename: exportFilename(["utilization", all.from, all.to]),
          format,
          sheetName: "Utilization",
        });
      }
      toast.success(`Exported ${plural(all.total, "row")}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not export");
    } finally {
      setExporting(false);
    }
  };

  const technicianOptions = (data?.options.technicians ?? []).map((t) => ({ value: t.id, label: t.name }));
  const teamOptions = (data?.options.teams ?? []).map((t) => ({ value: t.id, label: t.name }));
  const selects: ReportSelect[] = [
    { key: "technician", allLabel: "All technicians", options: technicianOptions },
    { key: "team", allLabel: "All teams", options: teamOptions },
    {
      key: "granularity",
      allLabel: "Trend: automatic",
      options: [
        { value: "day", label: "Trend: daily" },
        { value: "week", label: "Trend: weekly" },
        { value: "month", label: "Trend: monthly" },
      ],
      width: "w-full sm:w-40",
    },
    ...(view === "appointments"
      ? [
          {
            key: "chargeability",
            allLabel: "Chargeable or not",
            options: (Object.keys(CHARGEABILITY_LABELS) as Array<keyof typeof CHARGEABILITY_LABELS>).map((k) => ({
              value: k,
              label: CHARGEABILITY_LABELS[k],
            })),
          },
        ]
      : []),
  ];

  const toolbar = (
    <ReportToolbar
      key={view}
      idPrefix={`utilization-${view}`}
      searchPlaceholder={view === "appointments" ? "Search by appointment, work order, client or technician…" : "Search by technician or team…"}
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
      switches={view === "appointments" ? [{ key: "missing", label: "Missing actual times only" }] : []}
      dateLabel="Period"
      clearable={["technician", "team", "granularity", "chargeability", "missing", "from", "to"]}
      canExport={Boolean(data?.can.export) && view !== "teams"}
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

  const overall = data?.overall;
  const trend = (data?.trend ?? []).map((p) => ({ label: p.label, time: p.timePercent, commercial: p.commercialPercent }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Reports"
        title="Utilization"
        description="How busy each technician was against the hours they were available, and how much of that work could be billed."
        actions={
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
        }
      />

      <PillTabs<View>
        value={view}
        onChange={(next) => switchView(next)}
        tabs={[
          { value: "technicians", label: "By technician" },
          { value: "teams", label: "By team" },
          { value: "appointments", label: "Appointments" },
        ]}
      />

      <div className="flex flex-col gap-1">
        <DataAsOf asOf={data?.dataAsOf ?? null} resources={["appointments", "work_orders", "estimates"]} />
        {data ? <p className="text-muted-foreground text-xs">{periodLine(data)}</p> : null}
      </div>

      {error ? <ErrorState title="Could not load the utilization report" message={error} onRetry={() => void load()} retrying={loading} /> : null}

      {overall ? (
        <StatCardGrid columns={5}>
          <StatCard
            label="Time utilization"
            value={pct(overall.timePercent)}
            headline={`${hrs(overall.jobMinutes)} of ${hrs(overall.availableMinutes)} available`}
          />
          <StatCard
            label="Commercial utilization"
            value={pct(overall.commercialPercent)}
            headline={`${hrs(overall.chargeableMinutes)} chargeable`}
          />
          <StatCard
            label="Outside shift"
            value={hrs(overall.outsideShiftMinutes)}
            headline="Job time outside shift hours, not in the ratios"
          />
          <StatCard
            label="Data completeness"
            value={pct(overall.completenessPercent)}
            headline={`${overall.withActualTimes} of ${plural(overall.completed, "completed appointment")} have actual times`}
            tone={overall.completenessPercent !== null && overall.completenessPercent < 100 ? "bad" : "neutral"}
            onSelect={() => switchView("appointments", { missing: "1" })}
            selectLabel="Show appointments missing actual times"
          />
          <StatCard label="Travel" value="—" headline="Needs FSM trips, which the portal cannot read yet (B-01)" />
        </StatCardGrid>
      ) : (
        <StatGridSkeleton count={5} columns={5} />
      )}

      {data ? <Assumptions data={data} /> : null}

      {trend.length > 1 ? (
        <SectionCard
          icon={<TrendingUp />}
          title="Trend"
          description="Utilization per period, over the summed hours of the technicians shown."
        >
          <ChartContainer config={chartConfig} className="h-56 w-full">
            <LineChart data={trend} margin={{ left: -12, right: 12, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
              <YAxis tickLine={false} axisLine={false} width={40} unit="%" domain={[0, (max: number) => Math.max(100, Math.ceil(max / 10) * 10)]} />
              <ChartTooltip content={<ChartTooltipContent labelKey="label" formatter={(value, name) => <TooltipRow name={String(name)} value={value} />} />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Line dataKey="time" type="monotone" stroke="var(--color-time)" strokeWidth={2} dot={trend.length <= 12} connectNulls />
              <Line dataKey="commercial" type="monotone" stroke="var(--color-commercial)" strokeWidth={2} dot={trend.length <= 12} connectNulls />
            </LineChart>
          </ChartContainer>
        </SectionCard>
      ) : null}

      {view === "teams" ? (
        <Card className="gap-0 py-0">
          {toolbar}
          <div className="border-t">
            <TeamTable rows={data?.teams ?? []} onSelect={(team) => switchView("technicians", { team: team.key })} />
          </div>
        </Card>
      ) : view === "technicians" ? (
        <Card className="py-0">
          <DataTable
            data={data?.technicians ?? []}
            columns={TECHNICIAN_UTILIZATION_COLUMNS}
            toolbar={toolbar}
            {...tablePaging}
            handleRowClick={(row) => switchView("appointments", { technician: row.fsmId })}
            emptyState={
              <EmptyState
                icon={<Gauge />}
                title="No technicians in this period"
                description="Nobody had available hours or worked in these dates with these filters."
              />
            }
          />
        </Card>
      ) : (
        <Card className="py-0">
          <DataTable
            data={data?.appointments ?? []}
            columns={UTILIZATION_APPOINTMENT_COLUMNS}
            toolbar={toolbar}
            {...tablePaging}
            handleRowClick={(row) => {
              const link = fsmRecordLink("Service_Appointments", row.id);
              if (link) window.open(link, "_blank", "noopener,noreferrer");
            }}
            emptyState={
              <EmptyState
                icon={<Wrench />}
                title="No appointments"
                description="No completed appointments in this period match these filters."
              />
            }
          />
        </Card>
      )}
    </div>
  );
}

function TooltipRow({ name, value }: { name: string; value: unknown }) {
  const key = name as keyof typeof chartConfig;
  return (
    <div className="flex w-full items-center gap-2">
      <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: `var(--color-${key})` }} />
      <span className="text-muted-foreground">{chartConfig[key]?.label ?? name}</span>
      <span className="text-foreground ml-auto font-mono font-medium tabular-nums">{value === null || value === undefined ? "—" : `${value}%`}</span>
    </div>
  );
}

function periodLine(data: UtilizationReport) {
  const trend = { day: "daily", week: "weekly", month: "monthly" }[data.granularity];
  return `${data.from} to ${data.to}, ${plural(data.overall.technicians, "technician")}, ${trend} trend.`;
}

/** What the figures rest on, said plainly, so nobody reads a gap in the data as idle time. */
function Assumptions({ data }: { data: UtilizationReport }) {
  const n = data.notes;
  const lines: string[] = [
    "Chargeable: the quotation's total is above zero or, with no quotation, the work order has a value (to confirm, D-08). AMC and in-contract work cannot be told apart in FSM yet (D-14).",
    `Available hours: shift times from Settings, ${n.unpaidBreakMinutes ? `less a ${n.unpaidBreakMinutes}-minute break` : "no unpaid break set (D-22)"}, ${plural(
      n.holidays,
      "public holiday",
    )} and ${plural(n.leaveRecords, "leave record")} in the period.`,
  ];
  if (n.noRestDays) lines.push(`${plural(n.noRestDays, "technician")} with no rest days set: every day counts as a working day for them (D-16).`);
  if (n.crewsUnknown) lines.push(`${plural(n.crewsUnknown, "appointment")} whose crew FSM has not been read for yet count for the lead technician only.`);
  if (n.inactiveWithoutLeavingDate) lines.push(`${plural(n.inactiveWithoutLeavingDate, "inactive technician")} without a leaving date, included because they worked in the period.`);
  if (data.jobMinutesBy.no_value > 0) lines.push(`${hrs(data.jobMinutesBy.no_value)} of job time is on work with no value in FSM, so counts for time only.`);
  return (
    <ul className="text-muted-foreground -mt-2 flex list-disc flex-col gap-0.5 pl-4 text-xs">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

function TeamTable({ rows, onSelect }: { rows: TeamUtilization[]; onSelect: (team: TeamUtilization) => void }) {
  if (!rows.length) {
    return <EmptyState icon={<Users />} title="No teams in this period" description="Nobody had available hours or worked in these dates." className="py-10" />;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-5">Team</TableHead>
          <TableHead className="text-right">Technicians</TableHead>
          <TableHead className="text-right">Available</TableHead>
          <TableHead className="text-right">Job hours</TableHead>
          <TableHead className="text-right">Time %</TableHead>
          <TableHead className="text-right">Chargeable</TableHead>
          <TableHead className="text-right">Commercial %</TableHead>
          <TableHead className="text-right">Outside shift</TableHead>
          <TableHead className="pr-5 text-right">Data complete</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key} className="cursor-pointer" onClick={() => onSelect(row)}>
            <TableCell className="pl-5 font-medium">{row.name}</TableCell>
            <TableCell className="text-right tabular-nums">{row.technicians}</TableCell>
            <TableCell className="text-right tabular-nums">{hrs(row.availableMinutes)}</TableCell>
            <TableCell className="text-right tabular-nums">{hrs(row.jobMinutes)}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">{pct(row.timePercent)}</TableCell>
            <TableCell className="text-right tabular-nums">{hrs(row.chargeableMinutes)}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">{pct(row.commercialPercent)}</TableCell>
            <TableCell className="text-right tabular-nums">{row.outsideShiftMinutes ? hrs(row.outsideShiftMinutes) : "—"}</TableCell>
            <TableCell className="pr-5 text-right tabular-nums">{pct(row.completenessPercent)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
