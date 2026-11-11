"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarClock, ClipboardCheck, Database, PhoneCall, Plus, Route, Wrench } from "lucide-react";

import { DataTable } from "@/components/data-table";
import { ReportFiltersButton } from "@/components/data-table/toolbars/report-toolbar";
import { PageHeading } from "@/components/dashboard/shared/kaizen";
import { ErrorState } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { TruncatedText } from "@/components/ui/truncated-text";
import { useDebounce } from "@/hooks/use-debounce";
import {
  FIELD_VISIT_KINDS,
  FIELD_VISIT_KIND_LABELS,
  FIELD_VISIT_STAGES,
  FIELD_VISIT_STAGE_LABELS,
  FIELD_VISIT_WHEN,
  OPEN_FIELD_VISIT_STAGES,
  fieldVisitHref,
  type FieldVisitKind,
  type FieldVisitStage,
  type FieldVisitWhen,
} from "@/lib/amc/field-visits";
import { cn } from "@/lib/utils";
import { fieldVisitsService, type FieldVisitRow } from "@/modules/amc-contracts/field-visits-service";

import { NewSiteVisitDialog } from "./assessments";
import { ListToolbar } from "./call-out-shared";
import { formatContractDate } from "./contract-status";
import { ModuleGuide } from "./module-guide";
import { useAmcData } from "./use-amc-data";

const KIND_ICONS: Record<FieldVisitKind, typeof CalendarClock> = {
  ppm: CalendarClock,
  call_out: PhoneCall,
  additional_work: Wrench,
  site_visit: ClipboardCheck,
};

/* Each type its own colour, so a mixed list reads at a glance. */
const KIND_TONES: Record<FieldVisitKind, string> = {
  ppm: "bg-brand-50 text-brand",
  call_out: "bg-warning/10 text-warning",
  additional_work: "bg-mist text-ink",
  site_visit: "bg-success/10 text-success",
};

/* What each type is, in a line, for the Type column's tooltip. */
const KIND_HINTS: Record<FieldVisitKind, string> = {
  ppm: "A planned maintenance visit from a contract's schedule",
  call_out: "A visit the client asked for (a fault or an emergency)",
  additional_work: "Work outside the contract the client approved",
  site_visit: "A survey of a property before a proposal",
};

const STAGE_TONES: Record<FieldVisitStage, string> = {
  to_plan: "bg-mist text-ink-soft",
  planned: "bg-brand-50 text-brand",
  confirmed: "bg-success/10 text-success",
  in_progress: "bg-warning/10 text-warning",
  review: "bg-warning/10 text-warning",
  done: "bg-success/10 text-success",
  cancelled: "bg-mist text-ink-soft",
};

const WHEN_LABELS: Record<FieldVisitWhen, string> = {
  any: "Any day",
  overdue: "Overdue",
  today: "Today",
  week: "Next 7 days",
  past30: "Last 30 days",
};

type StageFilter = FieldVisitStage | "open" | "all";

const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }).format(new Date(iso));

/** When it is: the slot when one is set, else the planned day (and a planned visit's window). */
function When({ v }: { v: FieldVisitRow }) {
  return (
    <span className="flex flex-col text-sm whitespace-nowrap">
      <span className={cn(v.late && "text-danger font-medium")}>
        {formatContractDate(v.day)}
        {v.scheduledStart ? ` · ${time(v.scheduledStart)}${v.scheduledEnd ? `–${time(v.scheduledEnd)}` : ""}` : ""}
      </span>
      <span className="text-muted-foreground text-xs">
        {v.late && v.dueOn
          ? `Overdue since ${formatContractDate(v.dueOn)}`
          : v.windowStart && v.windowEnd
            ? `Window ${formatContractDate(v.windowStart)} – ${formatContractDate(v.windowEnd)}`
            : v.dueOn
              ? `Due ${formatContractDate(v.dueOn)}`
              : v.scheduledStart
                ? "Slot booked"
                : "No slot yet"}
      </span>
    </span>
  );
}

