"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  EllipsisVerticalIcon,
  FileSignature,
  Inbox,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Save,
  SearchX,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { DataTable } from "@/components/data-table";
import { IconText } from "@/components/data-table/columns/icon-text";
import { StatusSelect } from "@/components/data-table/toolbars/status-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PageHeading, SectionCard, StatCard, StatCardGrid, TabCount } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, ListSkeleton, SectionSkeleton, StatGridSkeleton, SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { DatePickerField } from "@/components/dashboard/extensions/amc/components/date-picker-field";
import { assessmentSummary, checkAssessmentCompletion, type AssessmentResult } from "@/lib/amc/business";
import { ATTENDANCE_LABELS, SITE_VISIT_ATTENDANCE, type SiteVisitAttendance } from "@/lib/amc/enquiries";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/use-debounce";
import { amcContractsService, type AssessmentRecord, type CustomerRecord } from "@/modules/amc-contracts/amc-contracts-service";

import { AmcNotificationsBell } from "./amc-notifications-bell";
import { AssessmentPhotos } from "./assessment-photos";
import { CustomerSearch, PropertySelect, UNIT_TYPE_LABELS } from "./customer-pickers";
import { PropertyDialog } from "./customer-property-views";
import { formatContractDate, formatDateTime } from "./contract-status";
import { SiteVisitStatusBadge, formatClock, fromLocalInput, toLocalInput } from "./enquiries/enquiry-ui";
import { ListToolbar } from "./enquiries/list-toolbar";
import { useUrlTab } from "./profile/use-url-tab";
import { useAmcData } from "./use-amc-data";

const RESULT_LABELS: Record<AssessmentResult, string> = { ok: "OK", attention: "Attention required", not_applicable: "Not applicable" };
const RESULT_TONES: Record<AssessmentResult, string> = {
  ok: "bg-success/10 text-success",
  attention: "bg-warning/10 text-warning",
  not_applicable: "bg-mist text-ink-soft",
};

const STATUS_FILTERS = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "completed", label: "Completed" },
] as const;

const visitHref = (id: string) => `/extensions/amc-contracts/assessments/${id}`;

/* ------------------------------------------------------------------ */
/* List                                                                 */
/* ------------------------------------------------------------------ */

