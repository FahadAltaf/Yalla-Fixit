"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { BarChart3, CalendarClock, Repeat, SearchIcon, Users } from "lucide-react";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { IconText } from "@/components/data-table/columns/icon-text";
import { StatusSelect } from "@/components/data-table/toolbars/status-select";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeading, PillTabs, SectionCard, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ErrorState, ListSkeleton, SectionSkeleton, StatGridSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { EXPIRY_BUCKET_LABELS, RENEWAL_STAGE_LABELS, type ExpiryBucket, type RenewalStage } from "@/lib/amc/business";
import { formatQuantity } from "@/lib/amc/contracts";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/use-debounce";
import { amcContractsService, type AmcReports as Reports } from "@/modules/amc-contracts/amc-contracts-service";

import { AmcNotificationsBell } from "./amc-notifications-bell";
import { ConfigTableToolbar, LocalDataTable } from "./config-table";
import { CONTRACT_STATUS_LABELS, formatContractDate } from "./contract-status";
import { ExportMenu } from "./export-menu";
import { useAmcData } from "./use-amc-data";

type Tab = "expiry" | "pipeline" | "managers" | "services";
type ExpiryRow = Reports["expiry"][number];
type PipelineRow = Reports["pipeline"][number];
type ManagerRow = Reports["portfolio"][number];
type ServiceRow = Reports["services"][number];
const ALL = "__all__";
const BUCKETS: ExpiryBucket[] = ["expired", "d0_30", "d31_60", "d61_90", "d90_plus"];
const TYPE_LABELS = { visits: "Visits", hours: "Hours", unlimited: "Unlimited", informational: "Included" } as const;

/* How close the end date is, in the theme's tones: gone, soon, coming, far off. */
const BUCKET_TONES: Record<ExpiryBucket, string> = {
  expired: "bg-danger/10 text-danger",
  d0_30: "bg-warning/10 text-warning",
  d31_60: "bg-brand-50 text-brand",
  d61_90: "bg-brand-50 text-brand",
  d90_plus: "bg-mist text-ink-soft",
};

/* A right-aligned column header, for the figures. */
const right = (text: string) =>
  function RightHeader() {
    return <div className="text-right">{text}</div>;
  };

/* A link inside a clickable row: it opens its own record, not the row's. */
const stop = (event: React.MouseEvent) => event.stopPropagation();

/**
 * AMC reports: portfolio figures, expiry, the renewal pipeline, account
 * managers and services. Counted from the contracts the viewer can see;
 * every export is the rows on screen, filters applied.
 */
