"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, ChevronRight, ClipboardCheck, Home, Layers, Pencil, Plus, Receipt, RefreshCw, ScrollText, UserRound, UserX } from "lucide-react";
import { toast } from "sonner";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Money } from "@/components/ui/money";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataRow, SectionCard, StatCard, StatCardGrid, TabCount } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, SectionSkeleton, StatGridSkeleton, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { RENEWAL_STAGE_LABELS, type RenewalStage } from "@/lib/amc/business";
import { LIFECYCLE_LABELS, documentExpiryState } from "@/lib/amc/client-profile";
import { formatQuantity, todayInDubai } from "@/lib/amc/contracts";
import { amcContractsService, type CustomerInput, type CustomerOverview, type PropertyInput, type PropertyOverview, type PropertyRecord } from "@/modules/amc-contracts/amc-contracts-service";

import { ELIGIBILITY_LABELS } from "./contract-commercial";
import { CONTRACT_STATUS_LABELS, contractStatusTone, formatContractDate } from "./contract-status";
import { CustomerDialog } from "./customers-page";
import { PropertyFields, UNIT_TYPE_LABELS, cleanProperty } from "./customer-pickers";
import { useAmcData } from "./use-amc-data";
import { CommunicationPanel } from "./profile/communication-panel";
import { ContactsPanel } from "./profile/contacts-panel";
import { DetailList } from "./profile/detail-list";
import { DocumentsPanel } from "./profile/documents-panel";
import { IdentityCard, LIFECYCLE_TONE } from "./profile/identity-card";
import { AccessRulesPanel, AssetsPanel, ScopePanel } from "./profile/property-panels";
import { useDialog } from "./profile/use-dialog";
import { useUrlTab } from "./profile/use-url-tab";
import { ClientEnquiriesCard } from "./enquiries/client-enquiries-card";

type ContractItem = CustomerOverview["contracts"][number];
type AssessmentItem = CustomerOverview["assessments"][number];
type QuoteItem = CustomerOverview["quotes"][number];

const CLIENTS_HREF = "/extensions/amc-contracts/customers";
const unitTypeLabel = (t: string | null) => (t ? (UNIT_TYPE_LABELS[t as keyof typeof UNIT_TYPE_LABELS] ?? t) : null);

/* ------------------------------------------------------------------ */
/* The record-page frame, as on Snagging's job page                    */
/* ------------------------------------------------------------------ */

/** "14:32" on the viewer's own clock, for the "Updated" note beside Refresh. */
function formatClock(at: number): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(at));
}

/**
 * The page's data with the time it arrived, and a Refresh that knows when
 * it is still waiting: `reload` keeps the page on screen, so the spinner
 * runs until an answer newer than the click lands.
 */
function useRecord<T>(load: () => Promise<T>, key: string) {
  const record = useAmcData(async () => ({ value: await load(), fetchedAt: Date.now() }), key);
  const [asked, setAsked] = useState(0);
  const refreshing = asked > 0 && !record.error && (record.data?.fetchedAt ?? 0) < asked;
  const refresh = () => {
    setAsked(Date.now());
    record.reload();
  };
  return { ...record, data: record.data?.value ?? null, fetchedAt: record.data?.fetchedAt ?? null, refreshing, refresh };
}

