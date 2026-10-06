"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, ClipboardCheck, FileSignature, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { PageHeading, PillTabs, SectionCard } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, HeadingSkeleton, ListSkeleton, SectionSkeleton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { DatePickerField } from "@/components/dashboard/extensions/amc/components/date-picker-field";
import { assessmentSummary, checkAssessmentCompletion, type AssessmentResult } from "@/lib/amc/business";
import { useDebounce } from "@/hooks/use-debounce";
import { amcContractsService, type AssessmentRecord, type CustomerRecord } from "@/modules/amc-contracts/amc-contracts-service";

import { AmcSectionNav } from "./amc-section-nav";
import { CustomerSearch, PropertySelect, UNIT_TYPE_LABELS } from "./customer-pickers";
import { PropertyDialog } from "./customer-property-views";
import { formatContractDate } from "./contract-status";
import { useAmcData } from "./use-amc-data";

const ASSESSMENTS_PAGE_SIZE = 25;

const RESULT_LABELS: Record<AssessmentResult, string> = { ok: "OK", attention: "Attention required", not_applicable: "Not applicable" };
const RESULT_TONES: Record<AssessmentResult, string> = {
  ok: "bg-green-600/10 text-green-700 dark:bg-green-400/10 dark:text-green-400",
  attention: "bg-amber-600/10 text-amber-700 dark:bg-amber-400/10 dark:text-amber-400",
  not_applicable: "bg-muted text-muted-foreground",
};

/* ------------------------------------------------------------------ */
/* List                                                                 */
/* ------------------------------------------------------------------ */