/** Site visits (the assessment records), laid out like Snagging's jobs table. */
export function AssessmentsPage() {
  useBreadcrumbLabel("assessments", "Site visits");
  const router = useRouter();
  const [status, setStatus] = useState<"all" | "draft" | "completed">("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [starting, setStarting] = useState(false);
  /* Set by Refresh and cleared when the answer lands; the rows stay on screen meanwhile. */
  const [refreshing, setRefreshing] = useState(false);
  const term = useDebounce(q.trim(), 250);
  const { data, error, loading, reload } = useAmcData(
    () =>
      amcContractsService
        .assessments({ status: status === "all" ? undefined : status, q: term || undefined, page, pageSize })
        .finally(() => setRefreshing(false)),
    `${status}|${term}|${page}|${pageSize}`,
  );
  const filtered = !!term || status !== "all";
  const refresh = () => {
    setRefreshing(true);
    reload();
  };
  const resetPage = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(0);
  };

  const columns = useMemo<ColumnDef<AssessmentRecord>[]>(
    () => [
      {
        id: "client",
        header: "Client & property",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-48">
            <IdentityCell title={row.original.customer?.name ?? "No client"} subtitle={row.original.property?.label ?? "No property recorded"} />
          </div>
        ),
      },
      {
        id: "number",
        header: "Site visit",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-sm font-medium">{row.original.assessmentNumber}</span>
            {row.original.enquiryId ? <span className="text-muted-foreground text-xs">From an enquiry</span> : null}
          </div>
        ),
      },
      {
        id: "date",
        header: "Date",
        enableSorting: false,
        cell: ({ row }) => {
          const a = row.original;
          const when = a.assessedOn ? formatContractDate(a.assessedOn) : a.scheduledAt ? formatDateTime(a.scheduledAt) : null;
          return when ? (
            <IconText icon={CalendarClock} className="tabular-nums">
              {when}
            </IconText>
          ) : (
            <IconText icon={CalendarClock} muted>
              Not dated
            </IconText>
          );
        },
      },
      {
        id: "assessor",
        header: "Assessor",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.assessorName ? (
            <IconText icon={UserRound}>{row.original.assessorName}</IconText>
          ) : (
            <IconText icon={UserRound} muted>
              Unassigned
            </IconText>
          ),
      },
      {
        id: "status",
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => <SiteVisitStatusBadge status={row.original.status} />,
      },
      {
        id: "proposal",
        header: "Proposal",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.proposal ? (
            <IconText icon={FileSignature}>{row.original.proposal.proposalNumber}</IconText>
          ) : (
            <IconText icon={FileSignature} muted>
              None yet
            </IconText>
          ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        cell: ({ row }) => <SiteVisitRowActions visit={row.original} />,
      },
    ],
    [],
  );

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="Operations"
        title="Site visits"
        description="Visit a property, record what needs attention and which services to recommend, then start an AMC proposal from it."
        actions={
          <>
            <AmcNotificationsBell />
            <Button onClick={() => setStarting(true)}>
              <Plus className="size-4" />
              New site visit
            </Button>
          </>
        }
      />

      {error ? <ErrorState title="Could not load site visits" message={error} onRetry={refresh} retrying={refreshing} /> : null}

      <Card className="py-0">
        <DataTable
          data={data?.assessments ?? []}
          columns={columns}
          loading={loading}
          rowCount={data?.total ?? 0}
          pageSize={pageSize}
          currentPage={page}
          isPagination
          onPageChange={setPage}
          onPageSizeChange={resetPage(setPageSize)}
          onGlobalFilterChange={resetPage(setQ)}
          handleRowClick={(a) => router.push(visitHref(a.id))}
          toolbar={
            <ListToolbar
              search={q}
              onSearchChange={resetPage(setQ)}
              searchPlaceholder="Search by client, property or number…"
              searchLabel="Search site visits"
              loading={loading || refreshing}
              pageSize={pageSize}
              onPageSizeChange={resetPage(setPageSize)}
              onRefresh={refresh}
              filters={<StatusSelect options={STATUS_FILTERS} value={status} onChange={(v) => resetPage(setStatus)(v as typeof status)} />}
            />
          }
          emptyState={
            error ? (
              <EmptyState icon={<ClipboardCheck className="size-5" />} title="Site visits could not be loaded" description="Try again once the connection is back." />
            ) : filtered ? (
              <EmptyState
                icon={<ClipboardCheck className="size-5" />}
                title="No site visits match"
                description="Nothing matches this status or that search."
                action={{
                  label: "Show all site visits",
                  onClick: () => {
                    setStatus("all");
                    setQ("");
                    setPage(0);
                  },
                  variant: "outline",
                }}
              />
            ) : (
              <EmptyState
                icon={<ClipboardCheck className="size-5" />}
                title="No site visits yet"
                description="Start one here, or book one from an enquiry."
                action={{ label: "New site visit", onClick: () => setStarting(true) }}
              />
            )
          }
        />
      </Card>

      <NewSiteVisitDialog open={starting} onOpenChange={setStarting} />
    </div>
  );
}

