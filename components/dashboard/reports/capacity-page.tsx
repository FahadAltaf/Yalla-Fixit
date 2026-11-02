"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarRange, Loader2, Wrench, XIcon } from "lucide-react";
import { toast } from "sonner";

import { ListPager, PageHeading, PillTabs, SectionCard, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ErrorState, StatGridSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { DataTable } from "@/components/data-table";
import { BOOKING_COLUMNS, CAPACITY_EXPORT_COLUMNS, capacityExportRows, Explained, hrs, type Help } from "@/components/data-table/columns/column-utilization";
import { ReportToolbar } from "@/components/data-table/toolbars/report-toolbar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { addDaysToDateString, todayInZone } from "@/lib/scheduling/org-time";
import { useDebounce } from "@/hooks/use-debounce";
import { fsmRecordLink } from "@/lib/fsm-links";
import { isoWeekday } from "@/lib/reports/available-hours";
import type { CapacityCell, CapacityRow, CellStatus } from "@/lib/reports/capacity";
import type { CapacityReport } from "@/lib/server/reports/planning";
import { exportFilename, exportTable, type ExportFormat } from "@/lib/snagging/export-table";
import { cn } from "@/lib/utils";
import { reportsService } from "@/modules/reports/reports-service";

import { HowItWorks, capacityHowItWorks } from "./how-it-works";
import { ReportDateRange, SavedFiltersMenu, plural, useReportFilters } from "./shared";

/**
 * Forward capacity (BRD 5.2 B5; DEV-452): booked against available hours
 * by day and team for the horizon, over-booked and spare days highlighted,
 * unassigned hours apart. A cell opens that team's or technician's
 * bookings for the day, below the board.
 *
 * 28 Oct: a cell is a selection for the bookings list only. It no longer
 * sets the Team filter (which narrowed the whole board to one team) and is
 * not remembered, so the page always opens on every team and every day.
 */

type Board = "teams" | "technicians";
type Can = { can: { view: boolean; export: boolean } };
/** The board cell picked: a team's or technician's day, or the whole day ("all"). */
type Slot = { day: string; kind: "all" | "team" | "technician"; key: string; name: string };

const ALL = "__all__";
const DEFAULTS = { from: "", days: "", team: "", client: "", technician: "", q: "" };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (date: string) => ({
  weekday: WEEKDAYS[isoWeekday(date) - 1],
  date: `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`,
});
/* "1 Oct – 30 Nov 2026"; the first year only when the range crosses one. */
const rangeLabel = (from: string, to: string) =>
  `${dayLabel(from).date}${from.slice(0, 4) !== to.slice(0, 4) ? ` ${from.slice(0, 4)}` : ""} – ${dayLabel(to).date} ${to.slice(0, 4)}`;
const shortHours = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10}`;
const BOARD_PAGE_SIZES = [10, 25, 50];

const CELL_STYLES: Record<CellStatus, string> = {
  over: "bg-destructive/10 text-destructive font-medium",
  spare: "bg-warning/10 text-warning",
  ok: "bg-success/10 text-success",
  off: "text-muted-foreground/60",
};
const DAY_STATUS_LABELS: Record<string, string> = { holiday: "public holiday", rest_day: "rest day", left: "after leaving" };
const share = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : "—");

/*
  Hover help (28 Oct), as on Utilization: what a figure is, where it comes
  from, and its own sum with the numbers shown.
*/
const BOOKED_SOURCE = "Booked: the scheduled time of the FSM appointments that day, not cancelled; two bookings at once count once per person.";
const AVAILABLE_SOURCE =
  "Available: the technician's whole working day (8 h; 12 h for Data Center technicians; or their own hours set in Scheduling), less leave. Rest days and public holidays count nothing.";

/* A technician's own day, worked out: "12 h working day − 4 h leave = 8 h available". */
function availableLine(cell: CapacityCell): string | null {
  if (cell.dayMinutes === undefined || cell.status === "off") return null;
  const day = cell.dayMinutes;

  const steps = [`${hrs(day)} working day`];
  if (cell.leaveMinutes) steps.push(`− ${hrs(cell.leaveMinutes)} leave`);
  return `Available: ${steps.join(" ")} = ${hrs(cell.availableMinutes)}.`;
}

function cellHelp(input: {
  title: string;
  cell: CapacityCell;
  spareBelowPercent: number;
  /** Team rows: how the day adds up. */
  technicians?: number;
  appointments?: number;
}): Help {
  const { cell } = input;
  const over = cell.bookedMinutes - cell.availableMinutes;
  const verdict =
    cell.status === "over"
      ? `${hrs(cell.bookedMinutes)} booked > ${hrs(cell.availableMinutes)} available: over-booked by ${hrs(over)}.`
      : cell.status === "off"
        ? `Not working${cell.dayStatus && DAY_STATUS_LABELS[cell.dayStatus] ? ` (${DAY_STATUS_LABELS[cell.dayStatus]})` : ""}: nothing available.`
        : `${hrs(cell.bookedMinutes)} ÷ ${hrs(cell.availableMinutes)} = ${share(cell.bookedMinutes, cell.availableMinutes)} booked${
            cell.status === "spare" ? `, below ${input.spareBelowPercent}%: spare.` : "."
          }`;
  return {
    title: input.title,
    lines: [
      verdict,
      input.technicians !== undefined
        ? `Booked and available are its ${plural(input.technicians, "technician")}' hours, added up.`
        : BOOKED_SOURCE,
      ...(input.technicians !== undefined ? [] : [availableLine(cell) ?? AVAILABLE_SOURCE]),
      ...(input.technicians === undefined && cell.restDaysAssumed
        ? ["No rest day is entered for this technician, so every day shows as a working day. Set it in Scheduling → Technicians and their rest day shows 0."]
        : []),
      ...(input.appointments !== undefined ? [`${plural(input.appointments, "appointment")} scheduled that day.`] : []),
      "Click to see the bookings below.",
    ],
  };
}

