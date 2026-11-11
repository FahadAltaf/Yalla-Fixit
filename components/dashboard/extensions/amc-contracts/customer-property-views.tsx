"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, ChevronRight, ClipboardCheck, Layers, Pencil, Plus, Receipt, ScrollText, TriangleAlert, UserRound, UserX } from "lucide-react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/data-table";
import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Money } from "@/components/ui/money";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataRow, PillTabs, SectionCard, StatCard, StatCardGrid, SubHeading, TabCount } from "@/components/dashboard/shared/kaizen";
import { GoogleLocationMap, hasGoogleMapsKey } from "@/components/dashboard/snagging/google-location-map";
import { LocationMap } from "@/components/dashboard/snagging/location-map";
import { ActionDialogContent, ErrorState, SectionSkeleton, StatGridSkeleton, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { canViewAmcPayments } from "@/components/dashboard/extensions/amc/amc-constants";
import { useAuth } from "@/context/AuthContext";
import { RENEWAL_STAGE_LABELS, type RenewalStage } from "@/lib/amc/business";
import { LIFECYCLE_LABELS, documentExpiryState } from "@/lib/amc/client-profile";
import { formatQuantity, todayInDubai } from "@/lib/amc/contracts";
import { amcContractsService, type CustomerOverview, type PropertyInput, type PropertyOverview, type PropertyRecord } from "@/modules/amc-contracts/amc-contracts-service";

import { ELIGIBILITY_LABELS } from "./contract-commercial";
import { CONTRACT_STATUS_LABELS, contractStatusTone, formatContractDate } from "./contract-status";
import { AddressDialog, useAddressFormAccess } from "./address-dialog";
import { BookSiteVisitDialog } from "./book-site-visit-dialog";
import { CustomerDialog } from "./customers-page";
import { DetailHeaderCard, DetailHeaderSkeleton, DetailToolbar } from "./detail-header";
import { customerInput } from "./edit-client-dialog";
import { ClientPaymentsPanel } from "./payments-page";
import { PropertyFields, UNIT_TYPE_LABELS, cleanProperty } from "./customer-pickers";
import { useAmcData } from "./use-amc-data";
import { AdditionalWorkTotalsCard, ClientSchedulePanel, ServiceHistoryPanel } from "./profile/client-history-panels";
import { CommunicationPanel } from "./profile/communication-panel";
import { ContactsPanel } from "./profile/contacts-panel";
import { DetailList } from "./profile/detail-list";
import { DocumentsPanel } from "./profile/documents-panel";
import { IdentityCard, LIFECYCLE_TONE } from "./profile/identity-card";
import { AccessRulesPanel, AssetsPanel, ScopePanel } from "./profile/property-panels";
import { useDialog } from "./profile/use-dialog";
import { useUrlTab } from "./profile/use-url-tab";
import { ClientEnquiriesCard } from "./enquiries/client-enquiries-card";
import { formatPhone } from "@/lib/phone/format-phone";
import { TruncatedText } from "@/components/ui/truncated-text";

type ContractItem = CustomerOverview["contracts"][number];
type AssessmentItem = CustomerOverview["assessments"][number];
type QuoteItem = CustomerOverview["quotes"][number];

const CLIENTS_HREF = "/extensions/amc-contracts/customers";
const noop = () => undefined;
const unitTypeLabel = (t: string | null) => (t ? (UNIT_TYPE_LABELS[t as keyof typeof UNIT_TYPE_LABELS] ?? t) : null);

/* ------------------------------------------------------------------ */
/* The record-page frame, as on Snagging's job page                    */
/* ------------------------------------------------------------------ */


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

/* The contract list's columns; Property only where the list spans properties. */
function contractColumns(showProperty: boolean): ColumnDef<ContractItem>[] {
  return [
    {
      id: "contract",
      header: "Contract",
      cell: ({ row }) => (
        <div className="font-medium">
          <Link href={`/extensions/amc-contracts/${row.original.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
            {row.original.proposalNumber}
          </Link>
          <div className="text-muted-foreground text-xs">
            <Money value={row.original.grandTotal} className="text-xs" />
          </div>
        </div>
      ),
    },
    ...(showProperty
      ? [
          {
            id: "property",
            header: "Property",
            cell: ({ row }) => (
              <div className="max-w-[320px]">
                {/* One line with "…"; the whole address on hover. */}
                <TruncatedText>
                  {row.original.propertyId ? (
                    <Link href={`/extensions/amc-contracts/properties/${row.original.propertyId}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                      {row.original.propertyLabel || "Property"}
                    </Link>
                  ) : (
                    row.original.propertyLabel || "—"
                  )}
                </TruncatedText>
              </div>
            ),
          } satisfies ColumnDef<ContractItem>,
        ]
      : []),
    {
      id: "start",
      header: "Start",
      cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{formatContractDate(row.original.startDate)}</span>,
    },
    {
      id: "end",
      header: "End",
      cell: ({ row }) => (
        <div className="whitespace-nowrap tabular-nums">
          {formatContractDate(row.original.endDate)}
          <div className="text-muted-foreground text-xs">{row.original.expiryLabel}</div>
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant="secondary" className={`border-0 font-medium ${contractStatusTone(row.original.displayStatus)}`}>
          {CONTRACT_STATUS_LABELS[row.original.displayStatus]}
        </Badge>
      ),
    },
    {
      id: "accountManager",
      header: "Account manager",
      cell: ({ row }) => (
        <div className="max-w-[200px]">
          <TruncatedText text={row.original.accountManagers.join(", ") || "—"} />
        </div>
      ),
    },
    {
      id: "coverage",
      header: "Coverage",
      cell: ({ row }) => (
        <div>
          {row.original.coverage.totalServices} services
          {row.original.coverage.exhausted ? <div className="text-danger text-xs">{row.original.coverage.exhausted} exhausted</div> : null}
        </div>
      ),
    },
    {
      id: "renewal",
      header: "Renewal",
      cell: ({ row }) => (
        <div>
          {row.original.renewalStage ? RENEWAL_STAGE_LABELS[row.original.renewalStage as RenewalStage] : "—"}
          {row.original.renewalOverdue ? <div className="text-danger text-xs">past the end date</div> : null}
        </div>
      ),
    },
  ];
}