function columns(): ColumnDef<FieldVisitRow>[] {
  return [
    {
      id: "visit",
      header: "Visit",
      cell: ({ row }) => (
        <IdentityCell
          title={row.original.ref}
          subtitle={row.original.contractNumber && !row.original.ref.startsWith(row.original.contractNumber) ? row.original.contractNumber : undefined}
          icon={KIND_ICONS[row.original.kind]}
          badge={
            row.original.priority === "emergency" ? (
              <Badge variant="secondary" className="bg-danger/10 text-danger border-0 font-medium">
                Emergency
              </Badge>
            ) : null
          }
        />
      ),
    },
    {
      id: "type",
      header: "Type",
      cell: ({ row }) => (
        <Badge variant="secondary" className={cn("border-0 font-medium whitespace-nowrap", KIND_TONES[row.original.kind])} title={KIND_HINTS[row.original.kind]}>
          {FIELD_VISIT_KIND_LABELS[row.original.kind]}
        </Badge>
      ),
    },
    {
      id: "client",
      header: "Client / property",
      cell: ({ row }) => (
        <span className="flex max-w-[200px] flex-col text-sm">
          <TruncatedText text={row.original.customerName || "—"} />
          {row.original.propertyLabel ? <TruncatedText text={row.original.propertyLabel} className="text-muted-foreground text-xs" /> : null}
        </span>
      ),
    },
    {
      id: "summary",
      header: "For",
      cell: ({ row }) =>
        row.original.summary ? <TruncatedText text={row.original.summary} className="max-w-[180px] text-sm" /> : <span className="text-muted-foreground text-sm">—</span>,
    },
    {
      id: "when",
      header: "When",
      cell: ({ row }) => <When v={row.original} />,
    },
    {
      id: "crew",
      header: "Crew",
      cell: ({ row }) => {
        const crew = row.original.crew;
        if (!crew.length) return <span className="text-muted-foreground text-sm">{row.original.kind === "site_visit" ? "Assessor on the visit" : "Not assigned"}</span>;
        return (
          <span className="flex max-w-[200px] flex-col text-sm">
            <TruncatedText text={crew[0].name} />
            {crew.length > 1 ? <span className="text-muted-foreground text-xs">+{crew.length - 1} more</span> : null}
          </span>
        );
      },
    },
    {
      id: "stage",
      header: "Stage",
      cell: ({ row }) => (
        <span className="flex flex-col items-start gap-1">
          <Badge variant="secondary" className={cn("border-0 font-medium", STAGE_TONES[row.original.stage])}>
            {FIELD_VISIT_STAGE_LABELS[row.original.stage]}
          </Badge>
          <span className="text-muted-foreground text-xs">{row.original.statusLabel}</span>
        </span>
      ),
    },
  ];
}

const pickFrom = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T => (value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback);

/**
 * AMC -> Visits: every AMC visit in one list (planned visits, call outs,
 * approved additional work, site visits), paged and filtered in the
 * database. The filters live in the address (?kind, ?stage, ?when,
 * ?technician), so a filtered list can be shared or reloaded.
 */
