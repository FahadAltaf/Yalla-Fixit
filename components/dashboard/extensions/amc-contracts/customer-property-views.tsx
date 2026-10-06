"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, ClipboardCheck, Pencil, Plus, Receipt, ScrollText, UserRound } from "lucide-react";
import { toast } from "sonner";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataRow, PageHeading, SectionCard, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, HeadingSkeleton, SectionSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { RENEWAL_STAGE_LABELS, type RenewalStage } from "@/lib/amc/business";
import { formatQuantity } from "@/lib/amc/contracts";
import { amcContractsService, type CustomerOverview, type PropertyInput, type PropertyOverview } from "@/modules/amc-contracts/amc-contracts-service";

import { AmcSectionNav } from "./amc-section-nav";
import { ELIGIBILITY_LABELS } from "./contract-commercial";
import { CONTRACT_STATUS_LABELS, contractStatusTone, formatContractDate } from "./contract-status";
import { CustomerDialog } from "./customers-page";
import { PropertyFields, UNIT_TYPE_LABELS, cleanProperty } from "./customer-pickers";
import { useAmcData } from "./use-amc-data";

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

export function CustomerDetail({ id }: { id: string }) {
  const { data, error, loading, reload } = useAmcData(() => amcContractsService.customer(id), id);
  useBreadcrumbLabel("customers", "Customers");
  useBreadcrumbLabel(id, data?.overview.customer.name ?? "Customer");
  const [editing, setEditing] = useState(false);
  const [addingProperty, setAddingProperty] = useState(false);

  if (loading)
    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        <HeadingSkeleton withActions />
        <SectionSkeleton />
      </div>
    );
  if (error || !data) return <ErrorState title="Could not load this customer" message={error} onRetry={reload} />;
  const { customer, properties, contracts, assessments, quotes, summary } = data.overview;

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow={`Customer${customer.customerRef ? ` · ${customer.customerRef}` : ""}`}
        title={customer.name}
        description={[customer.company, customer.phone, customer.email].filter(Boolean).join(" · ") || undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="size-4" />
              Edit
            </Button>
            <StartAssessmentButton customerId={customer.id} propertyId={null} />
          </div>
        }
      />
      <AmcSectionNav current="customers" />
      <StatCardGrid columns={4}>
        <StatCard label="Contracts in force" value={summary.inForce} headline={`${summary.contracts} in total`} caption={`${summary.historical} historical · ${summary.renewals} renewals`} />
        <StatCard
          label="Active properties"
          value={summary.activeProperties}
          headline={summary.inForceContractsWithoutProperty ? `${summary.inForceContractsWithoutProperty} contract(s) without a property record` : "All linked"}
          caption="Covered by a contract in force"
        />
        <StatCard
          label="Current AMC value"
          value={<Money value={summary.currentValue} className="text-xl" />}
          headline="Contracts in force"
          caption="Incl. VAT, as signed"
        />
        <StatCard label="Additional-service quotes" value={summary.quotesIssued} headline={`${summary.quotesDraft} draft`} caption="Issued = FSM estimate linked" />
      </StatCardGrid>

      <SectionCard title="Contracts" description="Each contract separately; a customer can have several." icon={<ScrollText />} bodyClassName="pb-2">
        <ContractsTable contracts={contracts} />
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard
          title="Properties"
          icon={<Building2 />}
          bodyClassName="px-5 pb-5"
          action={
            <Button size="sm" variant="outline" onClick={() => setAddingProperty(true)}>
              <Plus className="size-4" />
              Add
            </Button>
          }
        >
          {properties.length === 0 ? (
            <p className="text-muted-foreground text-sm">No properties yet.</p>
          ) : (
            properties.map((p) => (
              <DataRow
                key={p.id}
                icon={<Building2 />}
                title={
                  <Link href={`/extensions/amc-contracts/properties/${p.id}`} className="hover:underline">
                    {p.label}
                  </Link>
                }
                subtitle={[p.unitType ? UNIT_TYPE_LABELS[p.unitType as keyof typeof UNIT_TYPE_LABELS] : null, p.address].filter(Boolean).join(" · ") || undefined}
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

      {editing ? (
        <CustomerDialog
          title="Edit customer"
          initial={{ name: customer.name, customerRef: customer.customerRef, company: customer.company, email: customer.email, phone: customer.phone, notes: customer.notes }}
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

/* ------------------------------------------------------------------ */

export function PropertyDetail({ id }: { id: string }) {
  const { data, error, loading, reload } = useAmcData(() => amcContractsService.property(id), id);
  useBreadcrumbLabel("properties", "Properties");
  useBreadcrumbLabel(id, data?.overview.property.label ?? "Property");
  const [editing, setEditing] = useState(false);

  if (loading)
    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        <HeadingSkeleton withActions />
        <SectionSkeleton />
      </div>
    );
  if (error || !data) return <ErrorState title="Could not load this property" message={error} onRetry={reload} />;
  const { property, customer, current, previous, assessments, quotes }: PropertyOverview = data.overview;

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
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="size-4" />
              Edit
            </Button>
            <StartAssessmentButton customerId={customer?.id ?? null} propertyId={property.id} />
          </div>
        }
      />
      <AmcSectionNav current="customers" />

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

      {editing ? (
        <PropertyDialog
          title="Edit property"
          initial={{
            label: property.label,
            address: property.address,
            community: property.community,
            propertyCategory: property.propertyCategory as PropertyInput["propertyCategory"],
            unitType: property.unitType as PropertyInput["unitType"],
            bedrooms: property.bedrooms,
            sizeSqft: property.sizeSqft,
            notes: property.notes,
          }}
          onOpenChange={(next) => !next && setEditing(false)}
          onSave={async (input) => {
            await amcContractsService.updateProperty(property.id, input);
            toast.success("Property saved. Signed contracts are unchanged.");
            setEditing(false);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

export function PropertyDialog({
  title,
  initial,
  onOpenChange,
  onSave,
}: {
  title: string;
  initial: PropertyInput;
  onOpenChange: (open: boolean) => void;
  onSave: (input: PropertyInput) => Promise<void>;
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
      <ActionDialogContent busy={busy} className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Signed contracts keep their own copy of the property.</DialogDescription>
        </DialogHeader>
        <PropertyFields value={value} onChange={setValue} />
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
