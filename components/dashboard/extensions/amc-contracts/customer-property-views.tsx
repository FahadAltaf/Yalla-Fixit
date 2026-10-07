"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, ClipboardCheck, Home, Layers, Pencil, Plus, Receipt, ScrollText, UserRound } from "lucide-react";
import { toast } from "sonner";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataRow, PageHeading, SectionCard, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, HeadingSkeleton, SectionSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { RENEWAL_STAGE_LABELS, type RenewalStage } from "@/lib/amc/business";
import { formatQuantity } from "@/lib/amc/contracts";
import { amcContractsService, type CustomerInput, type CustomerOverview, type PropertyInput, type PropertyOverview, type PropertyRecord } from "@/modules/amc-contracts/amc-contracts-service";
import { LIFECYCLE_LABELS } from "@/lib/amc/client-profile";

import { AmcSectionNav } from "./amc-section-nav";
import { ELIGIBILITY_LABELS } from "./contract-commercial";
import { CONTRACT_STATUS_LABELS, contractStatusTone, formatContractDate } from "./contract-status";
import { CustomerDialog } from "./customers-page";
import { PropertyFields, UNIT_TYPE_LABELS, cleanProperty } from "./customer-pickers";
import { useAmcData } from "./use-amc-data";
import { CommunicationPanel } from "./profile/communication-panel";
import { ContactsPanel } from "./profile/contacts-panel";
import { DocumentsPanel } from "./profile/documents-panel";
import { IdentityCard, LIFECYCLE_TONE } from "./profile/identity-card";
import { AccessRulesPanel, AssetsPanel, ScopePanel } from "./profile/property-panels";
import { useUrlTab } from "./profile/use-url-tab";
import { ClientEnquiriesCard } from "./enquiries/client-enquiries-card";

type ContractItem = CustomerOverview["contracts"][number];
type AssessmentItem = CustomerOverview["assessments"][number];
type QuoteItem = CustomerOverview["quotes"][number];