export function VisitsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [kind, setKind] = useState<FieldVisitKind | "any">(() => pickFrom(searchParams.get("kind"), [...FIELD_VISIT_KINDS, "any"] as const, "any"));
  const [stage, setStage] = useState<StageFilter>(() => pickFrom(searchParams.get("stage"), [...FIELD_VISIT_STAGES, "open", "all"] as const, "open"));
  const [when, setWhen] = useState<FieldVisitWhen>(() => pickFrom(searchParams.get("when"), FIELD_VISIT_WHEN, "any"));
  const [technician, setTechnician] = useState<string>(() => searchParams.get("technician") ?? "any");
  const [search, setSearch] = useState("");
  const [startingSiteVisit, setStartingSiteVisit] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const q = useDebounce(search.trim(), 400);

  /* The filters in the address, without a navigation (as Snagging's tabs). */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const set = (key: string, value: string, fallback: string) => (value === fallback ? params.delete(key) : params.set(key, value));
    set("kind", kind, "any");
    set("stage", stage, "open");
    set("when", when, "any");
    set("technician", technician, "any");
    const next = params.toString();
    window.history.replaceState(null, "", next ? `?${next}` : window.location.pathname);
  }, [kind, stage, when, technician]);

  const query = {
    kind: kind === "any" ? null : kind,
    stage,
    when,
    technician: technician === "any" ? null : technician,
    q,
    page,
    pageSize,
  };
  const key = JSON.stringify(query);
  const { data, error, loading, reload } = useAmcData(() => fieldVisitsService.list(query), `field-visits:${key}`);
  const roster = useAmcData(() => fieldVisitsService.technicians(), "field-visit-technicians");

  const counts = data?.stageCounts;
  const openCount = counts ? OPEN_FIELD_VISIT_STAGES.reduce((sum, s) => sum + (counts[s] ?? 0), 0) : null;
  const allCount = counts ? FIELD_VISIT_STAGES.reduce((sum, s) => sum + (counts[s] ?? 0), 0) : null;
  const withCount = (label: string, n: number | null | undefined) => (n === null || n === undefined ? label : `${label} (${n})`);

  const stageOptions = useMemo(
    () => [
      { value: "open", label: withCount("Open", openCount) },
      ...FIELD_VISIT_STAGES.map((s) => ({ value: s, label: withCount(FIELD_VISIT_STAGE_LABELS[s], counts?.[s]) })),
      { value: "all", label: withCount("All stages", allCount) },
    ],
    [counts, openCount, allCount],
  );
  const technicianOptions = useMemo(
    () => [{ value: "any", label: "Any technician" }, ...(roster.data?.technicians ?? []).map((t) => ({ value: t.id, label: t.name }))],
    [roster.data],
  );
  const cols = useMemo(() => columns(), []);
  const rows = data?.visits ?? [];
  const filtered = kind !== "any" || stage !== "open" || when !== "any" || technician !== "any" || Boolean(q);

  const reset = <T,>(apply: (v: T) => void) => (v: T) => {
    apply(v);
    setPage(0);
  };
  const clearFilters = () => {
    setKind("any");
    setStage("open");
    setWhen("any");
    setTechnician("any");
    setSearch("");
    setPage(0);
  };

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="Operations"
        title="Visits"
        info={<ModuleGuide module="visits" />}
        description="Every AMC visit in one place: planned maintenance, call outs, approved additional work and site visits, with where each one stands."
        actions={
          <Button onClick={() => setStartingSiteVisit(true)}>
            <Plus className="size-4" />
            New site visit
          </Button>
        }
      />

      {data && !data.migrated ? (
        <Alert className="border-warning/30 bg-warning/5 items-start p-4">
          <Database className="text-warning" />
          <AlertTitle>The visits list is not set up on this database yet</AlertTitle>
          <AlertDescription>It reads the amc_field_visits view (migration 20261111100000). Ask an admin to apply it.</AlertDescription>
        </Alert>
      ) : null}

      {error ? <ErrorState title="Could not load the visits" message={error} onRetry={reload} /> : null}

      <Card className="py-0">
        <DataTable
          columns={cols}
          data={rows}
          loading={loading}
          rowCount={data?.total ?? 0}
          pageSize={pageSize}
          currentPage={page}
          isPagination
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
          onGlobalFilterChange={setSearch}
          handleRowClick={(row) => router.push(fieldVisitHref(row))}
          toolbar={
            <ListToolbar
              search={search}
              onSearchChange={reset(setSearch)}
              placeholder="Search number, client, property or service…"
              searchLabel="Search visits"
              loading={loading}
              filters={[]}
              /* One Filters button for type, stage, day and technician, as Finance's lists (11 Nov 2026). */
              extra={
                <ReportFiltersButton
                  filters={{ kind: kind === "any" ? "" : kind, stage, when: when === "any" ? "" : when, technician: technician === "any" ? "" : technician }}
                  onFiltersChange={(next) => {
                    setKind((next.kind || "any") as FieldVisitKind | "any");
                    setStage((next.stage || "open") as StageFilter);
                    setWhen((next.when || "any") as FieldVisitWhen);
                    setTechnician(next.technician || "any");
                    setPage(0);
                  }}
                  selects={[
                    { key: "kind", allLabel: "All types", options: FIELD_VISIT_KINDS.map((k) => ({ value: k, label: FIELD_VISIT_KIND_LABELS[k] })) },
                    { key: "stage", allLabel: "Stage", required: true, defaultValue: "open", options: stageOptions },
                    { key: "when", allLabel: "Any day", options: FIELD_VISIT_WHEN.filter((w) => w !== "any").map((w) => ({ value: w, label: WHEN_LABELS[w] })) },
                    { key: "technician", allLabel: "All technicians", options: technicianOptions.filter((o) => o.value !== "any") },
                  ]}
                  clearable={["kind", "when", "technician"]}
                />
              }
              pageSize={pageSize}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(0);
              }}
              onRefresh={reload}
            />
          }
          emptyState={
            <EmptyState
              icon={<Route />}
              title={filtered ? "No matching visits" : "No open visits"}
              description={
                filtered
                  ? "No visit matches these filters."
                  : "Visits appear here when a contract's schedule is made, a call out is logged, additional work is approved or a site visit is booked."
              }
              action={filtered ? { label: "Clear filters", variant: "outline", onClick: clearFilters } : undefined}
            />
          }
        />
      </Card>
      <NewSiteVisitDialog open={startingSiteVisit} onOpenChange={setStartingSiteVisit} />
    </div>
  );
}