function ContractsTable({ contracts, showProperty = true }: { contracts: ContractItem[]; showProperty?: boolean }) {
  const router = useRouter();
  const columns = useMemo(() => contractColumns(showProperty), [showProperty]);
  return (
    <DataTable
      columns={columns}
      data={contracts}
      loading={false}
      rowCount={contracts.length}
      pageSize={500}
      currentPage={0}
      onPageChange={noop}
      onPageSizeChange={noop}
      onGlobalFilterChange={noop}
      handleRowClick={(c) => router.push(`/extensions/amc-contracts/${c.id}`)}
      emptyState={<EmptyState icon={<ScrollText className="size-5" />} title="No contracts" description="Contracts signed with this client appear here, each one separately." />}
    />
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
            {a.summary ? <TruncatedText className="text-muted-foreground text-xs">{a.summary}</TruncatedText> : null}
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

/* New site visit: the Book site visit form, as on an enquiry (property, date and time, assessor). */
function StartAssessmentButton({
  client,
  propertyId,
  initialProperty,
  size,
}: {
  client: { id: string; name: string } | null;
  propertyId: string | null;
  /** The page's own property record, handed to the form instead of read again. */
  initialProperty?: { property: PropertyOverview["property"]; missing?: string[] };
  size?: "sm";
}) {
  const [open, setOpen] = useState(false);
  if (!client) return null;
  return (
    <>
      <Button size={size} onClick={() => setOpen(true)}>
        <ClipboardCheck className="size-4" />
        New site visit
      </Button>
      <BookSiteVisitDialog open={open} onOpenChange={setOpen} client={client} propertyId={propertyId} initialProperty={initialProperty} />
    </>
  );
}

/* ------------------------------------------------------------------ */

const CUSTOMER_TABS = ["overview", "properties", "contracts", "schedule", "service", "payments", "visits", "contacts", "documents", "communication"] as const;

/**
 * The client profile (BRD 5.9, DEV-379), one page per client like the
 * Snagging job page: a header card, the figures, then tabs kept in ?tab=,
 * each mounted once opened. The PPM schedule and the service history span
 * all the client's contracts.
 */
export function CustomerDetail({ id }: { id: string }) {
  const router = useRouter();
  const { data, error, loading, reload, fetchedAt, refreshing, refresh } = useRecord(() => amcContractsService.customer(id), id);
  useBreadcrumbLabel("customers", "Clients");
  useBreadcrumbLabel(id, data?.overview.customer.name ?? "Client");
  const editing = useDialog();
  const addingProperty = useDialog();
  /* A new property on the Snagging address form, as Edit property uses (needs Snagging (Create)). */
  const addressForm = useAddressFormAccess();
  /* Payments (Phase 7) only for AMC Payments (View), as /api/amc-payments answers. */
  const { userProfile } = useAuth();
  const canViewPayments = canViewAmcPayments(userProfile);
  const { tab, setTab, isOpened } = useUrlTab(canViewPayments ? CUSTOMER_TABS : CUSTOMER_TABS.filter((t) => t !== "payments"), "overview");

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
            <p className="text-muted-foreground text-sm">{[customer.company, formatPhone(customer.phone), customer.email].filter(Boolean).join(" · ") || "No contact details recorded"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <Button variant="outline" onClick={() => editing.show(true)}>
                <Pencil className="size-4" />
                Edit
              </Button>
            ) : null}
            <StartAssessmentButton client={customer} propertyId={null} />
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
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="service">Service history</TabsTrigger>
          {canViewPayments ? <TabsTrigger value="payments">Payments</TabsTrigger> : null}
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
            <AdditionalWorkTotalsCard customerId={customer.id} />
            <SectionCard title="Additional-service quotes" icon={<Receipt />} bodyClassName="border-t">
              <QuotesList quotes={quotes} />
            </SectionCard>
          </>,
        )}
        {panel("schedule", <ClientSchedulePanel customerId={customer.id} />)}
        {panel("service", <ServiceHistoryPanel customerId={customer.id} />)}
        {canViewPayments ? panel("payments", <ClientPaymentsPanel clientId={customer.id} />) : null}
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
      {addressForm ? (
        <AddressDialog
          key={`address-${addingProperty.key}`}
          open={addingProperty.open}
          onOpenChange={addingProperty.onOpenChange}
          clientId={customer.id}
          clientName={customer.name}
          full
          parentOptions={properties.map((p) => ({ id: p.id, label: p.label }))}
          onSaved={() => {
            addingProperty.onOpenChange(false);
            toast.success("Property added");
            reload();
          }}
        />
      ) : (
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
      )}
    </div>
  );
}