function ContractsTable({ contracts, showProperty = true }: { contracts: ContractItem[]; showProperty?: boolean }) {
  const router = useRouter();
  if (contracts.length === 0) return <p className="text-muted-foreground px-5 pb-4 text-sm">No contracts linked.</p>;
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[820px]">
        <TableHeader>
          <TableRow>
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
            <TableRow key={c.id} className="cursor-pointer" onClick={() => router.push(`/extensions/amc-contracts/${c.id}`)}>
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
                <Badge variant="secondary" className={`border-none ${contractStatusTone(c.displayStatus)}`}>
                  {CONTRACT_STATUS_LABELS[c.displayStatus]}
                </Badge>
              </TableCell>
              <TableCell>{c.accountManagers.join(", ") || "—"}</TableCell>
              <TableCell>
                {c.coverage.totalServices} services
                {c.coverage.exhausted ? <div className="text-destructive text-xs">{c.coverage.exhausted} exhausted</div> : null}
              </TableCell>
              <TableCell className="pr-5">
                {c.renewalStage ? RENEWAL_STAGE_LABELS[c.renewalStage as RenewalStage] : "—"}
                {c.renewalOverdue ? <div className="text-destructive text-xs">past the end date</div> : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function AssessmentsList({ assessments }: { assessments: AssessmentItem[] }) {
  if (assessments.length === 0) return <p className="text-muted-foreground text-sm">No assessments yet.</p>;
  return (
    <ul className="divide-y text-sm">
      {assessments.map((a) => (
        <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
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
          <Badge variant="secondary" className="font-normal capitalize">
            {a.status}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function QuotesList({ quotes }: { quotes: QuoteItem[] }) {
  if (quotes.length === 0) return <p className="text-muted-foreground text-sm">None.</p>;
  return (
    <ul className="divide-y text-sm">
      {quotes.map((q) => (
        <li key={q.id} className="py-2">
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
      toast.error(e instanceof Error ? e.message : "Could not start the assessment.");
      setBusy(false);
    }
  };
  return (
    <Button size="sm" variant="outline" onClick={() => void start()} disabled={busy}>
      <ClipboardCheck className="size-4" />
      {busy ? "Starting…" : "New assessment"}
    </Button>
  );
}

/* ------------------------------------------------------------------ */

const CUSTOMER_TABS = ["overview", "contacts", "documents", "communication"] as const;

/**
 * The client profile (BRD 5.9, DEV-379), one page per client like the
 * Snagging job page: tabs kept in ?tab=, each mounted once opened.
 * Payments, the PPM schedule and service history join as their phases land.
 */
export function CustomerDetail({ id }: { id: string }) {
  const { data, error, loading, reload } = useAmcData(() => amcContractsService.customer(id), id);
  useBreadcrumbLabel("customers", "Customers");
  useBreadcrumbLabel(id, data?.overview.customer.name ?? "Customer");
  const [editing, setEditing] = useState(false);
  const [addingProperty, setAddingProperty] = useState(false);
  const { tab, setTab, isOpened } = useUrlTab(CUSTOMER_TABS, "overview");

  if (loading)
    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        <HeadingSkeleton withActions />
        <SectionSkeleton />
      </div>
    );
  if (error || !data) return <ErrorState title="Could not load this customer" message={error} onRetry={reload} />;
  const { customer, properties, contracts, assessments, quotes, summary } = data.overview;
  const canEdit = data.canEdit !== false;
  const panel = (value: (typeof CUSTOMER_TABS)[number], children: React.ReactNode) =>
    isOpened(value) ? (
      <TabsContent value={value} forceMount className="flex flex-col gap-6 data-[state=inactive]:hidden">
        {children}
      </TabsContent>
    ) : null;

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow={`${LIFECYCLE_LABELS[customer.lifecycle]}${customer.customerRef ? ` · ${customer.customerRef}` : ""}`}
        title={customer.name}
        description={[customer.company, customer.phone, customer.email].filter(Boolean).join(" · ") || undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className={`border-none ${LIFECYCLE_TONE[customer.lifecycle]}`}>
              {LIFECYCLE_LABELS[customer.lifecycle]}
            </Badge>
            {canEdit ? (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="size-4" />
                Edit
              </Button>
            ) : null}
            <StartAssessmentButton customerId={customer.id} propertyId={null} />
          </div>
        }
      />
      <AmcSectionNav current="customers" />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="communication">Communication log</TabsTrigger>
        </TabsList>

        {panel(
          "overview",
          <>
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

            <IdentityCard customer={customer} canEdit={canEdit} onChanged={reload} />

            <SectionCard title="Contracts" description="Each contract separately; a customer can have several." icon={<ScrollText />} bodyClassName="pb-2">
              <ContractsTable contracts={contracts} />
            </SectionCard>

            <ClientEnquiriesCard customerId={customer.id} />

            <div className="grid gap-6 lg:grid-cols-3">
              <SectionCard
                title="Properties"
                icon={<Building2 />}
                bodyClassName="px-5 pb-5"
                action={
                  canEdit ? (
                    <Button size="sm" variant="outline" onClick={() => setAddingProperty(true)}>
                      <Plus className="size-4" />
                      Add
                    </Button>
                  ) : null
                }
              >
                {properties.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No properties yet.</p>
                ) : (
                  properties.map((p) => (
                    <DataRow
                      key={p.id}
                      icon={p.parentPropertyId ? <Layers /> : <Building2 />}
                      title={
                        <Link href={`/extensions/amc-contracts/properties/${p.id}`} className="hover:underline">
                          {p.label}
                        </Link>
                      }
                      subtitle={
                        [
                          p.unitType ? UNIT_TYPE_LABELS[p.unitType as keyof typeof UNIT_TYPE_LABELS] : null,
                          p.parentPropertyId ? `part of ${properties.find((x) => x.id === p.parentPropertyId)?.label ?? "another unit"}` : null,
                          p.address,
                        ]
                          .filter(Boolean)
                          .join(" · ") || undefined
                      }
                    />
                  ))
                )}
              </SectionCard>
              <SectionCard title="Assessments" icon={<ClipboardCheck />} bodyClassName="px-5 pb-5">
                <AssessmentsList assessments={assessments} />
              </SectionCard>
              <SectionCard title="Additional-service quotes" icon={<Receipt />} bodyClassName="px-5 pb-5">
                <QuotesList quotes={quotes} />
              </SectionCard>
            </div>
          </>,
        )}
        {panel("contacts", <ContactsPanel customerId={customer.id} canEdit={canEdit} />)}
        {panel("documents", <DocumentsPanel target={{ customerId: customer.id }} canUpload={canEdit} title="Documents (client, properties and contracts)" />)}
        {panel("communication", <CommunicationPanel customerId={customer.id} />)}
      </Tabs>

      {editing ? (
        <CustomerDialog
          title="Edit customer"
          initial={customerInput(customer)}
          onOpenChange={(next) => !next && setEditing(false)}
          onSave={async (input) => {
            await amcContractsService.updateCustomer(customer.id, input);
            toast.success("Customer saved. Signed contracts are unchanged.");
            setEditing(false);
            reload();
          }}
        />
      ) : null}
      {addingProperty ? (
        <PropertyDialog
          title="Add property"
          initial={{ label: "" }}
          parentOptions={properties.map((p) => ({ id: p.id, label: p.label }))}
          onOpenChange={(next) => !next && setAddingProperty(false)}
          onSave={async (input) => {
            await amcContractsService.createProperty(customer.id, input);
            toast.success("Property added");
            setAddingProperty(false);
            reload();
          }}
        />
      ) : null}
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

const PROPERTY_TABS = ["overview", "assets", "access", "scope", "documents"] as const;

/**
 * A property (BRD 5.2, 5.9): details and combined units, its AMC, the asset
 * register, access rules, scope and documents. Tabs as on the client page.
 */
export function PropertyDetail({ id }: { id: string }) {
  const { data, error, loading, reload } = useAmcData(() => amcContractsService.property(id), id);
  useBreadcrumbLabel("properties", "Properties");
  useBreadcrumbLabel(id, data?.overview.property.label ?? "Property");
  const [editing, setEditing] = useState(false);
  const { tab, setTab, isOpened } = useUrlTab(PROPERTY_TABS, "overview");

  if (loading)
    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        <HeadingSkeleton withActions />
        <SectionSkeleton />
      </div>
    );
  if (error || !data) return <ErrorState title="Could not load this property" message={error} onRetry={reload} />;
  const { property, customer, current, previous, assessments, quotes }: PropertyOverview = data.overview;
  const units = data.units ?? { parent: null, children: [] };
  const canEdit = data.canEdit !== false;
  const panel = (value: (typeof PROPERTY_TABS)[number], children: React.ReactNode) =>
    isOpened(value) ? (
      <TabsContent value={value} forceMount className="flex flex-col gap-6 data-[state=inactive]:hidden">
        {children}
      </TabsContent>
    ) : null;

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow={customer ? `Property · ${customer.name}` : "Property"}
        title={property.label}
        description={[property.unitType ? UNIT_TYPE_LABELS[property.unitType as keyof typeof UNIT_TYPE_LABELS] : null, property.address, property.community].filter(Boolean).join(" · ") || undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            {customer ? (
              <Button asChild variant="outline">
                <Link href={`/extensions/amc-contracts/customers/${customer.id}`}>
                  <UserRound className="size-4" />
                  {customer.name}
                </Link>
              </Button>
            ) : null}
            {canEdit ? (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="size-4" />
                Edit
              </Button>
            ) : null}
            <StartAssessmentButton customerId={customer?.id ?? null} propertyId={property.id} />
          </div>
        }
      />
      <AmcSectionNav current="customers" />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="assets">Assets</TabsTrigger>
          <TabsTrigger value="access">Access rules</TabsTrigger>
          <TabsTrigger value="scope">Scope</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        {panel(
          "overview",
          <>
            <div className="grid gap-6 lg:grid-cols-3">
              <SectionCard title="Details" icon={<Home />} bodyClassName="px-5 pb-5" className="lg:col-span-2">
                <div className="grid gap-x-6 sm:grid-cols-2">
                  <DataRow title="Category" trailing={<span className="text-sm capitalize">{property.propertyCategory ?? "—"}</span>} />
                  <DataRow title="Type" trailing={<span className="text-sm">{property.unitType ? UNIT_TYPE_LABELS[property.unitType as keyof typeof UNIT_TYPE_LABELS] : "—"}</span>} />
                  <DataRow title="Building" trailing={<span className="text-sm">{property.building ?? "—"}</span>} />
                  <DataRow title="Unit / floor" trailing={<span className="text-sm">{[property.unitNo, property.floor ? `floor ${property.floor}` : null].filter(Boolean).join(", ") || "—"}</span>} />
                  <DataRow title="Street / city" trailing={<span className="text-sm">{[property.street, property.city].filter(Boolean).join(", ") || "—"}</span>} />
                  <DataRow title="Community" trailing={<span className="text-sm">{property.community ?? "—"}</span>} />
                  <DataRow title="Size" trailing={<span className="text-sm">{[property.sizeSqft ? `${property.sizeSqft} sq ft` : null, property.bedrooms !== null ? `${property.bedrooms} bed` : null].filter(Boolean).join(" · ") || "—"}</span>} />
                  <DataRow title="Floors" trailing={<span className="text-sm">{property.floorsCount ?? "—"}</span>} />
                  <DataRow title="Occupied by" trailing={<span className="text-sm capitalize">{property.occupancy ?? "—"}</span>} />
                  <DataRow title="Zones" trailing={<span className="text-sm">{property.zones.length ? property.zones.join(", ") : "—"}</span>} />
                </div>
                {property.accessConstraints ? (
                  <p className="text-muted-foreground mt-3 rounded-md border px-3 py-2 text-sm">
                    <span className="text-foreground font-medium">Access constraints: </span>
                    {property.accessConstraints}
                  </p>
                ) : null}
              </SectionCard>
              <SectionCard title="Combined units" icon={<Layers />} description="Linked, not merged: each keeps its owner, billing and history." bodyClassName="px-5 pb-5">
                {units.parent ? (
                  <DataRow
                    icon={<Building2 />}
                    title={
                      <Link href={`/extensions/amc-contracts/properties/${units.parent.id}`} className="hover:underline">
                        {units.parent.label}
                      </Link>
                    }
                    subtitle="This unit is part of it"
                  />
                ) : null}
                {units.children.map((u) => (
                  <DataRow
                    key={u.id}
                    icon={<Layers />}
                    title={
                      <Link href={`/extensions/amc-contracts/properties/${u.id}`} className="hover:underline">
                        {u.label}
                      </Link>
                    }
                    subtitle={[u.unitType ? UNIT_TYPE_LABELS[u.unitType as keyof typeof UNIT_TYPE_LABELS] : null, u.customerId && u.customerId !== customer?.id ? "different owner" : null].filter(Boolean).join(" · ") || "Unit within"}
                  />
                ))}
                {!units.parent && units.children.length === 0 ? <p className="text-muted-foreground text-sm">Not linked to other units. Link one from its Edit form.</p> : null}
              </SectionCard>
            </div>

            <CurrentAmcCard current={current} />

            <SectionCard title="Previous contracts" description="Kept as they were; renewals never overwrite them." icon={<ScrollText />} bodyClassName="pb-2">
              <ContractsTable contracts={previous} showProperty={false} />
            </SectionCard>

            <div className="grid gap-6 lg:grid-cols-2">
              <SectionCard title="Assessments" icon={<ClipboardCheck />} bodyClassName="px-5 pb-5">
                <AssessmentsList assessments={assessments} />
              </SectionCard>
              <SectionCard title="Additional-service quotes" icon={<Receipt />} bodyClassName="px-5 pb-5">
                <QuotesList quotes={quotes} />
              </SectionCard>
            </div>
          </>,
        )}
        {panel("assets", <AssetsPanel propertyId={property.id} canEdit={canEdit} />)}
        {panel("access", <AccessRulesPanel propertyId={property.id} canEdit={canEdit} />)}
        {panel("scope", <ScopePanel propertyId={property.id} canEdit={canEdit} />)}
        {panel("documents", <DocumentsPanel target={{ level: "property", entityId: property.id }} canUpload={canEdit} />)}
      </Tabs>

      {editing ? (
        <EditPropertyDialog
          property={property}
          customerId={customer?.id ?? null}
          childIds={units.children.map((u) => u.id)}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

function CurrentAmcCard({ current }: { current: PropertyOverview["current"] }) {
  return (
    <SectionCard title="Current AMC" icon={<ScrollText />} bodyClassName="px-5 pb-5">
      {current ? (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <Link href={`/extensions/amc-contracts/${current.id}`} className="text-lg font-medium hover:underline">
                {current.proposalNumber}
              </Link>
              <div className="text-muted-foreground text-sm">
                {formatContractDate(current.startDate)} to {formatContractDate(current.endDate)} · {current.expiryLabel}
                {current.accountManagers.length ? ` · ${current.accountManagers.join(", ")}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className={`border-none ${contractStatusTone(current.displayStatus)}`}>
                {CONTRACT_STATUS_LABELS[current.displayStatus]}
              </Badge>
              {current.renewalStage ? <Badge variant="outline">{RENEWAL_STAGE_LABELS[current.renewalStage as RenewalStage]}</Badge> : null}
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table className="min-w-[520px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Used</TableHead>
                  <TableHead className="text-right">Included</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {current.entitlements.map((e) => (
                  <TableRow key={`${e.serviceId}-${e.entitlementType}`}>
                    <TableCell>{e.serviceLabel}</TableCell>
                    <TableCell className="capitalize">{e.entitlementType === "informational" ? "included" : e.entitlementType}</TableCell>
                    <TableCell className="text-right tabular-nums">{e.entitlementType === "informational" ? "—" : formatQuantity(e.usedQuantity)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {e.includedQuantity !== null ? formatQuantity(e.includedQuantity) : e.entitlementType === "unlimited" ? "Unlimited" : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">No contract in force for this property.</p>
      )}
    </SectionCard>
  );
}

/** Edit a property; its customer's other properties are offered as the parent (not itself or its own units). */
function EditPropertyDialog({
  property,
  customerId,
  childIds,
  onClose,
  onSaved,
}: {
  property: PropertyRecord;
  customerId: string | null;
  childIds: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [options, setOptions] = useState<Array<{ id: string; label: string }>>([]);
  useEffect(() => {
    if (!customerId) return;
    let gone = false;
    amcContractsService
      .customerProperties(customerId)
      .then(({ properties }) => {
        if (!gone) setOptions(properties.filter((p) => p.id !== property.id && !childIds.includes(p.id)).map((p) => ({ id: p.id, label: p.label })));
      })
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, [customerId, property.id, childIds]);

  return (
    <PropertyDialog
      title="Edit property"
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
      onOpenChange={(next) => !next && onClose()}
      onSave={async (input) => {
        await amcContractsService.updateProperty(property.id, input);
        toast.success("Property saved. Signed contracts are unchanged.");
        onSaved();
      }}
    />
  );
}

export function PropertyDialog({
  title,
  initial,
  onOpenChange,
  onSave,
  parentOptions = [],
}: {
  title: string;
  initial: PropertyInput;
  onOpenChange: (open: boolean) => void;
  onSave: (input: PropertyInput) => Promise<void>;
  parentOptions?: Array<{ id: string; label: string }>;
}) {
  const [value, setValue] = useState<PropertyInput>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(cleanProperty(value));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Signed contracts keep their own copy of the property.</DialogDescription>
        </DialogHeader>
        <PropertyFields value={value} onChange={setValue} parentOptions={parentOptions} />
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !value.label.trim()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