/** Back link on the left; when it was read and Refresh on the right. It never waits on the record. */
function DetailToolbar({
  backHref,
  backLabel,
  fetchedAt,
  refreshing,
  onRefresh,
}: {
  backHref: string;
  backLabel: string;
  fetchedAt?: number | null;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href={backHref}>
          <ArrowLeft className="size-4" />
          {backLabel}
        </Link>
      </Button>
      {onRefresh ? (
        <div className="flex items-center gap-3">
          {fetchedAt ? <span className="text-muted-foreground hidden text-xs sm:inline">Updated {formatClock(fetchedAt)}</span> : null}
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing} aria-label="Refresh this page">
            <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The header card, tabs and a panel greyed out while the record arrives. */
function DetailSkeleton() {
  return (
    <>
      <Card className="gap-0 p-0">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="space-y-2">
            <Skeleton className="h-5 w-28 rounded-full" />
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-36" />
          </div>
        </div>
      </Card>
      <StatGridSkeleton />
      <Skeleton className="h-9 w-full rounded-lg" />
      <SectionSkeleton />
    </>
  );
}

const TABS_LIST = "h-auto w-full flex-wrap justify-start gap-1 group-data-horizontal/tabs:h-auto";

/* ------------------------------------------------------------------ */
/* Shared lists                                                        */
/* ------------------------------------------------------------------ */

function ContractsTable({ contracts, showProperty = true }: { contracts: ContractItem[]; showProperty?: boolean }) {
  const router = useRouter();
  if (contracts.length === 0) return <EmptyState icon={<ScrollText className="size-5" />} title="No contracts" description="Contracts signed with this client appear here, each one separately." />;
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[820px]">
        <TableHeader className="[&_th]:text-muted-foreground">
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-5">Contract</TableHead>
            {showProperty ? <TableHead>Property</TableHead> : null}
            <TableHead>Start</TableHead>
            <TableHead>End</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Account manager</TableHead>
            <TableHead>Coverage</TableHead>
            <TableHead className="pr-5">Renewal</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contracts.map((c) => (
            <TableRow key={c.id} className="hover:bg-muted/50 h-14 cursor-pointer" onClick={() => router.push(`/extensions/amc-contracts/${c.id}`)}>
              <TableCell className="pl-5 font-medium">
                <Link href={`/extensions/amc-contracts/${c.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                  {c.proposalNumber}
                </Link>
                <div className="text-muted-foreground text-xs">
                  <Money value={c.grandTotal} className="text-xs" />
                </div>
              </TableCell>
              {showProperty ? (
                <TableCell>
                  {c.propertyId ? (
                    <Link href={`/extensions/amc-contracts/properties/${c.propertyId}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                      {c.propertyLabel || "Property"}
                    </Link>
                  ) : (
                    <span>{c.propertyLabel || "—"}</span>
                  )}
                </TableCell>
              ) : null}
              <TableCell className="tabular-nums">{formatContractDate(c.startDate)}</TableCell>
              <TableCell className="tabular-nums">
                {formatContractDate(c.endDate)}
                <div className="text-muted-foreground text-xs">{c.expiryLabel}</div>
              </TableCell>
              <TableCell>
                <Badge variant="secondary" className={`border-0 font-medium ${contractStatusTone(c.displayStatus)}`}>
                  {CONTRACT_STATUS_LABELS[c.displayStatus]}
                </Badge>
              </TableCell>
              <TableCell>{c.accountManagers.join(", ") || "—"}</TableCell>
              <TableCell>
                {c.coverage.totalServices} services
                {c.coverage.exhausted ? <div className="text-danger text-xs">{c.coverage.exhausted} exhausted</div> : null}
              </TableCell>
              <TableCell className="pr-5">
                {c.renewalStage ? RENEWAL_STAGE_LABELS[c.renewalStage as RenewalStage] : "—"}
                {c.renewalOverdue ? <div className="text-danger text-xs">past the end date</div> : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function AssessmentsList({ assessments }: { assessments: AssessmentItem[] }) {
  if (assessments.length === 0) return <EmptyState icon={<ClipboardCheck className="size-5" />} title="No site visits yet" description="Start one from the button at the top of the page." />;
  return (
    <ul className="divide-y">
      {assessments.map((a) => (
        <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 px-5 py-3 text-sm">
          <div className="min-w-0">
            <Link href={`/extensions/amc-contracts/assessments/${a.id}`} className="font-medium hover:underline">
              {a.assessmentNumber}
            </Link>
            <span className="text-muted-foreground">
              {" "}
              · {a.assessedOn ? formatContractDate(a.assessedOn) : "not dated"}
              {a.assessorName ? ` · ${a.assessorName}` : ""}
              {a.propertyLabel ? ` · ${a.propertyLabel}` : ""}
            </span>
            {a.summary ? <div className="text-muted-foreground line-clamp-2 text-xs">{a.summary}</div> : null}
            {a.proposal ? (
              <div className="text-xs">
                Proposal{" "}
                <Link href={`/extensions/amc/${a.proposal.id}`} className="hover:underline">
                  {a.proposal.proposalNumber}
                </Link>{" "}
                ({a.proposal.status.replace(/_/g, " ")})
              </div>
            ) : null}
          </div>
          <Badge variant="secondary" className={`border-0 font-medium capitalize ${a.status === "completed" ? "bg-success/10 text-success" : "bg-mist text-ink-soft"}`}>
            {a.status}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function QuotesList({ quotes }: { quotes: QuoteItem[] }) {
  if (quotes.length === 0) return <EmptyState icon={<Receipt className="size-5" />} title="No quotes" description="Quotes for work outside a contract appear here." />;
  return (
    <ul className="divide-y">
      {quotes.map((q) => (
        <li key={q.id} className="px-5 py-3 text-sm">
          <Link href={`/extensions/amc-contracts/${q.contractId}`} className="font-medium hover:underline">
            {q.quoteNumber}
          </Link>{" "}
          · {q.serviceLabel} · {ELIGIBILITY_LABELS[q.eligibility]}
          <div className="text-muted-foreground text-xs">
            {q.status === "estimate_linked" ? `Estimate ${q.fsmEstimateNumber}` : q.status === "draft" ? "Draft" : "Cancelled"}
            {q.finalPrice !== null ? ` · AED ${q.finalPrice.toLocaleString("en-AE", { minimumFractionDigits: 2 })}` : ""}
            {q.discountAmount > 0 ? ` (saves AED ${q.discountAmount.toLocaleString("en-AE", { minimumFractionDigits: 2 })})` : ""}
          </div>
        </li>
      ))}
    </ul>
  );
}

function StartAssessmentButton({ customerId, propertyId }: { customerId: string | null; propertyId: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      const { assessment } = await amcContractsService.createAssessment({ customerId, propertyId });
      router.push(`/extensions/amc-contracts/assessments/${assessment.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the site visit.");
      setBusy(false);
    }
  };
  return (
    <SubmitButton onClick={() => void start()} pending={busy} pendingLabel="Starting…" icon={<ClipboardCheck className="size-4" />}>
      New site visit
    </SubmitButton>
  );
}

/* ------------------------------------------------------------------ */

const CUSTOMER_TABS = ["overview", "properties", "contracts", "visits", "contacts", "documents", "communication"] as const;

/**
 * The client profile (BRD 5.9, DEV-379), one page per client like the
 * Snagging job page: a header card, the figures, then tabs kept in ?tab=,
 * each mounted once opened. Payments, the PPM schedule and service history
 * join as their phases land.
 */
export function CustomerDetail({ id }: { id: string }) {
  const router = useRouter();
  const { data, error, loading, reload, fetchedAt, refreshing, refresh } = useRecord(() => amcContractsService.customer(id), id);
  useBreadcrumbLabel("customers", "Clients");
  useBreadcrumbLabel(id, data?.overview.customer.name ?? "Client");
  const editing = useDialog();
  const addingProperty = useDialog();
  const { tab, setTab, isOpened } = useUrlTab(CUSTOMER_TABS, "overview");

  const toolbar = <DetailToolbar backHref={CLIENTS_HREF} backLabel="Clients" fetchedAt={fetchedAt} refreshing={refreshing} onRefresh={data ? refresh : undefined} />;

  if (loading)
    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        {toolbar}
        <DetailSkeleton />
      </div>
    );
  if (error && /not found/i.test(error))
    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        {toolbar}
        <Card className="p-0">
          <EmptyState icon={<UserX className="size-5" />} title="Client not found" description="It may have been merged or removed. Find the client in the list instead." action={{ label: "Back to clients", onClick: () => router.push(CLIENTS_HREF) }} />
        </Card>
      </div>
    );
  if (error || !data)
    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        {toolbar}
        <ErrorState title="Could not load this client" message={error} onRetry={reload} />
      </div>
    );

  const { customer, properties, contracts, assessments, quotes, summary } = data.overview;
  const canEdit = data.canEdit !== false;
  const licenceState = customer.customerType !== "individual" ? documentExpiryState(customer.tradeLicenseExpiry, todayInDubai(), 60) : null;
  const panel = (value: (typeof CUSTOMER_TABS)[number], children: React.ReactNode) =>
    isOpened(value) ? (
      <TabsContent value={value} forceMount className="mt-4 flex flex-col gap-6 data-[state=inactive]:hidden">
        {children}
      </TabsContent>
    ) : null;

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      {toolbar}

      <Card className="gap-0 p-0">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              {customer.customerRef ? <Badge variant="outline">Customer ID {customer.customerRef}</Badge> : null}
              {customer.customerType ? <Badge variant="outline">{customer.customerType === "company" ? "Company" : "Individual"}</Badge> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl">{customer.name}</h2>
              <Badge variant="secondary" className={`border-0 font-medium ${LIFECYCLE_TONE[customer.lifecycle]}`}>
                {LIFECYCLE_LABELS[customer.lifecycle]}
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm">{[customer.company, customer.phone, customer.email].filter(Boolean).join(" · ") || "No contact details recorded"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <Button variant="outline" onClick={() => editing.show(true)}>
                <Pencil className="size-4" />
                Edit
              </Button>
            ) : null}
            <StartAssessmentButton customerId={customer.id} propertyId={null} />
          </div>
        </div>
        {licenceState ? (
          <div className={`border-t px-5 py-3 ${licenceState === "expired" ? "border-danger/30 bg-danger/5" : "border-warning/30 bg-warning/5"}`}>
            <p className="text-sm">
              <span className={`font-medium ${licenceState === "expired" ? "text-danger" : "text-warning"}`}>
                {licenceState === "expired" ? "Trade licence expired" : "Trade licence expiring"}
              </span>
              <span className="text-muted-foreground">
                {" "}
                · {customer.tradeLicenseExpiry ? formatContractDate(customer.tradeLicenseExpiry) : ""}. Ask the client for the renewed licence and upload it under Documents.
              </span>
            </p>
          </div>
        ) : null}
      </Card>

      <StatCardGrid columns={4}>
        <StatCard label="Contracts in force" value={summary.inForce} headline={`${summary.contracts} in total`} caption={`${summary.historical} historical · ${summary.renewals} renewals`} />
        <StatCard
          label="Active properties"
          value={summary.activeProperties}
          headline={summary.inForceContractsWithoutProperty ? `${summary.inForceContractsWithoutProperty} contract(s) without a property record` : "All linked"}
          caption="Covered by a contract in force"
        />
        <StatCard label="Current AMC value" value={<Money value={summary.currentValue} className="text-xl" />} headline="Contracts in force" caption="Incl. VAT, as signed" />
        <StatCard label="Additional-service quotes" value={summary.quotesIssued} headline={`${summary.quotesDraft} draft`} caption="Issued = FSM estimate linked" />
      </StatCardGrid>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className={TABS_LIST}>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="properties">
            Properties
            <TabCount value={properties.length} />
          </TabsTrigger>
          <TabsTrigger value="contracts">
            Contracts
            <TabCount value={contracts.length} />
          </TabsTrigger>
          <TabsTrigger value="visits">
            Site visits
            <TabCount value={assessments.length} />
          </TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="communication">Communication log</TabsTrigger>
        </TabsList>

        {panel(
          "overview",
          <>
            <IdentityCard customer={customer} canEdit={canEdit} onChanged={reload} />
            <ClientEnquiriesCard customerId={customer.id} />
          </>,
        )}
        {panel(
          "properties",
          <SectionCard
            title="Properties"
            description="The client's addresses, the same ones Snagging uses. Open one for its contract, assets, access rules and scope."
            icon={<Building2 />}
            bodyClassName="border-t"
            action={
              canEdit ? (
                <Button size="sm" variant="outline" onClick={() => addingProperty.show(true)}>
                  <Plus className="size-4" />
                  Add property
                </Button>
              ) : null
            }
          >
            {properties.length === 0 ? (
              <EmptyState
                icon={<Building2 className="size-5" />}
                title="No properties yet"
                description="Add the client's villa, apartment or premises; contracts and site visits are raised against it."
                action={canEdit ? { label: "Add property", onClick: () => addingProperty.show(true) } : undefined}
              />
            ) : (
              <div className="divide-y">
                {properties.map((p) => (
                  <DataRow
                    key={p.id}
                    onClick={() => router.push(`/extensions/amc-contracts/properties/${p.id}`)}
                    icon={p.parentPropertyId ? <Layers /> : <Building2 />}
                    title={p.label}
                    subtitle={
                      [unitTypeLabel(p.unitType), p.parentPropertyId ? `part of ${properties.find((x) => x.id === p.parentPropertyId)?.label ?? "another unit"}` : null, p.address, p.community]
                        .filter(Boolean)
                        .join(" · ") || "No address recorded"
                    }
                    trailing={<ChevronRight className="text-muted-foreground size-4" aria-hidden />}
                  />
                ))}
              </div>
            )}
          </SectionCard>,
        )}
        {panel(
          "contracts",
          <>
            <SectionCard title="Contracts" description="Each contract separately; a client can have several." icon={<ScrollText />} bodyClassName="border-t">
              <ContractsTable contracts={contracts} />
            </SectionCard>
            <SectionCard title="Additional-service quotes" icon={<Receipt />} bodyClassName="border-t">
              <QuotesList quotes={quotes} />
            </SectionCard>
          </>,
        )}
        {panel(
          "visits",
          <SectionCard title="Site visits" description="Surveys of the client's properties, and the proposals raised from them." icon={<ClipboardCheck />} bodyClassName="border-t">
            <AssessmentsList assessments={assessments} />
          </SectionCard>,
        )}
        {panel("contacts", <ContactsPanel customerId={customer.id} canEdit={canEdit} />)}
        {panel("documents", <DocumentsPanel target={{ customerId: customer.id }} canUpload={canEdit} title="Documents (client, properties and contracts)" />)}
        {panel("communication", <CommunicationPanel customerId={customer.id} />)}
      </Tabs>

      <CustomerDialog
        key={editing.key}
        open={editing.open}
        onOpenChange={editing.onOpenChange}
        title="Edit client"
        description="Changes what future documents carry. Signed contracts keep their own copy of these details."
        initial={customerInput(customer)}
        onSave={async (input) => {
          await amcContractsService.updateCustomer(customer.id, input);
          toast.success("Client saved. Signed contracts are unchanged.");
          reload();
        }}
      />
      <PropertyDialog
        key={`property-${addingProperty.key}`}
        open={addingProperty.open}
        onOpenChange={addingProperty.onOpenChange}
        title="Add property"
        description={`Adds an address for ${customer.name}. Snagging sees it too.`}
        submitLabel="Add property"
        initial={{ label: "" }}
        parentOptions={properties.map((p) => ({ id: p.id, label: p.label }))}
        onSave={async (input) => {
          await amcContractsService.createProperty(customer.id, input);
          toast.success("Property added");
          reload();
        }}
      />
    </div>
  );
}

function customerInput(c: CustomerOverview["customer"]): CustomerInput {
  return {
    name: c.name,
    customerRef: c.customerRef,
    company: c.company,
    email: c.email,
    phone: c.phone,
    notes: c.notes,
    customerType: c.customerType as CustomerInput["customerType"],
    lifecycle: c.lifecycle,
    tradeLicenseNo: c.tradeLicenseNo,
    tradeLicenseExpiry: c.tradeLicenseExpiry,
    trn: c.trn,
    preferredChannel: c.preferredChannel as CustomerInput["preferredChannel"],
    preferredLanguage: c.preferredLanguage,
  };
}

/* ------------------------------------------------------------------ */

const PROPERTY_TABS = ["overview", "contracts", "visits", "assets", "access", "scope", "documents"] as const;

/**
 * A property (BRD 5.2, 5.9): details and combined units, its AMC, the asset
 * register, access rules, scope and documents. Laid out as the client page.
 */
export function PropertyDetail({ id }: { id: string }) {
  const router = useRouter();
  const { data, error, loading, reload, fetchedAt, refreshing, refresh } = useRecord(() => amcContractsService.property(id), id);
  useBreadcrumbLabel("properties", "Properties");
  useBreadcrumbLabel(id, data?.overview.property.label ?? "Property");
  const editing = useDialog();
  const { tab, setTab, isOpened } = useUrlTab(PROPERTY_TABS, "overview");

  const owner = data?.overview.customer ?? null;
  const toolbar = (
    <DetailToolbar
      backHref={owner ? `${CLIENTS_HREF}/${owner.id}?tab=properties` : CLIENTS_HREF}
      backLabel={owner ? owner.name : "Clients"}
      fetchedAt={fetchedAt}
      refreshing={refreshing}
      onRefresh={data ? refresh : undefined}
    />
  );

  if (loading)
    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        {toolbar}
        <DetailSkeleton />
      </div>
    );
  if (error && /not found/i.test(error))
    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        {toolbar}
        <Card className="p-0">
          <EmptyState icon={<Building2 className="size-5" />} title="Property not found" description="It may have been removed. Open the client to see their properties." action={{ label: "Back to clients", onClick: () => router.push(CLIENTS_HREF) }} />
        </Card>
      </div>
    );
  if (error || !data)
    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        {toolbar}
        <ErrorState title="Could not load this property" message={error} onRetry={reload} />
      </div>
    );

  const { property, customer, current, previous, assessments, quotes }: PropertyOverview = data.overview;
  const units = data.units ?? { parent: null, children: [] };
  const canEdit = data.canEdit !== false;
  const panel = (value: (typeof PROPERTY_TABS)[number], children: React.ReactNode) =>
    isOpened(value) ? (
      <TabsContent value={value} forceMount className="mt-4 flex flex-col gap-6 data-[state=inactive]:hidden">
        {children}
      </TabsContent>
    ) : null;

  const left = [
    { label: "Category", value: property.propertyCategory ? <span className="capitalize">{property.propertyCategory}</span> : null },
    { label: "Type", value: unitTypeLabel(property.unitType) },
    { label: "Building", value: property.building },
    { label: "Unit / floor", value: [property.unitNo, property.floor ? `floor ${property.floor}` : null].filter(Boolean).join(", ") },
    { label: "Street / city", value: [property.street, property.city].filter(Boolean).join(", ") },
  ];
  const right = [
    { label: "Community", value: property.community },
    { label: "Size", value: [property.sizeSqft ? `${property.sizeSqft} sq ft` : null, property.bedrooms !== null ? `${property.bedrooms} bed` : null].filter(Boolean).join(" · ") },
    { label: "Floors", value: property.floorsCount },
    { label: "Occupied by", value: property.occupancy ? <span className="capitalize">{property.occupancy}</span> : null },
    { label: "Zones", value: property.zones.length ? property.zones.join(", ") : null },
  ];

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      {toolbar}

      <Card className="gap-0 p-0">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              {unitTypeLabel(property.unitType) ? <Badge variant="outline">{unitTypeLabel(property.unitType)}</Badge> : null}
              {property.propertyCategory ? (
                <Badge variant="outline" className="capitalize">
                  {property.propertyCategory}
                </Badge>
              ) : null}
              {units.parent ? <Badge variant="outline">Part of {units.parent.label}</Badge> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl">{property.label}</h2>
              {current ? (
                <Badge variant="secondary" className={`border-0 font-medium ${contractStatusTone(current.displayStatus)}`}>
                  {CONTRACT_STATUS_LABELS[current.displayStatus]}
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-mist text-ink-soft border-0 font-medium">
                  No contract in force
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              {[customer?.name, property.address, property.community].filter(Boolean).join(" · ") || "No address recorded"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {customer ? (
              <Button asChild variant="outline">
                <Link href={`${CLIENTS_HREF}/${customer.id}`}>
                  <UserRound className="size-4" />
                  Client
                </Link>
              </Button>
            ) : null}
            {canEdit ? (
              <Button variant="outline" onClick={() => editing.show(true)}>
                <Pencil className="size-4" />
                Edit
              </Button>
            ) : null}
            <StartAssessmentButton customerId={customer?.id ?? null} propertyId={property.id} />
          </div>
        </div>
        {property.accessConstraints ? (
          <div className="border-warning/30 bg-warning/5 border-t px-5 py-3">
            <p className="text-sm">
              <span className="text-warning font-medium">Access constraints</span>
              <span className="text-muted-foreground"> · {property.accessConstraints}</span>
            </p>
          </div>
        ) : null}
      </Card>

      <StatCardGrid columns={4}>
        <StatCard
          label="Current AMC"
          value={current ? current.proposalNumber : "None"}
          headline={current ? CONTRACT_STATUS_LABELS[current.displayStatus] : "No contract in force"}
          caption={current ? `${formatContractDate(current.startDate)} to ${formatContractDate(current.endDate)}` : "Start one from a proposal"}
        />
        <StatCard label="Previous contracts" value={previous.length} headline="Kept as they were" caption="Renewals never overwrite them" />
        <StatCard label="Site visits" value={assessments.length} headline={`${assessments.filter((a) => a.status === "completed").length} completed`} caption="Surveys of this property" />
        <StatCard label="Additional-service quotes" value={quotes.length} headline={`${quotes.filter((q) => q.status === "draft").length} draft`} caption="Work outside the contract" />
      </StatCardGrid>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className={TABS_LIST}>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="contracts">
            Contracts
            <TabCount value={previous.length + (current ? 1 : 0)} />
          </TabsTrigger>
          <TabsTrigger value="visits">
            Site visits
            <TabCount value={assessments.length} />
          </TabsTrigger>
          <TabsTrigger value="assets">Assets</TabsTrigger>
          <TabsTrigger value="access">Access rules</TabsTrigger>
          <TabsTrigger value="scope">Scope</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        {panel(
          "overview",
          <>
            <div className="grid gap-6 lg:grid-cols-3">
              <SectionCard title="Details" icon={<Home />} bodyClassName="px-5 pb-4" className="lg:col-span-2">
                <div className="grid gap-x-8 sm:grid-cols-2">
                  <DetailList rows={left} />
                  <DetailList rows={right} />
                </div>
              </SectionCard>
              <SectionCard title="Combined units" icon={<Layers />} description="Linked, not merged: each keeps its owner, billing and history." bodyClassName="border-t">
                {units.parent ? (
                  <DataRow
                    onClick={() => router.push(`/extensions/amc-contracts/properties/${units.parent!.id}`)}
                    icon={<Building2 />}
                    title={units.parent.label}
                    subtitle="This unit is part of it"
                    trailing={<ChevronRight className="text-muted-foreground size-4" aria-hidden />}
                  />
                ) : null}
                {units.children.map((u) => (
                  <DataRow
                    key={u.id}
                    onClick={() => router.push(`/extensions/amc-contracts/properties/${u.id}`)}
                    icon={<Layers />}
                    title={u.label}
                    subtitle={[unitTypeLabel(u.unitType), u.customerId && u.customerId !== customer?.id ? "different owner" : null].filter(Boolean).join(" · ") || "Unit within"}
                    trailing={<ChevronRight className="text-muted-foreground size-4" aria-hidden />}
                  />
                ))}
                {!units.parent && units.children.length === 0 ? <p className="text-muted-foreground px-5 py-4 text-sm">Not linked to other units. Link one from its Edit form.</p> : null}
              </SectionCard>
            </div>

            <CurrentAmcCard current={current} />
          </>,
        )}
        {panel(
          "contracts",
          <>
            <SectionCard title="Previous contracts" description="Kept as they were; renewals never overwrite them." icon={<ScrollText />} bodyClassName="border-t">
              <ContractsTable contracts={previous} showProperty={false} />
            </SectionCard>
            <SectionCard title="Additional-service quotes" icon={<Receipt />} bodyClassName="border-t">
              <QuotesList quotes={quotes} />
            </SectionCard>
          </>,
        )}
        {panel(
          "visits",
          <SectionCard title="Site visits" description="Surveys of this property, and the proposals raised from them." icon={<ClipboardCheck />} bodyClassName="border-t">
            <AssessmentsList assessments={assessments} />
          </SectionCard>,
        )}
        {panel("assets", <AssetsPanel propertyId={property.id} canEdit={canEdit} />)}
        {panel("access", <AccessRulesPanel propertyId={property.id} canEdit={canEdit} />)}
        {panel("scope", <ScopePanel propertyId={property.id} canEdit={canEdit} />)}
        {panel("documents", <DocumentsPanel target={{ level: "property", entityId: property.id }} canUpload={canEdit} />)}
      </Tabs>

      <EditPropertyDialog
        key={editing.key}
        open={editing.open}
        onOpenChange={editing.onOpenChange}
        property={property}
        customerId={customer?.id ?? null}
        childIds={units.children.map((u) => u.id)}
        onSaved={reload}
      />
    </div>
  );
}

function CurrentAmcCard({ current }: { current: PropertyOverview["current"] }) {
  return (
    <SectionCard
      title="Current AMC"
      icon={<ScrollText />}
      description={
        current
          ? `${formatContractDate(current.startDate)} to ${formatContractDate(current.endDate)} · ${current.expiryLabel}${current.accountManagers.length ? ` · ${current.accountManagers.join(", ")}` : ""}`
          : undefined
      }
      bodyClassName="border-t"
      action={
        current ? (
          <div className="flex flex-wrap items-center gap-2">
            {current.renewalStage ? <Badge variant="outline">{RENEWAL_STAGE_LABELS[current.renewalStage as RenewalStage]}</Badge> : null}
            <Button asChild variant="outline" size="sm">
              <Link href={`/extensions/amc-contracts/${current.id}`}>
                <ScrollText className="size-4" />
                {current.proposalNumber}
              </Link>
            </Button>
          </div>
        ) : null
      }
    >
      {current ? (
        <div className="overflow-x-auto">
          <Table className="min-w-[520px]">
            <TableHeader className="[&_th]:text-muted-foreground">
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5">Service</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Used</TableHead>
                <TableHead className="pr-5 text-right">Included</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {current.entitlements.map((e) => (
                <TableRow key={`${e.serviceId}-${e.entitlementType}`} className="h-12">
                  <TableCell className="pl-5">{e.serviceLabel}</TableCell>
                  <TableCell className="capitalize">{e.entitlementType === "informational" ? "included" : e.entitlementType}</TableCell>
                  <TableCell className="text-right tabular-nums">{e.entitlementType === "informational" ? "—" : formatQuantity(e.usedQuantity)}</TableCell>
                  <TableCell className="pr-5 text-right tabular-nums">
                    {e.includedQuantity !== null ? formatQuantity(e.includedQuantity) : e.entitlementType === "unlimited" ? "Unlimited" : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState icon={<ScrollText className="size-5" />} title="No contract in force" description="This property has no AMC running today. Earlier ones are under Contracts." />
      )}
    </SectionCard>
  );
}

/** Edit a property; its client's other properties are offered as the parent (not itself or its own units). */
function EditPropertyDialog({
  open,
  onOpenChange,
  property,
  customerId,
  childIds,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property: PropertyRecord;
  customerId: string | null;
  childIds: string[];
  onSaved: () => void;
}) {
  const [options, setOptions] = useState<Array<{ id: string; label: string }>>([]);
  /* A string, so a fresh array from the parent's render does not read again. */
  const childKey = childIds.join(",");
  useEffect(() => {
    // Read only while the dialog is open: it stays mounted with the page.
    if (!open || !customerId) return;
    let gone = false;
    const children = childKey ? childKey.split(",") : [];
    amcContractsService
      .customerProperties(customerId)
      .then(({ properties }) => {
        if (!gone) setOptions(properties.filter((p) => p.id !== property.id && !children.includes(p.id)).map((p) => ({ id: p.id, label: p.label })));
      })
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, [open, customerId, property.id, childKey]);

  return (
    <PropertyDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit property"
      submitLabel="Save changes"
      description="Changes the address for AMC and Snagging alike. Signed contracts keep their own copy."
      parentOptions={options}
      initial={{
        label: property.label,
        address: property.address,
        community: property.community,
        propertyCategory: property.propertyCategory as PropertyInput["propertyCategory"],
        unitType: property.unitType as PropertyInput["unitType"],
        bedrooms: property.bedrooms,
        sizeSqft: property.sizeSqft,
        notes: property.notes,
        building: property.building,
        unitNo: property.unitNo,
        floor: property.floor,
        street: property.street,
        city: property.city,
        floorsCount: property.floorsCount,
        zones: property.zones,
        occupancy: property.occupancy as PropertyInput["occupancy"],
        accessConstraints: property.accessConstraints,
        parentPropertyId: property.parentPropertyId,
      }}
      onSave={async (input) => {
        await amcContractsService.updateProperty(property.id, input);
        toast.success("Property saved. Signed contracts are unchanged.");
        onSaved();
      }}
    />
  );
}

/**
 * Add or edit a property. Controlled by `open`; screens that still mount it
 * only while it is showing can leave `open` out.
 */
export function PropertyDialog({
  open = true,
  title,
  description = "Signed contracts keep their own copy of the property.",
  submitLabel = "Save",
  initial,
  onOpenChange,
  onSave,
  parentOptions = [],
}: {
  open?: boolean;
  title: string;
  description?: string;
  submitLabel?: string;
  initial: PropertyInput;
  onOpenChange: (open: boolean) => void;
  /** Does the work and says so; the dialog closes when it resolves. */
  onSave: (input: PropertyInput) => Promise<void>;
  parentOptions?: Array<{ id: string; label: string }>;
}) {
  const [value, setValue] = useState<PropertyInput>(initial);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await onSave(cleanProperty(value));
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the property.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <PropertyFields value={value} onChange={setValue} parentOptions={parentOptions} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton onClick={() => void save()} pending={busy} pendingLabel="Saving…" disabled={!value.label.trim()}>
            {submitLabel}
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