export function AssessmentsPage() {
  useBreadcrumbLabel("assessments", "Assessments");
  const router = useRouter();
  const [status, setStatus] = useState<"all" | "draft" | "completed">("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const term = useDebounce(q.trim(), 250);
  const { data, error, loading, reload } = useAmcData(
    () =>
      amcContractsService.assessments({
        status: status === "all" ? undefined : status,
        q: term || undefined,
        page,
        pageSize: ASSESSMENTS_PAGE_SIZE,
      }),
    `${status}|${term}|${page}`,
  );
  const total = data?.total ?? 0;
  const firstShown = total === 0 ? 0 : page * ASSESSMENTS_PAGE_SIZE + 1;
  const lastShown = Math.min(total, (page + 1) * ASSESSMENTS_PAGE_SIZE);
  const [starting, setStarting] = useState(false);

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="AMC contracts"
        title="Property assessments"
        description="Assess a property, record what needs attention and which services to recommend, then start an AMC proposal from it."
        actions={
          <Button onClick={() => setStarting(true)}>
            <Plus className="size-4" />
            New assessment
          </Button>
        }
      />
      <AmcSectionNav current="assessments" />
      <PillTabs
        tabs={[
          { value: "all", label: "All" },
          { value: "draft", label: "Draft" },
          { value: "completed", label: "Completed" },
        ]}
        value={status}
        onChange={(v) => {
          setStatus(v as typeof status);
          setPage(0);
        }}
      />
      <SectionCard
        title="Assessments"
        icon={<ClipboardCheck />}
        bodyClassName="pb-2"
        action={<Input className="h-8 w-56" placeholder="Search" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} aria-label="Search assessments" />}
      >
        {error ? (
          <div className="px-5 pb-4">
            <ErrorState title="Could not load assessments" message={error} onRetry={reload} />
          </div>
        ) : loading ? (
          <div className="px-5 pb-4">
            <ListSkeleton rows={4} />
          </div>
        ) : data!.assessments.length === 0 ? (
          <p className="text-muted-foreground px-5 pb-4 text-sm">No assessments{term || status !== "all" ? " match" : " yet"}.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Assessment</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Property</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Assessor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-5">Proposal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data!.assessments.map((a) => (
                  <TableRow key={a.id} className="cursor-pointer" onClick={() => router.push(`/extensions/amc-contracts/assessments/${a.id}`)}>
                    <TableCell className="pl-5 font-medium">{a.assessmentNumber}</TableCell>
                    <TableCell>{a.customer?.name ?? "—"}</TableCell>
                    <TableCell>{a.property?.label ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{a.assessedOn ? formatContractDate(a.assessedOn) : "—"}</TableCell>
                    <TableCell>{a.assessorName ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-normal capitalize">
                        {a.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="pr-5">{a.proposal?.proposalNumber ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {total > ASSESSMENTS_PAGE_SIZE ? (
              <div className="text-muted-foreground flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <span className="tabular-nums">
                  Showing {firstShown} to {lastShown} of {total}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={lastShown >= total} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </SectionCard>
      {starting ? <StartAssessmentDialog onOpenChange={(next) => !next && setStarting(false)} /> : null}
    </div>
  );
}

function StartAssessmentDialog({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerRecord | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [addingProperty, setAddingProperty] = useState(false);
  const [propertyVersion, setPropertyVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const { assessment } = await amcContractsService.createAssessment({ customerId: customer?.id ?? null, propertyId });
      router.push(`/extensions/amc-contracts/assessments/${assessment.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the assessment.");
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New assessment</DialogTitle>
          <DialogDescription>Choose the customer and the property. Add them under Customers if they are new.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Label>Customer</Label>
          <CustomerSearch
            selectedId={customer?.id}
            onPick={(c) => {
              setCustomer(c);
              setPropertyId(null);
            }}
          />
          <Label>Property</Label>
          <PropertySelect customerId={customer?.id ?? null} value={propertyId} onChange={(p) => setPropertyId(p?.id ?? null)} refreshKey={propertyVersion} />
          {customer ? (
            <Button variant="link" className="h-auto justify-start p-0" onClick={() => setAddingProperty(true)}>
              Add a property for {customer.name}
            </Button>
          ) : null}
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void start()} disabled={busy || !customer}>
            {busy ? "Starting…" : "Start"}
          </Button>
        </DialogFooter>
        {addingProperty && customer ? (
          <PropertyDialog
            title={`Add property for ${customer.name}`}
            initial={{ label: "" }}
            onOpenChange={(next) => !next && setAddingProperty(false)}
            onSave={async (input) => {
              const { property } = await amcContractsService.createProperty(customer.id, input);
              setPropertyId(property.id);
              setPropertyVersion((v) => v + 1);
              setAddingProperty(false);
            }}
          />
        ) : null}
      </ActionDialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* One assessment                                                       */
/* ------------------------------------------------------------------ */

type Draft = Omit<AssessmentRecord, "customer" | "property" | "proposal"> & { customerId: string | null; propertyId: string | null };

function toDraft(a: AssessmentRecord): Draft {
  return { ...a, customerId: a.customer?.id ?? null, propertyId: a.property?.id ?? null };
}

export function AssessmentDetail({ id }: { id: string }) {
  const router = useRouter();
  const { data, error, loading, reload } = useAmcData(() => amcContractsService.assessment(id), id);
  const catalogue = useAmcData(() => amcContractsService.coverageCatalogue(), "catalogue");
  useBreadcrumbLabel("assessments", "Assessments");
  useBreadcrumbLabel(id, data?.assessment.assessmentNumber ?? "Assessment");
  const { confirm, dialog } = useConfirm();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [baseVersion, setBaseVersion] = useState<string | null>(null);

  /* Take the loaded record as the editable draft (again after each save). */
  const loadedKey = data ? `${data.assessment.id}|${data.assessment.status}|${data.assessment.createdAt}|${JSON.stringify(data.assessment.items.map((i) => i.result))}` : null;
  if (data && loadedKey !== baseVersion) {
    setBaseVersion(loadedKey);
    setDraft(toDraft(data.assessment));
  }

  const summary = useMemo(() => (draft ? assessmentSummary(draft.items) : null), [draft]);

  if (loading || !draft) {
    if (error) return <ErrorState title="Could not load this assessment" message={error} onRetry={reload} />;
    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        <HeadingSkeleton withActions />
        <SectionSkeleton />
      </div>
    );
  }
  const a = data!.assessment;
  const editable = data!.canEdit;
  const completion = checkAssessmentCompletion({ status: a.status, assessedOn: draft.assessedOn, propertyId: draft.propertyId, items: draft.items });

  const save = async (quiet = false) => {
    setBusy(true);
    try {
      await amcContractsService.updateAssessment(id, {
        assessedOn: draft.assessedOn,
        assessorName: draft.assessorName,
        propertyCategory: draft.propertyCategory,
        unitType: draft.unitType,
        bedrooms: draft.bedrooms,
        sizeSqft: draft.sizeSqft,
        occupancy: draft.occupancy,
        summary: draft.summary,
        findings: draft.findings,
        notes: draft.notes,
        recommendedServiceIds: draft.recommendedServiceIds,
        items: draft.items.map((i) => ({ itemKey: i.itemKey, result: i.result, notes: i.notes })),
      });
      if (!quiet) toast.success("Assessment saved");
      reload();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the assessment.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const complete = async () => {
    const ok = await confirm({
      title: "Complete this assessment?",
      description: "It becomes history: its answers cannot be changed afterwards.",
      confirmText: "Complete",
    });
    if (!ok) return;
    if (!(await save(true))) return;
    setBusy(true);
    try {
      await amcContractsService.completeAssessment(id);
      toast.success("Assessment completed");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not complete the assessment.");
    } finally {
      setBusy(false);
    }
  };
  const createProposal = async () => {
    setBusy(true);
    try {
      const result = await amcContractsService.proposalFromAssessment(id);
      if (result.droppedServiceIds.length) toast.warning(`Not offered on this unit type, left out: ${result.droppedServiceIds.join(", ")}.`);
      else toast.success(`Proposal ${result.proposalNumber} started as a draft. Enter the prices in the wizard.`);
      router.push(`/extensions/amc/${result.submissionId}/edit`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the proposal.");
      setBusy(false);
    }
  };
  const remove = async () => {
    const ok = await confirm({ title: "Delete this draft?", description: "Drafts can be deleted; completed assessments are kept.", confirmText: "Delete", variant: "destructive" });
    if (!ok) return;
    try {
      await amcContractsService.deleteAssessment(id);
      toast.success("Draft deleted");
      router.push("/extensions/amc-contracts/assessments");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete the draft.");
    }
  };

  const setItem = (itemKey: string, patch: Partial<Draft["items"][number]>) =>
    setDraft({ ...draft, items: draft.items.map((i) => (i.itemKey === itemKey ? { ...i, ...patch } : i)) });
  const categories = [...new Map(draft.items.map((i) => [i.categoryKey, i.categoryLabel])).entries()];
  const services = catalogue.data?.catalogue ?? [];

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      {dialog}
      <PageHeading
        eyebrow={`Assessment · ${a.status === "completed" ? "Completed" : "Draft"}`}
        title={a.assessmentNumber}
        description={[a.customer?.name, a.property?.label].filter(Boolean).join(" · ") || undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            {editable ? (
              <>
                <Button variant="ghost" onClick={() => void remove()} disabled={busy}>
                  <Trash2 className="size-4" />
                  Delete draft
                </Button>
                <Button variant="outline" onClick={() => void save()} disabled={busy}>
                  <Save className="size-4" />
                  Save
                </Button>
                <Button onClick={() => void complete()} disabled={busy || !completion.ok}>
                  <CheckCircle2 className="size-4" />
                  Complete
                </Button>
              </>
            ) : null}
            {a.status === "completed" && !a.proposal ? (
              <Button onClick={() => void createProposal()} disabled={busy}>
                <FileSignature className="size-4" />
                Create AMC proposal
              </Button>
            ) : null}
            {a.proposal ? (
              <Button asChild variant="outline">
                <Link href={`/extensions/amc/${a.proposal.id}`}>Proposal {a.proposal.proposalNumber}</Link>
              </Button>
            ) : null}
          </div>
        }
      />
      <AmcSectionNav current="assessments" />
      {editable && !completion.ok ? (
        <p className="text-muted-foreground text-sm">To complete: {completion.errors.join(" ")}</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard title="Details" icon={<ClipboardCheck />} bodyClassName="px-5 pb-5 grid gap-3">
          <div className="text-sm">
            {a.customer ? (
              <Link href={`/extensions/amc-contracts/customers/${a.customer.id}`} className="font-medium hover:underline">
                {a.customer.name}
              </Link>
            ) : (
              "No customer"
            )}
            {a.property ? (
              <>
                {" · "}
                <Link href={`/extensions/amc-contracts/properties/${a.property.id}`} className="hover:underline">
                  {a.property.label}
                </Link>
              </>
            ) : null}
          </div>
          {!a.property && editable && a.customer ? (
            <div className="grid gap-1.5">
              <Label>Property</Label>
              <PropertySelect
                customerId={a.customer.id}
                value={draft.propertyId}
                onChange={(p) => {
                  setDraft({ ...draft, propertyId: p?.id ?? null });
                  if (p) void amcContractsService.updateAssessment(id, { propertyId: p.id }).then(reload);
                }}
              />
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor="as-date">Assessment date</Label>
            {editable ? (
              <DatePickerField id="as-date" value={draft.assessedOn ?? ""} onChange={(v) => setDraft({ ...draft, assessedOn: v || null })} />
            ) : (
              <p className="text-sm">{a.assessedOn ? formatContractDate(a.assessedOn) : "—"}</p>
            )}
          </div>
          <Field label="Assessor" editable={editable} value={draft.assessorName ?? ""} onChange={(v) => setDraft({ ...draft, assessorName: v })} />
          <div className="grid grid-cols-2 gap-3">
            <SelectField
              label="Unit type"
              editable={editable}
              value={draft.unitType}
              options={Object.entries(UNIT_TYPE_LABELS)}
              onChange={(v) => setDraft({ ...draft, unitType: v })}
            />
            <SelectField
              label="Occupancy"
              editable={editable}
              value={draft.occupancy}
              options={[
                ["occupied", "Occupied"],
                ["vacant", "Vacant"],
                ["unknown", "Unknown"],
              ]}
              onChange={(v) => setDraft({ ...draft, occupancy: v })}
            />
            <Field label="Bedrooms" type="number" editable={editable} value={draft.bedrooms?.toString() ?? ""} onChange={(v) => setDraft({ ...draft, bedrooms: v === "" ? null : Number(v) })} />
            <Field label="Size (sq ft)" type="number" editable={editable} value={draft.sizeSqft?.toString() ?? ""} onChange={(v) => setDraft({ ...draft, sizeSqft: v === "" ? null : Number(v) })} />
          </div>
          <p className="text-muted-foreground text-xs">Photos and attachments are not stored yet: the portal&apos;s current upload bucket is public, so it is not used for customer properties.</p>
        </SectionCard>

        <SectionCard
          title="Checklist"
          description={summary ? `${summary.ok} OK · ${summary.attention} attention · ${summary.notApplicable} n/a · ${summary.unanswered} unanswered` : undefined}
          icon={<CheckCircle2 />}
          className="lg:col-span-2"
          bodyClassName="px-5 pb-5 space-y-5"
        >
          {draft.items.length === 0 ? <p className="text-muted-foreground text-sm">The checklist is empty. An approver can add items in Settings.</p> : null}
          {categories.map(([key, label]) => (
            <div key={key} className="space-y-2">
              <h3 className="text-sm font-medium">{label}</h3>
              <ul className="divide-y rounded-lg border">
                {draft.items
                  .filter((i) => i.categoryKey === key)
                  .map((i) => (
                    <li key={i.itemKey} className="grid gap-2 p-3 sm:grid-cols-[1fr_auto]">
                      <div className="text-sm">{i.label}</div>
                      {editable ? (
                        <div className="flex flex-wrap gap-1">
                          {(Object.keys(RESULT_LABELS) as AssessmentResult[]).map((r) => (
                            <Button
                              key={r}
                              size="sm"
                              variant={i.result === r ? "default" : "outline"}
                              className="h-7 px-2 text-xs"
                              aria-pressed={i.result === r}
                              onClick={() => setItem(i.itemKey, { result: i.result === r ? null : r })}
                            >
                              {RESULT_LABELS[r]}
                            </Button>
                          ))}
                        </div>
                      ) : (
                        <Badge variant="secondary" className={`h-fit border-none font-normal ${i.result ? RESULT_TONES[i.result] : ""}`}>
                          {i.result ? RESULT_LABELS[i.result] : "Not answered"}
                        </Badge>
                      )}
                      {editable ? (
                        <Input
                          className="h-8 sm:col-span-2"
                          placeholder="Notes"
                          value={i.notes ?? ""}
                          maxLength={1000}
                          onChange={(e) => setItem(i.itemKey, { notes: e.target.value })}
                          aria-label={`Notes for ${i.label}`}
                        />
                      ) : i.notes ? (
                        <p className="text-muted-foreground text-xs sm:col-span-2">{i.notes}</p>
                      ) : null}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </SectionCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Recommended services" description="Ticked here, they are ticked on the proposal it starts. Prices are entered in the proposal." icon={<FileSignature />} bodyClassName="px-5 pb-5">
          {services.length === 0 ? (
            <ListSkeleton rows={3} />
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {services.map((s) => (
                <li key={s.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={draft.recommendedServiceIds.includes(s.id)}
                      disabled={!editable}
                      onCheckedChange={(v) =>
                        setDraft({
                          ...draft,
                          recommendedServiceIds: v === true ? [...draft.recommendedServiceIds, s.id] : draft.recommendedServiceIds.filter((x) => x !== s.id),
                        })
                      }
                      aria-label={s.label}
                    />
                    {s.label}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard title="Summary and findings" icon={<ClipboardCheck />} bodyClassName="px-5 pb-5 grid gap-3">
          <Area label="Summary" editable={editable} value={draft.summary ?? ""} onChange={(v) => setDraft({ ...draft, summary: v })} rows={2} />
          <Area label="Findings" editable={editable} value={draft.findings ?? ""} onChange={(v) => setDraft({ ...draft, findings: v })} rows={4} />
          <Area label="Notes" editable={editable} value={draft.notes ?? ""} onChange={(v) => setDraft({ ...draft, notes: v })} rows={2} />
          {summary && summary.attentionItems.length ? (
            <div className="text-sm">
              <div className="font-medium">Needs attention</div>
              <ul className="text-muted-foreground list-disc pl-5">
                {summary.attentionItems.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </SectionCard>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, editable, type = "text" }: { label: string; value: string; onChange: (v: string) => void; editable: boolean; type?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {editable ? <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} /> : <p className="text-sm">{value || "—"}</p>}
    </div>
  );
}

function Area({ label, value, onChange, editable, rows }: { label: string; value: string; onChange: (v: string) => void; editable: boolean; rows: number }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {editable ? (
        <Textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} maxLength={5000} />
      ) : (
        <p className="text-sm whitespace-pre-wrap">{value || "—"}</p>
      )}
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  editable,
}: {
  label: string;
  value: string | null;
  options: Array<[string, string]>;
  onChange: (v: string | null) => void;
  editable: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {editable ? (
        <Select value={value ?? ""} onValueChange={(v) => onChange(v || null)}>
          <SelectTrigger aria-label={label}>
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent>
            {options.map(([k, l]) => (
              <SelectItem key={k} value={k}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <p className="text-sm">{options.find(([k]) => k === value)?.[1] ?? "—"}</p>
      )}
    </div>
  );
}
