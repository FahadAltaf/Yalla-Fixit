"use client";

import { useState } from "react";
import Link from "next/link";
import { BarChart3, CalendarClock, Repeat, Users } from "lucide-react";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeading, PillTabs, SectionCard, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ErrorState, ListSkeleton, StatGridSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { EXPIRY_BUCKET_LABELS, RENEWAL_STAGE_LABELS, type ExpiryBucket, type RenewalStage } from "@/lib/amc/business";
import { formatQuantity } from "@/lib/amc/contracts";
import { useDebounce } from "@/hooks/use-debounce";
import { amcContractsService, type AmcReports as Reports } from "@/modules/amc-contracts/amc-contracts-service";

import { AmcSectionNav } from "./amc-section-nav";
import { CONTRACT_STATUS_LABELS, formatContractDate } from "./contract-status";
import { ExportMenu } from "./export-menu";
import { useAmcData } from "./use-amc-data";

type Tab = "expiry" | "pipeline" | "managers" | "services";
const ALL = "__all__";
const BUCKETS: ExpiryBucket[] = ["expired", "d0_30", "d31_60", "d61_90", "d90_plus"];
const TYPE_LABELS = { visits: "Visits", hours: "Hours", unlimited: "Unlimited", informational: "Included" } as const;

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
      <PageHeading eyebrow="AMC contracts" title="Reports" description="Contracts, renewals and services, from contract data only. Draft or rejected proposals and quotes are never counted as revenue." />
      <AmcSectionNav current="reports" />
      <div className="grid gap-3 sm:grid-cols-3">
        <Select value={manager} onValueChange={setManager}>
          <SelectTrigger aria-label="Account manager">
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
        <Input placeholder="Customer (name or ID)" value={customer} onChange={(e) => setCustomer(e.target.value)} aria-label="Customer" />
        <Input placeholder="Property" value={property} onChange={(e) => setProperty(e.target.value)} aria-label="Property" />
      </div>

      {error ? (
        <ErrorState title="Could not load the reports" message={error} onRetry={reload} />
      ) : loading || !data ? (
        <>
          <StatGridSkeleton count={4} />
          <ListSkeleton rows={6} />
        </>
      ) : (
        <ReportsBody reports={data.reports} tab={tab} setTab={setTab} pending={summary.data?.summary.pendingActivation ?? null} usage30={summary.data?.summary.usageLast30Days ?? null} />
      )}
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
          label="Customers with an AMC"
          value={m.customersWithAmc}
          headline={m.contractsWithoutCustomer ? `${m.contractsWithoutCustomer} contract(s) not linked to a customer` : "All linked"}
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
        <p className="text-muted-foreground text-sm">Active contracts with their customer, property and coverage, filters applied:</p>
        <ExportMenu name="active-contracts" columns={ACTIVE_COLUMNS} rows={activeRows(reports)} />
      </div>
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
      {tab === "expiry" ? <ExpiryReport reports={reports} /> : null}
      {tab === "pipeline" ? <PipelineReport reports={reports} /> : null}
      {tab === "managers" ? <ManagersReport reports={reports} /> : null}
      {tab === "services" ? <ServicesReport reports={reports} /> : null}
    </>
  );
}

const ACTIVE_COLUMNS = [
  { key: "contract", label: "Contract" },
  { key: "customer", label: "Customer" },
  { key: "customerRef", label: "Customer ID" },
  { key: "property", label: "Property" },
  { key: "linked", label: "Customer/property record" },
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
      linked: [r.customerId ? "customer" : null, r.propertyId ? "property" : null].filter(Boolean).join(" + ") || "not linked",
      start: r.startDate,
      end: r.endDate,
      status: CONTRACT_STATUS_LABELS[r.displayStatus],
      manager: r.accountManagers.join(", "),
      services: r.coverage.totalServices,
      exhausted: r.coverage.exhausted,
      value: r.grandTotal,
    }));
}