/** The row's kebab: the visit, its client, its enquiry and its proposal. Clicks stay out of the row's own click. */
function SiteVisitRowActions({ visit }: { visit: AssessmentRecord }) {
  const router = useRouter();
  return (
    <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${visit.assessmentNumber}`}>
            <EllipsisVerticalIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-max">
          <DropdownMenuItem onClick={() => router.push(visitHref(visit.id))}>
            <ClipboardCheck className="mr-2 size-4" />
            Open site visit
          </DropdownMenuItem>
          {visit.customer ? (
            <DropdownMenuItem onClick={() => router.push(`/extensions/amc-contracts/customers/${visit.customer!.id}`)}>
              <UserRound className="mr-2 size-4" />
              Open client
            </DropdownMenuItem>
          ) : null}
          {visit.enquiryId ? (
            <DropdownMenuItem onClick={() => router.push(`/extensions/amc-contracts/enquiries/${visit.enquiryId}`)}>
              <Inbox className="mr-2 size-4" />
              Open enquiry
            </DropdownMenuItem>
          ) : null}
          {visit.proposal ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push(`/extensions/amc/${visit.proposal!.id}`)}>
                <FileSignature className="mr-2 size-4" />
                Proposal {visit.proposal.proposalNumber}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Always mounted and controlled; the form renders inside the content, so it starts fresh on each open. */
function NewSiteVisitDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [working, setWorking] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ActionDialogContent busy={working} className="max-h-[88vh] overflow-y-auto sm:max-w-md">
        <NewSiteVisitForm working={working} setWorking={setWorking} onOpenChange={onOpenChange} />
      </ActionDialogContent>
    </Dialog>
  );
}

function NewSiteVisitForm({ working, setWorking, onOpenChange }: { working: boolean; setWorking: (busy: boolean) => void; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerRecord | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [addingProperty, setAddingProperty] = useState(false);
  const [propertyVersion, setPropertyVersion] = useState(0);

  const start = async () => {
    setWorking(true);
    try {
      const { assessment } = await amcContractsService.createAssessment({ customerId: customer?.id ?? null, propertyId });
      toast.success(`Site visit ${assessment.assessmentNumber} started`);
      router.push(visitHref(assessment.id));
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the site visit.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>New site visit</DialogTitle>
        <DialogDescription>Starts a draft site visit for the client&apos;s property; add them under Clients first if they are new.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="grid gap-2">
          <Label>Client</Label>
          <CustomerSearch
            selectedId={customer?.id}
            onPick={(c) => {
              setCustomer(c);
              setPropertyId(null);
            }}
          />
        </div>
        <div className="grid gap-2">
          <Label>Property</Label>
          <PropertySelect customerId={customer?.id ?? null} value={propertyId} onChange={(p) => setPropertyId(p?.id ?? null)} refreshKey={propertyVersion} />
          {customer ? (
            <Button variant="link" className="h-auto justify-start p-0" onClick={() => setAddingProperty(true)}>
              Add a property for {customer.name}
            </Button>
          ) : null}
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={working}>
          Cancel
        </Button>
        <SubmitButton onClick={() => void start()} disabled={!customer} pending={working} pendingLabel="Starting…" icon={<Plus className="size-4" />}>
          Start site visit
        </SubmitButton>
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
    </>
  );
}

/* ------------------------------------------------------------------ */
/* One site visit                                                       */
/* ------------------------------------------------------------------ */

type Draft = Omit<AssessmentRecord, "customer" | "property" | "proposal"> & { customerId: string | null; propertyId: string | null };

function toDraft(a: AssessmentRecord): Draft {
  return { ...a, customerId: a.customer?.id ?? null, propertyId: a.property?.id ?? null };
}

const TABS = ["details", "checklist", "findings", "photos"] as const;

export function AssessmentDetail({ id }: { id: string }) {
  const router = useRouter();
  /* Set by Refresh and cleared when the answer lands; the page stays on screen meanwhile. */
  const [refreshing, setRefreshing] = useState(false);
  const { data, error, loading, reload } = useAmcData(
    () =>
      amcContractsService
        .assessment(id)
        .then((r) => ({ ...r, fetchedAt: Date.now() }))
        .finally(() => setRefreshing(false)),
    id,
  );
  const catalogue = useAmcData(() => amcContractsService.coverageCatalogue(), "catalogue");
  useBreadcrumbLabel("assessments", "Site visits");
  useBreadcrumbLabel(id, data?.assessment.assessmentNumber ?? "Site visit");
  const { confirm, dialog } = useConfirm();
  const { tab, setTab, isOpened } = useUrlTab(TABS, "details");

  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState<"save" | "proposal" | null>(null);
  const [baseVersion, setBaseVersion] = useState<string | null>(null);

  /* Take the loaded record as the editable draft (again after each save). */
  const loadedKey = data
    ? `${data.assessment.id}|${data.assessment.status}|${data.assessment.createdAt}|${JSON.stringify(data.assessment.items.map((i) => i.result))}|${data.assessment.attendance}|${data.assessment.scheduledAt}|${JSON.stringify(data.assessment.assetCounts)}`
    : null;
  if (data && loadedKey !== baseVersion) {
    setBaseVersion(loadedKey);
    setDraft(toDraft(data.assessment));
  }

  const summary = useMemo(() => (draft ? assessmentSummary(draft.items) : null), [draft]);

  const refresh = () => {
    setRefreshing(true);
    reload();
  };

  /* Renders straight away, before any data: the way back and Refresh. */
  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <BackToSiteVisits />
      <div className="flex items-center gap-3">
        {data ? <span className="text-muted-foreground hidden text-xs sm:inline">Updated {formatClock(data.fetchedAt)}</span> : null}
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading || refreshing} aria-label="Refresh this site visit">
          <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>
    </div>
  );

  if (error && /not found/i.test(error)) {
    return (
      <div className="flex w-full flex-1 flex-col gap-4">
        <BackToSiteVisits />
        <Card className="p-0">
          <EmptyState
            icon={<SearchX className="size-6" />}
            title="This site visit could not be found"
            description="It may have been deleted as a draft, or the link may be out of date."
            action={{ label: "Back to site visits", onClick: () => router.push("/extensions/amc-contracts/assessments"), variant: "outline" }}
          />
        </Card>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex w-full flex-1 flex-col gap-4">
        {toolbar}
        <ErrorState title="Could not load this site visit" message={error} onRetry={refresh} retrying={refreshing} />
      </div>
    );
  }
  if (loading || !data || !draft || !summary) {
    return (
      <div className="flex w-full flex-1 flex-col gap-4">
        {toolbar}
        <Skeleton className="h-32 w-full rounded-xl" />
        <StatGridSkeleton count={4} />
        <SectionSkeleton />
      </div>
    );
  }
  const a = data.assessment;
  const editable = data.canEdit;
  const busy = pending !== null;
  const completion = checkAssessmentCompletion({
    status: a.status,
    assessedOn: draft.assessedOn,
    propertyId: draft.propertyId,
    items: draft.items,
    attendance: draft.attendance,
  });

  /* The draft as the server takes it; throws on failure. */
  const persist = () =>
    amcContractsService.updateAssessment(id, {
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
      scheduledAt: draft.scheduledAt,
      attendance: draft.attendance,
      assetCounts: draft.assetCounts,
      accessNotes: draft.accessNotes,
      exclusions: draft.exclusions,
      items: draft.items.map((i) => ({ itemKey: i.itemKey, result: i.result, notes: i.notes })),
    });
  const save = async () => {
    setPending("save");
    try {
      await persist();
      toast.success("Site visit saved");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the site visit.");
    } finally {
      setPending(null);
    }
  };
  /* Saves first, then completes, while the confirmation stays open. */
  const complete = () =>
    void confirm({
      title: "Complete this site visit?",
      description: "It becomes history: its answers cannot be changed afterwards.",
      confirmText: "Complete",
      action: async () => {
        await persist();
        await amcContractsService.completeAssessment(id);
        toast.success("Site visit completed");
        reload();
      },
    });
  const createProposal = async () => {
    setPending("proposal");
    try {
      const result = await amcContractsService.proposalFromAssessment(id);
      if (result.droppedServiceIds.length) toast.warning(`Not offered on this unit type, left out: ${result.droppedServiceIds.join(", ")}.`);
      else toast.success(`Proposal ${result.proposalNumber} started as a draft. Enter the prices in the wizard.`);
      router.push(`/extensions/amc/${result.submissionId}/edit`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the proposal.");
      setPending(null);
    }
  };
  const remove = () =>
    void confirm({
      title: "Delete this draft?",
      description: "Drafts can be deleted; completed site visits are kept.",
      confirmText: "Delete",
      variant: "destructive",
      action: async () => {
        await amcContractsService.deleteAssessment(id);
        toast.success("Draft deleted");
        router.push("/extensions/amc-contracts/assessments");
      },
    });

  const setItem = (itemKey: string, patch: Partial<Draft["items"][number]>) =>
    setDraft({ ...draft, items: draft.items.map((i) => (i.itemKey === itemKey ? { ...i, ...patch } : i)) });
  const categories = [...new Map(draft.items.map((i) => [i.categoryKey, i.categoryLabel])).entries()];
  const services = catalogue.data?.catalogue ?? [];
  const answered = summary.total - summary.unanswered;
  const panel = (value: (typeof TABS)[number], children: React.ReactNode) =>
    isOpened(value) ? (
      <TabsContent value={value} forceMount className="mt-4 flex flex-col gap-6 data-[state=inactive]:hidden">
        {children}
      </TabsContent>
    ) : null;

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      {dialog}
      {toolbar}

      <Card className="gap-0 p-0">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="space-y-1">
            {a.enquiryId || draft.unitType ? (
              <div className="flex flex-wrap items-center gap-2">
                {a.enquiryId ? <Badge variant="outline">From an enquiry</Badge> : null}
                {draft.unitType ? <Badge variant="outline">{UNIT_TYPE_LABELS[draft.unitType as keyof typeof UNIT_TYPE_LABELS] ?? draft.unitType}</Badge> : null}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl">{a.assessmentNumber}</h2>
              <SiteVisitStatusBadge status={a.status} />
            </div>
            <p className="text-muted-foreground text-sm">
              {[
                a.customer?.name ?? "No client",
                a.property?.label,
                a.assessorName ? `by ${a.assessorName}` : null,
                a.assessedOn ? formatContractDate(a.assessedOn) : a.scheduledAt ? formatDateTime(a.scheduledAt) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {a.proposal ? (
              <Button asChild variant="outline">
                <Link href={`/extensions/amc/${a.proposal.id}`}>
                  <FileSignature className="size-4" />
                  Proposal {a.proposal.proposalNumber}
                </Link>
              </Button>
            ) : null}
            {editable ? (
              <>
                <SubmitButton variant="outline" onClick={() => void save()} pending={pending === "save"} pendingLabel="Saving…" disabled={busy} icon={<Save className="size-4" />}>
                  Save
                </SubmitButton>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" aria-label="More actions" disabled={busy}>
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-max">
                    {a.enquiryId ? (
                      <>
                        <DropdownMenuItem onClick={() => router.push(`/extensions/amc-contracts/enquiries/${a.enquiryId}`)}>
                          <Inbox className="mr-2 size-4" />
                          Open the enquiry
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    ) : null}
                    <DropdownMenuItem onClick={remove} className="text-destructive focus:text-destructive">
                      <Trash2 className="mr-2 size-4" />
                      Delete draft
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button onClick={complete} disabled={busy || !completion.ok}>
                  <CheckCircle2 className="size-4" />
                  Complete
                </Button>
              </>
            ) : null}
            {a.status === "completed" && !a.proposal ? (
              <SubmitButton onClick={() => void createProposal()} pending={pending === "proposal"} pendingLabel="Creating…" icon={<FileSignature className="size-4" />}>
                Create AMC proposal
              </SubmitButton>
            ) : null}
          </div>
        </div>

        {editable && !completion.ok ? (
          <div className="border-warning/30 bg-warning/5 border-t px-5 py-3">
            <p className="text-sm">To complete: {completion.errors.join(" ")}</p>
          </div>
        ) : null}
      </Card>

      <StatCardGrid columns={4}>
        <StatCard
          label="Checklist"
          value={`${answered}/${summary.total}`}
          tone={summary.total > 0 && summary.unanswered === 0 ? "good" : "neutral"}
          headline={summary.unanswered ? `${summary.unanswered} unanswered` : "Every item answered"}
          caption={`${summary.ok} OK · ${summary.notApplicable} not applicable`}
          onSelect={() => setTab("checklist")}
        />
        <StatCard
          label="Needs attention"
          value={summary.attention}
          tone={summary.attention ? "progress" : "neutral"}
          headline={summary.attention ? "Items to put right" : "Nothing flagged"}
          caption="From the checklist"
          onSelect={() => setTab("findings")}
        />
        <StatCard
          label="Recommended services"
          value={draft.recommendedServiceIds.length}
          headline="Ticked on the proposal it starts"
          caption="Prices are entered in the proposal"
          onSelect={() => setTab("findings")}
        />
        <StatCard
          label="Visit"
          value={draft.attendance ? (ATTENDANCE_LABELS[draft.attendance as SiteVisitAttendance] ?? draft.attendance) : "Not recorded"}
          headline={draft.scheduledAt ? formatDateTime(draft.scheduledAt) : "Not booked for a time"}
          caption="Attendance"
          onSelect={() => setTab("details")}
        />
      </StatCardGrid>

      <Tabs value={tab} onValueChange={setTab}>
        {/* Wraps onto a second line on a narrow screen rather than scrolling sideways. */}
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 group-data-horizontal/tabs:h-auto">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="checklist">
            Checklist
            <TabCount value={summary.total} />
          </TabsTrigger>
          <TabsTrigger value="findings">
            Findings and services
            <TabCount value={summary.attention} />
          </TabsTrigger>
          <TabsTrigger value="photos">Photos</TabsTrigger>
        </TabsList>

        {panel(
          "details",
          <div className="grid gap-6 lg:grid-cols-2">
            <SectionCard
              title="Visit"
              description={
                a.enquiryId
                  ? "Booked from an enquiry. Record whether it took place, how to get in, and what is left out."
                  : "When the visit is, whether it took place, how to get in, and what is left out."
              }
              icon={<CalendarClock />}
              bodyClassName="px-5 pb-5 grid gap-4 sm:grid-cols-2"
              action={
                a.enquiryId ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/extensions/amc-contracts/enquiries/${a.enquiryId}`}>Open the enquiry</Link>
                  </Button>
                ) : null
              }
            >
              <div className="grid gap-2">
                <Label htmlFor="as-visit-at">Visit date and time</Label>
                {editable ? (
                  <Input id="as-visit-at" type="datetime-local" value={toLocalInput(draft.scheduledAt)} onChange={(e) => setDraft({ ...draft, scheduledAt: fromLocalInput(e.target.value) })} />
                ) : (
                  <ReadValue>{a.scheduledAt ? formatDateTime(a.scheduledAt) : null}</ReadValue>
                )}
              </div>
              <SelectField
                label="Attendance"
                editable={editable}
                value={draft.attendance}
                options={SITE_VISIT_ATTENDANCE.map((v) => [v, ATTENDANCE_LABELS[v]])}
                onChange={(v) => setDraft({ ...draft, attendance: v })}
              />
              <Area label="Access notes" editable={editable} value={draft.accessNotes ?? ""} onChange={(v) => setDraft({ ...draft, accessNotes: v })} rows={2} className="sm:col-span-2" />
              <Area label="Exclusions" editable={editable} value={draft.exclusions ?? ""} onChange={(v) => setDraft({ ...draft, exclusions: v })} rows={2} className="sm:col-span-2" />
            </SectionCard>

            <SectionCard title="Property" description="The client, the property and what was found there." icon={<ClipboardCheck />} bodyClassName="px-5 pb-5 grid gap-4">
              <div className="text-sm">
                {a.customer ? (
                  <Link href={`/extensions/amc-contracts/customers/${a.customer.id}`} className="font-medium hover:underline">
                    {a.customer.name}
                  </Link>
                ) : (
                  "No client"
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
                <div className="grid gap-2">
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
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="as-date">Visited on</Label>
                  {editable ? (
                    <DatePickerField id="as-date" value={draft.assessedOn ?? ""} onChange={(v) => setDraft({ ...draft, assessedOn: v || null })} />
                  ) : (
                    <ReadValue>{a.assessedOn ? formatContractDate(a.assessedOn) : null}</ReadValue>
                  )}
                </div>
                <Field label="Assessor" editable={editable} value={draft.assessorName ?? ""} onChange={(v) => setDraft({ ...draft, assessorName: v })} />
                <SelectField label="Unit type" editable={editable} value={draft.unitType} options={Object.entries(UNIT_TYPE_LABELS)} onChange={(v) => setDraft({ ...draft, unitType: v })} />
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
            </SectionCard>
          </div>,
        )}

        {panel(
          "checklist",
          <SectionCard
            title="Checklist"
            description={`${summary.ok} OK · ${summary.attention} attention · ${summary.notApplicable} n/a · ${summary.unanswered} unanswered`}
            icon={<CheckCircle2 />}
            bodyClassName={draft.items.length === 0 ? "border-t" : "px-5 pb-5 space-y-5"}
          >
            {draft.items.length === 0 ? (
              <EmptyState icon={<CheckCircle2 className="size-5" />} title="The checklist is empty" description="An approver can add items in Settings." />
            ) : null}
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
                          <Badge variant="secondary" className={cn("h-fit border-0 font-medium", i.result ? RESULT_TONES[i.result] : "bg-mist text-ink-soft")}>
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
          </SectionCard>,
        )}

        {panel(
          "findings",
          <div className="grid gap-6 lg:grid-cols-2">
            <SectionCard
              title="Recommended services"
              description="Ticked here, they are ticked on the proposal it starts, with the units counted on site. Prices are entered in the proposal."
              icon={<FileSignature />}
              bodyClassName="px-5 pb-5"
            >
              {services.length === 0 ? (
                <ListSkeleton rows={3} />
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {services.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2">
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
                      {draft.recommendedServiceIds.includes(s.id) ? (
                        editable ? (
                          <Input
                            type="number"
                            min={1}
                            max={10000}
                            className="h-7 w-20"
                            placeholder="Units"
                            value={draft.assetCounts[s.id] ?? ""}
                            onChange={(e) => {
                              const next = { ...draft.assetCounts };
                              const n = Math.trunc(Number(e.target.value));
                              if (e.target.value === "" || !Number.isFinite(n) || n < 1) delete next[s.id];
                              else next[s.id] = Math.min(n, 10000);
                              setDraft({ ...draft, assetCounts: next });
                            }}
                            aria-label={`Units counted for ${s.label}`}
                          />
                        ) : (
                          <span className="text-muted-foreground text-xs tabular-nums">{draft.assetCounts[s.id] ?? 1} unit(s)</span>
                        )
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
            <SectionCard title="Summary and findings" icon={<ClipboardCheck />} bodyClassName="px-5 pb-5 grid gap-4">
              <Area label="Summary" editable={editable} value={draft.summary ?? ""} onChange={(v) => setDraft({ ...draft, summary: v })} rows={2} />
              <Area label="Findings" editable={editable} value={draft.findings ?? ""} onChange={(v) => setDraft({ ...draft, findings: v })} rows={4} />
              <Area label="Notes" editable={editable} value={draft.notes ?? ""} onChange={(v) => setDraft({ ...draft, notes: v })} rows={2} />
              {summary.attentionItems.length ? (
                <div className="border-warning/30 bg-warning/5 rounded-md border px-3 py-2 text-sm">
                  <div className="font-medium">Needs attention</div>
                  <ul className="text-muted-foreground list-disc pl-5">
                    {summary.attentionItems.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </SectionCard>
          </div>,
        )}

        {panel("photos", <AssessmentPhotos assessmentId={a.id} editable={editable} completed={a.status === "completed"} />)}
      </Tabs>
    </div>
  );
}

function BackToSiteVisits() {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
      <Link href="/extensions/amc-contracts/assessments">
        <ArrowLeft className="size-4" />
        Site visits
      </Link>
    </Button>
  );
}

/** A read-only value under its label: an em dash when empty. */
function ReadValue({ children, multiline = false }: { children: React.ReactNode; multiline?: boolean }) {
  return children === null || children === undefined || children === "" ? (
    <p className="text-muted-foreground text-sm">—</p>
  ) : (
    <p className={cn("text-sm font-medium", multiline && "whitespace-pre-wrap")}>{children}</p>
  );
}

function Field({ label, value, onChange, editable, type = "text" }: { label: string; value: string; onChange: (v: string) => void; editable: boolean; type?: string }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {editable ? <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} /> : <ReadValue>{value}</ReadValue>}
    </div>
  );
}

function Area({ label, value, onChange, editable, rows, className }: { label: string; value: string; onChange: (v: string) => void; editable: boolean; rows: number; className?: string }) {
  return (
    <div className={cn("grid gap-2", className)}>
      <Label>{label}</Label>
      {editable ? <Textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} maxLength={5000} /> : <ReadValue multiline>{value}</ReadValue>}
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
    <div className="grid gap-2">
      <Label>{label}</Label>
      {editable ? (
        <Select value={value ?? ""} onValueChange={(v) => onChange(v || null)}>
          <SelectTrigger className="w-full" aria-label={label}>
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
        <ReadValue>{options.find(([k]) => k === value)?.[1]}</ReadValue>
      )}
    </div>
  );
}
