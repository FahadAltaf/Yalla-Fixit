"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import {
  ArrowLeft,
  Boxes,
  Building2,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  EllipsisVerticalIcon,
  FileSignature,
  Inbox,
  SquarePen,
  Plus,
  Lock,
  SearchX,
  TriangleAlert,
  ShieldCheck,
  Undo2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { DataTable } from "@/components/data-table";
import { IconText } from "@/components/data-table/columns/icon-text";
import { StatusSelect } from "@/components/data-table/toolbars/status-select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import DateTimeSelect from "@/components/ui/date-time-select";
import { PageHeading, SectionCard, StatCard, StatCardGrid, SubHeading } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, ListSkeleton, SectionSkeleton, StatGridSkeleton, SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { assessmentSummary, type AssessmentResult } from "@/lib/amc/business";
import { ATTENDANCE_LABELS, type SiteVisitAttendance } from "@/lib/amc/enquiries";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/use-debounce";
import { amcContractsService, type AssessmentRecord, type CustomerRecord } from "@/modules/amc-contracts/amc-contracts-service";
import { fieldVisitsService } from "@/modules/amc-contracts/field-visits-service";

import { AssessmentPhotos } from "./assessment-photos";
import { SiteVisitApproversNote } from "./approver-field";
import { SendBackDialog, SiteVisitChangesCard, SiteVisitPropertyLists } from "./site-visit-changes";
import { SiteVisitChecklistCard } from "./approver-checklist";
import { CustomerSearch, UNIT_TYPE_LABELS } from "./customer-pickers";
import { formatContractDate, formatDateTime } from "./contract-status";
import { AddressDialog, useAddressFormAccess } from "./address-dialog";
import { DetailHeaderCard, DetailHeaderSkeleton, DetailToolbar, shortPlace } from "./detail-header";
import { EditClientDialog } from "./edit-client-dialog";
import { EnquiryPropertySelect } from "./enquiries/enquiry-property-select";
import { PropertyPickerField } from "./property-picker-field";
import { AssessorPicker } from "./assessor-picker";
import { HeadingIconButton, SiteVisitStatusBadge, fromLocalInput, toLocalInput } from "./enquiries/enquiry-ui";
import { ListToolbar } from "./enquiries/list-toolbar";
import { useUrlTab } from "./profile/use-url-tab";
import { useAmcData } from "./use-amc-data";
import { HistoryPanel } from "./visit-page";
import { SiteVisitAccessCard } from "./access-card";
import { ModuleGuide } from "@/components/dashboard/extensions/amc-contracts/module-guide";