export function CapacityPage() {
  const { filters, setFilters, ready, saved, saveAs, remove, apply } = useReportFilters("capacity", DEFAULTS, { restoreLastUsed: false });
  const debouncedQ = useDebounce(filters.q, 400);
  const [board, setBoard] = useState<Board>("teams");
  const [slot, setSlot] = useState<Slot | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [boardPage, setBoardPage] = useState(0);
  const [boardPageSize, setBoardPageSize] = useState(BOARD_PAGE_SIZES[0]);
  const [data, setData] = useState<(CapacityReport & Can) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const bookingsRef = useRef<HTMLDivElement>(null);

  /* What the board depends on; the slot, search and paging only change the bookings list. */
  const boardKey = `${filters.from}|${filters.days}|${filters.team}|${filters.client}`;
  const [shownBoardKey, setShownBoardKey] = useState<string | null>(null);
  const boardLoading = loading && shownBoardKey !== boardKey;

  const query = useMemo(
    () => ({
      ...filters,
      q: debouncedQ,
      day: slot?.day ?? "",
      slotTeam: slot?.kind === "team" ? slot.key : "",
      slotTechnician: slot?.kind === "technician" ? slot.key : "",
    }),
    [filters, debouncedQ, slot],
  );

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
      setShownBoardKey(boardKey);
    } catch (e) {
      if (mine !== ticket.current) return;
      setError(e instanceof Error ? e.message : "Could not load the capacity report");
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  }, [query, page, pageSize, boardKey]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  /* A new board (dates or team) starts on its first page, with nothing picked. */
  const change = (next: Record<string, string>) => {
    const merged = { ...DEFAULTS, ...next };
    if (merged.from !== filters.from || merged.days !== filters.days || merged.team !== filters.team || merged.client !== filters.client) {
      setSlot(null);
      setBoardPage(0);
    }
    setFilters(merged);
    setPage(0);
  };

  /* A cell narrows the bookings below to that row and day, and brings them into view; the same cell again clears it. */
  const pickCell = (next: Slot) => {
    const same = slot && slot.day === next.day && slot.kind === next.kind && slot.key === next.key;
    setSlot(same ? null : next);
    setPage(0);
    if (!same) requestAnimationFrame(() => bookingsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
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
  const lastBoardPage = Math.max(0, Math.ceil(rows.length / boardPageSize) - 1);
  const shownPage = Math.min(boardPage, lastBoardPage);
  const pageRows = rows.slice(shownPage * boardPageSize, (shownPage + 1) * boardPageSize);

  /* The capacity horizon from Reporting Settings until changed (BRD 6.6: 14 days). */
  const capacityFrom = filters.from || data?.from || todayInZone();
  const capacityTo = data?.to ?? addDaysToDateString(capacityFrom, Number(filters.days || data?.horizonDays || 14) - 1);

  const slotLine = slot ? `${slot.name} on ${dayLabel(slot.day).weekday} ${dayLabel(slot.day).date}` : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Reports"
        title="Capacity"
        description="Booked against available hours for the days ahead, by team and technician, so over-booked and spare days show before they arrive."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <HowItWorks content={capacityHowItWorks(data ? { horizonDays: data.horizonDays, spareBelowPercent: data.spareBelowPercent } : undefined)} />
            <ReportDateRange
              from={capacityFrom}
              to={capacityTo}
              onChange={(from, to) => {
                /* The board shows up to 90 days. */
                const days = Math.min(90, Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1));
                change({ ...filters, from, days: String(days) });
              }}
            />
            <Select value={filters.team || ALL} onValueChange={(v) => change({ ...filters, team: v === ALL ? "" : v })}>
              <SelectTrigger className="w-52" aria-label="Team">
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
            {/* BRD B5: a client narrows the booked hours and bookings to its appointments; availability stays everyone's. */}
            <Select value={filters.client || ALL} onValueChange={(v) => change({ ...filters, client: v === ALL ? "" : v })}>
              <SelectTrigger className="w-52" aria-label="Client">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All clients</SelectItem>
                {(data?.options.clients ?? []).map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <SavedFiltersMenu
              saved={saved}
              current={filters}
              onApply={(entry) => {
                apply(entry);
                setSlot(null);
                setPage(0);
                setBoardPage(0);
              }}
              onSave={saveAs}
              onRemove={remove}
            />
          </div>
        }
      />

      {error ? <ErrorState title="Could not load the capacity report" message={error} onRetry={() => void load()} retrying={loading} /> : null}

      {totals && data && !boardLoading ? (
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

      <SectionCard
        icon={<CalendarRange />}
        title={data ? rangeLabel(data.from, data.to) : "Board"}
        description="Booked / available hours a day. Click a cell to see its bookings below."
        action={
          <PillTabs<Board>
            value={board}
            onChange={(next) => {
              setBoard(next);
              setBoardPage(0);
            }}
            tabs={[
              { value: "teams", label: "Teams" },
              { value: "technicians", label: "Technicians" },
            ]}
          />
        }
        bodyClassName="border-t"
      >
        {data ? (
          <div className="relative">
            <div className={cn("transition-opacity", boardLoading && "pointer-events-none opacity-40")}>
              <BoardTable data={data} rows={pageRows} showAllDays={board === "teams" && shownPage === 0} board={board} slot={slot} onPick={pickCell} />
              <ListPager
                page={shownPage}
                pageSize={boardPageSize}
                total={rows.length}
                onPageChange={setBoardPage}
                onPageSizeChange={(size) => {
                  setBoardPageSize(size);
                  setBoardPage(0);
                }}
                pageSizes={BOARD_PAGE_SIZES}
                noun={board === "teams" ? "teams" : "technicians"}
                className="border-t"
              />
            </div>
            {boardLoading ? (
              <div className="absolute inset-0 flex items-start justify-center pt-16">
                <span className="bg-background/90 text-muted-foreground flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm shadow-sm">
                  <Loader2 className="size-4 animate-spin" />
                  Updating the board…
                </span>
              </div>
            ) : null}
          </div>
        ) : (
          <BoardSkeleton />
        )}
      </SectionCard>

      <div ref={bookingsRef} className="scroll-mt-4">
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
                  clearable={["technician"]}
                  canExport={Boolean(data?.can.export)}
                  exporting={exporting}
                  onExport={(format) => void doExport(format)}
                />
                <div className="flex flex-wrap items-center gap-2 px-4 pb-4 text-sm">
                  <span className="text-muted-foreground">
                    {slotLine ? `Bookings for ${slotLine}` : "Bookings in these days"}
                    {data && !loading ? `: ${plural(data.total, "appointment")}` : ""}
                  </span>
                  {slot ? (
                    <Button variant="outline" size="sm" className="h-7" onClick={() => pickCell(slot)}>
                      <XIcon className="size-3.5" />
                      Clear selection
                    </Button>
                  ) : null}
                </div>
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
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-4">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-2">
          <Skeleton className="h-8 w-44 shrink-0" />
          {Array.from({ length: 12 }, (__, j) => (
            <Skeleton key={j} className="h-6 w-16 shrink-0" />
          ))}
        </div>
      ))}
    </div>
  );
}

