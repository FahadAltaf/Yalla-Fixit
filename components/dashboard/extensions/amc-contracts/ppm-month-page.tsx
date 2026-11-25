"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import { CalendarCheck, ChevronLeft, ChevronRight, RefreshCwIcon, SearchIcon } from "lucide-react";

import { DataTable } from "@/components/data-table";
import { StatusSelect } from "@/components/data-table/toolbars/status-select";
import { PageHeading } from "@/components/dashboard/shared/kaizen";
import { ErrorState } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { Input } from "@/components/ui/input";
import { TruncatedText } from "@/components/ui/truncated-text";
import { todayInDubai } from "@/lib/amc/contracts";
import { amcRefresh, amcRequest } from "@/lib/amc/http-cache";
import { PPM_CONTACT_LABELS, type PpmContactState } from "@/lib/amc/visits";
import { cn } from "@/lib/utils";
import type { PpmMonthItem } from "@/lib/server/amc/ppm-month";

import { ConfirmationUrgencyBadge, ServiceBadges, visitDayOf } from "./visit-board-shared";
import { useAmcData } from "./use-amc-data";

type MonthResponse = { migrated: boolean; items: PpmMonthItem[]; month: string; mine: boolean; canSeeAll: boolean };

const STATES: PpmContactState[] = ["not_contacted", "contacted", "confirmed"];
const STATE_TONE: Record<PpmContactState, string> = {
  not_contacted: "bg-danger/10 text-danger",
  contacted: "bg-warning/10 text-warning",
  confirmed: "bg-success/10 text-success",
};
const FILTER_OPTIONS = [{ value: "any", label: "All visits" }, ...STATES.map((s) => ({ value: s, label: PPM_CONTACT_LABELS[s] }))];

const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};
const monthLabel = (month: string) => format(new Date(`${month}-01T00:00:00`), "MMMM yyyy");
const dayLabel = (iso: string) => format(new Date(`${iso}T00:00:00`), "EEE d MMM");

/**
 * AMC -> PPM month (DEV-492, BRD v0.4 5.11): the coordinators' month of
 * planned visits, split into not contacted yet, contacted and confirmed,
 * with the client, property, services and tentative date. Each row opens
 * the visit on its Client tab, where the confirmation is asked and logged.
 */