/* ------------------------------------------------------------------ */

/* Four tabs, as a quotation has its three: what it is, its contracts, what is maintained there, and what happened to it. */
const PROPERTY_TABS = ["details", "contracts", "assets", "activity"] as const;
type MaintainedView = "assets" | "scope" | "access";
type PropertyActivityView = "visits" | "documents";

/** A sub-tab asked for in the link (?view=), so "Assets and scope" lands on Scope. */
function initialView<T extends string>(allowed: readonly T[], fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const asked = new URLSearchParams(window.location.search).get("view") as T | null;
  return asked && allowed.includes(asked) ? asked : fallback;
}

/**
 * One property, laid out like a quotation's page: the way back and what the
 * property can do in one toolbar, access constraints as an alert, then
 * Details (the figures, the property and its client with the map, combined
 * units), Contracts, Assets and scope, and Activity (site visits, documents).
 */
export function PropertyDetail({ id }: { id: string }) {
  const router = useRouter();
  const { data, error, loading, reload, fetchedAt, refreshing, refresh } = useRecord(() => amcContractsService.property(id), id);
  useBreadcrumbLabel("properties", "Properties");
  useBreadcrumbLabel(id, data?.overview.property.label ?? "Property");
  const editing = useDialog();
  const { tab, setTab, isOpened } = useUrlTab(PROPERTY_TABS, "details");
  const [maintained, setMaintainedState] = useState<MaintainedView>(() => initialView<MaintainedView>(["assets", "scope", "access"], "assets"));
  const [maintainedOpened, setMaintainedOpened] = useState<Set<MaintainedView>>(() => new Set([maintained]));
  const setMaintained = (next: MaintainedView) => {
    setMaintainedState(next);
    setMaintainedOpened((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
  };
  const [activity, setActivityState] = useState<PropertyActivityView>(() => initialView<PropertyActivityView>(["visits", "documents"], "visits"));
  const [activityOpened, setActivityOpened] = useState<Set<PropertyActivityView>>(() => new Set([activity]));
  const setActivity = (next: PropertyActivityView) => {
    setActivityState(next);
    setActivityOpened((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
  };

  if (error && /not found/i.test(error))
    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        <BackLink href={CLIENTS_HREF} label="Clients" />
        <Card className="p-0">
          <EmptyState
            icon={<Building2 className="size-5" />}
            title="Property not found"
            description="It may have been removed. Open the client to see their properties."
            action={{ label: "Back to clients", onClick: () => router.push(CLIENTS_HREF) }}
          />
        </Card>
      </div>
    );

  const overview: PropertyOverview | null = data?.overview ?? null;
  const property = overview?.property ?? null;
  const customer = overview?.customer ?? null;
  const current = overview?.current ?? null;
  const previous = overview?.previous ?? [];
  const assessments = overview?.assessments ?? [];
  const quotes = overview?.quotes ?? [];
  const units = data?.units ?? { parent: null, children: [] };
  const canEdit = data?.canEdit !== false;
  const location = data?.location ?? null;
  const panel = (value: (typeof PROPERTY_TABS)[number], children: React.ReactNode) =>
    isOpened(value) ? (
      <TabsContent value={value} forceMount className="mt-4 flex flex-col gap-4 data-[state=inactive]:hidden">
        {children}
      </TabsContent>
    ) : null;

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      {/* As the client page: the way back and Refresh, then the property's card with what it can do. */}
      <DetailToolbar
        backHref={customer ? `${CLIENTS_HREF}/${customer.id}?tab=properties` : CLIENTS_HREF}
        backLabel={customer?.name ?? "Clients"}
        fetchedAt={fetchedAt}
        refreshing={refreshing}
        onRefresh={data ? refresh : undefined}
      />

      {!property ? (
        error ? null : <DetailHeaderSkeleton />
      ) : (
        <DetailHeaderCard
          badges={
            <>
              <Badge variant="outline">Property</Badge>
              {property.propertyCategory ? <Badge variant="outline">{property.propertyCategory === "commercial" ? "Commercial" : "Residential"}</Badge> : null}
              {unitTypeLabel(property.unitType) ? <Badge variant="outline">{unitTypeLabel(property.unitType)}</Badge> : null}
            </>
          }
          title={property.label || "Property"}
          status={
            current ? (
              <Badge variant="secondary" className={`border-0 font-medium ${contractStatusTone(current.displayStatus)}`}>
                {CONTRACT_STATUS_LABELS[current.displayStatus]}
              </Badge>
            ) : (
              <Badge variant="secondary" className="bg-mist text-ink-soft border-0 font-medium">
                No AMC
              </Badge>
            )
          }
          subline={
            [[property.building, property.community, property.city].filter(Boolean).join(", "), customer ? `for ${customer.name}` : "No client linked"]
              .filter(Boolean)
              .join(" · ")
          }
          actions={
            <>
              {customer ? (
                <Button asChild variant="outline">
                  <Link href={`${CLIENTS_HREF}/${customer.id}`}>
                    <UserRound className="size-4" />
                    Open the client
                  </Link>
                </Button>
              ) : null}
              {current ? (
                <Button asChild variant="outline">
                  <Link href={`/extensions/amc-contracts/${current.id}`}>
                    <ScrollText className="size-4" />
                    {current.proposalNumber}
                  </Link>
                </Button>
              ) : null}
              {canEdit ? (
                <Button variant="outline" onClick={() => editing.show(true)}>
                  <Pencil className="size-4" />
                  Edit
                </Button>
              ) : null}
              <StartAssessmentButton client={customer ?? null} propertyId={property.id} initialProperty={{ property, missing: data?.siteVisitMissing }} />
            </>
          }
        />
      )}

      {error ? (
        <ErrorState title="Could not load this property" message={error} onRetry={reload} />
      ) : loading || !property || !overview ? (
        <PropertyBodySkeleton tab={tab} />
      ) : (
        <div className="flex flex-col gap-4">
          {/* What anyone going there must know first, as a quotation shows what is holding it up. */}
          {property.accessConstraints ? (
            <Alert>
              <TriangleAlert />
              <AlertTitle>Access constraints</AlertTitle>
              <AlertDescription>{property.accessConstraints}</AlertDescription>
            </Alert>
          ) : null}

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className={TABS_LIST}>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="contracts">Contracts</TabsTrigger>
              <TabsTrigger value="assets">Assets and scope</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>

            {panel(
              "details",
              <>
                {/* The four answers somebody opens a property for. */}
                <StatCardGrid columns={4}>
                  <StatCard
                    label="Current AMC"
                    value={current ? CONTRACT_STATUS_LABELS[current.displayStatus] : "None"}
                    headline={current ? `Contract ${current.proposalNumber}` : "No contract in force"}
                    caption={current ? `${formatContractDate(current.startDate)} to ${formatContractDate(current.endDate)}` : "Start one from a proposal"}
                    tone={current ? "good" : "neutral"}
                    onSelect={() => setTab("contracts")}
                    selectLabel="Open the contracts"
                  />
                  <StatCard
                    label="Previous contracts"
                    value={previous.length}
                    headline="Kept as they were"
                    caption="Renewals never overwrite them"
                    onSelect={() => setTab("contracts")}
                    selectLabel="Open the contracts"
                  />
                  <StatCard
                    label="Site visits"
                    value={assessments.length}
                    headline={`${assessments.filter((a) => a.status === "completed").length} completed`}
                    caption="Surveys of this property"
                    onSelect={() => {
                      setActivity("visits");
                      setTab("activity");
                    }}
                    selectLabel="Open the site visits"
                  />
                  <StatCard
                    label="Additional-service quotes"
                    value={quotes.length}
                    headline={`${quotes.filter((q) => q.status === "draft").length} draft`}
                    caption="Work outside the contract"
                    onSelect={() => setTab("contracts")}
                    selectLabel="Open the quotes"
                  />
                </StatCardGrid>

                <SectionCard title="Property & client" icon={<Building2 />} description="The address, what it is, who it belongs to, and where it is." bodyClassName="px-5 pb-5">
                  <div className="grid items-stretch gap-6 lg:grid-cols-2">
                    <div className="min-w-0 space-y-6">
                      <div className="space-y-3">
                        <SubHeading>Property</SubHeading>
                        <DetailList
                          rows={[
                            { label: "Unit", value: property.label },
                            { label: "Unit no. / floor", value: [property.unitNo, property.floor ? `floor ${property.floor}` : null].filter(Boolean).join(", ") || null },
                            { label: "Building", value: property.building },
                            { label: "Community", value: property.community },
                            { label: "Street / city", value: [property.street, property.city].filter(Boolean).join(", ") || null },
                            { label: "Developer", value: data?.developer ?? null },
                            { label: "Type", value: unitTypeLabel(property.unitType) },
                            { label: "Category", value: property.propertyCategory ? <span className="capitalize">{property.propertyCategory}</span> : null },
                            {
                              label: "Size",
                              value:
                                [property.sizeSqft ? `${property.sizeSqft.toLocaleString("en-US")} sq ft` : null, property.bedrooms !== null ? `${property.bedrooms} bed` : null]
                                  .filter(Boolean)
                                  .join(" · ") || null,
                            },
                            { label: "Floors", value: property.floorsCount },
                            { label: "Zones", value: property.zones.length ? property.zones.join(", ") : null },
                            { label: "Occupied by", value: property.occupancy ? <span className="capitalize">{property.occupancy}</span> : null },
                          ]}
                        />
                      </div>
                      <div className="space-y-3">
                        <SubHeading>Client</SubHeading>
                        <DetailList
                          rows={[
                            {
                              label: "Name",
                              value: customer ? (
                                <Link href={`${CLIENTS_HREF}/${customer.id}`} className="hover:text-brand underline underline-offset-2">
                                  {customer.name}
                                </Link>
                              ) : null,
                            },
                            { label: "Customer ID", value: customer?.customerRef ?? null },
                            {
                              label: "Status",
                              value: customer ? (
                                <Badge variant="secondary" className={`border-0 font-medium ${LIFECYCLE_TONE[customer.lifecycle] ?? ""}`}>
                                  {LIFECYCLE_LABELS[customer.lifecycle] ?? customer.lifecycle}
                                </Badge>
                              ) : null,
                            },
                          ]}
                        />
                      </div>
                    </div>

                    <div className="flex min-w-0 flex-col space-y-3">
                      <SubHeading>Location</SubHeading>
                      {location ? (
                        hasGoogleMapsKey() ? (
                          <GoogleLocationMap className="flex-1" lat={location.lat} lng={location.lng} label={property.label} />
                        ) : (
                          <LocationMap className="flex-1" lat={location.lat} lng={location.lng} label={property.label} />
                        )
                      ) : (
                        <div className="text-muted-foreground flex min-h-48 flex-1 flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm">
                          No location pinned on the property record.
                        </div>
                      )}
                    </div>
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
                  {!units.parent && units.children.length === 0 ? (
                    <p className="text-muted-foreground px-5 py-4 text-sm">Not linked to other units. Link one from its Edit form.</p>
                  ) : null}
                </SectionCard>
              </>,
            )}

            {panel(
              "contracts",
              <>
                <CurrentAmcCard current={current} />
                <SectionCard title="Previous contracts" description="Kept as they were; renewals never overwrite them." icon={<ScrollText />} bodyClassName="border-t">
                  <ContractsTable contracts={previous} showProperty={false} />
                </SectionCard>
                <SectionCard title="Additional-service quotes" icon={<Receipt />} bodyClassName="border-t">
                  <QuotesList quotes={quotes} />
                </SectionCard>
              </>,
            )}

            {panel(
              "assets",
              /* What is maintained there: the asset register, the scope and the access rules, each fetched when opened. */
              <>
                <PillTabs<MaintainedView>
                  value={maintained}
                  onChange={setMaintained}
                  tabs={[
                    { value: "assets", label: "Assets" },
                    { value: "scope", label: "Scope" },
                    { value: "access", label: "Access rules" },
                  ]}
                />
                {maintainedOpened.has("assets") ? (
                  <div hidden={maintained !== "assets"}>
                    <AssetsPanel propertyId={property.id} canEdit={canEdit} />
                  </div>
                ) : null}
                {maintainedOpened.has("scope") ? (
                  <div hidden={maintained !== "scope"}>
                    <ScopePanel propertyId={property.id} canEdit={canEdit} />
                  </div>
                ) : null}
                {maintainedOpened.has("access") ? (
                  <div hidden={maintained !== "access"}>
                    <AccessRulesPanel propertyId={property.id} canEdit={canEdit} />
                  </div>
                ) : null}
              </>,
            )}

            {panel(
              "activity",
              <>
                <PillTabs<PropertyActivityView>
                  value={activity}
                  onChange={setActivity}
                  tabs={[
                    { value: "visits", label: "Site visits", count: assessments.length },
                    { value: "documents", label: "Documents" },
                  ]}
                />
                {activityOpened.has("visits") ? (
                  <div hidden={activity !== "visits"}>
                    <SectionCard title="Site visits" description="Surveys of this property, and the proposals raised from them." icon={<ClipboardCheck />} bodyClassName="border-t">
                      <AssessmentsList assessments={assessments} />
                    </SectionCard>
                  </div>
                ) : null}
                {activityOpened.has("documents") ? (
                  <div hidden={activity !== "documents"}>
                    <DocumentsPanel target={{ level: "property", entityId: property.id }} canUpload={canEdit} />
                  </div>
                ) : null}
              </>,
            )}
          </Tabs>
        </div>
      )}

      {property ? (
        <EditPropertyDialog
          key={editing.key}
          open={editing.open}
          onOpenChange={editing.onOpenChange}
          property={property}
          customerId={customer?.id ?? null}
          clientName={customer?.name ?? null}
          childIds={units.children.map((u) => u.id)}
          onSaved={reload}
        />
      ) : null}
    </div>
  );
}

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2 max-w-full self-start">
      <Link href={href}>
        <ArrowLeft className="size-4" />
        <span className="truncate">{label}</span>
      </Link>
    </Button>
  );
}