export function AmcReports() {
  useBreadcrumbLabel("reports", "Reports");
  const [tab, setTab] = useState<Tab>("expiry");
  const [manager, setManager] = useState(ALL);
  const [customer, setCustomer] = useState("");
  const [property, setProperty] = useState("");
  const c = useDebounce(customer.trim(), 300);
  const p = useDebounce(property.trim(), 300);
  const filters = { manager: manager === ALL ? undefined : manager, customer: c || undefined, property: p || undefined };
  const { data, error, loading, reload } = useAmcData(() => amcContractsService.reports(filters), JSON.stringify(filters));
  const summary = useAmcData(() => amcContractsService.summary(), "summary");

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="Insights"
        title="Reports"
        description="Contracts, renewals and services, from contract data only. Draft or rejected proposals and quotes are never counted as revenue."
        actions={<AmcNotificationsBell />}
      />

      {/* The filters narrow every figure and table below, so they sit above them all rather than in one table's toolbar. */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={manager} onValueChange={setManager}>
          <SelectTrigger className="w-full whitespace-nowrap sm:w-56" aria-label="Account manager">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All account managers</SelectItem>
            {(data?.reports.managers ?? []).map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SearchBox value={customer} onChange={setCustomer} placeholder="Client (name or ID)" label="Client" pending={customer.trim() !== c} />
        <SearchBox value={property} onChange={setProperty} placeholder="Property" label="Property" pending={property.trim() !== p} />
      </div>

      {error ? (
        <ErrorState title="Could not load the reports" message={error} onRetry={reload} />
      ) : loading || !data ? (
        <>
          <StatGridSkeleton count={4} />
          <SectionSkeleton>
            <ListSkeleton rows={6} />
          </SectionSkeleton>
        </>
      ) : (
        <ReportsBody reports={data.reports} tab={tab} setTab={setTab} pending={summary.data?.summary.pendingActivation ?? null} usage30={summary.data?.summary.usageLast30Days ?? null} />
      )}
    </div>
  );
}

/** A filter box with the search icon inside it, as on the Snagging toolbars. */
function SearchBox({ value, onChange, placeholder, label, pending }: { value: string; onChange: (value: string) => void; placeholder: string; label: string; pending: boolean }) {
  return (
    <div className="relative w-full sm:w-64">
      <Input type="search" placeholder={placeholder} className="peer w-full ps-9" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
      <div className="text-muted-foreground/80 pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3">
        <SearchIcon aria-hidden="true" size={16} className={cn(pending && "animate-pulse")} />
      </div>
    </div>
  );
}

function ReportsBody({
  reports,
  tab,
  setTab,
  pending,
  usage30,
}: {
  reports: Reports;
  tab: Tab;
  setTab: (t: Tab) => void;
  pending: number | null;
  usage30: number | null;
}) {
  const m = reports.metrics;
  const expiring = reports.expiry.filter((r) => r.bucket === "d0_30").length;
  const expired = reports.expiry.filter((r) => r.bucket === "expired").length;
  return (
    <>
      <StatCardGrid columns={4}>
        <StatCard label="Active contracts" value={m.inForce} headline={`${pending ?? "—"} pending activation`} caption="In force today" href="/extensions/amc-contracts?status=active" />
        <StatCard label="Active contract value" value={<Money value={m.inForceValue} className="text-xl" />} headline="Incl. VAT, as signed" caption="Contracts in force" />
        <StatCard label="Expiring within 30 days" value={expiring} headline={`${expired} expired`} caption="Excludes cancelled" tone={expiring ? "progress" : "neutral"} />
        <StatCard label="Renewals" value={m.renewed} headline={`${m.renewalsStarted} in progress`} caption="Renewed / proposal started" />
        <StatCard
          label="Clients with an AMC"
          value={m.customersWithAmc}
          headline={m.contractsWithoutCustomer ? `${m.contractsWithoutCustomer} contract(s) not linked to a client` : "All linked"}
          caption="Counted once each"
        />
        <StatCard
          label="Properties covered"
          value={m.propertiesCovered}
          headline={m.contractsWithoutProperty ? `${m.contractsWithoutProperty} contract(s) without a property record` : "All linked"}
          caption="Counted once each"
        />
        <StatCard label="Allowance used up" value={m.withExhausted} headline={`${m.withLowRemaining} low on allowance`} caption="Contracts in force (visits/hours)" />
        <StatCard label="Usage events" value={usage30 ?? "—"} headline="Last 30 days" caption="Consumption entries" />
      </StatCardGrid>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PillTabs
          tabs={[
            { value: "expiry", label: "Expiry" },
            { value: "pipeline", label: "Renewal pipeline" },
            { value: "managers", label: "Account managers" },
            { value: "services", label: "Services" },
          ]}
          value={tab}
          onChange={(v) => setTab(v as Tab)}
        />
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground hidden text-sm md:inline">Active contracts, filters applied:</span>
          <ExportMenu name="active-contracts" columns={ACTIVE_COLUMNS} rows={activeRows(reports)} />
        </div>
      </div>
      {tab === "expiry" ? <ExpiryReport reports={reports} /> : null}
      {tab === "pipeline" ? <PipelineReport reports={reports} /> : null}
      {tab === "managers" ? <ManagersReport reports={reports} /> : null}
      {tab === "services" ? <ServicesReport reports={reports} /> : null}
    </>
  );
}

const ACTIVE_COLUMNS = [
  { key: "contract", label: "Contract" },
  { key: "customer", label: "Client" },
  { key: "customerRef", label: "Client ID" },
  { key: "property", label: "Property" },
  { key: "linked", label: "Client/property record" },
  { key: "start", label: "Start" },
  { key: "end", label: "End" },
  { key: "status", label: "Status" },
  { key: "manager", label: "Account manager" },
  { key: "services", label: "Services" },
  { key: "exhausted", label: "Exhausted allowances" },
  { key: "value", label: "Value (AED, incl. VAT)" },
];

/* In force today: active and expiring, never cancelled or expired. */
function activeRows(reports: Reports) {
  return reports.expiry
    .filter((r) => r.displayStatus === "active" || r.displayStatus === "expiring")
    .map((r) => ({
      contract: r.proposalNumber,
      customer: r.customerName,
      customerRef: r.customerRef ?? "",
      property: r.propertyLabel,
      linked: [r.customerId ? "client" : null, r.propertyId ? "property" : null].filter(Boolean).join(" + ") || "not linked",
      start: r.startDate,
      end: r.endDate,
      status: CONTRACT_STATUS_LABELS[r.displayStatus],
      manager: r.accountManagers.join(", "),
      services: r.coverage.totalServices,
      exhausted: r.coverage.exhausted,
      value: r.grandTotal,
    }));
}

/* The end date with how far off it is underneath. */
function EndCell({ endDate, label }: { endDate: string; label: string }) {
  return (
    <div className="flex flex-col text-sm tabular-nums">
      <span>{formatContractDate(endDate)}</span>
      <span className="text-muted-foreground text-xs">{label}</span>
    </div>
  );
}

function ClientCell({ name, id, subtitle }: { name: string; id: string | null; subtitle?: string | null }) {
  const cell = <IdentityCell title={name} subtitle={subtitle} />;
  return id ? (
    <Link href={`/extensions/amc-contracts/customers/${id}`} onClick={stop} className="hover:underline">
      {cell}
    </Link>
  ) : (
    cell
  );
}

function ExpiryReport({ reports }: { reports: Reports }) {
  const router = useRouter();
  const [bucket, setBucket] = useState<"all" | ExpiryBucket>("all");
  const [pageSize, setPageSize] = useState(10);
  const all = reports.expiry.filter((r) => BUCKETS.includes(r.bucket as ExpiryBucket));
  const rows = bucket === "all" ? all : all.filter((r) => r.bucket === bucket);
  const columns = [
    { key: "bucket", label: "Expiry" },
    { key: "contract", label: "Contract" },
    { key: "customer", label: "Client" },
    { key: "property", label: "Property" },
    { key: "manager", label: "Account manager" },
    { key: "end", label: "End date" },
    { key: "status", label: "Status" },
    { key: "renewal", label: "Renewal" },
    { key: "value", label: "Value (AED)" },
  ];
  const exportRows = reports.expiry.map((r) => ({
    bucket: EXPIRY_BUCKET_LABELS[r.bucket as ExpiryBucket],
    contract: r.proposalNumber,
    customer: r.customerName,
    property: r.propertyLabel,
    manager: r.accountManagers.join(", "),
    end: r.endDate,
    status: CONTRACT_STATUS_LABELS[r.displayStatus],
    renewal: r.renewalStage ? RENEWAL_STAGE_LABELS[r.renewalStage as RenewalStage] : "",
    value: r.grandTotal,
  }));
  const tableColumns: ColumnDef<ExpiryRow, unknown>[] = [
    {
      id: "contract",
      header: "Contract",
      cell: ({ row }) => <span className="font-medium">{row.original.proposalNumber}</span>,
    },
    {
      id: "client",
      header: "Client",
      cell: ({ row }) => <ClientCell name={row.original.customerName} id={row.original.customerId} subtitle={row.original.propertyLabel || null} />,
    },
    {
      id: "manager",
      header: "Account manager",
      cell: ({ row }) => <IconText icon={Users} muted={!row.original.accountManagers.length}>{row.original.accountManagers.join(", ") || "—"}</IconText>,
    },
    {
      id: "bucket",
      header: "Expiry",
      cell: ({ row }) => (
        <Badge variant="secondary" className={cn("border-0 font-medium", BUCKET_TONES[row.original.bucket as ExpiryBucket])}>
          {EXPIRY_BUCKET_LABELS[row.original.bucket as ExpiryBucket]}
        </Badge>
      ),
    },
    {
      id: "end",
      header: "End",
      cell: ({ row }) => <EndCell endDate={row.original.endDate} label={row.original.expiryLabel} />,
    },
    {
      id: "renewal",
      header: "Renewal",
      cell: ({ row }) => (
        <span className={cn("text-sm", !row.original.renewalStage && "text-muted-foreground")}>
          {row.original.renewalStage ? RENEWAL_STAGE_LABELS[row.original.renewalStage as RenewalStage] : "Not started"}
        </span>
      ),
    },
  ];
  return (
    <SectionCard
      title="Contract expiry"
      description="Grouped by days to the end date. Cancelled contracts are excluded."
      icon={<CalendarClock />}
      action={<ExportMenu name="expiry" columns={columns} rows={exportRows} />}
    >
      <LocalDataTable
        columns={tableColumns}
        rows={rows}
        pageSize={pageSize}
        resetKey={bucket}
        onRowClick={(r) => router.push(`/extensions/amc-contracts/${r.id}`)}
        toolbar={
          <ConfigTableToolbar
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            filters={
              <StatusSelect
                label="Filter by expiry"
                value={bucket}
                onChange={(v) => setBucket(v as "all" | ExpiryBucket)}
                options={[
                  { value: "all", label: "All", count: all.length },
                  ...BUCKETS.map((b) => ({ value: b, label: EXPIRY_BUCKET_LABELS[b], count: all.filter((r) => r.bucket === b).length })),
                ]}
              />
            }
          />
        }
        emptyState={
          bucket === "all" ? (
            <EmptyState icon={<CalendarClock />} title="No contracts to show" description="Contracts appear here once they are signed. Clear the filters above if you expected some." />
          ) : (
            <EmptyState icon={<CalendarClock />} title="None in this group" description="No contract ends in this window. Pick another group, or show all." />
          )
        }
      />
    </SectionCard>
  );
}

function PipelineReport({ reports }: { reports: Reports }) {
  const router = useRouter();
  const [pageSize, setPageSize] = useState(10);
  const rows = reports.pipeline;
  const stages = [...new Set(rows.map((r) => r.renewalStage as RenewalStage))];
  const columns = [
    { key: "stage", label: "Stage" },
    { key: "contract", label: "Old contract" },
    { key: "customer", label: "Client" },
    { key: "property", label: "Property" },
    { key: "end", label: "Expiry" },
    { key: "proposal", label: "Renewal proposal" },
    { key: "manager", label: "Account manager" },
  ];
  const exportRows = rows.map((r) => ({
    stage: RENEWAL_STAGE_LABELS[r.renewalStage as RenewalStage],
    contract: r.proposalNumber,
    customer: r.customerName,
    property: r.propertyLabel,
    end: r.endDate,
    proposal: r.renewalProposal?.proposalNumber ?? "",
    manager: r.accountManagers.join(", "),
  }));
  const tableColumns: ColumnDef<PipelineRow, unknown>[] = [
    {
      id: "stage",
      header: "Stage",
      cell: ({ row }) => (
        <div className="flex flex-col text-sm">
          <span>{RENEWAL_STAGE_LABELS[row.original.renewalStage as RenewalStage]}</span>
          {row.original.renewalOverdue ? <span className="text-danger text-xs">past the end date</span> : null}
        </div>
      ),
    },
    {
      id: "contract",
      header: "Old contract",
      cell: ({ row }) => <span className="font-medium">{row.original.proposalNumber}</span>,
    },
    {
      id: "client",
      header: "Client",
      cell: ({ row }) => <IdentityCell title={row.original.customerName} subtitle={row.original.propertyLabel || null} />,
    },
    {
      id: "end",
      header: "Expiry",
      cell: ({ row }) => <EndCell endDate={row.original.endDate} label={row.original.expiryLabel} />,
    },
    {
      id: "proposal",
      header: "Renewal proposal",
      cell: ({ row }) =>
        row.original.renewalProposal ? (
          <Link href={`/extensions/amc/${row.original.renewalProposal.id}`} onClick={stop} className="text-sm hover:underline">
            {row.original.renewalProposal.proposalNumber}
          </Link>
        ) : row.original.renewedByContractId ? (
          <Link href={`/extensions/amc-contracts/${row.original.renewedByContractId}`} onClick={stop} className="text-sm hover:underline">
            Renewed contract
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "manager",
      header: "Account manager",
      cell: ({ row }) => <IconText icon={Users} muted={!row.original.accountManagers.length}>{row.original.accountManagers.join(", ") || "—"}</IconText>,
    },
  ];
  return (
    <SectionCard
      title="Renewal pipeline"
      description="Derived from each contract and its renewal proposal; nothing is kept by hand. Contracts enter it 90 days before the end date."
      icon={<Repeat />}
      action={<ExportMenu name="renewal-pipeline" columns={columns} rows={exportRows} />}
    >
      {stages.length ? (
        <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 px-5 pb-1 text-xs">
          {stages.map((s) => (
            <span key={s}>
              {RENEWAL_STAGE_LABELS[s]}: {rows.filter((r) => r.renewalStage === s).length}
            </span>
          ))}
        </div>
      ) : null}
      <LocalDataTable
        columns={tableColumns}
        rows={rows}
        pageSize={pageSize}
        onRowClick={(r) => router.push(`/extensions/amc-contracts/${r.id}`)}
        toolbar={<ConfigTableToolbar pageSize={pageSize} onPageSizeChange={setPageSize} />}
        emptyState={<EmptyState icon={<Repeat />} title="Nothing in the pipeline" description="A contract joins it 90 days before its end date." />}
      />
    </SectionCard>
  );
}

function ManagersReport({ reports }: { reports: Reports }) {
  const rows = reports.portfolio;
  const columns = [
    { key: "manager", label: "Account manager" },
    { key: "inForce", label: "Active contracts" },
    { key: "expiring", label: "Expiring within 90 days" },
    { key: "renewals", label: "Renewals in progress" },
    { key: "value", label: "Contract value (AED)" },
    { key: "properties", label: "Properties covered" },
  ];
  const exportRows = rows.map((r) => ({
    manager: r.manager,
    inForce: r.inForce,
    expiring: r.expiringWithin90,
    renewals: r.renewalsInProgress,
    value: r.inForceValue,
    properties: r.propertiesCovered,
  }));
  const tableColumns: ColumnDef<ManagerRow, unknown>[] = [
    { id: "manager", header: "Account manager", cell: ({ row }) => <IdentityCell title={row.original.manager} /> },
    { id: "inForce", header: right("Active"), cell: ({ row }) => <div className="text-right text-sm tabular-nums">{row.original.inForce}</div> },
    { id: "expiring", header: right("Expiring (90 days)"), cell: ({ row }) => <div className="text-right text-sm tabular-nums">{row.original.expiringWithin90}</div> },
    { id: "renewals", header: right("Renewals in progress"), cell: ({ row }) => <div className="text-right text-sm tabular-nums">{row.original.renewalsInProgress}</div> },
    {
      id: "value",
      header: right("Contract value"),
      cell: ({ row }) => (
        <div className="text-right">
          <Money value={row.original.inForceValue} className="text-sm" />
        </div>
      ),
    },
    {
      id: "properties",
      header: right("Properties covered"),
      cell: ({ row }) => (
        <div className="text-right text-sm tabular-nums">
          {row.original.propertiesCovered}
          {row.original.contractsWithoutProperty ? <span className="text-muted-foreground text-xs"> (+{row.original.contractsWithoutProperty} unlinked)</span> : null}
        </div>
      ),
    },
  ];
  return (
    <SectionCard
      title="Account manager portfolio"
      description="Per manager named on the signed contract. A contract with two managers counts for each. No commission is calculated."
      icon={<Users />}
      action={<ExportMenu name="account-managers" columns={columns} rows={exportRows} />}
    >
      <LocalDataTable
        columns={tableColumns}
        rows={rows}
        emptyState={<EmptyState icon={<Users />} title="No account managers yet" description="A manager appears here once they are named on a signed contract." />}
      />
    </SectionCard>
  );
}

function ServicesReport({ reports }: { reports: Reports }) {
  const rows = reports.services;
  const columns = [
    { key: "service", label: "Service" },
    { key: "type", label: "Unit" },
    { key: "contracts", label: "Contracts" },
    { key: "included", label: "Included" },
    { key: "used", label: "Used" },
    { key: "exhausted", label: "Exhausted" },
  ];
  const exportRows = rows.map((r) => ({
    service: r.serviceLabel,
    type: TYPE_LABELS[r.entitlementType],
    contracts: r.contracts,
    included: r.included ?? "",
    used: r.entitlementType === "informational" ? "" : r.used,
    exhausted: r.exhausted,
  }));
  const tableColumns: ColumnDef<ServiceRow, unknown>[] = [
    { id: "service", header: "Service", cell: ({ row }) => <span className="font-medium">{row.original.serviceLabel}</span> },
    { id: "type", header: "Unit", cell: ({ row }) => <span className="text-sm">{TYPE_LABELS[row.original.entitlementType]}</span> },
    { id: "contracts", header: right("Contracts"), cell: ({ row }) => <div className="text-right text-sm tabular-nums">{row.original.contracts}</div> },
    {
      id: "included",
      header: right("Included"),
      cell: ({ row }) => <div className="text-right text-sm tabular-nums">{row.original.included !== null ? formatQuantity(row.original.included) : "—"}</div>,
    },
    {
      id: "used",
      header: right("Used"),
      cell: ({ row }) => (
        <div className="text-right text-sm tabular-nums">{row.original.entitlementType === "informational" ? "—" : formatQuantity(row.original.used)}</div>
      ),
    },
    {
      id: "exhausted",
      header: right("Exhausted"),
      cell: ({ row }) => <div className="text-right text-sm tabular-nums">{row.original.included !== null ? row.original.exhausted : "—"}</div>,
    },
  ];
  return (
    <SectionCard
      title="Services"
      description="Contracts in force. Each row is one service in one unit: visits and hours are never added together; unlimited services show use only."
      icon={<BarChart3 />}
      action={<ExportMenu name="service-usage" columns={columns} rows={exportRows} />}
    >
      <LocalDataTable
        columns={tableColumns}
        rows={rows}
        emptyState={<EmptyState icon={<BarChart3 />} title="No services in force" description="Services appear here once a contract carrying them is active." />}
      />
    </SectionCard>
  );
}