export function PpmMonthPage() {
  const router = useRouter();
  const [month, setMonth] = useState(() => todayInDubai().slice(0, 7));
  const [mine, setMine] = useState(false);
  const [filter, setFilter] = useState<"any" | PpmContactState>("any");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const { data, error, loading, reload } = useAmcData(
    () => amcRequest<MonthResponse>(`/api/amc-visits/month?month=${month}${mine ? "&mine=1" : ""}`),
    `ppm-month|${month}|${mine ? 1 : 0}`,
  );
  const open = useCallback((row: PpmMonthItem) => router.push(`/extensions/amc-contracts/visits/${row.visitId}?tab=client`), [router]);

  const all = useMemo(() => data?.items ?? [], [data]);
  const counts = useMemo(() => Object.fromEntries(STATES.map((s) => [s, all.filter((i) => i.state === s).length])) as Record<PpmContactState, number>, [all]);
  const term = search.trim().toLowerCase();
  const matching = useMemo(
    () =>
      all.filter(
        (r) =>
          (filter === "any" || r.state === filter) &&
          (!term || [r.customerName, r.propertyLabel, r.contractNumber, r.coordinatorName ?? "", ...r.services].some((v) => v.toLowerCase().includes(term))),
      ),
    [all, filter, term],
  );
  const rows = matching.slice(page * pageSize, (page + 1) * pageSize);
  const reset = () => setPage(0);

  const columns = useMemo<ColumnDef<PpmMonthItem>[]>(
    () => [
      {
        id: "date",
        header: "Tentative date",
        cell: ({ row }) => (
          <span className="flex flex-col text-sm whitespace-nowrap">
            <span className="font-medium">{dayLabel(row.original.targetDate)}</span>
            {row.original.scheduledStart ? <span className="text-muted-foreground text-xs">Slot {format(new Date(row.original.scheduledStart), "d MMM HH:mm")}</span> : null}
          </span>
        ),
      },
      {
        id: "client",
        header: "Client",
        cell: ({ row }) => <IdentityCell title={row.original.customerName || "—"} subtitle={`${row.original.contractNumber} · Visit ${row.original.visitNo}`} icon={CalendarCheck} />,
      },
      {
        id: "property",
        header: "Property",
        cell: ({ row }) => (row.original.propertyLabel ? <TruncatedText text={row.original.propertyLabel} className="max-w-[220px] text-sm" /> : <span className="text-muted-foreground text-sm">—</span>),
      },
      {
        id: "services",
        header: "Services",
        cell: ({ row }) => <ServiceBadges services={row.original.services} max={2} />,
      },
      {
        id: "state",
        header: "Contact",
        cell: ({ row }) => (
          <span className="flex flex-wrap items-center gap-1">
            <Badge variant="secondary" className={cn("border-0 font-medium", STATE_TONE[row.original.state])}>
              {PPM_CONTACT_LABELS[row.original.state]}
            </Badge>
            {row.original.state !== "confirmed" ? (
              <ConfirmationUrgencyBadge value={row.original.clientConfirmation ?? "pending"} day={visitDayOf(row.original)} status={row.original.status} />
            ) : null}
          </span>
        ),
      },
      {
        id: "attempts",
        header: "Attempts",
        cell: ({ row }) => (
          <span className="flex flex-col text-sm">
            <span className="tabular-nums">{row.original.attempts || "—"}</span>
            {row.original.lastAttemptAt ? <span className="text-muted-foreground text-xs">Last {format(new Date(row.original.lastAttemptAt), "d MMM")}</span> : null}
          </span>
        ),
      },
      {
        id: "coordinator",
        header: "Coordinator",
        cell: ({ row }) => <span className="text-sm">{row.original.coordinatorName ?? <span className="text-muted-foreground">—</span>}</span>,
      },
    ],
    [],
  );

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="Operations"
        title="PPM month"
        description="The month's planned visits for coordinators: who is not contacted yet, who is contacted and waiting, and who has confirmed. Open a visit to ask or log the confirmation."
        actions={
          <div className="flex items-center gap-1">
            <Button size="icon" variant="outline" aria-label="Previous month" onClick={() => (setMonth((m) => shiftMonth(m, -1)), reset())}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-36 text-center text-sm font-semibold">{monthLabel(month)}</span>
            <Button size="icon" variant="outline" aria-label="Next month" onClick={() => (setMonth((m) => shiftMonth(m, 1)), reset())}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {STATES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => (setFilter((f) => (f === s ? "any" : s)), reset())}
            className={cn("bg-card rounded-xl border px-5 py-4 text-left transition-colors hover:border-brand/40", filter === s && "border-brand ring-brand/20 ring-2")}
            aria-pressed={filter === s}
          >
            <p className="text-muted-foreground text-sm">{PPM_CONTACT_LABELS[s]}</p>
            <p className={cn("mt-1 text-2xl font-semibold tabular-nums", s === "not_contacted" && counts[s] ? "text-danger" : "")}>{data ? counts[s] : "—"}</p>
          </button>
        ))}
      </div>

      {error ? <ErrorState title="Could not load the month" message={error} onRetry={reload} /> : null}

      <Card className="py-0">
        <DataTable
          columns={columns}
          data={rows}
          loading={loading}
          rowCount={matching.length}
          pageSize={pageSize}
          currentPage={page}
          isPagination
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            reset();
          }}
          onGlobalFilterChange={setSearch}
          handleRowClick={open}
          toolbar={
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-4 sm:py-6">
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <div className="relative w-full sm:w-80 sm:flex-none">
                  <Input
                    type="search"
                    placeholder="Search client, property, service…"
                    className="w-full ps-9"
                    value={search}
                    onChange={(e) => (setSearch(e.target.value), reset())}
                    aria-label="Search the month's visits"
                  />
                  <SearchIcon aria-hidden="true" size={16} className="text-muted-foreground/80 pointer-events-none absolute inset-y-0 start-3 my-auto" />
                </div>
                <StatusSelect options={FILTER_OPTIONS} value={filter} onChange={(v) => (setFilter(v as typeof filter), reset())} label="Filter by client contact" />
                {data?.canSeeAll ? (
                  <StatusSelect
                    options={[
                      { value: "everyone", label: "All coordinators" },
                      { value: "mine", label: "My contracts" },
                    ]}
                    value={mine ? "mine" : "everyone"}
                    onChange={(v) => (setMine(v === "mine"), reset())}
                    label="Coordinator"
                  />
                ) : null}
              </div>
              <Button onClick={() => amcRefresh(reload)} variant="outline" disabled={loading}>
                <RefreshCwIcon className="size-4 sm:mr-1" />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
            </div>
          }
          emptyState={
            <EmptyState
              icon={<CalendarCheck />}
              title={all.length ? "No matching visits" : `No planned visits in ${monthLabel(month)}`}
              description={all.length ? "No visit this month matches the search and filter." : "Planned visits appear here once a contract's schedule is made."}
              action={
                all.length
                  ? {
                      label: "Clear filters",
                      variant: "outline",
                      onClick: () => {
                        setFilter("any");
                        setSearch("");
                        reset();
                      },
                    }
                  : undefined
              }
            />
          }
        />
      </Card>
    </div>
  );
}
