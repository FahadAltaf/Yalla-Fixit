"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarRange, Wrench, XIcon } from "lucide-react";
import { toast } from "sonner";

import { PageHeading, PillTabs, SectionCard, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ErrorState, StatGridSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { DataTable } from "@/components/data-table";
import { BOOKING_COLUMNS, CAPACITY_EXPORT_COLUMNS, capacityExportRows, hrs } from "@/components/data-table/columns/column-utilization";
import { ReportToolbar } from "@/components/data-table/toolbars/report-toolbar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDebounce } from "@/hooks/use-debounce";
import { fsmRecordLink } from "@/lib/fsm-links";
import { isoWeekday } from "@/lib/reports/available-hours";
import type { CapacityCell, CapacityRow, CellStatus } from "@/lib/reports/capacity";
import type { CapacityReport } from "@/lib/server/reports/planning";
import { exportFilename, exportTable, type ExportFormat } from "@/lib/snagging/export-table";
import { cn } from "@/lib/utils";
import { reportsService } from "@/modules/reports/reports-service";

import { DataAsOf, SavedFiltersMenu, plural, useReportFilters } from "./shared";

/**
 * Forward capacity (BRD 5.2 B5; DEV-452): booked against available hours
 * by day and team for the horizon, over-booked and spare days highlighted,
 * unassigned hours apart. A cell opens that team's or technician's
 * bookings for the day, below the board.
 */

type Board = "teams" | "technicians";
type Can = { can: { view: boolean; export: boolean } };

const ALL = "__all__";
const DEFAULTS = { from: "", days: "", team: "", technician: "", day: "", q: "" };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (date: string) => ({
  weekday: WEEKDAYS[isoWeekday(date) - 1],
  date: `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`,
});
const shortHours = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10}`;

const CELL_STYLES: Record<CellStatus, string> = {
  over: "bg-destructive/10 text-destructive font-medium",
  spare: "bg-warning/10 text-warning",
  ok: "bg-success/10 text-success",
  off: "text-muted-foreground/60",
};
const CELL_TITLES: Record<CellStatus, string> = {
  over: "Over-booked",
  spare: "Spare",
  ok: "Booked",
  off: "Not working",
};
const DAY_STATUS_LABELS: Record<string, string> = { holiday: "public holiday", rest_day: "rest day", left: "after leaving" };

export function CapacityPage() {
  const { filters, setFilters, ready, saved, saveAs, remove, apply } = useReportFilters("capacity", DEFAULTS);
  const debouncedQ = useDebounce(filters.q, 400);
  const [board, setBoard] = useState<Board>("teams");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<(CapacityReport & Can) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const query = useMemo(() => ({ ...filters, q: debouncedQ }), [filters, debouncedQ]);

  const ticket = useRef(0);
  const viewLogged = useRef(false);
  const load = useCallback(async () => {
    const mine = ++ticket.current;
    setLoading(true);
    setError(null);
    try {
      const response = await reportsService.capacity(query, { page, pageSize, logView: !viewLogged.current });
      viewLogged.current = true;
      if (mine !== ticket.current) return;
      setData(response);
    } catch (e) {
      if (mine !== ticket.current) return;
      setError(e instanceof Error ? e.message : "Could not load the capacity report");
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

  /* A cell narrows the bookings to that row and day; the same cell again clears it. */
  const pickCell = (row: CapacityRow, cell: CapacityCell) => {
    const isTeam = board === "teams";
    const same = filters.day === cell.date && (isTeam ? filters.team === row.key && !filters.technician : filters.technician === row.key);
    if (same) change({ ...filters, day: "", technician: "" });
    else change({ ...filters, day: cell.date, ...(isTeam ? { team: row.key, technician: "" } : { technician: row.key }) });
  };

  const doExport = async (format: ExportFormat) => {
    setExporting(true);
    try {
      const all = await reportsService.capacity(query, { exportFormat: format });
      const rows = [...capacityExportRows("Team", all.teams), ...capacityExportRows("Technician", all.technicians)];
      await exportTable({
        columns: CAPACITY_EXPORT_COLUMNS,
        rows,
        filename: exportFilename(["capacity", all.from, all.to]),
        format,
        sheetName: "Capacity",
      });
      toast.success(`Exported ${plural(rows.length, "row")}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not export");
    } finally {
      setExporting(false);
    }
  };

  const totals = data?.totals;
  const bookedShare = totals && totals.availableMinutes > 0 ? Math.round((totals.bookedMinutes / totals.availableMinutes) * 1000) / 10 : null;
  const rows = board === "teams" ? (data?.teams ?? []) : (data?.technicians ?? []);
  const selectedName =
    (filters.technician && data?.options.technicians.find((t) => t.id === filters.technician)?.name) ||
    (filters.team && data?.options.teams.find((t) => t.id === filters.team)?.name) ||
    null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Reports"
        title="Capacity"
        description="Booked against available hours for the days ahead, by team and technician, so over-booked and spare days show before they arrive."
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

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="capacity-from" className="text-muted-foreground text-xs">
            From
          </Label>
          <Input
            id="capacity-from"
            type="date"
            className="w-40"
            value={filters.from || data?.from || ""}
            onChange={(e) => change({ ...filters, from: e.target.value, day: "" })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-muted-foreground text-xs">Days</Label>
          <Select value={filters.days || ALL} onValueChange={(v) => change({ ...filters, days: v === ALL ? "" : v, day: "" })}>
            <SelectTrigger className="w-44" aria-label="Days shown">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Horizon{data ? ` (${data.horizonDays} days)` : ""}</SelectItem>
              {["7", "14", "28", "56"].map((d) => (
                <SelectItem key={d} value={d}>
                  {d} days
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-muted-foreground text-xs">Team</Label>
          <Select value={filters.team || ALL} onValueChange={(v) => change({ ...filters, team: v === ALL ? "" : v, technician: "", day: "" })}>
            <SelectTrigger className="w-56" aria-label="Team">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All teams</SelectItem>
              {(data?.options.teams ?? []).map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {filters.from || filters.days || filters.team ? (
          <Button variant="ghost" size="sm" onClick={() => change({ ...DEFAULTS })}>
            <XIcon className="size-4" />
            Reset
          </Button>
        ) : null}
      </div>

      <DataAsOf asOf={data?.dataAsOf ?? null} resources={["appointments"]} />

      {error ? <ErrorState title="Could not load the capacity report" message={error} onRetry={() => void load()} retrying={loading} /> : null}

      {totals && data ? (
        <StatCardGrid columns={4}>
          <StatCard
            label="Booked"
            value={bookedShare === null ? "—" : `${bookedShare}%`}
            headline={`${hrs(totals.bookedMinutes)} of ${hrs(totals.availableMinutes)} available`}
          />
          <StatCard
            label="Over-booked team days"
            value={totals.overTeamDays}
            headline={`${plural(totals.overTechnicianDays, "technician day")} over-booked`}
            tone={totals.overTeamDays ? "bad" : "good"}
          />
          <StatCard label="Spare team days" value={totals.spareTeamDays} headline={`Booked below ${data.spareBelowPercent}% of available`} />
          <StatCard
            label="Unassigned"
            value={hrs(totals.unassignedMinutes)}
            headline="Scheduled with no technician, not in any team"
            tone={totals.unassignedMinutes ? "bad" : "neutral"}
          />
        </StatCardGrid>
      ) : (
        <StatGridSkeleton count={4} columns={4} />
      )}

      {data ? <CapacityNotes data={data} /> : null}

      <SectionCard
        icon={<CalendarRange />}
        title={data ? `${data.from} to ${data.to}` : "Board"}
        description="Booked / available hours. Click a cell to see its bookings."
        action={
          <PillTabs<Board>
            value={board}
            onChange={setBoard}
            tabs={[
              { value: "teams", label: "Teams" },
              { value: "technicians", label: "Technicians" },
            ]}
          />
        }
        bodyClassName="border-t"
      >
        {data ? (
          <BoardTable data={data} rows={rows} board={board} filters={filters} onPick={pickCell} />
        ) : (
          <div className="text-muted-foreground p-6 text-sm">{loading ? "Loading…" : null}</div>
        )}
      </SectionCard>

      <Card className="py-0">
        <DataTable
          data={data?.bookings ?? []}
          columns={BOOKING_COLUMNS}
          toolbar={
            <div>
              <ReportToolbar
                idPrefix="capacity-bookings"
                searchPlaceholder="Search by appointment, work order, client or technician…"
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
                selects={[
                  {
                    key: "technician",
                    allLabel: "All technicians",
                    options: (data?.options.technicians ?? []).map((t) => ({ value: t.id, label: t.name })),
                  },
                ]}
                clearable={["technician", "day"]}
                canExport={Boolean(data?.can.export)}
                exporting={exporting}
                onExport={(format) => void doExport(format)}
              />
              <p className="text-muted-foreground px-4 pb-4 text-sm">
                Bookings{selectedName ? ` for ${selectedName}` : ""}
                {filters.day ? ` on ${dayLabel(filters.day).weekday} ${dayLabel(filters.day).date}` : " in these days"}
                {data ? `: ${plural(data.total, "appointment")}` : ""}
              </p>
            </div>
          }
          onGlobalFilterChange={() => undefined}
          onPageChange={setPage}
          onPageSizeChange={(size: number) => {
            setPageSize(size);
            setPage(0);
          }}
          pageSize={pageSize}
          currentPage={page}
          loading={loading}
          rowCount={data?.total ?? 0}
          isPagination
          handleRowClick={(row) => {
            const link = fsmRecordLink("Service_Appointments", row.id);
            if (link) window.open(link, "_blank", "noopener,noreferrer");
          }}
          emptyState={<EmptyState icon={<Wrench />} title="No bookings" description="Nothing is scheduled in FSM for this selection." />}
        />
      </Card>
    </div>
  );
}

function CapacityNotes({ data }: { data: CapacityReport }) {
  const n = data.notes;
  const lines = [
    `Booked: scheduled times of FSM appointments that are not cancelled. Bookings in the portal schedule that are not in FSM yet are not counted.`,
    `Available hours: shift times from Settings, ${n.unpaidBreakMinutes ? `less a ${n.unpaidBreakMinutes}-minute break` : "no unpaid break set (D-22)"}, ${plural(
      n.holidays,
      "public holiday",
    )} and ${plural(n.leaveRecords, "leave record")} in these days.`,
  ];
  if (n.noRestDays) lines.push(`${plural(n.noRestDays, "technician")} with no rest days set: every day counts as a working day for them (D-16).`);
  if (n.crewsUnknown) lines.push(`${plural(n.crewsUnknown, "appointment")} whose crew FSM has not been read for yet count for the lead technician only.`);
  return (
    <ul className="text-muted-foreground -mt-2 flex list-disc flex-col gap-0.5 pl-4 text-xs">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

function BoardTable({
  data,
  rows,
  board,
  filters,
  onPick,
}: {
  data: CapacityReport;
  rows: CapacityRow[];
  board: Board;
  filters: Record<string, string>;
  onPick: (row: CapacityRow, cell: CapacityCell) => void;
}) {
  if (!rows.length) {
    return <EmptyState icon={<CalendarRange />} title="Nobody on the board" description="No technicians are available or booked in these days." className="py-10" />;
  }
  const isSelected = (row: CapacityRow, cell: CapacityCell) =>
    filters.day === cell.date && (board === "teams" ? filters.team === row.key && !filters.technician : filters.technician === row.key);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-sm">
        <thead>
          <tr>
            <th className="bg-card sticky left-0 z-10 min-w-48 px-4 py-2 text-left text-xs font-medium">{board === "teams" ? "Team" : "Technician"}</th>
            {data.dates.map((date) => {
              const label = dayLabel(date);
              return (
                <th key={date} className="min-w-16 px-1 py-2 text-center text-xs font-medium">
                  <div className="text-muted-foreground">{label.weekday}</div>
                  <div>{label.date}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {board === "teams" ? (
            <tr>
              <td className="bg-card sticky left-0 z-10 px-4 py-1.5 text-xs font-medium">All teams</td>
              {data.days.map((day) => (
                <td key={day.date} className="px-0.5">
                  <div className={cn("rounded-md px-1.5 py-1 text-center text-xs tabular-nums", CELL_STYLES[day.status])}>
                    {shortHours(day.bookedMinutes)}/{shortHours(day.availableMinutes)}
                  </div>
                </td>
              ))}
            </tr>
          ) : null}
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="bg-card sticky left-0 z-10 px-4 py-1.5">
                <div className="text-sm font-medium">{row.name}</div>
                <div className="text-muted-foreground text-xs">
                  {board === "teams" ? plural(row.technicians ?? 0, "technician") : `${hrs(row.bookedMinutes)} of ${hrs(row.availableMinutes)}`}
                </div>
              </td>
              {row.cells.map((cell) => (
                <td key={cell.date} className="px-0.5">
                  <button
                    type="button"
                    onClick={() => onPick(row, cell)}
                    title={`${CELL_TITLES[cell.status]}${cell.dayStatus && DAY_STATUS_LABELS[cell.dayStatus] ? ` (${DAY_STATUS_LABELS[cell.dayStatus]})` : ""}: ${hrs(
                      cell.bookedMinutes,
                    )} booked of ${hrs(cell.availableMinutes)} available`}
                    className={cn(
                      "w-full rounded-md px-1.5 py-1 text-center text-xs tabular-nums transition-shadow hover:ring-1 hover:ring-ring",
                      CELL_STYLES[cell.status],
                      isSelected(row, cell) && "ring-2 ring-ring",
                    )}
                  >
                    {cell.status === "off" && cell.bookedMinutes === 0 ? "—" : `${shortHours(cell.bookedMinutes)}/${shortHours(cell.availableMinutes)}`}
                  </button>
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <td className="bg-card sticky left-0 z-10 px-4 py-1.5 text-xs font-medium">Unassigned</td>
            {data.days.map((day) => (
              <td key={day.date} className="px-0.5">
                <div
                  className={cn(
                    "rounded-md px-1.5 py-1 text-center text-xs tabular-nums",
                    day.unassignedMinutes ? "bg-destructive/10 text-destructive" : "text-muted-foreground/60",
                  )}
                >
                  {day.unassignedMinutes ? shortHours(day.unassignedMinutes) : "—"}
                </div>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 px-4 pt-1 pb-4 text-xs">
        <span>
          <span className={cn("rounded px-1.5 py-0.5", CELL_STYLES.over)}>over-booked</span> booked above available
        </span>
        <span>
          <span className={cn("rounded px-1.5 py-0.5", CELL_STYLES.spare)}>spare</span> below {data.spareBelowPercent}% booked
        </span>
        <span>
          <span className={cn("rounded px-1.5 py-0.5", CELL_STYLES.ok)}>booked</span> in between
        </span>
        <span>Hours shown as booked/available.</span>
      </p>
    </div>
  );
}