function BoardTable({
  data,
  rows,
  showAllDays,
  board,
  slot,
  onPick,
}: {
  data: CapacityReport;
  rows: CapacityRow[];
  /** The "All teams" line, on the teams board's first page. */
  showAllDays: boolean;
  board: Board;
  slot: Slot | null;
  onPick: (slot: Slot) => void;
}) {
  if (!rows.length) {
    return <EmptyState icon={<CalendarRange />} title="Nobody on the board" description="No technicians are available or booked in these days." className="py-10" />;
  }
  const today = todayInZone();
  const kind = board === "teams" ? "team" : "technician";
  const isPicked = (k: Slot["kind"], key: string, date: string) => slot?.day === date && slot.kind === k && slot.key === key;
  const cellClass = (status: CellStatus, picked: boolean) =>
    cn(
      "w-full rounded-md px-1.5 py-1 text-center text-xs tabular-nums transition-shadow hover:ring-1 hover:ring-ring",
      CELL_STYLES[status],
      picked && "ring-2 ring-ring",
    );
  const anyUnassigned = data.days.some((day) => day.unassignedMinutes > 0);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-1 text-sm">
          <thead>
            <tr>
              <th className="bg-card sticky left-0 z-10 min-w-48 px-4 py-2 text-left text-xs font-medium">
                <Explained
                  help={{
                    title: board === "teams" ? "Teams" : "Technicians",
                    lines: [
                      "Each cell is booked / available hours for that day.",
                      board === "teams"
                        ? "A team is a supervisor and the technicians who report to them (Scheduling → Technicians)."
                        : "Each technician's own day: their bookings against their shift hours.",
                    ],
                  }}
                >
                  <span className="decoration-muted-foreground/60 underline decoration-dotted underline-offset-4">{board === "teams" ? "Team" : "Technician"}</span>
                </Explained>
              </th>
              {data.dates.map((date) => {
                const label = dayLabel(date);
                const isToday = date === today;
                return (
                  <th key={date} className={cn("min-w-16 px-1 py-2 text-center text-xs font-medium", isToday && "text-brand")}>
                    <div className={isToday ? undefined : "text-muted-foreground"}>{isToday ? "Today" : label.weekday}</div>
                    <div>{label.date}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {showAllDays ? (
              <tr>
                <td className="bg-card sticky left-0 z-10 px-4 py-1.5">
                  <div className="text-sm font-medium">All teams</div>
                  <div className="text-muted-foreground text-xs">Everyone, every booking</div>
                </td>
                {data.days.map((day) => (
                  <td key={day.date} className="px-0.5">
                    <Explained
                      className="w-full"
                      help={cellHelp({
                        title: `All teams · ${dayLabel(day.date).weekday} ${dayLabel(day.date).date}`,
                        cell: day,
                        spareBelowPercent: data.spareBelowPercent,
                        technicians: data.technicians.length,
                        appointments: day.appointments,
                      })}
                    >
                      <button
                        type="button"
                        onClick={() => onPick({ day: day.date, kind: "all", key: "all", name: "every team" })}
                        className={cellClass(day.status, isPicked("all", "all", day.date))}
                      >
                        {shortHours(day.bookedMinutes)}/{shortHours(day.availableMinutes)}
                      </button>
                    </Explained>
                  </td>
                ))}
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="bg-card sticky left-0 z-10 px-4 py-1.5">
                  <div className="max-w-56 truncate text-sm font-medium" title={row.name}>
                    {row.name}
                  </div>
                  <Explained
                    help={{
                      title: `${row.name}: ${share(row.bookedMinutes, row.availableMinutes)} booked`,
                      lines: [
                        `${hrs(row.bookedMinutes)} booked ÷ ${hrs(row.availableMinutes)} available, over the days shown.`,
                        `${plural(row.overDays, "day")} over-booked, ${plural(row.spareDays, "day")} spare.`,
                        ...(board === "teams" ? [`${plural(row.technicians ?? 0, "technician")} in the team.`] : []),
                      ],
                    }}
                  >
                    <div className="text-muted-foreground text-xs">
                      {board === "teams" ? plural(row.technicians ?? 0, "technician") : `${hrs(row.bookedMinutes)} of ${hrs(row.availableMinutes)}`}
                    </div>
                  </Explained>
                </td>
                {row.cells.map((cell) => (
                  <td key={cell.date} className="px-0.5">
                    <Explained
                      className="w-full"
                      help={cellHelp({
                        title: `${row.name} · ${dayLabel(cell.date).weekday} ${dayLabel(cell.date).date}`,
                        cell,
                        spareBelowPercent: data.spareBelowPercent,
                        technicians: board === "teams" ? (row.technicians ?? 0) : undefined,
                      })}
                    >
                      <button
                        type="button"
                        onClick={() => onPick({ day: cell.date, kind, key: row.key, name: row.name })}
                        className={cellClass(cell.status, isPicked(kind, row.key, cell.date))}
                      >
                        {cell.status === "off" && cell.bookedMinutes === 0 ? "—" : `${shortHours(cell.bookedMinutes)}/${shortHours(cell.availableMinutes)}`}
                      </button>
                    </Explained>
                  </td>
                ))}
              </tr>
            ))}
            {/* Only when something is booked with nobody on it. */}
            {anyUnassigned ? (
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
            ) : null}
          </tbody>
        </table>
      </div>
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
        <span>
          <span className={cn("rounded px-1.5 py-0.5", CELL_STYLES.off)}>—</span> not working (rest day, holiday or left)
        </span>
        <span>Hours shown as booked/available.</span>
      </p>
    </div>
  );
}