/** The loading shape of the tab being opened, so the page does not jump when it lands. */
function PropertyBodySkeleton({ tab }: { tab: (typeof PROPERTY_TABS)[number] }) {
  return (
    <div className="flex flex-col gap-4" aria-label="Loading the property">
      <Skeleton className="h-9 w-full rounded-lg" />
      {tab === "details" ? (
        <>
          <StatGridSkeleton count={4} />
          <SectionSkeleton />
        </>
      ) : tab === "assets" || tab === "activity" ? (
        <>
          <div className="flex gap-1.5">
            <Skeleton className="h-8 w-24 rounded-full" />
            <Skeleton className="h-8 w-24 rounded-full" />
          </div>
          <SectionSkeleton />
        </>
      ) : (
        <SectionSkeleton />
      )}
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
                <TableHead>Used</TableHead>
                <TableHead className="pr-5">Included</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {current.entitlements.map((e) => (
                <TableRow key={`${e.serviceId}-${e.entitlementType}`} className="h-12">
                  <TableCell className="pl-5">{e.serviceLabel}</TableCell>
                  <TableCell className="capitalize">{e.entitlementType === "informational" ? "included" : e.entitlementType}</TableCell>
                  <TableCell className="tabular-nums">{e.entitlementType === "informational" ? "—" : formatQuantity(e.usedQuantity)}</TableCell>
                  <TableCell className="pr-5 tabular-nums">
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
  clientName,
  childIds,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property: PropertyRecord;
  customerId: string | null;
  clientName?: string | null;
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
  const addressForm = useAddressFormAccess();

  /*
    The same form as a client's addresses in Snagging (unit, type, size, the
    pin and the paperwork), with AMC's own fields beneath, so a property is
    edited one way everywhere. It saves through Snagging, so without
    Snagging (Create), or for an address with no client, the AMC form stays.
  */
  if (addressForm && customerId) {
    return (
      <AddressDialog
        open={open}
        onOpenChange={onOpenChange}
        clientId={customerId}
        clientName={clientName ?? "Client"}
        propertyId={property.id}
        editing
        onSaved={() => {
          onOpenChange(false);
          toast.success("Property saved. Signed contracts are unchanged.");
          onSaved();
        }}
      />
    );
  }

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