function ExpiryReport({ reports }: { reports: Reports }) {
  const rows = reports.expiry;
  const columns = [
    { key: "bucket", label: "Expiry" },
    { key: "contract", label: "Contract" },
    { key: "customer", label: "Customer" },
    { key: "property", label: "Property" },
    { key: "manager", label: "Account manager" },
    { key: "end", label: "End date" },
    { key: "status", label: "Status" },
    { key: "renewal", label: "Renewal" },
    { key: "value", label: "Value (AED)" },
  ];
  const exportRows = rows.map((r) => ({
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
  return (
    <SectionCard
      title="Contract expiry"
      description="Grouped by days to the end date. Cancelled contracts are excluded."
      icon={<CalendarClock />}
      bodyClassName="px-5 pb-5 space-y-5"
      action={<ExportMenu name="expiry" columns={columns} rows={exportRows} />}
    >
      {BUCKETS.map((b) => {
        const list = rows.filter((r) => r.bucket === b);
        return (
          <div key={b} className="space-y-2">
            <h3 className="text-sm font-medium">
              {EXPIRY_BUCKET_LABELS[b]} <span className="text-muted-foreground">({list.length})</span>
            </h3>
            {list.length ? <ContractRows rows={list} /> : <p className="text-muted-foreground text-sm">None.</p>}
          </div>
        );
      })}
    </SectionCard>
  );
}

function ContractRows({ rows }: { rows: Reports["expiry"] }) {
  return (
    <div className="-mx-5 overflow-x-auto">
      <Table className="min-w-[780px]">
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">Contract</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Property</TableHead>
            <TableHead>Account manager</TableHead>
            <TableHead>End</TableHead>
            <TableHead className="pr-5">Renewal</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="pl-5 font-medium">
                <Link href={`/extensions/amc-contracts/${r.id}`} className="hover:underline">
                  {r.proposalNumber}
                </Link>
              </TableCell>
              <TableCell>
                {r.customerId ? (
                  <Link href={`/extensions/amc-contracts/customers/${r.customerId}`} className="hover:underline">
                    {r.customerName}
                  </Link>
                ) : (
                  r.customerName
                )}
              </TableCell>
              <TableCell>{r.propertyLabel || "—"}</TableCell>
              <TableCell>{r.accountManagers.join(", ") || "—"}</TableCell>
              <TableCell className="tabular-nums">
                {formatContractDate(r.endDate)}
                <div className="text-muted-foreground text-xs">{r.expiryLabel}</div>
              </TableCell>
              <TableCell className="pr-5">{r.renewalStage ? RENEWAL_STAGE_LABELS[r.renewalStage as RenewalStage] : "Not started"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function PipelineReport({ reports }: { reports: Reports }) {
  const rows = reports.pipeline;
  const stages = [...new Set(rows.map((r) => r.renewalStage as RenewalStage))];
  const columns = [
    { key: "stage", label: "Stage" },
    { key: "contract", label: "Old contract" },
    { key: "customer", label: "Customer" },
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
  return (
    <SectionCard
      title="Renewal pipeline"
      description="Derived from each contract and its renewal proposal; nothing is kept by hand. Contracts enter it 90 days before the end date."
      icon={<Repeat />}
      bodyClassName="pb-2"
      action={<ExportMenu name="renewal-pipeline" columns={columns} rows={exportRows} />}
    >
      {rows.length === 0 ? (
        <p className="text-muted-foreground px-5 pb-4 text-sm">Nothing in the pipeline.</p>
      ) : (
        <>
          <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 px-5 pb-3 text-xs">
            {stages.map((s) => (
              <span key={s}>
                {RENEWAL_STAGE_LABELS[s]}: {rows.filter((r) => r.renewalStage === s).length}
              </span>
            ))}
          </div>
          <div className="overflow-x-auto">
            <Table className="min-w-[860px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Stage</TableHead>
                  <TableHead>Old contract</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Property</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Renewal proposal</TableHead>
                  <TableHead className="pr-5">Account manager</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="pl-5">
                      {RENEWAL_STAGE_LABELS[r.renewalStage as RenewalStage]}
                      {r.renewalOverdue ? <div className="text-destructive text-xs">past the end date</div> : null}
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link href={`/extensions/amc-contracts/${r.id}`} className="hover:underline">
                        {r.proposalNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{r.customerName}</TableCell>
                    <TableCell>{r.propertyLabel || "—"}</TableCell>
                    <TableCell className="tabular-nums">
                      {formatContractDate(r.endDate)}
                      <div className="text-muted-foreground text-xs">{r.expiryLabel}</div>
                    </TableCell>
                    <TableCell>
                      {r.renewalProposal ? (
                        <Link href={`/extensions/amc/${r.renewalProposal.id}`} className="hover:underline">
                          {r.renewalProposal.proposalNumber}
                        </Link>
                      ) : r.renewedByContractId ? (
                        <Link href={`/extensions/amc-contracts/${r.renewedByContractId}`} className="hover:underline">
                          Renewed contract
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="pr-5">{r.accountManagers.join(", ") || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
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
  return (
    <SectionCard
      title="Account manager portfolio"
      description="Per manager named on the signed contract. A contract with two managers counts for each. No commission is calculated."
      icon={<Users />}
      bodyClassName="pb-2"
      action={<ExportMenu name="account-managers" columns={columns} rows={exportRows} />}
    >
      <div className="overflow-x-auto">
        <Table className="min-w-[680px]">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Account manager</TableHead>
              <TableHead className="text-right">Active</TableHead>
              <TableHead className="text-right">Expiring (90 days)</TableHead>
              <TableHead className="text-right">Renewals in progress</TableHead>
              <TableHead className="text-right">Contract value</TableHead>
              <TableHead className="pr-5 text-right">Properties covered</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.manager}>
                <TableCell className="pl-5 font-medium">{r.manager}</TableCell>
                <TableCell className="text-right tabular-nums">{r.inForce}</TableCell>
                <TableCell className="text-right tabular-nums">{r.expiringWithin90}</TableCell>
                <TableCell className="text-right tabular-nums">{r.renewalsInProgress}</TableCell>
                <TableCell className="text-right">
                  <Money value={r.inForceValue} className="text-sm" />
                </TableCell>
                <TableCell className="pr-5 text-right tabular-nums">
                  {r.propertiesCovered}
                  {r.contractsWithoutProperty ? <span className="text-muted-foreground text-xs"> (+{r.contractsWithoutProperty} unlinked)</span> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
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
  return (
    <SectionCard
      title="Services"
      description="Contracts in force. Each row is one service in one unit: visits and hours are never added together; unlimited services show use only."
      icon={<BarChart3 />}
      bodyClassName="pb-2"
      action={<ExportMenu name="service-usage" columns={columns} rows={exportRows} />}
    >
      <div className="overflow-x-auto">
        <Table className="min-w-[620px]">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Service</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">Contracts</TableHead>
              <TableHead className="text-right">Included</TableHead>
              <TableHead className="text-right">Used</TableHead>
              <TableHead className="pr-5 text-right">Exhausted</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.serviceId}-${r.entitlementType}`}>
                <TableCell className="pl-5 font-medium">{r.serviceLabel}</TableCell>
                <TableCell>{TYPE_LABELS[r.entitlementType]}</TableCell>
                <TableCell className="text-right tabular-nums">{r.contracts}</TableCell>
                <TableCell className="text-right tabular-nums">{r.included !== null ? formatQuantity(r.included) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{r.entitlementType === "informational" ? "—" : formatQuantity(r.used)}</TableCell>
                <TableCell className="pr-5 text-right tabular-nums">{r.included !== null ? r.exhausted : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </SectionCard>
  );
}