import { Fact } from "@/components/dashboard/extensions/amc/steps/review-step";
import { formatPhone, phoneHref } from "@/lib/phone/format-phone";
const RESULT_LABELS: Record<AssessmentResult, string> = {
  ok: "OK",
  attention: "Attention required",
  not_applicable: "Not applicable",
};
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
        .assessments({
          status: status === "all" ? undefined : status,
          q: term || undefined,
          page,
          pageSize,
        })
        .finally(() => setRefreshing(false)),
    `${status}|${term}|${page}|${pageSize}`,
  );
  const filtered = !!term || status !== "all";
  const refresh = () => {
    setRefreshing(true);
    reload();
  };
  const resetPage =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
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
        header: "Inspector",
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
        info={<ModuleGuide module="siteVisits" />}
        description="Visit a property, record what needs attention and which services to recommend, then start an AMC proposal from it."
        actions={
          <>
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
                action={{
                  label: "New site visit",
                  onClick: () => setStarting(true),
                }}
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
            <DropdownMenuItem onClick={() => router.push(`/clients/${visit.customer!.id}`)}>
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

/** Always mounted and controlled; the form renders inside the content, so it starts fresh on each open. Also on AMC -> Visits. */
export function NewSiteVisitDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
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

  const start = async () => {
    setWorking(true);
    try {
      const { assessment } = await amcContractsService.createAssessment({
        customerId: customer?.id ?? null,
        propertyId,
      });
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
          {customer ? (
            <PropertyPickerField clientId={customer.id} clientName={customer.name} requireComplete propertyId={propertyId} onChange={(id) => setPropertyId(id)} />
          ) : (
            <p className="text-muted-foreground text-sm">Choose the client first.</p>
          )}
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
    </>
  );
}

/* ------------------------------------------------------------------ */
/* One site visit                                                       */
/* ------------------------------------------------------------------ */

type Draft = Omit<AssessmentRecord, "customer" | "property" | "proposal"> & {
  customerId: string | null;
  propertyId: string | null;
};

/** A checklist group: the office's category, or the name the inspector gave an on-site one. */
const checkGroup = (i: { categoryKey: string; categoryLabel: string }) => (i.categoryKey === "custom" ? `custom:${i.categoryLabel}` : i.categoryKey);

function toDraft(a: AssessmentRecord): Draft {
  return {
    ...a,
    customerId: a.customer?.id ?? null,
    propertyId: a.property?.id ?? null,
  };
}

/* access (17 Nov 2026): the property's access rules and the passes, as a planned visit has. */
const TABS = ["details", "access", "report", "property", "history"] as const;

export function AssessmentDetail({ id }: { id: string }) {
  const router = useRouter();
  /* Set by Refresh and cleared when the answer lands; the page stays on screen meanwhile. */
  const [refreshing, setRefreshing] = useState(false);
  /* When the visit was read, for "Updated" beside Refresh. */
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const { data, error, loading, reload } = useAmcData(
    () =>
      amcContractsService
        .assessment(id)
        .then((result) => {
          setFetchedAt(Date.now());
          return result;
        })
        .finally(() => setRefreshing(false)),
    id,
  );
  const catalogue = useAmcData(() => amcContractsService.coverageCatalogue(), "catalogue");
  /* Who can be the assessor: only for someone who can edit the visit, and from the shared (cached) list. */
  const assessors = useAmcData(() => (data?.canEdit ? amcContractsService.siteVisitPeople() : Promise.resolve({ people: [], me: "" })), data?.canEdit ? "assessors" : "no-assessors");
  useBreadcrumbLabel("assessments", "Site visits");
  useBreadcrumbLabel(id, data?.assessment.assessmentNumber ?? "Site visit");
  const { confirm, dialog } = useConfirm();
  const { tab, setTab, isOpened } = useUrlTab(TABS, "details");
  /* What happened to the visit (booked, moved, attended, completed …), read when its tab first opens. */
  const history = useAmcData(() => (isOpened("history") ? fieldVisitsService.history(id) : Promise.resolve(null)), isOpened("history") ? `site-visit-history:${id}` : "history:none");
  const addressForm = useAddressFormAccess();
  const [addingAddress, setAddingAddress] = useState(false);
  /* How many photos the visit has, from the photos card (the Report tab's figure). */
  const [photoCount, setPhotoCount] = useState<number | null>(null);
  const countPhotos = useCallback((n: number) => setPhotoCount(n), []);
  /* The shared client or address record, edited in place as on the job's Setup tab. */
  const [editingRecord, setEditingRecord] = useState<"client" | "property" | null>(null);
  /* The section being edited in its dialog. */
  /* Whether the chosen inspector has been found free at the time in the Edit the visit dialog. */
  const [inspectorReady, setInspectorReady] = useState(false);
  /* The approver's Send back dialog (16 Nov 2026). */
  const [sendingBack, setSendingBack] = useState(false);
  const [section, setSection] = useState<"visit" | "services" | "findings" | null>(null);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState<"save" | "proposal" | "attendance" | null>(null);
  const [baseVersion, setBaseVersion] = useState<string | null>(null);

  /* Take the loaded record as the editable draft (again after each save). */
  const loadedKey = data
    ? `${data.assessment.id}|${data.assessment.status}|${data.assessment.createdAt}|${data.assessment.property?.id ?? ""}|${JSON.stringify(data.assessment.items.map((i) => i.result))}|${data.assessment.attendance}|${data.assessment.scheduledAt}|${JSON.stringify(data.assessment.assetCounts)}`
    : null;
  if (data && loadedKey !== baseVersion) {
    setBaseVersion(loadedKey);
    setDraft(toDraft(data.assessment));
  }

  const summary = useMemo(() => (draft ? assessmentSummary(draft.items) : null), [draft]);

  const refresh = () => {
    setRefreshing(true);
    reload();
    history.reload();
  };

  if (error && /not found/i.test(error)) {
    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        <BackToSiteVisits />
        <Card className="p-0">
          <EmptyState
            icon={<SearchX className="size-6" />}
            title="This site visit could not be found"
            description="It may have been deleted as a draft, or the link may be out of date."
            action={{
              label: "Back to site visits",
              onClick: () => router.push("/extensions/amc-contracts/assessments"),
              variant: "outline",
            }}
          />
        </Card>
      </div>
    );
  }

  const a = data?.assessment ?? null;
  const ready = Boolean(a && draft && summary) && !error;
  const editable = Boolean(data?.canEdit);
  const busy = pending !== null;

  /* A draft as the server takes it; throws on failure. */
  const persistDraft = (draft: Draft) =>
    amcContractsService.updateAssessment(id, {
      /* Changed in the visit's dialog: the assessor (a portal user, whose name the server fills in). */
      ...(draft.assessorId !== (data?.assessment.assessorId ?? null) && draft.assessorId ? { assessorId: draft.assessorId } : {}),
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
      items: draft.items.map((i) => ({
        itemKey: i.itemKey,
        result: i.result,
        notes: i.notes,
      })),
    });
  /*
    Edit the visit saves only what it edits (16 Nov 2026). Sending the whole
    draft wrote back the checklist, attendance and findings as this page last
    read them, over anything the inspector had since saved on the phone.
  */
  const saveVisit = async (next: Draft) => {
    await amcContractsService.updateAssessment(id, {
      ...(next.assessorId !== (data?.assessment.assessorId ?? null) && next.assessorId ? { assessorId: next.assessorId } : {}),
      scheduledAt: next.scheduledAt,
      accessNotes: next.accessNotes,
      exclusions: next.exclusions,
    });
    setDraft(next);
    toast.success("Site visit saved");
    reload();
  };
  /* A section's dialog saves the visit with its changes straight away; the page shows what is saved. */
  const saveSection = async (next: Draft) => {
    await persistDraft(next);
    setDraft(next);
    toast.success("Site visit saved");
    reload();
  };
  /* Asked first (11 Nov 2026): it acts at once, so it is confirmed like every other step. */
  /*
    The named approver approves a completed visit: the scope and asset
    changes the inspector made on site go onto the property (16 Nov 2026).
  */
  const changes = data?.changes ?? [];
  const canApprove = Boolean(data?.canApprove);
  const awaitingApproval = Boolean(a && a.status === "completed" && a.approverId && !a.approvedAt);
  const stage = a ? siteVisitStage(a) : { label: "", tone: "neutral" as const, caption: "" };
  const approve = () =>
    void confirm({
      title: "Approve this site visit?",
      description: changes.length
        ? `The ${changes.length} change${changes.length === 1 ? "" : "s"} to the property's scope and assets recorded on site go onto the property, and the visit is closed. This can't be undone.`
        : "The visit is closed. Nothing on the property changes: no scope or asset changes were recorded on site.",
      confirmText: "Approve",
      action: async () => {
        await amcContractsService.approveAssessment(id);
        toast.success(changes.length ? "Site visit approved; the property is updated" : "Site visit approved");
        reload();
      },
    });
  const sendBack = async (reason: string) => {
    await amcContractsService.sendBackAssessment(id, reason);
    toast.success("Sent back to the inspector");
    reload();
  };
  const createProposal = () =>
    void confirm({ title: "Create an AMC proposal from this site visit?", description: "Starts a draft proposal with this visit's client, property and recommended services, then opens it to enter the prices. Nothing is sent to the client.", confirmText: "Create proposal" }).then((ok) => {
      if (ok) void createProposalNow();
    });
  const createProposalNow = async () => {
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
  const notAttended = Boolean(draft?.attendance && draft.attendance !== "attended");

  /* The property picked (or just added): saved on the visit straight away, as it is not part of the draft's form. */
  const linkProperty = async (propertyId: string | null) => {
    if (!draft || !propertyId) return;
    setDraft({ ...draft, propertyId });
    try {
      await amcContractsService.updateAssessment(id, { propertyId });
      toast.success("Property linked to the site visit");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not link the property.");
    }
  };

  const people = assessors.data?.people ?? [];
  /* In progress once the inspector records it as attended (as AMC -> Visits): its time and inspector are then fixed. */
  const inProgress = data?.assessment.attendance === "attended";
  const movesOrReassigns = (d: Draft) =>
    (d.assessorId ?? null) !== (data?.assessment.assessorId ?? null) ||
    (d.scheduledAt ? Date.parse(d.scheduledAt) : null) !== (data?.assessment.scheduledAt ? Date.parse(data.assessment.scheduledAt) : null);
  /*
    Groups as the inspector named them: checks added on the mobile app all
    have the key "custom" with their own category name, so grouping by key
    alone put every one of them under a single heading (16 Nov 2026).
  */
  /* The checklist items flagged as needing attention, with their notes (the Report tab). */
  const attentionItems = draft ? draft.items.filter((i) => i.result === "attention") : [];
  /*
    The checklist as the inspector recorded it on the phone (24 Nov 2026): only
    items answered or noted. Items a visit was once created with and nobody
    answered are not shown; the office sets nothing here.
  */
  const recorded = draft ? draft.items.filter((i) => i.result || i.notes?.trim()) : [];
  /* The findings one per line, as the inspector typed them (bullets, dashes or numbers taken off). */
  const findingLines = findingList(draft?.findings);
  const recordedGroups = [...new Map(recorded.map((i) => [checkGroup(i), i.categoryLabel])).entries()];
  const services = catalogue.data?.catalogue ?? [];
  const panel = (value: (typeof TABS)[number], children: React.ReactNode) =>
    isOpened(value) ? (
      <TabsContent value={value} forceMount className="mt-4 flex flex-col gap-4 data-[state=inactive]:hidden">
        {children}
      </TabsContent>
    ) : null;
  const unitLabel = (v: string | null | undefined) => (v ? (UNIT_TYPE_LABELS[v as keyof typeof UNIT_TYPE_LABELS] ?? v) : null);

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      {dialog}
      {/* As the client page: the way back and Refresh, then the visit's card with what it can do. */}
      <DetailToolbar backHref="/extensions/amc-contracts/visits?kind=site_visit" backLabel="Visits" fetchedAt={fetchedAt} refreshing={refreshing || loading} onRefresh={refresh} />

      {!ready || !a ? (
        error ? null : (
          <DetailHeaderSkeleton />
        )
      ) : (
        <DetailHeaderCard
          badges={
            <>
              <Badge variant="outline">Site visit</Badge>
              <Badge variant="outline" className="tabular-nums">
                {a.assessmentNumber}
              </Badge>
              {a.enquiryId ? <Badge variant="outline">From an enquiry</Badge> : null}
            </>
          }
          title={a.customer?.name || "Site visit"}
          status={
            <Badge variant="secondary" className={cn("border-0 font-medium", STAGE_TONE_CLASSES[stage.tone])}>
              {stage.label}
            </Badge>
          }
          subline={[
            shortPlace(a.property?.label) ?? "No property yet",
            a.scheduledAt ? formatDateTime(a.scheduledAt) : "Not booked yet",
            a.assessorName ?? null,
            a.approverName ? `Approver: ${a.approverName}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          actions={
            <>
              {ready && a ? (
                <>
                  {a.enquiryId ? (
                    <Button asChild variant="outline">
                      <Link href={`/extensions/amc-contracts/enquiries/${a.enquiryId}`}>
                        <Inbox className="size-4" />
                        Open the enquiry
                      </Link>
                    </Button>
                  ) : null}
                  {a.proposal ? (
                    <Button asChild variant="outline">
                      <Link href={`/extensions/amc/${a.proposal.id}`}>
                        <FileSignature className="size-4" />
                        Proposal {a.proposal.proposalNumber}
                      </Link>
                    </Button>
                  ) : null}
                  {/* Gone once the inspector submits the visit from the mobile app (23 Nov 2026): it is final then. */}
                  {editable && draft ? (
                    <>
                      {/*
                        Attendance, the checklist, counts, findings and photos come from
                        the inspector's mobile app (16 Nov 2026): no attendance menu
                        here. The office can still move the visit or change who goes.
                      */}
                      <Button variant="outline" onClick={() => setSection("visit")} disabled={busy}>
                        <SquarePen className="size-4" />
                        Edit the visit
                      </Button>
                      {/* No Delete draft for now (16 Nov 2026). */}
                      {/* No Complete here (16 Nov 2026): the inspector completes the visit on the mobile app. */}
                    </>
                  ) : null}
                  {canApprove ? (
                    <>
                      <Button variant="outline" onClick={() => setSendingBack(true)} disabled={busy}>
                        <Undo2 className="size-4" />
                        Send back
                      </Button>
                      <Button onClick={approve} disabled={busy}>
                        <ShieldCheck className="size-4" />
                        Approve
                      </Button>
                    </>
                  ) : null}
                  {/* A proposal once the visit is approved (or, for a visit booked before approvals, once complete). */}
                  {a.status === "completed" && !a.proposal && (!a.approverId || a.approvedAt) ? (
                    <SubmitButton onClick={() => void createProposal()} pending={pending === "proposal"} pendingLabel="Creating…" icon={<FileSignature className="size-4" />}>
                      Create AMC proposal
                    </SubmitButton>
                  ) : null}
                </>
              ) : null}
            </>
          }
        />
      )}

      {error ? (
        <ErrorState title="Could not load this site visit" message={error} onRetry={refresh} retrying={refreshing} />
      ) : !ready || !a || !draft || !summary ? (
        <SiteVisitBodySkeleton tab={tab} />
      ) : (
        <div className="flex flex-col gap-4">
          {a.status === "draft" && a.sentBackReason ? (
            <Alert variant="warning">
              <Undo2 />
              <AlertTitle>Sent back by {a.approverName ?? "the approver"}</AlertTitle>
              <AlertDescription>
                {a.sentBackReason}
                {a.sentBackAt ? ` (${formatDateTime(a.sentBackAt)})` : ""}. The inspector puts it right on the app and completes it again.
              </AlertDescription>
            </Alert>
          ) : null}
          {awaitingApproval ? (
            <Alert>
              <ShieldCheck />
              <AlertTitle>{canApprove ? "Ready for your approval" : `Waiting for ${a.approverName ?? "the approver"} to approve`}</AlertTitle>
              <AlertDescription>
                {canApprove
                  ? `${a.assessorName ?? "The inspector"} completed the visit. Check its changes on the Scope and assets tab, then approve it (they go onto the property) or send it back.`
                  : `${a.assessorName ?? "The inspector"} completed the visit. The changes to the property's scope and assets (Scope and assets tab) go onto it once ${a.approverName ?? "the approver"} approves.`}
              </AlertDescription>
            </Alert>
          ) : null}
          {/* What the approver checks (23 Nov 2026): what approving changes, and what the visit recorded. */}
          {awaitingApproval && data?.checklist ? <SiteVisitChecklistCard checklist={data.checklist} canApprove={canApprove} /> : null}
          {a.status === "completed" && !a.proposal && (!a.approverId || a.approvedAt) ? (
            <Alert variant="success">
              <CheckCircle2 />
              <AlertTitle>{a.approvedAt ? "The site visit is approved" : "The site visit is complete"}</AlertTitle>
              {/* Create AMC proposal is in the header; the banner only says what it does. */}
              <AlertDescription>Use Create AMC proposal above: the recommended services are ticked, with the units counted on site.</AlertDescription>
            </Alert>
          ) : null}

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="h-auto w-full flex-wrap justify-start gap-1 group-data-horizontal/tabs:h-auto">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="access">Access</TabsTrigger>
              <TabsTrigger value="report">Report</TabsTrigger>
              <TabsTrigger value="property">Scope and assets</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>

            {panel(
              "details",
              <>
                {/* The four answers somebody opens a site visit for. */}
                <StatCardGrid columns={4}>
                  <StatCard
                    label="Status"
                    value={stage.label}
                    headline={stage.caption}
                    caption={a.approverName ? `Approver: ${a.approverName}` : `Site visit ${a.assessmentNumber}${a.enquiryId ? " · from an enquiry" : ""}`}
                    tone={stage.tone === "good" ? "good" : stage.tone === "bad" ? "bad" : stage.tone === "neutral" ? "neutral" : "progress"}
                  />
                  <StatCard
                    label="Attendance"
                    value={draft.attendance ? (ATTENDANCE_LABELS[draft.attendance as SiteVisitAttendance] ?? draft.attendance) : "Not yet"}
                    tone={draft.attendance === "attended" ? "good" : notAttended ? "bad" : "neutral"}
                    headline={draft.attendance ? "Recorded on the mobile app" : `Recorded by ${a.assessorName ?? "the inspector"} on site`}
                    caption={draft.assessedOn ? `Visited on ${formatContractDate(draft.assessedOn)}` : "No visit date yet"}
                  />
                  <StatCard
                    label="Needs attention"
                    value={summary.attention}
                    tone={summary.attention ? "progress" : "neutral"}
                    headline={summary.attention ? "Items to put right" : "Nothing flagged"}
                    caption="From the checklist"
                    onSelect={() => setTab("report")}
                    selectLabel="Open the findings"
                  />
                  <StatCard
                    label="Recommended services"
                    value={draft.recommendedServiceIds.length}
                    headline="Ticked on the proposal it starts"
                    caption="Prices are entered in the proposal"
                    onSelect={() => setTab("report")}
                    selectLabel="Open the recommended services"
                  />
                </StatCardGrid>


                {/* 27 Nov 2026 (the user): the proposal's design -- the client and the property as facts in one grid. */}
                <SectionCard
                  title="Client & property"
                  icon={<Building2 />}
                  description="Who the visit is for and the property being assessed."
                  bodyClassName="px-5 pb-5 grid gap-4"
                  action={
                    a.property ? (
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/extensions/amc-contracts/properties/${a.property.id}?tab=assets&view=scope`}>
                          <Boxes className="size-3.5" />
                          Assets and scope
                        </Link>
                      </Button>
                    ) : null
                  }
                >
                  <dl className="grid gap-x-6 gap-y-4 rounded-lg border p-4 sm:grid-cols-2 xl:grid-cols-4">
                    <Fact
                      label="Customer"
                      action={a.customer ? <HeadingIconButton label="Edit client" icon={<SquarePen />} onClick={() => setEditingRecord("client")} /> : null}
                    >
                      {a.customer ? (
                        <Link href={`/clients/${a.customer.id}`} className="hover:text-brand underline underline-offset-2">
                          {a.customer.name}
                        </Link>
                      ) : null}
                    </Fact>
                    <Fact label="Customer ID">{a.customer?.customerRef}</Fact>
                    <Fact label="Phone">
                      {a.customer?.phone ? (
                        <a href={phoneHref(a.customer.phone)} className="hover:text-brand underline underline-offset-2">
                          {formatPhone(a.customer.phone)}
                        </a>
                      ) : null}
                    </Fact>
                    <Fact label="Email">
                      {a.customer?.email ? (
                        <a href={`mailto:${a.customer.email}`} className="hover:text-brand underline underline-offset-2">
                          {a.customer.email}
                        </a>
                      ) : null}
                    </Fact>
                    <Fact
                      label="Property detail"
                      action={a.property && addressForm && a.customer ? <HeadingIconButton label="Edit property" icon={<SquarePen />} onClick={() => setEditingRecord("property")} /> : null}
                    >
                      {a.property ? (
                        <Link href={`/extensions/amc-contracts/properties/${a.property.id}`} className="hover:text-brand underline underline-offset-2">
                          {a.property.label}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground font-normal">Not linked yet</span>
                      )}
                    </Fact>
                    <Fact label="Building">{a.property?.buildingName}</Fact>
                    <Fact label="Community">{a.property?.community}</Fact>
                    <Fact label="Property category">{draft.propertyCategory ? capitalise(draft.propertyCategory) : null}</Fact>
                    <Fact label="Unit type">{unitLabel(draft.unitType)}</Fact>
                    <Fact label="Bedrooms">{a.property?.bedrooms == null ? null : a.property.bedrooms === 0 ? "Studio" : String(a.property.bedrooms)}</Fact>
                    <Fact label="Built-up area">{sqftText(a.property?.builtUpSqft)}</Fact>
                  </dl>
                  {!a.property && editable && a.customer ? (
                    <div className="grid gap-2">
                      <EnquiryPropertySelect
                        customerId={a.customer.id}
                        clientName={a.customer.name}
                        requireComplete
                        value={draft.propertyId}
                        onChange={(pid) => void linkProperty(pid)}
                        onAddNew={addressForm ? () => setAddingAddress(true) : undefined}
                      />
                      <p className="text-muted-foreground text-xs">The property is needed to complete the visit. Pick one of the client&apos;s addresses, or add a new one.</p>
                    </div>
                  ) : null}
                </SectionCard>

                <SectionCard
                  title="Visit"
                  icon={<CalendarClock />}
                  description={`${a.enquiryId ? "Booked from an enquiry. " : ""}When it is, who goes and who approves; the attendance and the notes come from the inspector's app.`}
                  bodyClassName="px-5 pb-5 grid gap-5"
                >
                  {/*
                    Redesigned (16 Nov 2026): the four facts someone opens a visit
                    for as tiles, then the notes.
                    Read only here; Edit the visit in the header changes the time,
                    inspector and notes. The approvers come from AMC configuration.
                  */}
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <VisitFact
                      icon={<CalendarClock />}
                      label="Booked for"
                      value={draft.scheduledAt ? formatDateTime(draft.scheduledAt) : null}
                      empty="Not booked yet"
                      sub={a.enquiryId ? "From an enquiry" : "Booked from the client or property"}
                    />
                    <VisitFact icon={<UserRound />} label="Inspector" value={draft.assessorName} empty="Not assigned" sub="Records the visit on the mobile app" />
                    <VisitFact
                      icon={<ShieldCheck />}
                      label="Approvers"
                      value={a.approverName}
                      empty="Not set"
                      sub={
                        a.approvedAt
                          ? `Approved ${formatDateTime(a.approvedAt)}`
                          : awaitingApproval
                            ? "Waiting for their approval"
                            : a.approverId
                              ? "Any one of them approves it once completed"
                              : a.status === "completed"
                                ? "Completed before approvals were needed"
                                : "Set in AMC configuration"
                      }
                      tone={a.approvedAt ? "good" : awaitingApproval ? "warn" : undefined}
                    />
                    <VisitFact
                      icon={<CheckCircle2 />}
                      label="Attendance"
                      value={draft.attendance ? (ATTENDANCE_LABELS[draft.attendance as SiteVisitAttendance] ?? draft.attendance) : null}
                      empty="Not recorded yet"
                      sub={draft.assessedOn ? `Visited on ${formatContractDate(draft.assessedOn)}` : "Recorded on site"}
                      tone={draft.attendance === "attended" ? "good" : notAttended ? "bad" : undefined}
                    />
                  </div>

                  <div className="grid gap-5 lg:grid-cols-2">
                    <div className="flex min-w-0 flex-col space-y-2">
                      <SubHeading>Access notes</SubHeading>
                      <TextBlock empty="No access notes.">{draft.accessNotes}</TextBlock>
                    </div>
                    <div className="flex min-w-0 flex-col space-y-2">
                      <SubHeading>Exclusions</SubHeading>
                      <TextBlock empty="Nothing left out.">{draft.exclusions}</TextBlock>
                    </div>
                  </div>
                </SectionCard>
              </>,
            )}

            {/*
              The inspector's report in one place (16 Nov 2026): what they
              concluded first (findings and the services to recommend), then
              the checklist behind it, then the photos. It was three tabs.
            */}
            {panel("access", <SiteVisitAccessCard assessmentId={a.id} />)}
            {panel(
              "report",
              <>
                {/*
                  Redesigned (16 Nov 2026): the inspector's own words across the
                  top, what they recommend beside what they flagged, then the
                  checklist behind it, then the photos.
                */}
                {/*
                  25 Nov 2026: laid out as the call out's job sheet: the report at
                  a glance in four figures, then the visit's times as tiles.
                */}
                <StatCardGrid columns={4}>
                  <StatCard
                    label="Report"
                    value={a.status === "completed" ? "Completed" : draft.attendance ? "Being filled in" : "Not started"}
                    headline={a.completedAt ? `Completed ${dubaiDay(a.completedAt)}, ${dubaiTime(a.completedAt)}` : "Filled in by the inspector on the mobile app"}
                    caption={
                      a.approvedAt
                        ? `Approved${a.approverName ? ` by ${a.approverName}` : ""}`
                        : a.sentBackAt
                          ? "Sent back to the inspector"
                          : a.status === "completed"
                            ? "Waiting for approval"
                            : `By ${a.assessorName ?? "the inspector"}`
                    }
                    tone={a.approvedAt ? "good" : a.sentBackAt ? "bad" : a.status === "completed" ? "review" : "neutral"}
                  />
                  <StatCard
                    label="Recommended services"
                    value={draft.recommendedServiceIds.length}
                    headline={
                      draft.recommendedServiceIds.length
                        ? `${draft.recommendedServiceIds.reduce((n, sid) => n + (draft.assetCounts[sid] ?? 1), 0)} units counted on site`
                        : "None yet"
                    }
                    tone={draft.recommendedServiceIds.length ? "good" : "neutral"}
                  />
                  <StatCard
                    label="Checklist"
                    value={recorded.length ? `${summary?.ok ?? 0} / ${recorded.length}` : "0"}
                    headline={!recorded.length ? "No checks yet" : summary?.attention ? `${summary.attention} need attention` : "All OK"}
                    tone={!recorded.length ? "neutral" : summary?.attention ? "bad" : "good"}
                  />
                  <StatCard
                    label="Photos"
                    value={photoCount ?? "…"}
                    headline={photoCount === null ? "Loading" : photoCount ? "From the mobile app" : "None yet"}
                    tone={photoCount ? "good" : "neutral"}
                  />
                </StatCardGrid>

                <SectionCard
                  title="Times"
                  icon={<CalendarClock />}
                  description="When the visit was booked for, when the inspector was there, and when the report was completed."
                  bodyClassName="px-5 pb-5"
                >
                  <VisitTimeTiles
                    tiles={[
                      {
                        label: "Booked for",
                        icon: <CalendarClock />,
                        value: a.scheduledAt ? dubaiTime(a.scheduledAt) : null,
                        sub: a.scheduledAt ? dubaiDay(a.scheduledAt) : null,
                        empty: "Not booked",
                      },
                      {
                        label: "Visited",
                        icon: <CalendarCheck />,
                        value: draft.assessedOn ? visitDay(draft.assessedOn) : null,
                        sub:
                          [draft.assessedOn ? visitWeekday(draft.assessedOn) : null, draft.attendance ? (ATTENDANCE_LABELS[draft.attendance as SiteVisitAttendance] ?? draft.attendance) : null]
                            .filter(Boolean)
                            .join(" · ") || null,
                        empty: "Not yet",
                      },
                      {
                        label: "Completed",
                        icon: <CheckCircle2 />,
                        value: a.completedAt ? dubaiTime(a.completedAt) : null,
                        sub: a.completedAt ? dubaiDay(a.completedAt) : "When the inspector completes the report",
                        empty: "Not yet",
                      },
                    ]}
                  />
                </SectionCard>

                {/*
                  The inspector's words as the call out's job sheet reads its own
                  (25 Nov 2026): the summary as text across the card, each finding
                  on its own numbered row, the notes in a soft box under them.
                */}
                <SectionCard
                  title="Summary and findings"
                  icon={<ClipboardCheck />}
                  description="Written by the inspector on site."
                  bodyClassName="px-5 pb-5"
                  action={findingLines.length ? <Badge variant="secondary">{findingLines.length} finding{findingLines.length === 1 ? "" : "s"}</Badge> : undefined}
                >
                  <div className="grid gap-5">
                    <div className="grid gap-2">
                      <SubHeading>Summary</SubHeading>
                      {draft.summary?.trim() ? (
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{draft.summary.trim()}</p>
                      ) : (
                        <ReportEmpty text="No summary yet" />
                      )}
                    </div>

                    <div className="grid gap-2 border-t pt-5">
                      <SubHeading>Findings</SubHeading>
                      {findingLines.length ? (
                        <ul className="divide-y overflow-hidden rounded-lg border">
                          {findingLines.map((line, i) => (
                            <li key={i} className="flex items-start gap-3 px-4 py-3">
                              <span className="bg-muted/50 text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md border text-xs font-semibold tabular-nums">
                                {i + 1}
                              </span>
                              <span className="min-w-0 flex-1 pt-0.5 text-sm leading-relaxed">{line}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <ReportEmpty text="No findings recorded" />
                      )}
                    </div>

                    <div className="grid gap-2 border-t pt-5">
                      <SubHeading>Notes</SubHeading>
                      {draft.notes?.trim() ? (
                        <p className="bg-muted/30 rounded-lg border px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">{draft.notes.trim()}</p>
                      ) : (
                        <ReportEmpty text="No notes" />
                      )}
                    </div>
                  </div>
                </SectionCard>

                <div className="grid items-stretch gap-4 lg:grid-cols-2">
                  <SectionCard
                    title="Recommended services"
                    description="Ticked on the proposal it starts, with the units counted on site."
                    icon={<FileSignature />}
                    className="h-full"
                    bodyClassName="px-5 pb-5"
                    action={draft.recommendedServiceIds.length ? <Badge variant="secondary">{draft.recommendedServiceIds.length}</Badge> : undefined}
                  >
                    {services.length === 0 ? (
                      <ListSkeleton rows={3} />
                    ) : draft.recommendedServiceIds.length === 0 ? (
                      <div className="rounded-lg border border-dashed">
                        <EmptyState
                          icon={<FileSignature className="size-5" />}
                          title="No services recommended yet"
                          description={a.status === "draft" ? "The inspector recommends them on the mobile app, with the units counted on site." : "None were recommended on this visit."}
                        />
                      </div>
                    ) : (
                      <ul className="divide-y rounded-lg border">
                        {draft.recommendedServiceIds.map((sid) => {
                          const units = draft.assetCounts[sid] ?? 1;
                          const svc = services.find((x) => x.id === sid);
                          return (
                            <li key={sid} className="flex items-center gap-3 px-3 py-2.5">
                              <span aria-hidden className="bg-brand-50 text-brand flex size-8 shrink-0 items-center justify-center rounded-md [&_svg]:size-4">
                                <FileSignature />
                              </span>
                              <span className="min-w-0 flex-1 truncate text-sm font-medium">{svc?.label ?? sid}</span>
                              <Badge variant="secondary" className="shrink-0 tabular-nums">
                                {units} unit{units === 1 ? "" : "s"}
                              </Badge>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </SectionCard>

                  <SectionCard
                    title="Needs attention"
                    description="What the inspector flagged on the checklist, with their notes."
                    icon={<TriangleAlert />}
                    className="h-full"
                    bodyClassName="px-5 pb-5"
                    action={attentionItems.length ? <Badge variant="secondary" className="bg-warning/10 text-warning border-0">{attentionItems.length}</Badge> : undefined}
                  >
                    {attentionItems.length === 0 ? (
                      <div className="rounded-lg border border-dashed">
                        <EmptyState icon={<CheckCircle2 className="size-5" />} title="Nothing flagged" description={draft.items.length ? "No checklist item needs attention." : "Items the inspector flags on the checklist show here."} />
                      </div>
                    ) : (
                      <ul className="divide-y rounded-lg border">
                        {attentionItems.map((i) => (
                          <li key={i.itemKey} className="flex items-start gap-3 px-3 py-2.5">
                            <span aria-hidden className="bg-warning/10 text-warning mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md [&_svg]:size-4">
                              <TriangleAlert />
                            </span>
                            <span className="min-w-0 flex-1 text-sm">
                              <span className="block font-medium">{i.label}</span>
                              <span className="text-muted-foreground block text-xs">{i.categoryLabel}</span>
                              {i.notes ? <span className="mt-1 block text-sm">{i.notes}</span> : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </SectionCard>
                </div>

                <SectionCard
                  title="Checklist"
                  description="Recorded by the inspector on site in the mobile app. Read only here."
                  icon={<CheckCircle2 />}
                  bodyClassName="px-5 pb-5"
                  action={
                    recorded.length ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary" className={cn("border-0 font-medium tabular-nums", RESULT_TONES.ok)}>{summary.ok} OK</Badge>
                        <Badge variant="secondary" className={cn("border-0 font-medium tabular-nums", RESULT_TONES.attention)}>{summary.attention} attention</Badge>
                        {summary.notApplicable ? <Badge variant="secondary" className={cn("border-0 font-medium tabular-nums", RESULT_TONES.not_applicable)}>{summary.notApplicable} n/a</Badge> : null}
                      </div>
                    ) : undefined
                  }
                >
                  {recorded.length === 0 ? (
                    <div className="rounded-lg border border-dashed">
                      <EmptyState icon={<CheckCircle2 className="size-5" />} title="Nothing recorded yet" description="The inspector builds and answers the checklist on site in the mobile app; it shows here as their phone syncs." />
                    </div>
                  ) : (
                    /* Groups side by side on a wide screen, each one list. */
                    <div className="grid items-start gap-4 lg:grid-cols-2">
                      {recordedGroups.map(([key, label]) => {
                        const rows = recorded.filter((i) => checkGroup(i) === key);
                        return (
                          <div key={key} className="min-w-0 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <SubHeading>{label}</SubHeading>
                              <span className="text-muted-foreground text-xs tabular-nums">{rows.length} item{rows.length === 1 ? "" : "s"}</span>
                            </div>
                            <ul className="divide-y overflow-hidden rounded-lg border">
                              {rows.map((i) => (
                                <li key={i.itemKey} className="flex items-center gap-3 px-4 py-3">
                                  <span className="bg-muted/50 text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md border [&_svg]:size-4">
                                    {i.result === "ok" ? (
                                      <CheckCircle2 className="text-success" />
                                    ) : i.result === "attention" ? (
                                      <TriangleAlert className="text-warning" />
                                    ) : (
                                      <CircleDashed />
                                    )}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium" title={i.label}>
                                      {i.label}
                                    </span>
                                    {i.notes ? <span className="text-muted-foreground mt-0.5 block text-sm leading-relaxed">{i.notes}</span> : null}
                                  </span>
                                  <Badge variant="secondary" className={cn("shrink-0 border-0 font-medium", i.result ? RESULT_TONES[i.result] : "bg-mist text-ink-soft")}>
                                    {i.result ? RESULT_LABELS[i.result] : "Not answered"}
                                  </Badge>
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </SectionCard>
                <AssessmentPhotos assessmentId={a.id} editable={false} completed={a.status === "completed"} onCount={countPhotos} />
              </>,
            )}

            {panel(
              "property",
              <>
                {/* What the visit changes on the property, beside what was, for the approver (16 Nov 2026). */}
                {changes.length ? (
                  <SiteVisitChangesCard
                    changes={changes}
                    approved={Boolean(a.approvedAt)}
                    approverName={a.approverName}
                    serviceLabel={(sid) => services.find((x) => x.id === sid)?.label ?? sid}
                  />
                ) : null}
                {/* The property's scope and assets as the inspector recorded them on the mobile app. */}
                <SiteVisitPropertyLists
                  assets={data?.siteAssets ?? []}
                  scope={data?.siteScope ?? []}
                  serviceLabel={(sid) => services.find((x) => x.id === sid)?.label ?? sid}
                  pendingFor={a.approverId && !a.approvedAt ? (a.approverName ?? "the approver") : null}
                />
              </>,
            )}
            {panel("history", <HistoryPanel data={history} description="Everything that happened to this site visit, newest first: when it was created, booked, attended and completed." />)}
          </Tabs>
        </div>
      )}

      {canApprove && a ? <SendBackDialog open={sendingBack} onOpenChange={setSendingBack} inspectorName={a.assessorName} onSend={sendBack} /> : null}
      {draft ? (
        <>
          <SectionDialog
            open={section === "visit"}
            onOpenChange={(open) => !open && setSection(null)}
            title="Edit the visit"
            description={
              inProgress
                  ? "The visit is in progress, so its date, time and inspector stay as they are. How to get in and what is left out can still change."
                  : "When it is, who goes, how to get in and what is left out. The rest is recorded by the inspector on the mobile app."
            }
            initial={draft}
            onSave={saveVisit}
            canSave={(d) => inProgress || !movesOrReassigns(d) || inspectorReady}
            saveHint="Find available inspectors first: the inspector has to be free at the new time."
          >
            {(d, set) => (
              <div className="grid gap-4">
                {inProgress ? (
                  /* Attended on the phone: shown, not changed (the server refuses it too). */
                  <div className="bg-muted/30 grid gap-3 rounded-lg border px-4 py-3 sm:grid-cols-2">
                    <div className="grid gap-1">
                      <span className="text-muted-foreground text-xs">Visit date and time</span>
                      <span className="text-sm font-medium">{d.scheduledAt ? formatDateTime(d.scheduledAt) : "Not booked"}</span>
                    </div>
                    <div className="grid gap-1">
                      <span className="text-muted-foreground text-xs">Inspector</span>
                      <span className="text-sm font-medium">{d.assessorName ?? "Not assigned"}</span>
                    </div>
                    <p className="text-muted-foreground flex items-center gap-1.5 text-xs sm:col-span-2">
                      <Lock className="size-3.5 shrink-0" aria-hidden />
                      Locked: the inspector has recorded the visit as attended.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid min-w-0 content-start gap-2">
                      <Label htmlFor="as-visit-at">Visit date and time</Label>
                      <DateTimeSelect id="as-visit-at" value={toLocalInput(d.scheduledAt)} onChange={(value) => set({ ...d, scheduledAt: fromLocalInput(value) })} />
                    </div>
                    <div className="grid min-w-0 content-start gap-2">
                      <Label>Inspector</Label>
                      <AssessorPicker
                        people={people}
                        value={d.assessorId}
                        scheduledAt={d.scheduledAt}
                        ignoreAssessmentId={data?.assessment.id ?? null}
                        onChange={(pid, name) => set({ ...d, assessorId: pid, assessorName: name })}
                        onReadyChange={setInspectorReady}
                      />
                    </div>
                  </>
                )}
                <SiteVisitApproversNote />
                <Area label="Access notes" editable value={d.accessNotes ?? ""} onChange={(v) => set({ ...d, accessNotes: v })} rows={3} />
                <Area label="Exclusions" editable value={d.exclusions ?? ""} onChange={(v) => set({ ...d, exclusions: v })} rows={3} />
              </div>
            )}
          </SectionDialog>

          {/* No checklist dialog (24 Nov 2026): the inspector answers it on the phone; the office only reads it. */}
          <SectionDialog
            open={section === "services"}
            onOpenChange={(open) => !open && setSection(null)}
            title="Recommended services"
            description="Tick the services to offer and the units counted on site. They are ticked on the proposal the visit starts."
            initial={draft}
            onSave={saveSection}
            wide
          >
            {(d, set) => (
              <ul className="grid gap-2 sm:grid-cols-2">
                {services.map((s) => (
                  <li key={s.id} className="flex min-h-8 items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={d.recommendedServiceIds.includes(s.id)}
                        onCheckedChange={(v) =>
                          set({
                            ...d,
                            recommendedServiceIds: v === true ? [...d.recommendedServiceIds, s.id] : d.recommendedServiceIds.filter((x) => x !== s.id),
                          })
                        }
                        aria-label={s.label}
                      />
                      {s.label}
                    </label>
                    {d.recommendedServiceIds.includes(s.id) ? (
                      <Input
                        type="number"
                        min={1}
                        max={10000}
                        className="h-7 w-20"
                        placeholder="Units"
                        value={d.assetCounts[s.id] ?? ""}
                        onChange={(e) => {
                          const next = { ...d.assetCounts };
                          const n = Math.trunc(Number(e.target.value));
                          if (e.target.value === "" || !Number.isFinite(n) || n < 1) delete next[s.id];
                          else next[s.id] = Math.min(n, 10000);
                          set({ ...d, assetCounts: next });
                        }}
                        aria-label={`Units counted for ${s.label}`}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </SectionDialog>

          <SectionDialog
            open={section === "findings"}
            onOpenChange={(open) => !open && setSection(null)}
            title="Summary and findings"
            description="What the visit found, in words the proposal and the client can use."
            initial={draft}
            onSave={saveSection}
          >
            {(d, set) => (
              <div className="grid gap-4">
                <Area label="Summary" editable value={d.summary ?? ""} onChange={(v) => set({ ...d, summary: v })} rows={2} />
                <Area label="Findings" editable value={d.findings ?? ""} onChange={(v) => set({ ...d, findings: v })} rows={4} />
                <Area label="Notes" editable value={d.notes ?? ""} onChange={(v) => set({ ...d, notes: v })} rows={2} />
              </div>
            )}
          </SectionDialog>
        </>
      ) : null}

      {a?.customer ? <EditClientDialog open={editingRecord === "client"} onOpenChange={(open) => !open && setEditingRecord(null)} customerId={a.customer.id} onSaved={reload} /> : null}
      {a?.customer && a.property && addressForm ? (
        <AddressDialog
          open={editingRecord === "property"}
          onOpenChange={(open) => !open && setEditingRecord(null)}
          clientId={a.customer.id}
          clientName={a.customer.name}
          propertyId={a.property.id}
          editing
          onSaved={() => {
            setEditingRecord(null);
            toast.success("Property saved");
            reload();
          }}
        />
      ) : null}

      {/* A new address on the Clients page's form, with its pin on the map; linked to the visit once saved. */}
      {a?.customer && addressForm ? (
        <AddressDialog
          open={addingAddress}
          onOpenChange={setAddingAddress}
          clientId={a.customer.id}
          clientName={a.customer.name}
          defaults={{
            unitType: draft?.unitType,
            propertyCategory: draft?.propertyCategory,
          }}
          onSaved={(propertyId) => {
            setAddingAddress(false);
            void linkProperty(propertyId);
          }}
        />
      ) : null}
    </div>
  );
}

/** The loading shape of the tab being opened, so the page does not jump when it lands. */
type StageTone = "neutral" | "progress" | "warn" | "good" | "bad";
const STAGE_TONE_CLASSES: Record<StageTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  progress: "bg-brand-50 text-brand",
  warn: "bg-warning/10 text-warning",
  good: "bg-success/10 text-success",
  bad: "bg-danger/10 text-danger",
};

/**
 * Where a site visit stands (16 Nov 2026), from everything known about it
 * rather than its bare draft/completed status: booked, in progress on site,
 * sent back by the approver, awaiting approval, approved; or what the
 * inspector recorded instead (client not there, cancelled, rescheduled).
 */
function siteVisitStage(a: AssessmentRecord): { label: string; tone: StageTone; caption: string } {
  if (a.approvedAt) return { label: "Approved", tone: "good", caption: `Approved ${formatDateTime(a.approvedAt)}` };
  if (a.status === "completed") {
    return a.approverId
      ? { label: "Awaiting approval", tone: "warn", caption: `Completed${a.completedAt ? ` ${formatDateTime(a.completedAt)}` : ""}; waiting for ${a.approverName ?? "the approver"}` }
      : { label: "Completed", tone: "good", caption: a.completedAt ? `Completed ${formatDateTime(a.completedAt)}` : "Completed on site" };
  }
  if (a.sentBackAt) return { label: "Sent back", tone: "warn", caption: `By ${a.approverName ?? "the approver"} ${formatDateTime(a.sentBackAt)}; the inspector is putting it right` };
  if (a.attendance === "attended") return { label: "In progress", tone: "progress", caption: "Attended; the inspector is filling it in on site" };
  if (a.attendance === "cancelled") return { label: "Cancelled", tone: "bad", caption: "Recorded as cancelled on site" };
  if (a.attendance === "client_no_show") return { label: "Client not available", tone: "bad", caption: "The client was not there on the day" };
  if (a.attendance === "rescheduled") return { label: "Rescheduled", tone: "warn", caption: "To be booked again" };
  if (a.scheduledAt) return { label: "Booked", tone: "neutral", caption: `For ${formatDateTime(a.scheduledAt)}` };
  return { label: "To book", tone: "neutral", caption: "No date yet" };
}

/** One fact about the visit, as a tile: an icon, what it is, the answer and a line under it. */
function VisitFact({
  icon,
  label,
  value,
  empty,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null | undefined;
  empty: string;
  sub?: string;
  tone?: "good" | "warn" | "bad";
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-lg border px-4 py-3">
      <span
        aria-hidden
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-md border [&_svg]:size-4",
          tone === "good" ? "border-success/30 bg-success/10 text-success" : tone === "warn" ? "border-warning/30 bg-warning/10 text-warning" : tone === "bad" ? "border-danger/30 bg-danger/10 text-danger" : "bg-muted/50 text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-muted-foreground block text-xs">{label}</span>
        <span className={cn("block truncate text-sm font-medium", !value && "text-muted-foreground font-normal")}>{value || empty}</span>
        {sub ? <span className="text-muted-foreground block truncate text-xs">{sub}</span> : null}
      </span>
    </div>
  );
}

function SiteVisitBodySkeleton({ tab }: { tab: (typeof TABS)[number] }) {
  return (
    <div className="flex flex-col gap-4" aria-label="Loading the site visit">
      <Skeleton className="h-9 w-full rounded-lg" />
      {tab === "details" ? (
        <>
          <StatGridSkeleton count={4} />
          <SectionSkeleton />
          <SectionSkeleton />
        </>
      ) : (
        <SectionSkeleton />
      )}
    </div>
  );
}

const capitalise = (v: string) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : v);

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

/** A paragraph the visit recorded, in a box the height of its column, as the enquiry shows what the client needs. */
function TextBlock({ children, empty }: { children: string | null | undefined; empty: string }) {
  return children?.trim() ? (
    <p className="bg-muted/30 flex-1 rounded-lg border p-4 text-sm leading-relaxed whitespace-pre-wrap">{children}</p>
  ) : (
    <p className="text-muted-foreground flex-1 rounded-lg border border-dashed p-4 text-sm">{empty}</p>
  );
}

/**
 * One section of the visit edited in a dialog: a copy of the visit is taken
 * when it opens, the section's fields change the copy, and Save writes it.
 * Cancel leaves the page as it was.
 */
function SectionDialog({
  open,
  onOpenChange,
  title,
  description,
  initial,
  onSave,
  wide = false,
  canSave,
  saveHint,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  initial: Draft;
  onSave: (draft: Draft) => Promise<void>;
  wide?: boolean;
  /** Save waits until this says yes (with `saveHint` saying why). */
  canSave?: (draft: Draft) => boolean;
  saveHint?: string;
  children: (draft: Draft, set: (next: Draft | ((current: Draft) => Draft)) => void) => React.ReactNode;
}) {
  const [local, setLocal] = useState(initial);
  const [busy, setBusy] = useState(false);
  /* A fresh copy each time it opens, taken during render, so a cancelled edit never shows again. */
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setLocal(initial);
  }
  const save = async () => {
    setBusy(true);
    try {
      await onSave(local);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the site visit.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className={cn("flex max-h-[90dvh] flex-col", wide ? "sm:max-w-3xl" : "sm:max-w-2xl")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6 py-1">{children(local, setLocal)}</div>
        <DialogFooter className="items-center">
          {canSave && !canSave(local) && saveHint ? <p className="text-muted-foreground mr-auto text-xs">{saveHint}</p> : null}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton onClick={() => void save()} pending={busy} pendingLabel="Saving…" disabled={canSave ? !canSave(local) : false}>
            Save
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
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

function Area({ label, value, onChange, editable, rows, className }: { label: string; value: string; onChange: (v: string) => void; editable: boolean; rows: number; className?: string }) {
  return (
    <div className={cn("grid gap-2", className)}>
      <Label>{label}</Label>
      {editable ? <Textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} maxLength={5000} /> : <ReadValue multiline>{value}</ReadValue>}
    </div>
  );
}

/* Times and days in Dubai, whatever the computer is set to (as the job sheet). */
const dubaiTime = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }).format(new Date(iso));
const dubaiDay = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" }).format(new Date(iso));

/* A date-only day (YYYY-MM-DD): "24 Nov", and its weekday and year under it. */
const visitDay = (date: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
const visitWeekday = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  return `${new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(d)}, ${d.getUTCFullYear()}`;
};

/** The visit's moments as tiles, the value large and the day under it (as the call out's Times). */
function VisitTimeTiles({ tiles }: { tiles: Array<{ label: string; icon: React.ReactNode; value: string | null; sub: string | null; empty: string }> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {tiles.map((tile) => (
        <div key={tile.label} className="bg-muted/30 flex items-start gap-3 rounded-lg border px-4 py-3">
          <span className="bg-background text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md border [&_svg]:size-4">{tile.icon}</span>
          <div className="min-w-0">
            <div className="text-muted-foreground text-xs">{tile.label}</div>
            <div className={cn("text-xl font-semibold tabular-nums", !tile.value && "text-muted-foreground text-base font-medium")}>{tile.value ?? tile.empty}</div>
            {tile.sub ? <div className="text-muted-foreground text-xs">{tile.sub}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Findings as separate items: one per line, without the bullet, dash or number the inspector started it with. */
function findingList(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[\u2022\u2023\u25e6\u2043\u2219*\-\u2013\u2014]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

/** An empty part of the report, as the job sheet's empty boxes: dashed, with a short line. */
function ReportEmpty({ text }: { text: string }) {
  return <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-4 text-center text-sm">{text}</p>;
}

const sqftText = (n: number | null | undefined) => (n == null ? null : `${Number(n).toLocaleString("en-AE")} sq ft`);
